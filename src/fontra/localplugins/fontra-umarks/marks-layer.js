// The "ghosts" layer, from the rules (step 4 quater): what the rules would
// put around the glyph being edited, drawn on the canvas.
//
//   on a base      every accent of every rule that has it for base, each on
//                  its anchor, superposed (a stacked accent on the one under it)
//   on a composed  the result of its own rule: the base and its accents where
//                  Make would put them — so a glyph that has drifted shows it
//   on an accent   every base of every rule that uses it, each under it at
//                  its anchor
//
// The panel's menu can keep only one rule (a display setting, per glyph, in
// localStorage — not data of the font). Live while an anchor is dragged: the
// open glyph is the one the editor is drawing, the others come from a cache.
// See docs/brief.md § 4.3.
//
// `draw` has to be synchronous and glyph instances arrive asynchronously, so
// everything is drawn from a cache: a miss draws nothing, starts the load, and
// asks the canvas to come back. The cache is keyed by glyph and location, and
// emptied whenever a glyph changes.

import { composeLayer } from "./compose.js";

export const GHOSTS_LAYER_IDENTIFIER = "umarks.ghosts";
export const GHOSTS_SETTINGS_KEY = "umarks.ghosts";
export const GHOSTS_CHOICE_KEY = "umarks.ghosts.choice";

const DEFAULT_SETTINGS = { enabled: true, opacity: 0.25 };

/**
 * The rules that give a glyph its ghosts, and what the glyph is to them:
 * {kind: "composed" | "base" | "mark" | null, names: [rule names]}. A
 * composed glyph has its own rule; a base, the rules built on it; an accent,
 * the rules that use it. `codePointOf` sorts the names the way the font reads.
 */
export function ghostRules(glyphName, rules = {}, codePointOf = () => undefined) {
  const order = (names) =>
    names.sort((a, b) => {
      const ca = codePointOf(a) ?? Infinity;
      const cb = codePointOf(b) ?? Infinity;
      return ca - cb || (a < b ? -1 : a > b ? 1 : 0);
    });
  if (rules[glyphName]) {
    return { kind: "composed", names: [glyphName] };
  }
  const asBase = Object.keys(rules).filter((name) => rules[name].base === glyphName);
  if (asBase.length) {
    return { kind: "base", names: order(asBase) };
  }
  const asMark = Object.keys(rules).filter((name) =>
    (rules[name].marks || []).some((mark) => mark.glyph === glyphName)
  );
  if (asMark.length) {
    return { kind: "mark", names: order(asMark) };
  }
  return { kind: null, names: [] };
}

function locationKey(location) {
  return Object.keys(location || {})
    .sort()
    .map((axis) => `${axis}=${location[axis]}`)
    .join(",");
}

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(GHOSTS_SETTINGS_KEY) || "{}");
    return {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : true,
      opacity:
        typeof stored.opacity === "number" && stored.opacity >= 0 && stored.opacity <= 1
          ? stored.opacity
          : DEFAULT_SETTINGS.opacity,
    };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(GHOSTS_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // a private window, or storage turned off: the setting just won't persist
  }
}

function readChoices() {
  try {
    const stored = JSON.parse(localStorage.getItem(GHOSTS_CHOICE_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch (error) {
    return {};
  }
}

function writeChoices(choices) {
  try {
    localStorage.setItem(GHOSTS_CHOICE_KEY, JSON.stringify(choices));
  } catch (error) {
    // as for the settings: it just won't persist
  }
}

// what a problem of compose.js reads as on the foot of the panel (6b § 4)
const PROBLEM_WORDS = {
  "missing-anchor": "an anchor is missing",
  "missing-glyph": "a part is not in the font",
  "no-outline": "a part is not drawn",
  "unknown-stack": "a mark has nothing to stack on",
  "mark-outside-advance": "a mark falls outside the advance",
  "missing-source": "a part lacks a source",
  "source-skipped": "a source is left out",
};

export class GhostsLayer {
  /**
   * @param editorController Fontra's editor controller
   * @param getRulesData     () => the rules document, for the mark a rule picks
   */
  constructor(editorController, getRulesData = () => null) {
    this.editorController = editorController;
    this.fontController = editorController.fontController;
    this.getRulesData = getRulesData;

    this.settings = readSettings();
    this.choices = readChoices(); // glyphName -> the one rule to show
    this.instances = new Map(); // "glyph@location" -> instance | null
    this.loading = new Set();
    this.lastPlan = { glyphName: null, kind: null, ghosts: [], rules: [], choice: null, note: null };
    this.onPlanChange = null;
  }

  // --- settings, which the panel drives

  setEnabled(enabled) {
    this.settings = { ...this.settings, enabled: !!enabled };
    writeSettings(this.settings);
    this.requestUpdate();
  }

  setOpacity(opacity) {
    this.settings = { ...this.settings, opacity };
    writeSettings(this.settings);
    this.requestUpdate();
  }

  /** The one rule shown on this glyph, or null for all of them. */
  choiceFor(glyphName) {
    return this.choices[glyphName] ?? null;
  }

  setChoice(glyphName, ruleName) {
    const choices = { ...this.choices };
    if (ruleName) {
      choices[glyphName] = ruleName;
    } else {
      delete choices[glyphName];
    }
    this.choices = choices;
    writeChoices(choices);
    this.requestUpdate();
  }

  requestUpdate() {
    this.editorController.canvasController.requestUpdate();
  }

  /** Everything cached about the font's glyphs is suspect again. */
  invalidate() {
    this.instances.clear();
    this.requestUpdate();
  }

  /** Listen for the changes that make a ghost wrong. */
  attach() {
    this.fontController.addChangeListener({ glyphs: null }, () => this.invalidate());
    this.fontController.addChangeListener({ glyphMap: null }, () => this.invalidate());
  }

  // --- the glyph instances the ghosts are drawn from

  instanceFor(glyphName, location) {
    const key = `${glyphName}@${locationKey(location)}`;
    if (this.instances.has(key)) {
      return this.instances.get(key);
    }
    if (!this.loading.has(key)) {
      this.loading.add(key);
      this.fontController
        .getGlyphInstance(glyphName, location)
        .then((instance) => {
          this.instances.set(key, instance || null);
          this.loading.delete(key);
          this.requestUpdate();
        })
        .catch(() => {
          this.instances.set(key, null);
          this.loading.delete(key);
        });
    }
    return undefined; // not yet: draw nothing, come back when it lands
  }

  // --- what to draw

  codePointOf(glyphName) {
    return this.fontController.glyphMap?.[glyphName]?.[0];
  }

  /**
   * {kind, ghosts: [{glyphName, dx, dy, instance, anchor, rule}], rules,
   *  choice, note}. `rules` are the rules the glyph's menu offers, `choice` the
   * one kept (null: all of them); `note` says why there is nothing to draw.
   */
  planFor(glyphName, glyph, location) {
    const rules = this.getRulesData()?.rules || {};
    const { kind, names } = ghostRules(glyphName, rules, (name) => this.codePointOf(name));
    if (!names.length) {
      return { kind: null, ghosts: [], rules: [], choice: null, note: `no rule uses ${glyphName} yet` };
    }

    let choice = this.choiceFor(glyphName);
    if (choice && !names.includes(choice)) {
      // the rule it named is gone: back to all of them
      choice = null;
      this.setChoice(glyphName, null);
    }
    const shown = choice ? [choice] : names;

    const ghosts = [];
    const seen = new Set();
    let waiting = false;
    const problems = [];

    for (const ruleName of shown) {
      const rule = rules[ruleName];
      let missing = false;
      const getLayerGlyph = (name) => {
        if (name === glyphName && kind !== "composed") {
          // live: the anchors as they are being dragged — those of its
          // components too, when the open glyph is itself composed
          return glyph?.components?.length && glyph.propagatedAnchors
            ? { anchors: glyph.propagatedAnchors, xAdvance: glyph.xAdvance }
            : glyph;
        }
        const instance = this.instanceFor(name, location);
        if (instance === undefined) {
          missing = true; // loading: this rule comes back with the next frame
        }
        // a composed part is placed by the anchors its components give it
        if (instance?.components?.length && instance.propagatedAnchors) {
          return { anchors: instance.propagatedAnchors, xAdvance: instance.xAdvance };
        }
        return instance || null;
      };
      const { glyph: layout, problems: ruleProblems } = composeLayer(rule, getLayerGlyph);
      if (missing) {
        waiting = true;
        continue;
      }
      if (!layout) {
        problems.push(...ruleProblems);
        continue;
      }

      // where the open glyph is in the composition: the origin moves there
      let originX = 0;
      let originY = 0;
      if (kind === "mark") {
        const own = layout.components.find((component) => component.name === glyphName);
        originX = own.transformation.translateX;
        originY = own.transformation.translateY;
      }
      const ownMark = (rule.marks || []).find((mark) => mark.glyph === glyphName);

      for (const component of layout.components) {
        if (kind !== "composed" && component.name === glyphName) {
          continue;
        }
        const dx = component.transformation.translateX - originX;
        const dy = component.transformation.translateY - originY;
        const key = `${component.name}@${dx},${dy}`;
        if (seen.has(key)) {
          continue; // two rules, one accent at one place: drawn once
        }
        seen.add(key);
        const mark = (rule.marks || []).find((candidate) => candidate.glyph === component.name);
        let anchor = mark ? mark.anchor : null;
        if (kind === "mark" && component.name === rule.base && ownMark) {
          anchor = `_${ownMark.anchor}`;
        }
        ghosts.push({
          glyphName: component.name,
          dx,
          dy,
          instance: component.name === glyphName ? glyph : this.instanceFor(component.name, location),
          anchor,
          rule: ruleName,
        });
      }
    }

    let note = null;
    if (!ghosts.length) {
      note = waiting
        ? "loading…"
        : problems.length
          ? `the rules of ${glyphName} cannot be placed yet: ${[
              ...new Set(problems.map((problem) => PROBLEM_WORDS[problem.code] || problem.code)),
            ].join(", ")}`
          : "nothing to show";
    }
    return { kind, ghosts, rules: names, choice, note };
  }

  draw({ context, positionedGlyph, parameters, model }) {
    if (!this.settings.enabled) {
      return;
    }
    const glyph = positionedGlyph.glyph;
    const location = model.sceneSettings?.fontLocationSourceMapped || {};
    const plan = this.planFor(positionedGlyph.glyphName, glyph, location);

    const previous = this.lastPlan;
    this.lastPlan = { glyphName: positionedGlyph.glyphName, ...plan };
    if (
      this.onPlanChange &&
      (previous.glyphName !== this.lastPlan.glyphName ||
        previous.ghosts.length !== plan.ghosts.length ||
        previous.choice !== plan.choice ||
        previous.rules.join(" ") !== plan.rules.join(" ") ||
        previous.note !== plan.note)
    ) {
      this.onPlanChange(this.lastPlan);
    }

    if (!plan.ghosts.length) {
      return;
    }

    context.save();
    context.globalAlpha = this.settings.opacity;
    context.fillStyle = parameters.fillColor;
    for (const ghost of plan.ghosts) {
      const path = ghost.instance?.flattenedPath2d;
      if (!path) {
        continue;
      }
      context.save();
      context.translate(ghost.dx, ghost.dy);
      context.fill(path);
      context.restore();
    }
    context.restore();
  }

  get definition() {
    return {
      identifier: GHOSTS_LAYER_IDENTIFIER,
      name: "U+Marks accent previews",
      selectionFunc: (visContext) => visContext.glyphsBySelectionMode["editing"] || [],
      // false on purpose: a plug-in cannot register the action the
      // View > Glyph editor appearance submenu would need (see the README)
      userSwitchable: false,
      // 490 draws under the edited path and under the anchors, both at 500
      zIndex: 490,
      colors: { fillColor: "#8a6500" },
      colorsDarkMode: { fillColor: "#ffd166" },
      draw: (args) => this.draw(args),
    };
  }
}

/** Insert the layer at its zIndex rank and switch it on (see the README). */
export function installGhostsLayer(editorController, ghostsLayer) {
  const definition = ghostsLayer.definition;
  const definitions = editorController.visualizationLayers.definitions;
  if (definitions.some((d) => d.identifier === definition.identifier)) {
    return definition;
  }
  let index = definitions.findIndex((d) => d.zIndex > definition.zIndex);
  if (index < 0) {
    index = definitions.length;
  }
  definitions.splice(index, 0, definition);
  // mandatory: _visibleLayerIds was computed before the plug-in existed
  editorController.visualizationLayers.toggle(definition.identifier, true);
  editorController.visualizationLayers.requestUpdate();
  editorController.canvasController.requestUpdate();
  return definition;
}

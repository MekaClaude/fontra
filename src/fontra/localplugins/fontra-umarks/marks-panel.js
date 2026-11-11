// The sidebar panel (step 4 quater: a panel that follows the work). One
// screen, no tabs: the target and the path on top, the open glyph under it,
// the ghosts at the foot.
//
//   ① Target   [ GF Latin Core ▾ ] + 3 − 1   [Edit…]
//              312 glyphs · 2 sources · 271 done
//   ▸ ② Draw      8 glyphs to add · 10 still to draw     [Add 8 missing glyphs]
//   ▸ ③ Anchors   11 drawn glyphs have no anchors yet    [Place anchors]
//   ▸ ④ Check     12 anchors out of place · 3 moved by hand   [Re-place 12]
//   ▸ ⑤ Compose   38 ready · 3 can't be built yet        [Make 38]
//   ▸ ⑥ Update    3 glyphs have moved off their anchors  [Update 3]
//   ───────────────────
//   e  (the open glyph)
//   ───────────────────
//   ☑ Accents on the canvas · opacity     Last: Made 38 glyphs ▸   [Undo last batch]
//
// No step is a gate: every action works on the part of the target that is
// ready and leaves the rest waiting, said as such. The target replaces the
// `On:` line of step 4 ter: every batch works on it, a tick in a fold narrows
// the action to the ticked glyphs.
//
// This file wires the font to the pure modules (target.js decides where every
// glyph stands) and to the views (path-view.js, anchors-view.js,
// glyph-view.js). Nothing is imported from Fontra: the base class is handed in
// by init.js, which got it from an existing panel's prototype.

import {
  alignAnchors,
  checkAnchors,
  copyAnchors,
  glyphRoles,
  mirrorAnchors,
  placedStates,
  planAnchors,
  planVariants,
  referencedGlyphs,
  shiftAnchors,
} from "./anchors.js";
import { guideURLFor } from "./guide-url.js";
import { VERSION } from "./version.js";
import { AnchorsView } from "./anchors-view.js";
import { LEGACY_REFERENCE, MADE_KEY, composeVariableGlyph, isLegacyRule, syncDetails } from "./compose.js";
import {
  fontSources,
  glyphsNeededBy,
  invalidateCharacterIndex,
  loadFontAdapter,
  sourceMetrics,
} from "./font-adapter.js";
import { loadGlyphData } from "./glyph-data.js";
import {
  applyAnchorPlan,
  applyVariantPlan,
  beginBatch,
  createEmptyGlyphs,
  endBatch,
  decomposeOpenGlyph,
  lastBatch,
  makeGlyph,
  recomputeGlyph,
  undoLastBatch,
  writeRules,
  writeRulesBatch,
} from "./make.js";
import { GlyphView } from "./glyph-view.js";
import { MATRIX_STYLE, MatrixView } from "./matrix-view.js";
import { importLegacyRulesJSON } from "./legacy-import.js";
import { chosenForOverwrite, previewSVG, sheetRows, sheetTitle, splitForOverwrite } from "./overwrite.js";
import { ghostRules } from "./marks-layer.js";
import { PathView } from "./path-view.js";
import { batchReport, condensedRows, CONDENSE_FROM, outcomeOf } from "./report.js";
import {
  RULES_KEY,
  activeTarget,
  canonicalJSON,
  exportFileName,
  exportRulesJSON,
  importRulesFile,
  importSummary,
  mergeLegacyImport,
  readRulesData,
  rulesFileKind,
  sameRulesData,
  withGlyphSets,
  glyphSetInMenu,
  withActiveTarget,
  withAnchors,
  withRule,
  withRuleKept,
  withSettings,
  withTarget,
  withoutRule,
  withoutTarget,
} from "./rules.js";
import { markCandidatesFor } from "./suggest.js";
import {
  actionLabel,
  actionNames,
  anchorComposablesFor,
  baseAnchorStems,
  classifyTarget,
  commonAnchors,
  componentsOf,
  composingMark,
  DEFAULT_NAME_PATTERN,
  demandedParts,
  composablesFor,
  GLYPH_SET_MENU,
  glyphSetMenu,
  isCharacterItem,
  itemGlyph,
  listLabel,
  needsMake,
  parseTargetItems,
  placedRows,
  proposeTargetRules,
  problemLines,
  impossibleRow,
  isUsableGlyphName,
  markAnchorStems,
  matrixPreview,
  matrixRules,
  replaceEntries,
  ruleNameFor,
  staleGroups,
  staleReasons,
  stepCounts,
  targetEntries,
  waitingClause,
  withoutText,
} from "./target.js";
import { button, checkbox, element, replaceChildren } from "./ui.js";
import {
  alignLabel,
  anchorChoices,
  batchResultText,
  checkReportLines,
  checkSentence,
  copyLabel,
  defaultPlaceSelection,
  deriveSentence,
  mirrorLabel,
  missingVariantNote,
  moveLabel,
  newPreset,
  parsePresetField,
  placeSentence,
  plural,
  previewSentence,
  selectedPresets,
  undoResultText,
  addedText,
  variantCategories,
  variantChoices,
  withPresetField,
} from "./view-model.js";

const PANEL_IDENTIFIER = "umarks";
const PREVIEW_DELAY = 250; // ms: a sentence is worked out once the typing stops
const REFRESH_DELAY = 200; // ms: a burst of changes is looked at once
const REFRESH_DELAY_MAX = 2000; // ms: however slow the last refresh was
const PRESETS_URL = "/data/glyphset-presets.json";

// the messages of the first pass the designer closed: theirs, in the browser
const CLOSED_TIPS_KEY = "umarks.firstPass.closed";

function readClosedTips() {
  try {
    const value = JSON.parse(localStorage.getItem(CLOSED_TIPS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function writeClosedTips(ids) {
  try {
    localStorage.setItem(CLOSED_TIPS_KEY, JSON.stringify(ids));
  } catch (error) {
    // a browser that keeps nothing: the message comes back next time
  }
}

export function makeMarksPanel(Panel, pluginPath, ghostsLayer) {
  return class MarksPanel extends Panel {
    identifier = PANEL_IDENTIFIER;
    iconPath = `${pluginPath}/marks-icon.svg`;

    constructor(editorController) {
      super(editorController);
      this.sceneController = editorController.sceneController;
      this.fontController = editorController.fontController;
      this.ghostsLayer = ghostsLayer;

      this.glyphData = null;
      this.glyphToken = 0;
      this.presetCollections = null; // Fontra's /data/glyphset-presets.json
      this.refreshToken = 0;
      this.status = null; // target.js's classifyTarget, for the target
      this.entries = []; // the target's glyphs: [{glyphName, codePoints}]
      this.busy = false;
      // composed glyphs whose offset the designer chose to leave (5 bis § 6)
      this.leftAsIs = new Set();

      // ③: the ticked positions (null: the default, worked out from the rules)
      this.placeSelection = null;
      // ④: the plan Apply writes, and the tokens that drop stale previews
      this.pending = null;
      this.sourceNamesById = {};
      this.placeToken = 0;
      this.adjustToken = 0;

      this._appendStyleSheetLink(`${pluginPath}/marks.css`);
      // the shell is built at once, so that the editor finds the panel when it
      // puts back the sidebar the designer left open; what reads the font
      // waits for `start`, once the font controller has its sources (6a § 3)
      this.started = false;
    }

    /** Everything that reads the font: called by init.js once the font is there. */
    async start() {
      if (this.started) {
        return;
      }
      await this.fontController.ensureInitialized;
      this.started = true;
      const ghostsLayer = this.ghostsLayer;
      ghostsLayer.onPlanChange = (plan) => this.showPlan(plan);
      const openGlyphChanged = () => {
        this.showPlan(ghostsLayer.lastPlan);
        this.scheduleGlyph?.();
      };
      this.sceneController.sceneSettingsController.addKeyListener(
        ["selectedGlyphName"],
        openGlyphChanged
      );
      this.sceneController.addCurrentGlyphChangeListener(openGlyphChanged);
      this.fontController.addChangeListener({ glyphs: null }, () => this.scheduleRefresh());
      this.fontController.addChangeListener({ glyphMap: null }, () => {
        // a glyph renamed or given another code point: the index by code point is stale
        invalidateCharacterIndex(this.fontController);
        this.scheduleRefresh();
      });
      this.fontController.addChangeListener({ customData: null }, () => this.scheduleRefresh());
      this.sceneController.sceneSettingsController.addKeyListener(["projectGlyphSets"], () =>
        this.scheduleRefresh()
      );
      // Fontra's text shaping (6d § 2): the canvas composes what the font lacks
      this.sceneController.sceneSettingsController.addKeyListener(["applyTextShaping"], () => {
        this.render();
        this.scheduleGlyph?.();
      });

      this.loadPresets();
      this.render();
      this.scheduleGlyph();
      this.scheduleRefresh();
    }

    // --- the shell

    getContentElement() {
      const stylesheet = `${pluginPath}/marks.css`;

      this.pathView = new PathView(
        {
          onTargetChange: (value) => this.chooseTarget(value),
          onEdit: () => this.editTarget(),
          onMore: (value) => this.runMore(value),
          onHelp: () => window.open(this.guideURL, "_blank", "noopener"),
          onTipClose: (id) => this.closeTip(id),
          onImportFile: (kind, file) => this.importFile(kind, file),
          onAction: (step) => this.runStep(step),
          onSelectionChange: () => this.render(),
          onOpenGlyph: (glyphName) => this.openGlyph(glyphName),
          onFoldChange: (step, open) => {
            if (step === "check") {
              this.anchorsView.adjustOpen = open;
              this.scheduleAdjustPreview();
            }
            if (step === "anchors") {
              this.schedulePlacePreview();
            }
          },
        },
        { stylesheet }
      );

      this.anchorsView = new AnchorsView(
        {
          onPresetChange: (name, field, text) => this.editPreset(name, field, text),
          onPresetAdd: (name) => this.addPreset(name),
          onPresetRemove: (name) => this.removePreset(name),
          onPlaceToggle: (name, checked) => this.togglePlace(name, checked),
          onItalicChange: (checked) => this.setFollowItalic(checked),
          onOperationChange: () => this.scheduleAdjustPreview(),
          onFieldsChange: () => this.scheduleAdjustPreview(),
          onApply: () => this.applyPending(),
        },
        { stylesheet }
      );

      this.glyphView = new GlyphView({
        onGhostChoice: (value) => {
          this.ghostsLayer.setChoice(this.currentGlyphName, value || null);
          this.refreshGlyph();
        },
        onToggleTarget: (glyphName, add) => this.toggleInTarget(glyphName, add),
        onMarkGlyphChange: (glyphName, index, value) =>
          this.editRule(glyphName, (rule) => {
            rule.marks[index] = { ...rule.marks[index], glyph: value };
          }),
        onMarkAnchorChange: (glyphName, index, value) =>
          this.editRule(glyphName, (rule) => {
            rule.marks[index] = { ...rule.marks[index], anchor: value };
          }),
        onLegacyChange: (glyphName, value) =>
          this.editRule(glyphName, (rule) => {
            rule.legacy = value;
          }),
        onKeep: (glyphName) => this.writeData(withRuleKept(this.rulesData, glyphName), `Keep the rule of ${glyphName}`),
        onMake: (glyphName) => this.runMakeOne(glyphName),
        onRecompute: (names) => this.runRecompute(names),
        // the offset stays: ⑥ keeps counting it (5 bis § 6)
        onLeave: (glyphName) => {
          this.leftAsIs.add(glyphName);
          this.scheduleGlyph();
        },
        onDecompose: () => this.runDecompose(),
        onOpen: (glyphName) => this.openGlyph(glyphName),
        onAnchorRule: (base, mark, anchor) => this.addAnchorRule(base, mark, anchor),
        onRenameRule: (from, to) => this.renameRule(from, to),
      });
      this.glyphElement = element("div", { class: "panel-section umarks-glyph", "data-role": "glyph" }, [
        this.glyphView.element,
      ]);

      // --- the foot: the ghosts, the last report, Undo last batch
      const previews = checkbox(
        "umarks-ghosts-enabled",
        "Accents on the canvas",
        ghostsLayer.settings.enabled,
        (checked) => this.ghostsLayer.setEnabled(checked)
      );
      this.enabledCheckbox = previews.input;
      this.opacitySlider = element("input", {
        type: "range",
        id: "umarks-ghosts-opacity",
        title: "Opacity of the accents on the canvas",
        min: "0.05",
        max: "1",
        step: "0.05",
        oninput: (event) => this.ghostsLayer.setOpacity(parseFloat(event.target.value)),
      });
      this.opacitySlider.value = String(ghostsLayer.settings.opacity);
      this.statusElement = element("div", { class: "umarks-status" });

      this.lastSummary = element("span", { class: "umarks-last-summary" });
      this.lastDetails = element("div", { class: "umarks-last-details", hidden: "" });
      this.lastElement = element(
        "div",
        {
          class: "umarks-last",
          hidden: "",
          title: "Click for the whole report",
          onclick: () => {
            this.lastDetails.hidden = !this.lastDetails.hidden;
            this.lastElement.classList.toggle("open", !this.lastDetails.hidden);
          },
        },
        [
          element("div", { class: "umarks-last-line" }, [
            element("span", { class: "umarks-last-label", text: "Last:" }),
            this.lastSummary,
            element("span", { class: "umarks-last-toggle", text: "▸" }),
          ]),
          this.lastDetails,
        ]
      );
      this.undoButton = button("Undo last batch", () => this.undoBatch(), {
        className: "umarks-button--small",
      });
      this.undoButton.disabled = true;

      const content = element("div", { class: "panel marks-panel" }, [
        element("div", { class: "panel-section umarks-path-section" }, [this.pathView.element]),
        this.glyphElement,
        element("div", { class: "panel-section umarks-footer" }, [
          element("div", { class: "umarks-footer-row" }, [previews.row, this.opacitySlider]),
          this.statusElement,
          element("div", { class: "umarks-footer-row umarks-footer-row--last" }, [
            this.lastElement,
            this.undoButton,
          ]),
          // the version, small, for the bug reports: « which U+Marks were you looking at? »
          element("div", { class: "umarks-version", "data-role": "version", text: `U+Marks ${VERSION}` }),
        ]),
      ]);
      return content;
    }

    /** The guide, next to the plug-in's files: /umarks/guide/, jsDelivr, Hive (6b § 2). */
    get guideURL() {
      return guideURLFor(pluginPath);
    }

    // --- data

    get rulesData() {
      return readRulesData(this.fontController.customData).data;
    }

    get target() {
      return activeTarget(this.rulesData);
    }

    /**
     * Fontra shapes the canvas text (« Apply text shaping »): HarfBuzz then
     * shows à from a + gravecomb by the mark features Fontra builds from the
     * anchors, whether or not agrave is in the font (6d § 2).
     */
    get textShaping() {
      return !!this.editorController.sceneSettings?.applyTextShaping;
    }

    /** The ready glyphs the font does not have yet: the canvas may shape them, the font lacks them. */
    readyAbsent(ready = []) {
      const glyphMap = this.fontController.glyphMap;
      return ready.filter((name) => !glyphMap[name]);
    }

    get currentGlyphName() {
      return this.editorController.sceneSettings.selectedGlyphName || null;
    }

    async ensureGlyphData() {
      if (!this.glyphData) {
        try {
          this.glyphData = await loadGlyphData();
        } catch (error) {
          console.warn("U+Marks: could not load Fontra's glyph data", error);
        }
      }
      return this.glyphData;
    }

    async loadPresets() {
      try {
        const response = await fetch(PRESETS_URL, { cache: "no-cache" });
        this.presetCollections = response.ok ? await response.json() : [];
      } catch (error) {
        console.warn("U+Marks: could not load Fontra's glyph set presets", error);
        this.presetCollections = [];
      }
      this.render();
      this.scheduleRefresh();
    }

    /** {glyphSet, collection} of a preset url, from Fontra's list. */
    presetFor(url) {
      for (const collection of this.presetCollections || []) {
        for (const glyphSet of collection.glyphSets || []) {
          if (glyphSet.url === url) {
            return { glyphSet, collection };
          }
        }
      }
      return null;
    }

    get projectGlyphSets() {
      return this.sceneController.sceneSettings.projectGlyphSets || {};
    }

    /** The glyph sets the designer added in Fontra (Settings › Glyph sets), kept by Fontra in the browser: {url: info}. */
    get myGlyphSets() {
      return this.sceneController.sceneSettings.myGlyphSets || {};
    }

    /** The name a `from` reads as: the preset's, the glyph set's, or « From scratch ». */
    fromLabel(from) {
      if (from?.preset) {
        // a preset of Fontra's list, or one of the designer's own, which Fontra keys by its URL
        return this.presetFor(from.preset)?.glyphSet.name ?? this.myGlyphSets[from.preset]?.name ?? from.preset;
      }
      if (typeof from?.projectGlyphSet === "string") {
        // the key "" is Fontra's « This font's glyphs »
        return this.projectGlyphSets[from.projectGlyphSet]?.name ?? (from.projectGlyphSet || "This font's glyphs");
      }
      return "From scratch";
    }

    /**
     * The glyph set a target starts from, through Fontra's own loader — it
     * fetches, parses and caches, and keeps the errors where Fontra's glyph
     * set UI shows them. {entries, error}.
     */
    async loadTargetBase(from) {
      const controller = this.sceneController.glyphSetsController;
      if (!from) {
        return { entries: [] };
      }
      let info = null;
      if (from.preset) {
        const found = this.presetFor(from.preset);
        info = found
          ? { ...found.collection.dataOptions, ...found.glyphSet }
          : this.myGlyphSets[from.preset] || { url: from.preset, dataFormat: "glyph-names" };
      } else if (from.projectGlyphSet === "") {
        // Fontra's « This font's glyphs » (THIS_FONTS_GLYPHSET): every glyph of the
        // font, with its code points — Fontra's loader has no URL to fetch for it
        const glyphMap = this.fontController.glyphMap || {};
        return {
          entries: Object.keys(glyphMap)
            .sort()
            .map((glyphName) => ({ glyphName, codePoints: [...(glyphMap[glyphName] || [])] })),
        };
      } else if (typeof from.projectGlyphSet === "string") {
        info = this.projectGlyphSets[from.projectGlyphSet] || null;
        if (!info) {
          return { entries: [], error: `the project has no glyph set ${from.projectGlyphSet} any more` };
        }
      }
      const entries = (await controller?.fetchGlyphSet(info)) || [];
      const error = this.sceneController.sceneSettings.glyphSetErrors?.[info.url];
      return { entries, error: error && error !== "..." ? error : null };
    }

    // --- refresh: where the target stands

    /**
     * Look at the target again — the classification ①–⑥ included — after a
     * change of the font (5 bis § 4). Changes are grouped: each one pushes the
     * refresh back, by at least REFRESH_DELAY and by twice what the last
     * refresh took, so a font of 18 sources × 239 glyphs does not refresh
     * between two edits the designer makes in a row. Never needs a reload.
     */
    scheduleRefresh() {
      clearTimeout(this.refreshTimer);
      const delay = Math.min(REFRESH_DELAY_MAX, Math.max(REFRESH_DELAY, 2 * (this.lastRefreshMs || 0)));
      this.refreshTimer = setTimeout(() => this.timedRefresh(), delay);
    }

    async timedRefresh() {
      const start = performance.now();
      const token = this.refreshToken + 1;
      await this.refresh();
      // only a refresh that went to the end says how long a refresh takes
      if (token === this.refreshToken) {
        this.lastRefreshMs = performance.now() - start;
      }
    }

    /**
     * The glyphs ③ and ④ look at: the parts the rules of the target ask for —
     * bases, accents, the `…comb` of legacy accents —, and nothing else of the
     * target (5 bis § 2). A part composed in its turn (`i`, under `iogonek`) is
     * one: glyphRoles leaves it alone unless it was drawn by hand (§ 3).
     */
    workNames(names, rules) {
      return [...new Set(names.filter((name) => rules[name]).flatMap((name) => demandedParts(rules[name])))];
    }

    async refresh() {
      if (!this.started) {
        return;
      }
      this.refreshCount = (this.refreshCount || 0) + 1;
      const token = ++this.refreshToken;
      const data = this.rulesData;
      const target = activeTarget(data);
      if (!target) {
        this.status = null;
        this.entries = [];
        this.targetError = null;
        this.render();
        this.scheduleGlyph();
        return;
      }

      const glyphData = await this.ensureGlyphData();
      const { entries: baseEntries, error } = await this.loadTargetBase(target.from);
      if (token !== this.refreshToken) {
        return;
      }
      this.targetError = error ? `${this.fromLabel(target.from)}: ${error}` : null;

      const namesOnly = await loadFontAdapter(this.fontController, []);
      const entries = targetEntries(baseEntries, target, { font: namesOnly, glyphData });
      const names = entries.map((entry) => entry.glyphName);

      // the rules of the target, proposed on their own (decision B): written
      // to the document, so that Make, ⑥ and the export see them
      if (glyphData) {
        const candidates = markCandidatesFor(names, namesOnly, glyphData, data.settings);
        let suggestFont = await loadFontAdapter(this.fontController, [...names, ...candidates]);
        // the parts of the target's composed glyphs, for the rule they show
        // to be read with their anchors (6a, decision 1)
        const loaded = new Set([...names, ...candidates]);
        const parts = componentsOf(suggestFont, names).filter((name) => !loaded.has(name));
        if (parts.length) {
          suggestFont = await loadFontAdapter(this.fontController, [...loaded, ...parts]);
        }
        if (token !== this.refreshToken) {
          return;
        }
        const { rules, changed } = proposeTargetRules(entries, { font: suggestFont, glyphData, data });
        // written only when the document does not say it already (6b § 0), and
        // never twice the same: a proposal that comes back unchanged from the
        // document is not written again, or the panel would loop on it
        const next = { ...data, rules };
        const key = changed.length ? canonicalJSON(next) : null;
        if (key && key !== this.lastProposal && !this.fontController.readOnly && !sameRulesData(next, data)) {
          this.lastProposal = key;
          if (await writeRules(this.fontController, next, `Rules for ${plural(changed.length, "glyph")} of the glyph set`)) {
            return; // the change of customData comes back here, with the rules in place
          }
        }
      }

      const rules = data.rules;
      const work = this.workNames(names, rules);
      const composed = names.filter((name) => rules[name]);
      const font = await loadFontAdapter(this.fontController, [
        ...names,
        ...work,
        ...referencedGlyphs(data.anchors),
        // the legacy accents' margin is read from it
        ...(composed.some((name) => isLegacyRule(rules[name])) ? [LEGACY_REFERENCE] : []),
      ]);
      if (token !== this.refreshToken) {
        return;
      }

      const states = new Map(composed.map((name) => [name, syncDetails(name, rules[name], font)]));
      const roles = glyphRoles(work, { font, glyphData, data });
      const presets = selectedPresets(data.anchors, this.checkedPresets(composed, data));
      const drawnWork = work.filter((name) => font.hasGlyph(name));
      const plan = planAnchors(font, drawnWork, presets, { roles, settings: data.settings });
      const pendingAnchors = new Set(plan.filter((entry) => !entry.existing).map((entry) => entry.glyph));
      const placed = placedStates(font, drawnWork, presets, { roles, settings: data.settings });

      this.entries = entries;
      this.font = font;
      this.states = states;
      this.workGlyphs = work;
      this.status = classifyTarget({
        names,
        rules,
        font,
        states,
        pendingAnchors,
        placed,
        isMark: (name) => !!glyphData?.isMark(name) || roles.get(name)?.kind === "mark",
      });
      this.render();
      this.scheduleGlyph();
      this.schedulePlacePreview();
      this.scheduleAdjustPreview();
    }

    // --- drawing the path

    /**
     * ①'s menu (6c, decision 2): only the glyph sets chosen for this font — the
     * active one ticked — and, last, Add a glyph set…. On a new font that is
     * all it holds; the closed menu then reads « No glyph set yet ».
     */
    targetMenu() {
      return glyphSetMenu(this.rulesData);
    }

    selectedFor(step, all) {
      return this.pathView.selected(step).filter((name) => all.includes(name));
    }

    render() {
      if (!this.pathView || !this.started) {
        return;
      }
      this.renderCount = (this.renderCount || 0) + 1;
      const view = this.pathView;
      this.refreshAnchorTools();
      const menu = this.targetMenu();
      view.setTargetOptions(menu.groups, menu.value);
      const target = this.target;
      const sources = fontSources(this.fontController);
      const busy = this.busy;
      this.undoButton.disabled = !lastBatch(this.editorController) || busy;
      this.undoButton.title = lastBatch(this.editorController)
        ? `Take back: ${lastBatch(this.editorController).label}`
        : "Nothing to take back. ⌘Z undoes one glyph at a time.";

      const status = this.status;
      view.setTip(this.firstPassTip(target, status));
      if (!target || !status) {
        view.setTarget({
          info: target ? "looking at the glyph set…" : "Add the glyph set you want to end up with.",
          canEdit: !!target,
        });
        for (const id of ["draw", "anchors", "check", "compose", "update"]) {
          view.setStep(id, {
            count: { text: "—", done: false },
            action: { label: this.idleLabel(id), enabled: false },
            extra: id === "anchors" ? this.anchorsView.positionsElement : id === "check" ? this.anchorsView.adjustElement : null,
          });
        }
        return;
      }

      const counts = stepCounts(status, { sources: sources.length });
      view.setTarget({
        list: listLabel(target),
        info: counts.target.text,
        done: counts.target.done,
        canEdit: true,
        error: this.targetError,
      });

      // ② Draw
      const absent = status.draw.absent.map((entry) => entry.glyph);
      const drawSelected = this.selectedFor("draw", absent);
      view.setStep("draw", {
        count: counts.draw,
        action: {
          label: actionLabel("Add", absent, drawSelected, "missing glyph"),
          enabled: absent.length > 0 && !busy,
          title: "Add the glyphs the font is missing, empty, to find them in the font overview and draw them",
        },
        groups: [
          {
            title: "To add",
            rows: status.draw.absent.map((entry) => ({
              glyph: entry.glyph,
              detail: entry.kind === "glyph" ? "" : entry.kind,
              selectable: true,
            })),
          },
          {
            title: "Still to draw",
            rows: status.draw.empty.map((entry) => ({
              glyph: entry.glyph,
              // where and why (5 bis § 5)
              detail: [entry.kind === "glyph" ? "" : entry.kind, ...(entry.why || [])].filter((text) => text).join(" · "),
            })),
          },
          {
            title: "Missing in some sources — usable, Make leaves those out",
            rows: (status.draw.incomplete || []).map((entry) => ({
              glyph: entry.glyph,
              detail: [entry.kind === "glyph" ? "" : entry.kind, ...(entry.why || [])].filter((text) => text).join(" · "),
            })),
          },
        ],
        empty: "Everything the glyph set needs is drawn.",
      });

      // ③ Anchors
      const withoutAnchors = status.anchors.glyphs;
      const anchorsSelected = this.selectedFor("anchors", withoutAnchors);
      view.setStep("anchors", {
        count: counts.anchors,
        action: {
          label: "Place anchors",
          enabled: withoutAnchors.length > 0 && !busy,
          title: anchorsSelected.length
            ? `Place the ticked positions on the ${plural(anchorsSelected.length, "ticked glyph")}`
            : "Place the ticked positions on the drawn glyphs that lack them",
        },
        groups: [
          {
            rows: withoutAnchors.map((glyph) => ({ glyph, selectable: true })),
          },
        ],
        extra: this.anchorsView.positionsElement,
      });

      // ④ Check: Re-place N puts back what Place put and its position left
      // (6b § 1); what was moved by hand stays unless ticked
      const check = status.check;
      const sourceName = (id) => this.sourceNamesById[id] || id;
      const replaceCount = replaceEntries(check, this.selectedFor("check", check.glyphs)).length;
      view.setStep("check", {
        count: counts.check,
        action: {
          label: replaceCount ? `Re-place ${replaceCount}` : "Re-place",
          enabled: replaceCount > 0 && !busy,
          title: "Put the anchors Place put back on their positions; those moved by hand only if ticked",
        },
        groups: [
          {
            title: "Out of place — still where Place put them",
            rows: placedRows(check.outOfDate, "stale", sourceName, sources.length).map((row) => ({
              ...row,
              selectable: true,
            })),
          },
          {
            title: "Moved by hand — tick to put back",
            rows: placedRows(check.movedByHand, "drawn", sourceName, sources.length).map((row) => ({
              ...row,
              selectable: true,
            })),
          },
        ],
        extra: this.anchorsView.adjustElement,
      });

      // ⑤ Compose: what is drawn by hand is apart, and out of Make N unless ticked
      const ready = status.compose.ready;
      const drawn = status.compose.drawnByHand;
      const composeSelected = this.selectedFor("compose", [...ready, ...drawn]);
      view.setStep("compose", {
        count: counts.compose,
        // once, in a half line (6d § 2): the canvas is a preview, the font lacks them
        note:
          this.textShaping && this.readyAbsent(ready).length
            ? "Shaped on the canvas, not yet in the font: Make writes them."
            : "",
        action: {
          label: composeSelected.length ? `Make ${composeSelected.length}` : actionLabel("Make", ready),
          enabled: (ready.length > 0 || composeSelected.length > 0) && !busy,
          title: composeSelected.some((name) => drawn.includes(name))
            ? "Make the ticked glyphs; those drawn by hand are asked about first"
            : "Make the composed glyphs whose parts are drawn and placed",
        },
        groups: [
          {
            title: "Ready",
            rows: ready.map((glyph) => ({
              glyph,
              // the sources Make will leave out, named (5 bis § 5)
              detail: [this.ruleText(glyph), withoutText(status.byGlyph.get(glyph)?.without)]
                .filter((text) => text)
                .join(" · "),
              selectable: true,
            })),
          },
          {
            title: "Drawn by hand — tick to overwrite",
            rows: drawn.map((glyph) => ({
              glyph,
              detail: `${this.ruleText(glyph)} · drawn by hand`,
              selectable: true,
              state: "drawn",
            })),
          },
          {
            title: "Waiting",
            rows: status.compose.waiting.map((entry) => ({
              glyph: entry.glyph,
              detail: `waiting for ${waitingClause(entry.parts, entry.anchorsOn)}`,
              state: "waiting",
            })),
          },
          {
            title: "Can't be built yet",
            // one short line; the causes on hover when there are several (5 bis § 7)
            rows: status.compose.impossible.map((entry) => ({
              glyph: entry.glyph,
              ...impossibleRow(entry.why),
              state: "impossible",
            })),
          },
        ],
      });

      // ⑥ Update
      const stale = status.update.stale.map((entry) => entry.glyph);
      const updateSelected = this.selectedFor("update", stale);
      view.setStep("update", {
        count: counts.update,
        action: {
          label: actionLabel("Update", stale, updateSelected),
          enabled: stale.length > 0 && !busy,
          title: "Put the components back where the anchors say",
        },
        groups: [
          {
            rows: status.update.stale.map((entry) => ({
              glyph: entry.glyph,
              detail: entry.reasons.join("; "),
              selectable: true,
              state: "stale",
            })),
          },
        ],
      });
    }

    // --- the first pass (6b § 3)

    /**
     * The message of the first pass, or null: under ①, one at a time, in the
     * order of the work, each gone once its step is done, and for good once
     * the designer has closed it (×) — that is the designer's, kept in the
     * browser, not in the document.
     */
    firstPassTip(target, status) {
      const closed = readClosedTips();
      const tips = [];
      if (!target) {
        tips.push({ id: "target", text: "Start by adding a glyph set — one of your project's, one of yours, or a preset of Fontra." });
      } else if (status) {
        const absent = status.draw.absent.length;
        if (absent || status.draw.empty.length) {
          tips.push({
            id: "draw",
            text: absent
              ? "Draw the missing parts in Fontra, or add them now, empty, to find them in the font overview."
              : "Draw the missing parts in Fontra.",
          });
        }
        if (status.anchors.glyphs.length) {
          tips.push({
            id: "anchors",
            text: "Place anchors puts the anchors where the positions say; you can move any of them by hand afterwards.",
          });
        }
        const ready = status.compose.ready.length;
        if (ready && !this.madeOnce()) {
          tips.push({ id: "make", text: "Make writes the accented glyphs that are ready; Undo last batch takes them back." });
        }
      }
      return tips.find((tip) => !closed.includes(tip.id)) ?? null;
    }

    /** Has Make ever written a glyph of this document? A made glyph remembers its anchors (compose.js MADE_KEY). */
    madeOnce() {
      return [...(this.states?.values() || [])].some((details) => details.state === "ok" || details.state === "stale")
        || !!this.font?.sources?.some((source) =>
          (this.workGlyphs || []).concat((this.entries || []).map((entry) => entry.glyphName)).some(
            (name) => this.font.getLayerCustomData?.(name, source.identifier)?.[MADE_KEY]
          )
        );
    }

    closeTip(id) {
      if (!id) {
        return;
      }
      writeClosedTips([...new Set([...readClosedTips(), id])]);
      this.render();
    }

    idleLabel(id) {
      return { draw: "Add missing glyphs", anchors: "Place anchors", check: "Re-place", compose: "Make", update: "Update" }[id];
    }

    /** `e + acutecomb@top`, for a row. */
    ruleText(glyphName) {
      const rule = this.rulesData.rules[glyphName];
      if (!rule) {
        return "";
      }
      if (isLegacyRule(rule)) {
        return `spacing accent, from ${rule.legacy}`;
      }
      return [rule.base, ...(rule.append || []), ...(rule.marks || []).map((mark) => `${mark.glyph}@${mark.on || mark.anchor}`)].join(" + ");
    }

    // --- ① the target

    async writeData(next, label) {
      if (this.fontController.readOnly) {
        this.report(["This font is read-only."]);
        return false;
      }
      await writeRules(this.fontController, next, label);
      return true;
    }

    async chooseTarget(value) {
      if (value === GLYPH_SET_MENU.addGlyphSet) {
        // the menu stays on the active glyph set while the dialog is open
        this.pathView.targetOptionsKey = null;
        this.render();
        await this.addGlyphSets();
        return;
      }
      if (value.startsWith("target:")) {
        await this.writeData(withActiveTarget(this.rulesData, value.slice("target:".length)), "Choose the glyph set");
      }
    }

    /**
     * Add a glyph set… (6c, decision 3): Fontra's own dialog, three groups in
     * this order — the project's glyph sets, the designer's own, Fontra's
     * presets (folded by family, with a filter) — then From scratch. One or
     * several are ticked; Add puts them in the menu, the first one becomes
     * the active one. One the menu has already is greyed. Nothing is written
     * into the font but their entries of `targets`: a glyph set keeps its
     * source (`from`), so it follows Fontra when it changes there.
     */
    async addGlyphSets() {
      const dialog = document.querySelector("modal-dialog");
      if (!dialog) {
        return;
      }
      if (this.fontController.readOnly) {
        this.report(["This font is read-only."]);
        return;
      }
      if (!this.presetCollections) {
        await this.loadPresets();
      }
      const current = this.rulesData.targets;
      const order = []; // the ids, in the order the dialog lists them: the order they are added in
      const ticked = new Map(); // id → {name, from}
      let addButton = null;
      const update = () => addButton?.classList.toggle("disabled", !ticked.size);

      const row = (id, name, from, note = "") => {
        order.push(id);
        const taken = glyphSetInMenu(current, from);
        const input = element("input", { type: "checkbox", "data-glyph-set": id });
        input.disabled = taken;
        input.addEventListener("change", () => {
          if (input.checked) {
            ticked.set(id, { name, from });
          } else {
            ticked.delete(id);
          }
          update();
        });
        const label = element("label", { class: taken ? "umarks-add-taken" : "" }, [
          input,
          element("span", { text: name }),
          taken || note ? element("span", { class: "umarks-add-note", text: taken ? "already in the menu" : note }) : null,
        ]);
        return { label, name };
      };
      const group = (id, title, children, empty) =>
        element("section", { class: "umarks-add-group", "data-group": id }, [
          element("h3", { text: title }),
          ...(children.length ? children : [element("div", { class: "umarks-add-empty", text: empty })]),
        ]);
      const byName = (a, b) => String(a.name).localeCompare(String(b.name));
      const named = (entries) =>
        entries.map(([key, glyphSet]) => ({ key, name: glyphSet.name || key })).sort(byName);

      const projectRows = named(Object.entries(this.projectGlyphSets)).map(({ key, name }) =>
        row(`project:${key}`, name, { projectGlyphSet: key }).label
      );
      const mineRows = named(Object.entries(this.myGlyphSets)).map(({ key, name }) =>
        row(`my:${key}`, name, { preset: key }).label
      );
      const families = (this.presetCollections || []).map((collection) => {
        const rows = (collection.glyphSets || []).map((glyphSet) =>
          row(`preset:${glyphSet.url}`, glyphSet.name, { preset: glyphSet.url })
        );
        const details = element("details", { class: "umarks-add-family", "data-family": collection.name }, [
          element("summary", { text: `${collection.name} (${rows.length})` }),
          ...rows.map((entry) => entry.label),
        ]);
        return { collection, rows, details };
      });
      const filter = element("input", {
        type: "search",
        placeholder: "Filter Fontra's presets",
        spellcheck: "false",
        "data-field": "glyph-set-filter",
      });
      filter.addEventListener("input", () => {
        const needle = filter.value.trim().toLowerCase();
        for (const { collection, rows, details } of families) {
          const family = collection.name.toLowerCase().includes(needle);
          let shown = 0;
          rows.forEach((entry) => {
            const match = !needle || family || entry.name.toLowerCase().includes(needle);
            entry.label.hidden = !match;
            shown += match ? 1 : 0;
          });
          details.hidden = !!needle && !shown;
          details.open = !!needle && shown > 0;
        }
      });
      const scratch = row("scratch", "From scratch", null, "an empty glyph set: you add its glyphs in Edit…");

      // Fontra's dialog gives its content cell `overflow: hidden` (modal-dialog.js,
      // `.message`), with more weight than a class of ours: the part that scrolls
      // is a child of it, not the content element itself
      const content = element("div", { class: "umarks-add-dialog" }, [
        element("div", { class: "umarks-add-scroll" }, [
        group("project", "Project glyph sets", projectRows, "None in this project yet."),
        group("mine", "My glyph sets", mineRows, "None yet — Fontra keeps yours under Settings › Glyph sets."),
        element("section", { class: "umarks-add-group", "data-group": "presets" }, [
          element("h3", { text: "Fontra presets" }),
          filter,
          ...(families.length
            ? families.map(({ details }) => details)
            : [element("div", { class: "umarks-add-empty", text: "Fontra's presets could not be loaded." })]),
        ]),
        group("scratch", "From scratch", [scratch.label], ""),
        ]),
      ]);

      await dialog.setupDialog("Add a glyph set", "", [
        { title: "Cancel", isCancelButton: true },
        { title: "Add", isDefaultButton: true, resultValue: "add", disabled: true },
      ]);
      addButton = dialog.defaultButton;
      dialog.appendStyle?.(`
        .umarks-add-dialog {
          width: 34em;
          max-width: 80vw;
        }
        .umarks-add-scroll {
          display: grid;
          gap: 1em;
          max-height: calc(80vh - 10em);
          overflow-y: auto;
          padding-right: 0.5em;
        }
        .umarks-add-group { display: grid; gap: 0.2em; }
        .umarks-add-group h3 { margin: 0 0 0.2em; font-size: 1em; }
        .umarks-add-dialog label { display: flex; gap: 0.5em; align-items: baseline; }
        .umarks-add-dialog label[hidden], .umarks-add-dialog details[hidden] { display: none; }
        .umarks-add-taken { opacity: 0.5; }
        .umarks-add-note, .umarks-add-empty { opacity: 0.6; }
        .umarks-add-note { font-size: 0.9em; }
        .umarks-add-dialog input[type="search"] { margin-bottom: 0.3em; }
        .umarks-add-dialog summary { cursor: pointer; padding: 0.1em 0; }
        .umarks-add-dialog details > label { margin-left: 1.3em; }
      `);
      dialog.setContent(content);
      const result = await dialog.run();
      if (result !== "add" || !ticked.size) {
        return;
      }

      const picks = order.filter((id) => ticked.has(id)).map((id) => ticked.get(id));
      const { data: next, added } = withGlyphSets(this.rulesData, picks);
      if (!added.length) {
        return;
      }
      await this.writeData(next, added.length === 1 ? `Add the glyph set ${added[0].name}` : `Add ${added.length} glyph sets`);
      // From scratch, the first one: its glyphs are typed in Edit…, so it opens at once
      if (!added[0].from) {
        await this.editTarget();
      }
    }

    /**
     * Edit…: name the glyph set, add glyphs (names, or characters typed as they
     * are), take some out — in Fontra's own dialog, not a component of ours —
     * or remove it from the menu (6c, decision 4).
     */
    async editTarget() {
      const target = this.target;
      const dialog = document.querySelector("modal-dialog");
      if (!target || !dialog) {
        return;
      }
      const field = (label, value, placeholder, dataField) => {
        const input = element("input", {
          type: "text",
          spellcheck: "false",
          placeholder,
          "data-field": dataField,
        });
        input.value = value;
        return [element("label", { text: label }), input];
      };
      const [nameLabel, nameInput] = field("Name", target.name, "", "target-name");
      const [addLabel, addInput] = field("Add", target.add.join(" "), "names or characters: eacute ơư", "target-add");
      const [removeLabel, removeInput] = field("Take out", target.remove.join(" "), "names or characters", "target-remove");
      const matrix = await this.matrixView(target, addInput);
      const content = element("div", { class: "umarks-target-dialog" }, [
        element("div", {
          class: "umarks-target-dialog-from",
          text: target.from ? `Starts from ${this.fromLabel(target.from)}` : "Starts from scratch: the glyphs added here are the glyph set",
        }),
        nameLabel,
        nameInput,
        addLabel,
        addInput,
        removeLabel,
        removeInput,
        matrix.element,
        element("div", {
          class: "umarks-target-dialog-from",
          text: "Remove this glyph set takes it out of the menu only: no rule and no glyph of the font is deleted.",
        }),
      ]);
      await dialog.setupDialog(`Glyph set: ${target.name}`, "", [
        { title: "Remove this glyph set", resultValue: "remove" },
        { title: "Cancel", isCancelButton: true },
        { title: "Save", isDefaultButton: true, resultValue: "save" },
      ]);
      dialog.appendStyle?.(`
        .umarks-target-dialog {
          display: grid;
          grid-template-columns: max-content minmax(20em, 1fr);
          gap: 0.5em 0.8em;
          align-items: center;
        }
        .umarks-target-dialog > label { text-align: right; }
        .umarks-target-dialog-from { grid-column: 1 / -1; opacity: 0.7; }
        ${MATRIX_STYLE}
      `);
      dialog.setContent(content);
      setTimeout(() => addInput.focus(), 0);
      const result = await dialog.run();
      const data = this.rulesData;
      if (result === "remove") {
        await this.writeData(withoutTarget(data, target.key), `Remove the glyph set ${target.name}`);
      } else if (result === "save") {
        await this.writeData(
          withTarget(data, target.key, {
            name: nameInput.value.trim() || target.name,
            from: target.from,
            add: parseTargetItems(addInput.value),
            remove: parseTargetItems(removeInput.value),
          }),
          `Edit glyph set ${target.name}`
        );
      }
    }

    /**
     * The matrix of Edit… (6a, decision 6): the bases — of the target, or of
     * the font — and the marks of the font, ticked by the designer; the
     * anchors they share, the names, the count; Add writes the rules (manual)
     * and puts their glyphs into the target, as one batch « Undo last batch »
     * takes back. The dialog's Add field follows, so that Save keeps them.
     */
    async matrixView(target, addInput) {
      const glyphData = await this.ensureGlyphData();
      const data = this.rulesData;
      const glyphMap = this.fontController.glyphMap;
      const ruleMarks = new Set(Object.values(data.rules).flatMap((rule) => (rule.marks || []).map((mark) => mark.glyph)));
      const markCandidates = Object.keys(glyphMap).filter(
        (name) => /comb(\.|$)/.test(name) || glyphData?.isMark(name) || ruleMarks.has(name)
      );
      const targetNames = (this.entries || []).map((entry) => entry.glyphName);
      const font = await loadFontAdapter(this.fontController, [...markCandidates, ...targetNames]);
      const marks = markCandidates.filter((name) => composingMark(font, name, glyphData));
      const markSet = new Set(markCandidates);
      const isBase = (name) => !data.rules[name] && !markSet.has(name) && !markAnchorStems(font, name).length;
      const lists = {
        bases: {
          target: targetNames.filter((name) => font.hasGlyph(name) && isBase(name) && baseAnchorStems(font, name).length),
          font: Object.keys(glyphMap).filter((name) => isBase(name) && !glyphData?.isMark(name)),
        },
        marks,
      };
      let token = 0;
      const look = async (state) => {
        const mine = ++token;
        const adapter = await loadFontAdapter(this.fontController, [...state.bases, ...state.marks]);
        if (mine !== token) {
          return null;
        }
        view.setAnchors(commonAnchors(adapter, state.bases, state.marks), state.anchor);
        const anchor = view.anchorSelect.value || null;
        const result = matrixRules({ ...state, anchor, rules: this.rulesData.rules, font: adapter });
        view.setPreview(
          matrixPreview(result, { anchor, ticked: !!(state.bases.length && state.marks.length) }),
          result.add.length > 0
        );
        return { result, anchor };
      };
      const view = new MatrixView(
        { lists, pattern: data.settings.namePattern || DEFAULT_NAME_PATTERN },
        {
          onChange: (state) => look(state),
          onAdd: async (state) => {
            const looked = await look(state);
            if (!looked?.result.add.length) {
              return;
            }
            const { result } = looked;
            let next = this.rulesData;
            const added = {};
            for (const { glyph, rule } of result.add) {
              next = withRule(next, glyph, rule, { manual: true });
              added[glyph] = next.rules[glyph];
            }
            const current = next.targets[target.key];
            if (!current) {
              return; // the target was deleted meanwhile
            }
            const inTarget = new Set([...(this.entries || []).map((entry) => entry.glyphName), ...current.add]);
            const names = result.add.map((entry) => entry.glyph).filter((name) => !inTarget.has(name));
            if (names.length) {
              next = withTarget(next, target.key, { ...current, add: [...current.add, ...names] });
            }
            if (state.pattern && state.pattern !== (next.settings.namePattern || DEFAULT_NAME_PATTERN)) {
              next = withSettings(next, { namePattern: state.pattern });
            }
            if (this.fontController.readOnly) {
              this.report(["This font is read-only."]);
              return;
            }
            const label = `Compose ${plural(state.bases.length, "base")} × ${plural(state.marks.length, "mark")} @ ${looked.anchor}`;
            await writeRulesBatch(this.editorController, next, { label, added, target: { key: target.key, names } });
            // the dialog's own list, so that Save keeps what Add put in
            const typed = parseTargetItems(addInput.value);
            addInput.value = [...typed, ...names.filter((name) => !typed.includes(name))].join(" ");
            this.report([`${label}: ${plural(result.add.length, "rule")} written${names.length ? `, ${names.length} into the glyph set` : ""}.`]);
            this.render();
            await look(view.state());
          },
        }
      );
      return view;
    }

    // --- ① `…`: export and import (brief § 4.8)

    async runMore(value) {
      if (value === "export") {
        await this.exportRules();
      } else if (value === "import") {
        this.pathView.askFile(value);
      }
    }

    /** The document as the JSON of § 5, downloaded as `<family>-umarks.json`. */
    async exportRules() {
      let familyName = null;
      try {
        familyName = (await this.fontController.getFontInfo?.())?.familyName;
      } catch (error) {
        familyName = null;
      }
      if (!familyName) {
        const project = new URL(window.location.href).searchParams.get("project") || "";
        familyName = project.split("/").pop().replace(/\.[^.]*$/, "");
      }
      const fileName = exportFileName(familyName);
      const blob = new Blob([exportRulesJSON(this.rulesData)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = element("a", { href: url, download: fileName, hidden: "" });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const data = this.rulesData;
      this.report([
        `Exported ${plural(Object.keys(data.rules).length, "rule")} and ${plural(Object.keys(data.targets).length, "glyph set")} to ${fileName}.`,
      ]);
    }

    /**
     * Import rules…: our JSON or a file of the old script, told apart by what
     * it holds (6a, decision 4); added to the document, nothing of it replaced.
     */
    async importFile(_kind, file) {
      const text = await file.text();
      const data = this.rulesData;
      let result;
      const label = `Import ${file.name}`;
      const { kind, complaint } = rulesFileKind(text);
      if (!kind) {
        this.report([`${label}: ${complaint}`]);
        return;
      }
      if (kind === "legacy") {
        const glyphData = await this.ensureGlyphData();
        const legacy = importLegacyRulesJSON(text, {
          font: await loadFontAdapter(this.fontController, []),
          glyphData,
        });
        result = { ...mergeLegacyImport(data, legacy), invalid: legacy.skipped.length };
      } else {
        result = importRulesFile(text, data);
      }
      if (result.ok !== false && (result.taken.length || result.targets.length || result.anchors.length)) {
        if (!(await this.writeData(result.data, label))) {
          return;
        }
      }
      this.report([importSummary(label, result)]);
    }

    // --- the actions of the path

    async runStep(step) {
      if (this.busy || !this.status) {
        return;
      }
      switch (step) {
        case "draw":
          return this.runCreate();
        case "anchors":
          return this.runPlace();
        case "check":
          return this.runReplace();
        case "compose":
          return this.runMake();
        case "update":
          return this.runRecompute();
      }
    }

    async withBusy(text, work) {
      this.busy = true;
      this.pathView.setBusy(text);
      this.render();
      try {
        return await work();
      } catch (error) {
        console.warn("U+Marks: a batch failed", error);
        this.report([`${text.replace(/…$/, "")}: failed — ${error.message}`]);
        return null;
      } finally {
        this.busy = false;
        this.pathView.setBusy(null);
        this.render();
        this.ghostsLayer.requestUpdate();
        this.scheduleRefresh();
      }
    }

    entryFor(glyphName) {
      return this.entries.find((entry) => entry.glyphName === glyphName);
    }

    async runCreate() {
      const absent = this.status.draw.absent.map((entry) => entry.glyph);
      const names = actionNames(absent, this.pathView.selected("draw"));
      const glyphData = await this.ensureGlyphData();
      const label = `Add ${plural(names.length, "missing glyph")}`;
      await this.withBusy("adding…", async () => {
        const result = await createEmptyGlyphs(
          this.editorController,
          names.map((glyph) => {
            const kind = this.status.draw.absent.find((entry) => entry.glyph === glyph)?.kind;
            return {
              glyph,
              codePoint: this.entryFor(glyph)?.codePoints?.[0] ?? glyphData?.codePointForGlyphName(glyph),
              combining:
                kind === "accent" &&
                (glyph.endsWith("comb") || !!glyphData?.isCombiningMark(glyph)),
            };
          }),
          label
        );
        this.report([addedText(result)]);
      });
    }

    async runPlace() {
      const all = this.status.anchors.glyphs;
      const names = actionNames(all, this.pathView.selected("anchors"));
      await this.withBusy("placing…", async () => {
        const { label, plan, sentence } = await this.planPlace(names);
        if (!plan.length) {
          this.report([sentence.text]);
          return;
        }
        const result = await applyAnchorPlan(this.editorController, plan, label, { placed: true });
        this.report([batchResultText(label, result)]);
      });
    }

    /**
     * Re-place N (6b § 1): the anchors out of date, and those moved by hand of
     * the ticked glyphs, back on their positions — one batch, noted as Place
     * notes, that « Undo last batch » takes back.
     */
    async runReplace() {
      const check = this.status.check;
      const entries = replaceEntries(check, this.selectedFor("check", check.glyphs));
      if (!entries.length) {
        return;
      }
      const plan = entries.map(({ placed, ...item }) => item);
      const label = `Re-place ${plural(plan.length, "anchor")}`;
      await this.withBusy("re-placing…", async () => {
        const result = await applyAnchorPlan(this.editorController, plan, label, { placed: true });
        this.report([batchResultText(label, result)]);
      });
    }

    /**
     * One batch of Make or Recompute: what `work` writes goes into it, and it
     * becomes the one « Undo last batch » takes back — even when `work` stops
     * half-way, as far as it went.
     */
    async inBatch(label, work) {
      const batch = beginBatch(label);
      try {
        return await work(batch);
      } finally {
        endBatch(this.editorController, batch);
      }
    }

    async makeOne(glyphName, glyphData, { batch = null, force = false } = {}) {
      const rule = this.rulesData.rules[glyphName];
      if (!rule) {
        return { ok: false, problems: [{ code: "no-rule" }] };
      }
      const adapter = await loadFontAdapter(this.fontController, glyphsNeededBy(glyphName, rule));
      return await makeGlyph(this.editorController, glyphName, rule, adapter, {
        glyphData,
        glyphSetEntry: this.entryFor(glyphName),
        batch,
        force,
      });
    }

    async runMake() {
      const { ready, drawnByHand } = this.status.compose;
      const ticked = this.selectedFor("compose", [...ready, ...drawnByHand]);
      // nothing ticked: what is ready; the glyphs drawn by hand only when ticked
      const names = ticked.length ? ticked : ready;
      await this.makeGlyphs(names, drawnByHand);
    }

    /**
     * Make these glyphs as one batch. Those drawn by hand go through the
     * « Overwrite ? » sheet first: only the ones ticked there are written.
     */
    async makeGlyphs(names, drawnByHand = []) {
      if (!names.length || this.busy) {
        return;
      }
      const glyphData = await this.ensureGlyphData();
      const { ask } = splitForOverwrite(names, drawnByHand);
      const overwrite = ask.length ? await this.askOverwrite(ask) : new Set();
      const label = names.length === 1 ? `Make ${names[0]}` : `Make ${names.length}`;
      await this.withBusy(`making ${names.length}…`, async () =>
        this.inBatch(label, async (batch) => {
          const outcomes = [];
          try {
            for (const [index, glyphName] of names.entries()) {
              if (ask.includes(glyphName) && !overwrite.has(glyphName)) {
                outcomes.push(outcomeOf(glyphName, { left: "drawn by hand, not ticked" }));
                continue;
              }
              this.pathView.setBusy(`making ${index + 1}/${names.length}: ${glyphName}`);
              const result = await this.makeOne(glyphName, glyphData, {
                batch,
                force: overwrite.has(glyphName),
              });
              outcomes.push(outcomeOf(glyphName, result));
            }
          } finally {
            this.reportBatch(batchReport(label, outcomes));
          }
        })
      );
    }

    /**
     * The « Overwrite ? » sheet, in Fontra's own dialog: each glyph with its
     * rule, its drawing and what Make would put instead (the default source),
     * a box unticked. Resolves to the set of glyphs to overwrite.
     */
    async askOverwrite(names) {
      const dialog = document.querySelector("modal-dialog");
      if (!dialog) {
        return new Set();
      }
      const rows = sheetRows(names, (name) => this.ruleText(name));
      const boxes = new Map();
      const body = [];
      for (const row of rows) {
        const box = element("input", { type: "checkbox", "data-field": `overwrite-${row.glyph}` });
        box.checked = row.checked;
        boxes.set(row.glyph, box);
        const { before, after } = await this.overwritePreviews(row.glyph);
        const old = element("span", { class: "umarks-preview", title: "now: drawn by hand" });
        old.innerHTML = before;
        const made = element("span", { class: "umarks-preview", title: "after Make: its components" });
        made.innerHTML = after;
        body.push(
          element("label", { class: "umarks-overwrite-row", "data-glyph-name": row.glyph }, [
            box,
            element("span", { class: "umarks-overwrite-name" }, [
              element("b", { text: row.glyph }),
              element("span", { class: "umarks-overwrite-rule", text: row.rule }),
            ]),
            old,
            element("span", { class: "umarks-overwrite-arrow", text: "→" }),
            made,
          ])
        );
      }
      const content = element("div", { class: "umarks-overwrite" }, [
        element("div", {
          class: "umarks-overwrite-note",
          text: "Their drawing is replaced by the components of their rule. Undo last batch puts it back.",
        }),
        element("div", { class: "umarks-overwrite-list" }, body),
      ]);
      await dialog.setupDialog(sheetTitle(names.length), "", [
        { title: "Leave them", isCancelButton: true },
        {
          title: "Overwrite checked",
          isDefaultButton: true,
          getResult: () => [...boxes].filter(([, box]) => box.checked).map(([name]) => name),
        },
      ]);
      dialog.appendStyle?.(`
        .umarks-overwrite { display: grid; gap: 0.6em; min-width: 24em; }
        .umarks-overwrite-note { opacity: 0.7; font-size: 0.9em; }
        .umarks-overwrite-list { display: grid; gap: 0.3em; max-height: 50vh; overflow-y: auto; }
        .umarks-overwrite-row {
          display: grid;
          grid-template-columns: auto 1fr auto auto auto;
          gap: 0.6em;
          align-items: center;
          padding: 0.2em 0.4em;
          border-radius: 0.3em;
          cursor: pointer;
        }
        .umarks-overwrite-row:hover { background-color: #8882; }
        .umarks-overwrite-name { display: grid; }
        .umarks-overwrite-rule { font-size: 0.8em; opacity: 0.7; }
        .umarks-overwrite-arrow { opacity: 0.6; }
        .umarks-preview svg { display: block; fill: currentColor; }
        .umarks-preview .umarks-preview-edge { stroke: #8888; stroke-width: 6; }
      `);
      dialog.setContent(content);
      const answer = await dialog.run();
      return chosenForOverwrite(answer, names);
    }

    /** {before, after}: two SVG previews of a glyph in the default source. */
    async overwritePreviews(glyphName) {
      const source = fontSources(this.fontController)[0];
      const rule = this.rulesData.rules[glyphName];
      const metrics = sourceMetrics(this.fontController.sources[source?.identifier]);
      const frame = { ascender: metrics.ascender ?? 800, descender: metrics.descender ?? -200 };
      const contoursOf = (instance) => {
        const path = instance?.flattenedPath ?? instance?.path;
        if (typeof path?.unpackedContours === "function") {
          return path.unpackedContours();
        }
        return path?.contours || [];
      };
      try {
        const instance = await this.fontController.getGlyphInstance(glyphName, source.location);
        const before = previewSVG([{ contours: contoursOf(instance) }], { ...frame, xAdvance: instance?.xAdvance ?? 0 });
        const adapter = await loadFontAdapter(this.fontController, glyphsNeededBy(glyphName, rule));
        const layer = composeVariableGlyph(glyphName, rule, adapter).glyph?.layers[source.identifier]?.glyph;
        const shapes = [];
        for (const component of layer?.components || []) {
          const part = await this.fontController.getGlyphInstance(component.name, source.location);
          shapes.push({
            contours: contoursOf(part),
            dx: component.transformation.translateX,
            dy: component.transformation.translateY,
          });
        }
        const after = previewSVG(shapes, { ...frame, xAdvance: layer?.xAdvance ?? 0 });
        return { before, after };
      } catch (error) {
        console.warn("U+Marks: no preview for", glyphName, error);
        return { before: "", after: "" };
      }
    }

    async runRecompute(names = null) {
      const stale = this.status.update.stale;
      const chosen = names || actionNames(stale.map((entry) => entry.glyph), this.pathView.selected("update"));
      const glyphData = await this.ensureGlyphData();
      await this.withBusy(`updating ${chosen.length}…`, async () =>
        this.inBatch(`Update ${chosen.length}`, async (batch) => {
          const outcomes = [];
          try {
            for (const [index, glyphName] of chosen.entries()) {
              this.pathView.setBusy(`updating ${index + 1}/${chosen.length}: ${glyphName}`);
              const entry = stale.find((candidate) => candidate.glyph === glyphName);
              const rule = this.rulesData.rules[glyphName];
              let result = null; // no rule: outcomeOf says so
              if (!rule) {
                // nothing to do
              } else if (entry?.make) {
                // its components are no longer the rule's: that takes a Make
                result = await this.makeOne(glyphName, glyphData, { batch });
              } else {
                const adapter = await loadFontAdapter(this.fontController, glyphsNeededBy(glyphName, rule));
                result = await recomputeGlyph(this.editorController, glyphName, rule, adapter, { batch });
              }
              outcomes.push(outcomeOf(glyphName, result));
            }
          } finally {
            this.reportBatch(batchReport(`Update ${chosen.length}`, outcomes));
          }
        })
      );
    }

    async runDecompose() {
      const result = await decomposeOpenGlyph(this.editorController);
      this.report(result.ok ? `Decomposed ${result.count} components` : "Nothing to decompose");
      this.scheduleRefresh();
    }

    // --- the foot

    showPlan(plan) {
      if (!this.statusElement) {
        return;
      }
      const glyphName = this.currentGlyphName;
      let text = "";
      if (glyphName && plan && plan.glyphName === glyphName && plan.ghosts.length) {
        const what = plan.kind === "mark" ? "sits on" : "shows";
        text = `${glyphName} ${what} ${[...new Set(plan.ghosts.map((ghost) => ghost.glyphName))].join(" · ")}`;
      } else if (glyphName && plan?.glyphName === glyphName && plan.note) {
        text = `${glyphName}: ${plan.note}`;
      }
      this.statusElement.textContent = text;
      this.statusElement.hidden = !text;
    }

    /** The last report, one line in the foot; a click shows all of it. */
    report(lines) {
      const all = (Array.isArray(lines) ? lines : [lines]).filter((line) => line);
      if (!this.lastElement || !all.length) {
        return;
      }
      this.lastElement.hidden = false;
      this.lastSummary.textContent = all[0];
      replaceChildren(
        this.lastDetails,
        all.map((line) => element("div", { class: "umarks-report-line", text: line }))
      );
    }

    /**
     * The report of a batch: its summary on the line, and unfolded, its glyphs
     * by what they came to — a double-click opens one.
     */
    reportBatch({ summary, groups }) {
      if (!this.lastElement) {
        return;
      }
      this.lastElement.hidden = false;
      this.lastSummary.textContent = summary;
      const nodes = [element("div", { class: "umarks-report-line", text: summary })];
      for (const group of groups) {
        nodes.push(
          element("div", { class: "umarks-subheading", text: `${group.title} · ${group.rows.length}` })
        );
        if (group.rows.length >= CONDENSE_FROM) {
          // many glyphs (6d § 1): each detail once, its glyphs on one line
          for (const { detail, glyphs } of condensedRows(group.rows)) {
            if (detail) {
              nodes.push(element("div", { class: "umarks-report-cause", text: detail }));
            }
            const names = glyphs.flatMap((glyph, index) => [
              index ? ", " : "",
              element("span", {
                class: "umarks-report-name",
                dataset: { glyphName: glyph },
                text: glyph,
                title: "Double-click to open the glyph",
                ondblclick: (event) => {
                  event.stopPropagation();
                  this.openGlyph(glyph);
                },
              }),
            ]);
            nodes.push(
              element(
                "div",
                {
                  class: `umarks-report-names umarks-report-row--${group.kind}`,
                  title: glyphs.join(", "),
                  onclick: (event) => event.stopPropagation(),
                },
                [`${glyphs.length} ${glyphs.length === 1 ? "glyph" : "glyphs"}: `, ...names].filter((part) => part !== "")
              )
            );
          }
          continue;
        }
        for (const row of group.rows) {
          nodes.push(
            element(
              "div",
              {
                class: `umarks-report-row umarks-report-row--${group.kind}`,
                dataset: { glyphName: row.glyph },
                title: "Double-click to open the glyph",
                onclick: (event) => event.stopPropagation(),
                ondblclick: (event) => {
                  event.stopPropagation();
                  this.openGlyph(row.glyph);
                },
              },
              [
                element("span", { class: "umarks-row-name", text: row.glyph }),
                element("span", { class: "umarks-row-detail", text: row.detail, title: row.detail }),
              ]
            )
          );
        }
      }
      replaceChildren(this.lastDetails, nodes);
    }

    async undoBatch() {
      const result = await undoLastBatch(this.editorController);
      this.report([undoResultText(result)]);
      this.render();
      this.ghostsLayer.requestUpdate();
      this.scheduleRefresh();
    }

    // --- ③ and ④: the anchor tools (brief § 4.2, § 4.6)

    /** The glyphs the anchor tools work on: the target's drawn glyphs that are not composed, and every part. */
    anchorScope() {
      const all = (this.workGlyphs || []).filter((name) => this.fontController.hasGlyph(name));
      const ticked = this.pathView?.selected("check") || [];
      return actionNames(all, ticked);
    }

    /** The names of the ticked positions: the designer's choice, else the default. */
    checkedPresets(composed = null, data = this.rulesData) {
      const presets = data.anchors;
      const entries = (composed || (this.entries || []).map((entry) => entry.glyphName))
        .filter((name) => data.rules[name])
        .map((name) => [name, data.rules[name]]);
      const checked = this.placeSelection ?? defaultPlaceSelection(presets, entries);
      return new Set([...checked].filter((name) => name in presets));
    }

    togglePlace(name, ticked) {
      const checked = this.checkedPresets();
      if (ticked) {
        checked.add(name);
      } else {
        checked.delete(name);
      }
      this.placeSelection = checked;
      this.scheduleRefresh();
    }

    /** The positions of ③ and the menus of ④, from the document. */
    refreshAnchorTools() {
      if (!this.anchorsView) {
        return;
      }
      const data = this.rulesData;
      const sources = fontSources(this.fontController);
      this.sourceNamesById = Object.fromEntries(sources.map((source) => [source.identifier, source.name]));
      this.anchorsView.setPresets(data.anchors, this.checkedPresets());
      this.anchorsView.setSources(sources);
      this.anchorsView.setCategories(variantCategories(data.settings));
      this.anchorsView.setItalic(data.settings.followItalicAngle);
    }

    /**
     * The presets are saved in the document the first time they are edited,
     * so that they travel with the project and the designer edits *them*, not
     * the defaults of the plug-in version in use.
     */
    async editPreset(name, field, text) {
      const parsed = parsePresetField(field, text);
      if (!parsed.ok) {
        this.report([`${name}: ${parsed.message}`]);
        this.anchorsView.setPresets(this.rulesData.anchors, this.checkedPresets(), { force: true });
        return;
      }
      const data = this.rulesData;
      const next = withAnchors(data, withPresetField(data.anchors, name, field, parsed.value));
      await this.writeData(next, `Edit anchor position ${name}`);
    }

    async addPreset(text) {
      const created = newPreset(text);
      if (!created.ok) {
        this.report([created.message]);
        return;
      }
      const data = this.rulesData;
      if (created.name in data.anchors) {
        this.report([`${created.name} is already in the list`]);
        return;
      }
      if (this.placeSelection) {
        this.placeSelection.add(created.name);
      }
      await this.writeData(
        withAnchors(data, { ...data.anchors, [created.name]: created.preset }),
        `Add anchor position ${created.name}`
      );
      this.anchorsView.presetAdded();
    }

    async removePreset(name) {
      const data = this.rulesData;
      const anchors = { ...data.anchors };
      delete anchors[name];
      await this.writeData(withAnchors(data, anchors), `Remove anchor position ${name}`);
    }

    async setFollowItalic(on) {
      await this.writeData(
        withSettings(this.rulesData, { followItalicAngle: !!on }),
        on ? "Follow the italic angle" : "Do not follow the italic angle"
      );
    }

    /** Everything a planner needs about a list of glyphs, loaded. */
    async anchorContext(names, extraGlyphs = []) {
      const data = this.rulesData;
      const glyphData = await this.ensureGlyphData();
      const bases = names.map((name) => data.rules[name]?.base).filter((name) => name);
      const adapter = await loadFontAdapter(this.fontController, [
        ...names,
        ...bases,
        ...extraGlyphs,
        ...referencedGlyphs(data.anchors),
      ]);
      const roles = glyphRoles(names, { font: adapter, glyphData, data });
      return { data, adapter, roles };
    }

    /** The plan Place would write on these glyphs now: {label, plan, sentence}. */
    async planPlace(names) {
      const data = this.rulesData;
      const presets = selectedPresets(data.anchors, this.checkedPresets());
      const presetNames = Object.keys(presets);
      if (!names.length || !presetNames.length) {
        return { plan: [], sentence: placeSentence({ presetNames, glyphCount: names.length }) };
      }
      const { adapter, roles } = await this.anchorContext(names);
      const skipped = [];
      const kept = [];
      const plan = planAnchors(adapter, names, presets, { roles, settings: data.settings, skipped, kept });
      return {
        label: `Place anchors (${presetNames.join(", ")})`,
        plan,
        sentence: placeSentence({ presetNames, plan, kept, skipped, glyphCount: names.length }),
      };
    }

    schedulePlacePreview() {
      clearTimeout(this.placeTimer);
      if (!this.pathView?.isOpen("anchors") || !this.status) {
        return;
      }
      const token = ++this.placeToken;
      this.placeTimer = setTimeout(async () => {
        const names = actionNames(this.status.anchors.glyphs, this.pathView.selected("anchors"));
        const { sentence } = await this.planPlace(names.length ? names : this.anchorScope());
        if (token === this.placeToken) {
          this.anchorsView.setPlaceSentence(sentence);
        }
      }, PREVIEW_DELAY);
    }

    // Adjust: one operation, its sentence, then Apply

    scheduleAdjustPreview() {
      clearTimeout(this.adjustTimer);
      this.pending = null;
      if (!this.anchorsView?.adjustOpen) {
        return;
      }
      // the sentence stays until the new one is there (6b § 0): only Apply
      // waits, so that a refresh does not blank the sentence and write it again
      this.anchorsView.applyButton.disabled = true;
      const token = ++this.adjustToken;
      this.adjustTimer = setTimeout(async () => {
        let pending;
        try {
          pending = await this.planOperation(this.anchorsView.operation, this.anchorsView.operationValues());
        } catch (error) {
          console.warn("U+Marks: could not work out the preview", error);
          pending = { sentence: { text: `Could not work it out: ${error.message}`, ready: false } };
        }
        if (token !== this.adjustToken) {
          return;
        }
        this.pending = pending.sentence.ready ? pending : null;
        this.anchorsView.setPreview(pending.sentence);
      }, PREVIEW_DELAY);
    }

    /** A plan for one batch: {label, plan, apply, sentence}. */
    anchorPending(label, plan) {
      return {
        label,
        apply: () => applyAnchorPlan(this.editorController, plan, label),
        sentence: { text: previewSentence(label, plan), ready: plan.length > 0 },
      };
    }

    /**
     * What one operation of Adjust would do on the target, without writing:
     * {label, apply, sentence: {text, ready}}. `apply` writes it (or, for
     * Check, reports).
     */
    async planOperation(op, values) {
      const names = this.anchorScope();
      const nothing = (text) => ({ sentence: { text, ready: false } });
      if (!names.length) {
        return nothing("No drawn glyph in the glyph set yet.");
      }
      const data = this.rulesData;
      const sources = fontSources(this.fontController);

      switch (op) {
        case "check": {
          const presets = selectedPresets(data.anchors, this.checkedPresets());
          const sentence = checkSentence({
            presetNames: Object.keys(presets),
            glyphs: names.length,
            sources: sources.length,
          });
          return {
            label: "Check anchors",
            sentence,
            apply: async () => {
              const { adapter, roles } = await this.anchorContext(names);
              const report = checkAnchors(adapter, names, presets, { roles, settings: data.settings });
              return { lines: checkReportLines(report, this.sourceNamesById) };
            },
          };
        }
        case "move": {
          if (!values.name) {
            return nothing("Move: which anchor?");
          }
          const { adapter } = await this.anchorContext(names);
          return this.anchorPending(moveLabel(values), shiftAnchors(adapter, names, values.name, values.dx, values.dy));
        }
        case "align": {
          if (!values.name || (!values.x && !values.y)) {
            return nothing("Align: give an anchor, and where its x or its y goes.");
          }
          const { adapter } = await this.anchorContext(names);
          const skipped = [];
          const plan = alignAnchors(
            adapter,
            names,
            values.name,
            { x: values.x || undefined, y: values.y || undefined, dx: values.dx, dy: values.dy },
            { baseOf: (glyphName) => data.rules[glyphName]?.base ?? null, skipped }
          );
          const pending = this.anchorPending(alignLabel(values), plan);
          if (skipped.length) {
            pending.sentence.text += ` ${skipped.length} cannot be worked out, left alone.`;
          }
          return pending;
        }
        case "copy": {
          let from;
          if (values.mode === "source") {
            const ids = sources.map((source) => source.identifier);
            from = {
              fromSource: values.fromSource,
              toSources: values.toSource === "*" ? ids.filter((id) => id !== values.fromSource) : [values.toSource],
            };
          } else {
            if (!values.glyph) {
              return nothing("Copy from: which glyph?");
            }
            from = { fromGlyph: values.glyph };
          }
          const { adapter } = await this.anchorContext(names, values.glyph ? [values.glyph] : []);
          if (from.fromGlyph && !adapter.hasGlyph(from.fromGlyph)) {
            return nothing(`Copy from: the font has no ${from.fromGlyph}.`);
          }
          const label = copyLabel({
            ...values,
            fromName: this.sourceNamesById[values.fromSource] || values.fromSource,
            toName: values.toSource === "*" ? "all the others" : this.sourceNamesById[values.toSource] || values.toSource,
          });
          return this.anchorPending(
            label,
            copyAnchors(adapter, names, from, { names: values.names.length ? values.names : null, replace: values.replace })
          );
        }
        case "mirror": {
          if (!values.name) {
            return nothing("Mirror: which anchor?");
          }
          const { adapter } = await this.anchorContext(names);
          const label = mirrorLabel({
            ...values,
            sourceName:
              values.source && values.source !== "*"
                ? this.sourceNamesById[values.source] || values.source
                : "all sources",
          });
          return this.anchorPending(
            label,
            mirrorAnchors(adapter, names, values.name, values.angle, {
              sources: values.source && values.source !== "*" ? [values.source] : null,
            })
          );
        }
        case "derive": {
          if (!values.suffix) {
            return nothing("Derive variants: give the suffix, like .cap");
          }
          const { adapter, roles } = await this.anchorContext(names);
          const marks = names.filter((name) => roles.get(name)?.kind === "mark");
          const skipped = [];
          const plans = planVariants(adapter, marks, values.category, {
            suffix: values.suffix,
            scale: values.scale,
            dy: values.dy,
            settings: data.settings,
            skipped,
          });
          const label = `Derive ${values.suffix} variants`;
          return {
            label,
            sentence: deriveSentence({
              ...values,
              plans,
              marks: marks.length,
              existing: skipped.filter((entry) => entry.reason === "exists").length,
              problems: skipped.filter((entry) => entry.reason !== "exists").map((entry) => `${entry.glyph}: ${entry.reason}`),
            }),
            apply: () => applyVariantPlan(this.editorController, plans, label),
          };
        }
        default:
          return nothing(`No operation ${op}.`);
      }
    }

    async applyPending() {
      const pending = this.pending;
      if (!pending) {
        return;
      }
      this.pending = null;
      this.anchorsView.setPreview(null);
      await this.withBusy(`${pending.label}…`, async () => {
        const result = await pending.apply();
        this.report(result.lines || [batchResultText(pending.label, result)]);
      });
    }

    // --- the open glyph (needs 1, 2, 3)

    scheduleGlyph() {
      clearTimeout(this.glyphTimer);
      this.glyphTimer = setTimeout(() => this.refreshGlyph(), 50);
    }

    /** What the open glyph is to the target and to the rules, for glyph-view.js. */
    async refreshGlyph() {
      if (!this.glyphView || !this.started) {
        return;
      }
      const token = ++this.glyphToken;
      const glyphName = this.currentGlyphName;
      if (!glyphName) {
        this.glyphView.set(null);
        return;
      }
      const data = this.rulesData;
      const rules = data.rules;
      const glyphData = await this.ensureGlyphData();
      const glyphMap = this.fontController.glyphMap;
      const codePointOf = (name) => glyphMap[name]?.[0] ?? glyphData?.codePointForGlyphName(name);
      const { kind, names } = ghostRules(glyphName, rules, codePointOf);
      const targetNames = (this.entries || []).map((entry) => entry.glyphName);
      const hasTarget = !!this.target;
      const choice = this.ghostsLayer.choiceFor(glyphName);
      const info = {
        glyphName,
        kind,
        rules,
        hasTarget,
        inTarget: targetNames.includes(glyphName),
        // a base or an accent the target's rules are made of
        partOfTarget: !targetNames.includes(glyphName) && (this.workGlyphs || []).includes(glyphName),
        ghost: {
          options: names.length
            ? [{ value: "", label: `all ${names.length}` }, ...names.map((name) => ({ value: name, label: name }))]
            : [],
          value: choice && names.includes(choice) ? choice : "",
          note: `no rule uses ${glyphName} yet`,
        },
      };

      // the accents a glyph is made of, for the menus of a rule
      const markNames = Object.keys(glyphMap).filter(
        (name) => name.endsWith("comb") || glyphData?.isMark(name) || Object.values(rules).some((rule) => (rule.marks || []).some((mark) => mark.glyph === name))
      );
      const loadFor = [glyphName, ...markNames];
      if (kind === "composed") {
        loadFor.push(...glyphsNeededBy(glyphName, rules[glyphName]));
      }
      const font = await loadFontAdapter(this.fontController, loadFor);
      if (token !== this.glyphToken) {
        return;
      }
      const source = font.sources[0];
      const layer = (name) => (source ? font.getLayerGlyph(name, source.identifier) : null);
      const choicesFor = (rule) => ({
        // a legacy accent can be made of any `…comb` the font has
        combs: isLegacyRule(rule)
          ? [...new Set([rule.legacy, ...Object.keys(glyphMap).filter((name) => /comb(\.|$)/.test(name))])]
          : [],
        anchors: (rule.marks || []).map((mark) => anchorChoices(layer(mark.on || rule.base), layer(mark.glyph), mark.anchor)),
        variants: (rule.marks || []).map((mark) => variantChoices(mark.glyph, glyphMap)),
      });

      const stale = this.status?.update.stale || [];
      if (kind === "composed") {
        const rule = rules[glyphName];
        const where = this.status?.byGlyph.get(glyphName);
        const details = this.states?.get(glyphName) ?? syncDetails(glyphName, rule, await loadFontAdapter(this.fontController, glyphsNeededBy(glyphName, rule)));
        info.rule = rule;
        info.choices = choicesFor(rule);
        info.note = missingVariantNote(rule, data.settings, glyphMap);
        const state = this.composedState(glyphName, rule, details, where);
        Object.assign(info, state);
        info.canMake = details.state !== "impossible" && !where?.parts?.length;
        // ready but absent, shaping on (6d § 2): the canvas is right, the font has a hole
        const character = codePointOf(glyphName) ? String.fromCodePoint(codePointOf(glyphName)) : null;
        if (
          this.textShaping &&
          character &&
          details.state === "missing" &&
          state.stateKind === "missing" &&
          !glyphMap[glyphName] &&
          !isLegacyRule(rule)
        ) {
          const parts = [rule.base, ...(rule.append || []), ...(rule.marks || []).map((mark) => mark.glyph)];
          info.shapingNote =
            `The canvas already shows ${character} by shaping ${parts.join(" + ")} from your anchors; ` +
            `${glyphName} itself is not in the font yet — Make writes it.`;
        }
        info.canRecompute = details.state === "stale" || details.state === "ok";
        info.canDecompose = details.state === "ok" || details.state === "stale";
        if (state.stateText === "drawn by hand") {
          // nothing to recompute or decompose: Make, through the sheet, is the gesture
          info.canRecompute = false;
          info.canDecompose = false;
        }
        if (state.stateKind === "stale") {
          // the warning says what is true and where, and puts the choice
          // explicitly: Recompute, or leave it — ⑥ will go on counting it,
          // there is no offset per source in this version (5 bis § 6)
          info.warning = {
            text: `moved off its anchors: ${state.stateLines.join("; ")}`,
            names: [glyphName],
            choice: needsMake(details)
              ? null
              : {
                  glyph: glyphName,
                  left: this.leftAsIs.has(glyphName),
                  text: "Update puts it back on the anchor; left as it is, ⑥ goes on counting it.",
                },
          };
          info.stateLines = ["moved off its anchors since it was made"];
        }
      } else if (kind === "base" || (!kind && glyphData)) {
        const composes = composablesFor(glyphName, { font, glyphData, rules, targetNames });
        // after Unicode's, what its anchors accept (6a, decision 5)
        const anchorComposes = anchorComposablesFor(glyphName, {
          font,
          glyphData,
          markNames: [...markNames, ...targetNames.filter((name) => glyphData?.isMark(name))],
          rules,
          targetNames,
          settings: data.settings,
          used: composes.flatMap((entry) =>
            entry.rule?.marks?.length === 1 ? [`${entry.rule.marks[0].glyph}@${entry.rule.marks[0].anchor}`] : []
          ),
        });
        if (composes.length || anchorComposes.length || kind === "base") {
          info.kind = "base";
          info.composes = composes;
          info.anchorComposes = anchorComposes;
          info.composableChoices = Object.fromEntries(
            composes.filter((entry) => entry.rule).map((entry) => [entry.glyph, choicesFor(entry.rule)])
          );
        }
        // the composed glyphs of this base that its anchors no longer match
        const ofThis = stale.filter((entry) => rules[entry.glyph]?.base === glyphName);
        if (ofThis.length) {
          // condensed (6d § 1): the cause once, the glyphs on one line, the detail behind ▸
          info.warning = {
            groups: staleGroups(ofThis),
            names: ofThis.map((entry) => entry.glyph),
          };
        }
      } else if (kind === "mark") {
        info.bases = [...new Set(names.map((name) => rules[name].base))];
      }
      // a part not drawn everywhere: where and why (5 bis § 5)
      const drawWhere = this.status?.byGlyph.get(glyphName);
      if (drawWhere?.step === "draw" && info.kind !== "composed") {
        info.drawing = { status: drawWhere.status, why: drawWhere.why || [] };
      }
      this.glyphView.set(info);
    }

    /** {stateText, stateKind, stateLines} of a composed glyph. */
    composedState(glyphName, rule, details, where) {
      if (where?.status === "drawn-by-hand" && where.kind === "components") {
        return {
          stateText: "drawn by hand",
          stateKind: "ok",
          stateLines: ["made of other glyphs than its rule's: Make asks before replacing it"],
        };
      }
      if (where?.status === "drawn-by-hand") {
        return {
          stateText: "drawn by hand",
          stateKind: "ok",
          stateLines: ["drawn by hand — tick it to replace its drawing with the components of its rule"],
        };
      }
      if (where?.status === "waiting") {
        return {
          stateText: "waiting",
          stateKind: "waiting",
          stateLines: [`waiting for ${waitingClause(where.parts, where.anchorsOn)}`],
        };
      }
      switch (details?.state) {
        case "ok":
          return { stateText: "made", stateKind: "ok", stateLines: ["made, in step with its anchors"] };
        case "missing":
          return {
            stateText: "to make",
            stateKind: "missing",
            stateLines: ["not made yet: ready", withoutText(details.skipped)].filter((text) => text),
          };
        case "impossible":
          return {
            stateText: "can't be built yet",
            stateKind: "impossible",
            stateLines: problemLines(details.problems, details.sourceCount),
          };
        case "stale":
          if (details.differences.some((difference) => difference.code === "has-contours")) {
            return {
              stateText: "drawn by hand",
              stateKind: "ok",
              stateLines: ["drawn by hand — tick it to replace its drawing with the components of its rule"],
            };
          }
          return { stateText: "moved off its anchors", stateKind: "stale", stateLines: staleReasons(rule, details) };
        default:
          return { stateText: "", stateKind: "pending", stateLines: ["checking…"] };
      }
    }

    /** Add a glyph to the target's own list, or take it out. */
    async toggleInTarget(glyphName, add) {
      const target = this.target;
      if (!target) {
        return;
      }
      const glyphData = await this.ensureGlyphData();
      const font = await loadFontAdapter(this.fontController, []);
      const sameGlyph = (item) => itemGlyph(item, { font, glyphData }).glyphName === glyphName;
      const codePoint = this.fontController.glyphMap[glyphName]?.[0] ?? glyphData?.codePointForGlyphName(glyphName);
      const item = codePoint ? String.fromCodePoint(codePoint) : glyphName;
      let { add: added, remove: removed } = target;
      if (add) {
        if (removed.some(sameGlyph)) {
          removed = removed.filter((entry) => !sameGlyph(entry));
        } else {
          added = [...added, item];
        }
      } else if (added.some(sameGlyph)) {
        added = added.filter((entry) => !sameGlyph(entry));
      } else {
        removed = [...removed, isCharacterItem(item) ? item : glyphName];
      }
      await this.writeData(
        withTarget(this.rulesData, target.key, { ...target, add: added, remove: removed }),
        `${add ? "Add" : "Take"} ${glyphName} ${add ? "to" : "out of"} the glyph set`
      );
    }

    /**
     * A gesture on a rule — another accent, another anchor — makes it manual
     * (decision B). A glyph that has no rule yet gets the one shown, as manual.
     */
    async editRule(glyphName, change) {
      const data = this.rulesData;
      let rule = structuredClone(data.rules[glyphName] || null);
      if (!rule) {
        const shown = this.glyphView?.info?.composes?.find((entry) => entry.glyph === glyphName)?.rule;
        if (!shown) {
          return;
        }
        rule = structuredClone(shown);
      }
      change(rule);
      await this.writeData(withRule(data, glyphName, rule, { manual: true }), `Edit rule ${glyphName}`);
      this.ghostsLayer.requestUpdate();
    }

    /**
     * A click on a mark the base's anchors accept (6a, decision 5): the rule
     * `base_mark @ anchor`, manual, into the document and into the target —
     * one edit —, then open in the detail to be renamed.
     */
    async addAnchorRule(base, mark, anchor) {
      const data = this.rulesData;
      const glyphName = ruleNameFor(data.settings.namePattern, base, mark);
      if (!isUsableGlyphName(glyphName)) {
        this.report([`${glyphName}: not a name a glyph can take — change the pattern in Edit…`]);
        return;
      }
      if (data.rules[glyphName] || this.fontController.hasGlyph(glyphName)) {
        // already written, or a glyph of that name: shown, not written over
        this.glyphView.openComposable(glyphName);
        this.refreshGlyph();
        return;
      }
      let next = withRule(data, glyphName, { base, marks: [{ glyph: mark, anchor }] }, { manual: true });
      const target = activeTarget(next);
      if (target && !(this.entries || []).some((entry) => entry.glyphName === glyphName)) {
        next = withTarget(next, target.key, { ...target, add: [...target.add, glyphName] });
      }
      this.glyphView.openComposable(glyphName, { focusName: true });
      if (await this.writeData(next, `Rule ${glyphName} from the anchors`)) {
        this.report([`${glyphName} = ${base} + ${mark} @ ${anchor}${target ? ", added to the glyph set" : ""}.`]);
      }
    }

    /** Rename the glyph a rule makes, before it is made: in the rules and in the target. */
    async renameRule(from, to) {
      const data = this.rulesData;
      const rule = data.rules[from];
      if (!rule || !to || to === from) {
        return;
      }
      const problem = !isUsableGlyphName(to)
        ? "not a name a glyph can take"
        : data.rules[to] || this.fontController.hasGlyph(to)
          ? `${to} is taken`
          : this.fontController.hasGlyph(from)
            ? `${from} is made already: rename the glyph in Fontra`
            : null;
      if (problem) {
        this.report([`Rename ${from}: ${problem}.`]);
        return;
      }
      let next = withoutRule(data, from);
      next = withRule(next, to, rule);
      for (const [key, target] of Object.entries(next.targets || {})) {
        if (target.add.includes(from)) {
          next = withTarget(next, key, { ...target, add: target.add.map((item) => (item === from ? to : item)) });
        }
      }
      this.glyphView.openComposable(to);
      await this.writeData(next, `Rename ${from} to ${to}`);
    }

    async runMakeOne(glyphName) {
      // a glyph drawn by hand goes through the sheet, like in ⑤
      const drawn = this.status?.byGlyph.get(glyphName)?.status === "drawn-by-hand";
      await this.makeGlyphs([glyphName], drawn ? [glyphName] : []);
    }

    // --- actions on one glyph

    async openGlyph(glyphName) {
      await this.editorController.insertGlyphInfos([{ glyphName }], 1, true);
    }

    async toggle(on, focus) {
      if (on) {
        this.showPlan(this.ghostsLayer.lastPlan);
        this.render();
      }
    }
  };
}

// exported for the tests of the panel's wiring
export { RULES_KEY };

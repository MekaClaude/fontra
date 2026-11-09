// Writing to the font: create a composed glyph, recompute its components from
// the current anchors, decompose it, and store the rules.
//
// Everything goes through Fontra's own undoable APIs — `newGlyph`,
// `editNamedGlyphAndRecordChanges`, `performEdit` — so ⌘Z works and a change
// reaches collaborators. One glyph, one entry of ⌘Z: a whole batch under a
// single entry needs a change recorder a plug-in cannot import (see
// docs/notes-for-just.md § 4). So a batch — Make N, Recompute N, the anchors,
// the glyphs created — is also remembered here, glyph by glyph, before and
// after, and « Undo last batch » takes it back (the end of this file).
//
// Nothing here guesses: a glyph that already holds contours is refused with
// `needsOverwrite`, for the caller to put in front of the designer.

import { PLACED_KEY, pathSignature } from "./anchors.js";
import { MADE_KEY, composeVariableGlyph, isLegacyRule, syncDetails } from "./compose.js";
import { fontSources, layerNameForSource } from "./font-adapter.js";
import { RULES_KEY, normalizeRulesData, readRulesData, sameRulesData, storable } from "./rules.js";

/** The code point a new composed glyph should carry. */
export function codePointFor(glyphName, { glyphData, glyphSetEntry } = {}) {
  if (glyphSetEntry?.codePoints?.length) {
    return glyphSetEntry.codePoints[0];
  }
  return glyphData?.codePointForGlyphName(glyphName) ?? undefined;
}

/** Store the rules document in the font's customData. */
export async function writeRules(fontController, data, label = "Accent rules") {
  // nothing is written that the document already says (6b § 0): a write is
  // a change of customData, and every change of customData is looked at again
  if (sameRulesData(data, fontController.customData?.[RULES_KEY])) {
    return false;
  }
  await fontController.performEdit(label, "customData", (root) => {
    // no null anywhere: a UFO's lib.plist cannot hold one (rules.js, storable)
    root.customData[RULES_KEY] = storable(data);
  });
  return true;
}

function hasOutlines(layerGlyph) {
  return !!layerGlyph?.path?.contours?.length || !!layerGlyph?.path?.coordinates?.length;
}

/** Components that are other glyphs than the composition's (order aside); none says nothing. */
function otherComponents(existing, expected) {
  const names = (glyph) => (glyph?.components || []).map((component) => component.name).sort().join(" ");
  return !!existing?.components?.length && !!expected && names(existing) !== names(expected);
}

/**
 * Keep, in the layer's customData, where the anchors were when the components
 * were placed (compose.js MADE_KEY), for ⑥ to tell a moved anchor from a
 * moved component (5 bis § 6).
 */
function rememberAnchors(layer, composedLayer) {
  const made = composedLayer?.customData?.[MADE_KEY];
  if (!layer || !made) {
    return;
  }
  if (!layer.customData) {
    layer.customData = {};
  }
  layer.customData[MADE_KEY] = storable(JSON.parse(JSON.stringify(made)));
}

function round(value) {
  return Math.round((value || 0) * 100) / 100 + 0;
}

/**
 * What a layer is, for « is it still as the batch left it? »: its outlines,
 * its components and where they sit, its advance. Fontra's classes and plain
 * objects give the same signature.
 */
export function layerSignature(layerGlyph) {
  return JSON.stringify({
    path: pathSignature(layerGlyph?.path),
    components: (layerGlyph?.components || []).map((component) => {
      const t = component.transformation || {};
      return [
        component.name,
        round(t.translateX),
        round(t.translateY),
        round(t.rotation),
        round(t.scaleX ?? 1),
        round(t.scaleY ?? 1),
        round(t.skewX),
        round(t.skewY),
      ];
    }),
    xAdvance: round(layerGlyph?.xAdvance),
  });
}

/**
 * The class of a Fontra path, or null for the plain shape of the tests.
 * Inside an edit the path is behind Fontra's recording proxy, whose
 * `constructor` and `copy()` do not give the class back: the prototype does.
 */
function pathClass(path) {
  const PathClass = path ? Object.getPrototypeOf(path)?.constructor : null;
  return typeof PathClass?.fromUnpackedContours === "function" ? PathClass : null;
}

function copyOf(path) {
  if (path === undefined || path === null) {
    return null;
  }
  const PathClass = pathClass(path);
  if (PathClass) {
    return new PathClass(
      [...path.coordinates],
      [...path.pointTypes],
      path.contourInfo.map((info) => ({ ...info }))
    );
  }
  return JSON.parse(JSON.stringify(path));
}

/** What the undo needs to put a layer back: its components, its advance, its outlines. */
function layerBefore(layerGlyph) {
  return {
    components: JSON.parse(JSON.stringify(layerGlyph?.components || [])),
    xAdvance: layerGlyph?.xAdvance ?? 0,
    path: copyOf(layerGlyph?.path),
  };
}

/** An empty path of the same kind as `path`: Fontra's class, or the plain shape. */
function emptyPathLike(path) {
  const PathClass = pathClass(path);
  if (PathClass) {
    return PathClass.fromUnpackedContours([]);
  }
  if (path && "coordinates" in path) {
    return { coordinates: [], pointTypes: [], contourInfo: [] };
  }
  return { contours: [] };
}

// --- the shape Fontra keeps a glyph in
//
// Fontra holds a glyph it has read as instances of its classes (VariableGlyph,
// GlyphSource, Layer, StaticGlyph, VarPackedPath), and reads fields of them a
// plain object may lack: `Object.keys(component.location)` when it builds the
// glyph's variation model, `source.location` when it places a source. A glyph
// edited with bare objects keeps working until that model is rebuilt, then
// breaks every redraw (brief 5 bis, § 0) — and is fine again once reloaded,
// because the server fills the defaults in. So everything Make writes is given
// Fontra's shape here: through the class when one can be reached, otherwise
// with every field the class would set.

const IDENTITY = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  tCenterX: 0,
  tCenterY: 0,
};

/** A component as Fontra's `copyComponent` leaves it. */
export function fontraComponent(component) {
  return {
    name: component.name,
    transformation: { ...IDENTITY, ...(component.transformation || {}) },
    location: { ...(component.location || {}) },
    customData: JSON.parse(JSON.stringify(component.customData || {})),
  };
}

/** A glyph source as `GlyphSource.fromObject` leaves it. */
export function fontraSource(source) {
  return {
    name: source.name ?? "",
    locationBase: source.locationBase,
    location: { ...(source.location || {}) },
    layerName: source.layerName,
    inactive: !!source.inactive,
    customData: JSON.parse(JSON.stringify(source.customData || {})),
  };
}

/** A layer as `Layer.fromObject` leaves it, its path in the plain packed shape. */
export function fontraLayer(layer) {
  const glyph = layer?.glyph || {};
  return {
    glyph: {
      xAdvance: glyph.xAdvance ?? 0,
      path: glyph.path ?? { coordinates: [], pointTypes: [], contourInfo: [] },
      components: (glyph.components || []).map(fontraComponent),
      anchors: JSON.parse(JSON.stringify(glyph.anchors || [])),
      guidelines: JSON.parse(JSON.stringify(glyph.guidelines || [])),
    },
    customData: JSON.parse(JSON.stringify(layer?.customData || {})),
  };
}

/** A whole glyph for `fontController.newGlyph`, every part of it in Fontra's shape. */
export function fontraGlyph(glyph) {
  return {
    name: glyph.name,
    axes: JSON.parse(JSON.stringify(glyph.axes || [])),
    sources: (glyph.sources || []).map(fontraSource),
    layers: Object.fromEntries(
      Object.entries(glyph.layers || {}).map(([layerName, layer]) => [layerName, fontraLayer(layer)])
    ),
    customData: JSON.parse(JSON.stringify(glyph.customData || {})),
  };
}

/**
 * The class of an object Fontra made, reached through the prototype (inside an
 * edit, the recording proxy hides `constructor`), or null for the plain shape.
 */
function classOf(object) {
  const Class = object ? Object.getPrototypeOf(object)?.constructor : null;
  return typeof Class?.fromObject === "function" ? Class : null;
}

function asClassOf(sample, plain) {
  const Class = classOf(sample);
  return Class ? Class.fromObject(plain) : plain;
}

/**
 * Create the composed glyph, or fill an existing empty one.
 *
 * Returns one of:
 *   {ok: true, created, warnings}
 *   {ok: false, problems}        the anchors or the glyphs are not there
 *   {ok: false, needsOverwrite}  it exists and holds a drawing of its own
 */
export async function makeGlyph(
  editorController,
  glyphName,
  rule,
  adapter,
  { glyphData, glyphSetEntry, force = false, batch = null } = {}
) {
  const fontController = editorController.fontController;
  const { glyph, problems, warnings } = composeVariableGlyph(glyphName, rule, adapter);
  if (!glyph) {
    return { ok: false, problems, sourceCount: adapter.sources.length };
  }

  // never write to a glyph that is not in this snapshot: the caller forgot to
  // load it, and we would be overwriting what we cannot see
  if (fontController.hasGlyph(glyphName) && !adapter.isLoaded(glyphName)) {
    return { ok: false, problems: [{ code: "not-loaded", glyph: glyphName }] };
  }

  if (!fontController.hasGlyph(glyphName)) {
    // newGlyph(glyphName, codePoint, varGlyph, defaultLayerGlyph, undoLabel):
    // Fontra makes its classes out of `varGlyph`; it gets them whole
    await fontController.newGlyph(
      glyphName,
      codePointFor(glyphName, { glyphData, glyphSetEntry }),
      fontraGlyph(glyph),
      null,
      batch?.label ?? `Make ${glyphName}`
    );
    batch?.created.push({
      glyph: glyphName,
      layers: Object.fromEntries(
        Object.entries(glyph.layers).map(([layerName, layer]) => [layerName, layerSignature(layer.glyph)])
      ),
    });
    return { ok: true, created: true, warnings };
  }

  if (!force) {
    // a drawing of its own, or other glyphs than the rule's (5 bis § 1): put
    // together by hand, not to be replaced without asking
    for (const source of adapter.sources) {
      const existing = adapter.getLayerGlyph(glyphName, source.identifier);
      const expected = glyph.layers[source.identifier]?.glyph;
      if (hasOutlines(existing) || otherComponents(existing, expected)) {
        return { ok: false, needsOverwrite: true, source: source.name };
      }
    }
  }

  const label = batch?.label ?? `Make ${glyphName}`;
  const record = { glyph: glyphName, layers: [] };
  let overwritten = false;
  let edited = false;
  await editorController.sceneController.editNamedGlyphAndRecordChanges(
    glyphName,
    (variableGlyph) => {
      edited = true;
      for (const source of adapter.sources) {
        const composedLayer = glyph.layers[source.identifier]?.glyph;
        if (!composedLayer) {
          continue;
        }
        let layerName = layerNameForSource(
          variableGlyph,
          source.identifier,
          editorController.fontController
        );
        let added = false;
        if (!layerName) {
          added = true;
          // the glyph has no layer for this master yet: add one, the way
          // Fontra names them for a new glyph
          layerName = source.identifier;
          variableGlyph.sources.push(
            asClassOf(
              variableGlyph.sources[0],
              fontraSource({ name: "", layerName, locationBase: source.identifier })
            )
          );
        }
        if (!variableGlyph.layers[layerName]) {
          // a layer of Fontra's class, with an empty path of the glyph's kind
          const sample = Object.values(variableGlyph.layers)[0];
          const plain = fontraLayer({
            glyph: { xAdvance: 0, path: emptyPathLike(sample?.glyph?.path) },
          });
          variableGlyph.layers[layerName] = asClassOf(sample, plain);
        }
        const layerGlyph = variableGlyph.layers[layerName].glyph;
        const before = added ? null : layerBefore(layerGlyph);
        // components and advance: the glyph's own anchors, if it has any, are
        // the designer's and stay as they are. Its outlines go only when the
        // designer ticked it in the Overwrite sheet (`force`).
        if (force && hasOutlines(layerGlyph)) {
          layerGlyph.path = emptyPathLike(layerGlyph.path);
          overwritten = true;
        }
        layerGlyph.components = composedLayer.components.map(fontraComponent);
        layerGlyph.xAdvance = composedLayer.xAdvance;
        rememberAnchors(variableGlyph.layers[layerName], glyph.layers[source.identifier]);
        record.layers.push({ layerName, added, before, after: layerSignature(layerGlyph) });
      }
      return label;
    }
  );
  if (!edited) {
    // Fontra refused the edit (a locked glyph): nothing was written
    return { ok: false, problems: [{ code: "not-edited", glyph: glyphName }] };
  }
  if (record.layers.length) {
    batch?.glyphs.push(record);
  }
  return { ok: true, created: false, overwritten, warnings };
}

/**
 * Move the components back to where the anchors say, and touch nothing else.
 * Refused when the glyph's components are no longer the rule's — that is a
 * Make, not a Recompute.
 */
export async function recomputeGlyph(editorController, glyphName, rule, adapter, { batch = null } = {}) {
  const { glyph, problems } = composeVariableGlyph(glyphName, rule, adapter);
  if (!glyph) {
    return { ok: false, problems, sourceCount: adapter.sources.length };
  }
  if (!editorController.fontController.hasGlyph(glyphName)) {
    return { ok: false, problems: [{ code: "missing-glyph", glyph: glyphName }] };
  }

  const mismatches = [];
  for (const source of adapter.sources) {
    const existing = adapter.getLayerGlyph(glyphName, source.identifier);
    const expected = glyph.layers[source.identifier]?.glyph;
    if (!existing || !expected) {
      continue;
    }
    const existingNames = (existing.components || []).map((c) => c.name).join(" ");
    const expectedNames = expected.components.map((c) => c.name).join(" ");
    if (existingNames !== expectedNames) {
      mismatches.push({ source: source.name, found: existingNames, expected: expectedNames });
    }
  }
  if (mismatches.length) {
    return { ok: false, mismatches };
  }

  let moved = 0;
  const record = { glyph: glyphName, layers: [] };
  await editorController.sceneController.editNamedGlyphAndRecordChanges(
    glyphName,
    (variableGlyph) => {
      for (const source of adapter.sources) {
        const expected = glyph.layers[source.identifier]?.glyph;
        const layerName = layerNameForSource(
          variableGlyph,
          source.identifier,
          editorController.fontController
        );
        const layerGlyph = layerName && variableGlyph.layers[layerName]?.glyph;
        if (!expected || !layerGlyph?.components) {
          continue;
        }
        const before = layerBefore(layerGlyph);
        const movedBefore = moved;
        for (const [index, component] of layerGlyph.components.entries()) {
          const wanted = expected.components[index];
          if (!wanted || component.name !== wanted.name) {
            continue;
          }
          const { translateX, translateY } = wanted.transformation;
          if (
            component.transformation.translateX !== translateX ||
            component.transformation.translateY !== translateY
          ) {
            component.transformation.translateX = translateX;
            component.transformation.translateY = translateY;
            moved++;
          }
        }
        // a legacy accent's advance follows its margins (brief § 4.5)
        if (isLegacyRule(rule) && layerGlyph.xAdvance !== expected.xAdvance) {
          layerGlyph.xAdvance = expected.xAdvance;
          moved++;
        }
        if (moved > movedBefore) {
          // back on the anchors as they are now: that is the new « last Make »
          rememberAnchors(variableGlyph.layers[layerName], glyph.layers[source.identifier]);
          record.layers.push({ layerName, added: false, before, after: layerSignature(layerGlyph) });
        }
      }
      return batch?.label ?? `Update ${glyphName}`;
    }
  );
  if (record.layers.length) {
    batch?.glyphs.push(record);
  }
  return { ok: true, moved };
}

/**
 * Decompose the open glyph's components, with Fontra's own action — it knows
 * about nested components and background layers, we do not. Only works on the
 * glyph being edited, which is what the panel offers it for.
 */
export async function decomposeOpenGlyph(editorController) {
  const sceneController = editorController.sceneController;
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  const components = positionedGlyph?.glyph?.components || [];
  if (!components.length) {
    return { ok: false, reason: "no-components" };
  }
  sceneController.selection = new Set(
    components.map((component, index) => `component/${index}`)
  );
  await sceneController.doDecomposeSelectedComponents();
  return { ok: true, count: components.length };
}

/** The state of every rule of a glyph set, computed without blocking the UI. */
export async function computeStates(
  fontController,
  entries,
  loadAdapter,
  { batchSize = 50, onBatch = null } = {}
) {
  const states = new Map();
  for (let start = 0; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize);
    const adapter = await loadAdapter(batch);
    for (const [glyphName, rule] of batch) {
      states.set(glyphName, syncDetails(glyphName, rule, adapter));
    }
    onBatch?.(states, start + batch.length, entries.length);
    // let the browser breathe between batches
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return states;
}

// --- anchors, in batch (brief § 4.2, § 4.6, § 9)
//
// Fontra's undo is per glyph, so a batch cannot be one entry of ⌘Z (see
// docs/notes-for-just.md § 4). What U+Marks does instead is keep its own
// one-deep stack, like the font overview: each batch writes glyph by glyph,
// through the same undoable calls as everything else — so ⌘Z still takes it
// back one glyph at a time — and remembers *what it changed*, anchor by anchor,
// for `undoLastBatch` to put back.
//
// It remembers changes rather than keeping Fontra's rollback because there is
// none to keep: `editNamedGlyphAndRecordChanges` returns nothing, and a plug-in
// cannot import `recordChanges` to make a rollback of its own. An undo that
// finds an anchor no longer where the batch left it leaves it alone and says so:
// it will not overwrite what the designer did afterwards.

const batchStacks = new WeakMap(); // editorController -> the last batch

/** The batch `undoLastBatch` would take back, or null. */
export function lastBatch(editorController) {
  return batchStacks.get(editorController) ?? null;
}

function rememberBatch(editorController, batch) {
  if (batch.anchors.length || batch.created.length || batch.glyphs?.length || batch.rules) {
    batchStacks.set(editorController, batch);
  }
}

/**
 * Rules written as a batch (6a, the matrix): added to the document, and their
 * glyphs to a target's list, in one edit, which « Undo last batch » takes
 * back — each rule only if it is still as written, each name of the target
 * only if it is still there. `data` is the document to write; `added`
 * {glyphName: rule}; `target` {key, names}.
 */
export async function writeRulesBatch(editorController, data, { label, added, target = null }) {
  await writeRules(editorController.fontController, data, label);
  const batch = { label, anchors: [], created: [], glyphs: [], rules: { added: JSON.parse(JSON.stringify(added)), target } };
  rememberBatch(editorController, batch);
  return batch;
}

/** The rules a batch wrote, taken back: {removedRules, leftAlone}. */
async function undoRules(fontController, batch, undoLabel) {
  const { data } = readRulesData(fontController.customData);
  const removedRules = [];
  const leftAlone = [];
  const rules = { ...data.rules };
  for (const [glyphName, rule] of Object.entries(batch.rules.added || {})) {
    const { data: written } = normalizeRulesData({ rules: { [glyphName]: rule } });
    if (rules[glyphName] && JSON.stringify(rules[glyphName]) === JSON.stringify(written.rules[glyphName])) {
      delete rules[glyphName];
      removedRules.push(glyphName);
    } else if (rules[glyphName]) {
      leftAlone.push(glyphName);
    }
  }
  const targets = { ...data.targets };
  const target = batch.rules.target;
  if (target && targets[target.key]) {
    const names = new Set(target.names);
    targets[target.key] = { ...targets[target.key], add: targets[target.key].add.filter((item) => !names.has(item)) };
  }
  await writeRules(fontController, { ...data, rules, targets }, undoLabel);
  return { removedRules, leftAlone };
}

/**
 * A batch of Make or Recompute: `makeGlyph` and `recomputeGlyph` write into
 * it, glyph by glyph — the glyphs created, and for every glyph rewritten the
 * layers as they were and as they are left. `endBatch` makes it the one
 * « Undo last batch » takes back; call it in a `finally`, so that a batch cut
 * short by an error is still taken back as far as it went. Each glyph is one
 * edit of Fontra's: written whole, or not at all.
 */
export function beginBatch(label) {
  return { label, anchors: [], created: [], glyphs: [] };
}

export function endBatch(editorController, batch) {
  rememberBatch(editorController, batch);
}

/** The anchor an entry of a plan stands for in this layer, or -1. */
function findAnchorIndex(anchors, name, { x, y }, hint = undefined) {
  const matches = (anchor) => anchor?.name === name && anchor.x === x && anchor.y === y;
  if (hint !== undefined && matches(anchors[hint])) {
    return hint;
  }
  return anchors.findIndex(matches);
}

function groupByGlyph(items) {
  const groups = new Map();
  for (const entry of items) {
    if (!groups.has(entry.glyph)) {
      groups.set(entry.glyph, []);
    }
    groups.get(entry.glyph).push(entry);
  }
  return groups;
}

/**
 * Write a plan from anchors.js: add the anchors that are not there, move the
 * ones that are. One glyph at a time, each through an undoable edit labelled
 * with the batch (« Place anchors (top, bottom) »). Returns
 *
 *   {ok, label, glyphs, anchors, untouched: [glyph], noLayer: [{glyph, source}],
 *    changedSince: [{glyph, name}]}
 *
 * `untouched` are glyphs Fontra refused to edit (locked, read-only) — nothing
 * was written to them, and nothing is remembered for them. A single coordinate
 * typed by hand in the panel passes `{remember: false}`: it is not a batch, and
 * must not take the place of the one « Undo last batch » is waiting to undo.
 *
 * `placed`: Place and Re-place note, in the customData of each layer
 * (anchors.js PLACED_KEY), what they put and where, so that ④ can tell an
 * anchor out of date from one moved by hand (6b § 1); the batch keeps what
 * the note said before, for « Undo last batch » to put it back.
 */
export async function applyAnchorPlan(
  editorController,
  plan,
  label,
  { remember = true, placed = false } = {}
) {
  const { fontController, sceneController } = editorController;
  const batch = { label, anchors: [], created: [] };
  const result = {
    ok: true,
    label,
    glyphs: 0,
    anchors: 0,
    untouched: [],
    noLayer: [],
    changedSince: [],
  };

  for (const [glyphName, items] of groupByGlyph(plan)) {
    if (!fontController.hasGlyph(glyphName)) {
      result.untouched.push(glyphName);
      continue;
    }
    let edited = false;
    const operations = [];
    await sceneController.editNamedGlyphAndRecordChanges(glyphName, (variableGlyph) => {
      edited = true;
      for (const entry of items) {
        const layerName = layerNameForSource(variableGlyph, entry.source, fontController);
        const layerGlyph = layerName && variableGlyph.layers[layerName]?.glyph;
        if (!layerGlyph) {
          result.noLayer.push({ glyph: glyphName, source: entry.source });
          continue;
        }
        if (!layerGlyph.anchors) {
          layerGlyph.anchors = [];
        }
        const anchors = layerGlyph.anchors;
        // what the note said before, and the note of this anchor now
        const note = (operation) => {
          if (!placed) {
            return operation;
          }
          const layer = variableGlyph.layers[layerName];
          const notes = { ...(layer.customData?.[PLACED_KEY] || {}) };
          operation.placedBefore = notes[entry.name] ?? null;
          notes[entry.name] = [entry.x, entry.y];
          layer.customData = { ...(layer.customData || {}), [PLACED_KEY]: notes };
          return operation;
        };
        if (entry.existing) {
          const index = findAnchorIndex(anchors, entry.name, entry.existing, entry.index);
          if (index < 0) {
            result.changedSince.push({ glyph: glyphName, name: entry.name });
            continue;
          }
          anchors[index].x = entry.x;
          anchors[index].y = entry.y;
          operations.push(
            note({
              glyph: glyphName,
              layerName,
              name: entry.name,
              before: { ...entry.existing },
              after: { x: entry.x, y: entry.y },
            })
          );
        } else {
          anchors.push({ name: entry.name, x: entry.x, y: entry.y });
          operations.push(
            note({
              glyph: glyphName,
              layerName,
              name: entry.name,
              before: null,
              after: { x: entry.x, y: entry.y },
            })
          );
        }
      }
      return label;
    });

    if (!edited) {
      result.untouched.push(glyphName);
    } else if (operations.length) {
      batch.anchors.push(...operations);
      result.glyphs++;
      result.anchors += operations.length;
    }
  }

  if (remember) {
    rememberBatch(editorController, batch);
  }
  return result;
}

/**
 * Create the variant glyphs of a `planVariants` plan. A glyph the font has by
 * now is left alone. Returns {ok, label, created: [glyphName], skipped: [glyphName]}.
 */
export async function applyVariantPlan(editorController, plans, label) {
  const { fontController } = editorController;
  const batch = { label, anchors: [], created: [] };
  const result = { ok: true, label, created: [], skipped: [] };

  for (const plan of plans) {
    if (fontController.hasGlyph(plan.glyph)) {
      result.skipped.push(plan.glyph);
      continue;
    }
    await fontController.newGlyph(plan.glyph, undefined, plan.variableGlyph, null, label);
    result.created.push(plan.glyph);
    batch.created.push({
      glyph: plan.glyph,
      signatures: Object.fromEntries(
        Object.entries(plan.variableGlyph.layers).map(([layerName, layer]) => [
          layerName,
          pathSignature(layer.glyph.path),
        ])
      ),
    });
  }

  rememberBatch(editorController, batch);
  return result;
}

/**
 * ② Create N empty: the glyphs the target needs and the font does not have,
 * created empty — their code point, one empty layer per source — so they can
 * be drawn. `entries`: [{glyph, codePoint, combining}].
 *
 * The advance is Fontra's own for a new glyph: each glyph is made by
 * `fontController.newGlyph` without a drawing, which gives the default source
 * the width Fontra gives any new glyph, and the other sources copy it. A
 * combining accent gets 0 instead. One batch, which « Undo last batch » takes
 * back — it deletes the glyphs that are still empty.
 *
 * Returns {ok, label, created: [glyphName], skipped: [glyphName]}.
 */
export async function createEmptyGlyphs(editorController, entries, label) {
  const { fontController, sceneController } = editorController;
  const sources = fontSources(fontController);
  const batch = { label, anchors: [], created: [] };
  const result = { ok: true, label, created: [], skipped: [] };

  for (const entry of entries) {
    if (fontController.hasGlyph(entry.glyph)) {
      result.skipped.push(entry.glyph);
      continue;
    }
    await fontController.newGlyph(
      entry.glyph,
      typeof entry.codePoint === "number" ? entry.codePoint : undefined,
      null,
      null,
      label
    );
    await sceneController.editNamedGlyphAndRecordChanges(entry.glyph, (variableGlyph) => {
      const firstLayer = variableGlyph.layers[variableGlyph.sources[0]?.layerName];
      const first = firstLayer?.glyph;
      const xAdvance = entry.combining ? 0 : first?.xAdvance ?? 0;
      if (first) {
        first.xAdvance = xAdvance;
      }
      // the other sources get layers of Fontra's own classes, reached through
      // the ones Fontra just made: a plain object has no path a canvas can draw
      const LayerClass = firstLayer?.constructor;
      const SourceClass = variableGlyph.sources[0]?.constructor;
      for (const source of sources) {
        if (layerNameForSource(variableGlyph, source.identifier, fontController)) {
          continue;
        }
        const glyphSource = {
          name: "",
          location: {},
          layerName: source.identifier,
          locationBase: source.identifier,
        };
        variableGlyph.sources.push(
          SourceClass?.fromObject ? SourceClass.fromObject(glyphSource) : glyphSource
        );
        const layer = {
          glyph: {
            xAdvance,
            path: { coordinates: [], pointTypes: [], contourInfo: [] },
            components: [],
            anchors: [],
          },
        };
        variableGlyph.layers[source.identifier] = LayerClass?.fromObject
          ? LayerClass.fromObject(layer)
          : layer;
      }
      return label;
    });
    const variableGlyph = (await fontController.getGlyph(entry.glyph))?.glyph;
    batch.created.push({
      glyph: entry.glyph,
      signatures: Object.fromEntries(
        Object.entries(variableGlyph?.layers || {}).map(([layerName, layer]) => [
          layerName,
          pathSignature(layer.glyph?.path),
        ])
      ),
    });
    result.created.push(entry.glyph);
  }

  rememberBatch(editorController, batch);
  return result;
}

/**
 * Take the last batch back: anchors the batch added are removed, anchors it
 * moved go back, glyphs it created are deleted — each only if it is still as
 * the batch left it. Returns {ok, label, restored, removedGlyphs, leftAlone}
 * where `leftAlone` lists what had been touched since.
 */
export async function undoLastBatch(editorController) {
  const batch = lastBatch(editorController);
  if (!batch) {
    return { ok: false, reason: "nothing-to-undo" };
  }
  const { fontController, sceneController } = editorController;
  const undoLabel = `Undo ${batch.label}`;
  const result = {
    ok: true,
    label: batch.label,
    restored: 0,
    restoredGlyphs: [],
    removedGlyphs: [],
    leftAlone: [],
  };

  // the glyphs the batch rewrote: each layer goes back as it was, if it is
  // still as the batch left it
  for (const record of batch.glyphs || []) {
    if (!fontController.hasGlyph(record.glyph)) {
      result.leftAlone.push(record.glyph);
      continue;
    }
    let putBack = 0;
    let touched = 0;
    await sceneController.editNamedGlyphAndRecordChanges(record.glyph, (variableGlyph) => {
      for (const layer of record.layers) {
        const layerGlyph = variableGlyph.layers[layer.layerName]?.glyph;
        if (!layerGlyph || layerSignature(layerGlyph) !== layer.after) {
          touched++;
          continue;
        }
        if (layer.added) {
          variableGlyph.sources = variableGlyph.sources.filter(
            (source) => source.layerName !== layer.layerName
          );
          delete variableGlyph.layers[layer.layerName];
        } else {
          layerGlyph.components = layer.before.components;
          layerGlyph.xAdvance = layer.before.xAdvance;
          if (layer.before.path && pathSignature(layer.before.path) !== pathSignature(layerGlyph.path)) {
            layerGlyph.path = copyOf(layer.before.path);
          }
        }
        putBack++;
      }
      return undoLabel;
    });
    if (putBack) {
      result.restoredGlyphs.push(record.glyph);
    }
    if (touched) {
      result.leftAlone.push(record.glyph);
    }
  }

  for (const [glyphName, operations] of groupByGlyph(batch.anchors)) {
    if (!fontController.hasGlyph(glyphName)) {
      result.leftAlone.push(...operations.map((op) => `${glyphName} ${op.name}`));
      continue;
    }
    await sceneController.editNamedGlyphAndRecordChanges(glyphName, (variableGlyph) => {
      for (const op of [...operations].reverse()) {
        const anchors = variableGlyph.layers[op.layerName]?.glyph?.anchors;
        const index = anchors ? findAnchorIndex(anchors, op.name, op.after) : -1;
        if (index < 0) {
          result.leftAlone.push(`${glyphName} ${op.name}`);
          continue;
        } else if (op.before) {
          anchors[index].x = op.before.x;
          anchors[index].y = op.before.y;
          result.restored++;
        } else {
          anchors.splice(index, 1);
          result.restored++;
        }
        // Place's note goes back to what it said (6b § 1)
        if (op.placedBefore !== undefined) {
          const layer = variableGlyph.layers[op.layerName];
          const notes = { ...(layer.customData?.[PLACED_KEY] || {}) };
          if (op.placedBefore) {
            notes[op.name] = op.placedBefore;
          } else {
            delete notes[op.name];
          }
          const customData = { ...(layer.customData || {}) };
          if (Object.keys(notes).length) {
            customData[PLACED_KEY] = storable(notes);
          } else {
            delete customData[PLACED_KEY];
          }
          layer.customData = customData;
        }
      }
      return undoLabel;
    });
  }

  for (const created of batch.created) {
    if (!fontController.hasGlyph(created.glyph)) {
      continue;
    }
    const variableGlyph = (await fontController.getGlyph(created.glyph))?.glyph;
    // a glyph Make created is compared whole (components, advance); an empty
    // or derived one by its outlines
    const asLeft = created.layers
      ? Object.entries(created.layers).every(
          ([layerName, signature]) =>
            layerSignature(variableGlyph?.layers?.[layerName]?.glyph) === signature
        )
      : Object.entries(created.signatures).every(
          ([layerName, signature]) =>
            pathSignature(variableGlyph?.layers?.[layerName]?.glyph?.path) === signature
        );
    if (asLeft) {
      await fontController.deleteGlyph(created.glyph, undoLabel);
      result.removedGlyphs.push(created.glyph);
    } else {
      result.leftAlone.push(created.glyph);
    }
  }

  if (batch.rules) {
    const { removedRules, leftAlone } = await undoRules(fontController, batch, undoLabel);
    result.removedRules = removedRules;
    result.leftAlone.push(...leftAlone);
  }

  batchStacks.delete(editorController);
  return result;
}

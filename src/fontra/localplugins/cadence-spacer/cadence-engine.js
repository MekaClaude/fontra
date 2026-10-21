// cadence-engine.js
//
// The measurement and spacing math for the Cadence Spacer plugin.
//
// This file has NO dependency on the DOM and NO import of any Fontra
// module: it only uses the public surface of the `editor.fontController` /
// `editor.sceneController` objects that are handed to the plugin at
// registration time. Everything above the "editor access" line is pure and
// can be unit-tested in plain Node (see tests/cadence-engine.test.mjs).
//
// --- Concept recap ------------------------------------------------------
//
// - A "Spacing Table" (CUST, for Cadence Unit Spacing Table) lists, per
//   glyph, a side definition and two integers: how many "cadence units"
//   of sidebearing to put on the left and right.
// - A side definition is two characters, one per side:
//     X = "extreme"  -> measured from the outermost point of the shape
//     S = "stem"     -> measured at a fixed height (the "beam"), i.e.
//                        where a vertical stem crosses that height
//   e.g. "SS" (H, I, N...), "XX" (O, C, G...), "SX" / "XS" (mixed).
// - The "m/n-Beam" is a horizontal line, at a height the user picks so
//   that it crosses the stems of the lowercase "n" (or "m"). The
//   distance between the stems at that height, divided by "grid-steps"
//   (default 32), gives one "grid-step unit" in font units. Multiplying
//   a glyph's cadence units by that unit gives its sidebearing.
//
// The method follows Frank Blokland's LS Cadencer / Cadenculator.

export class CadenceError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "CadenceError";
    this.details = details;
  }
}

export const SIDE_DEFS = ["XX", "SX", "XS", "SS"];
export const DEFAULT_GRID_STEPS = 32;
export const DEFAULT_REF_GLYPHS = ["n", "m"];

// "R-alt" style alternate entries share the base glyph's sidebearing
// definition; see baseGlyphName() / isAltKey().
const ALT_SUFFIX_RE = /-alt[1-4]?$/;

export function baseGlyphName(key) {
  return key.replace(ALT_SUFFIX_RE, "");
}

export function isAltKey(key) {
  return ALT_SUFFIX_RE.test(key);
}

// ---------------------------------------------------------------------
// CUST parsing / serialization
//
// Text format (one directive or entry per line, close to the original
// LS Cadencer .csv syntax so existing tables are easy to port by hand):
//
//   nBeam=200            (optional: mBeam=, nBeam=, fBeam=, gBeam=)
//   tabular=zero.tf,one.tf,two.tf     (optional, glyphs to fix-width)
//   tabularWidth=600     (required if `tabular` is present)
//   # a comment
//   H=SS,14,14,Beam
//   O=XX,7,7,Beam
//   R-alt=SX,14,3,Beam   (alternate value-set for glyph "R")
// ---------------------------------------------------------------------

export function parseCust(text) {
  const lines = (text || "").split(/\r\n|\r|\n/);
  const meta = {
    mBeam: null,
    nBeam: null,
    fBeam: null,
    gBeam: null,
    tabular: [],
    tabularWidth: null,
  };
  const entries = new Map();
  const order = [];
  const errors = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (!line || line.startsWith("#")) {
      return;
    }

    let m;
    if ((m = /^([mnfg]Beam)\s*=\s*(-?\d+(?:\.\d+)?)$/i.exec(line))) {
      const key = m[1][0].toLowerCase() + "Beam";
      meta[key] = parseFloat(m[2]);
      return;
    }
    if ((m = /^tabularWidth\s*=\s*(-?\d+(?:\.\d+)?)$/i.exec(line))) {
      meta.tabularWidth = parseFloat(m[1]);
      return;
    }
    if ((m = /^tabular\s*=\s*(.+)$/i.exec(line))) {
      meta.tabular = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      errors.push(`Line ${lineNo}: expected "GlyphName=SIDEDEF,left,right,beam" — no "=" found.`);
      return;
    }
    const glyphKey = line.slice(0, eqIndex).trim();
    const fields = line
      .slice(eqIndex + 1)
      .split(",")
      .map((s) => s.trim());

    if (!glyphKey) {
      errors.push(`Line ${lineNo}: missing glyph name before "=".`);
      return;
    }
    if (fields.length !== 4) {
      errors.push(
        `Line ${lineNo}: expected 4 comma-separated fields (SIDEDEF,left,right,beam), got ${fields.length}.`
      );
      return;
    }

    const [sideDefRaw, leftStr, rightStr, beamStr] = fields;
    const sideDef = sideDefRaw.toUpperCase();
    if (!SIDE_DEFS.includes(sideDef)) {
      errors.push(
        `Line ${lineNo}: unknown side definition "${sideDefRaw}" (expected one of ${SIDE_DEFS.join(", ")}).`
      );
      return;
    }
    const left = parseFloat(leftStr);
    const right = parseFloat(rightStr);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      errors.push(`Line ${lineNo}: "left" and "right" must be numbers.`);
      return;
    }
    let beam;
    if (/^beam$/i.test(beamStr)) {
      beam = "Beam";
    } else {
      beam = parseFloat(beamStr);
      if (!Number.isFinite(beam)) {
        errors.push(`Line ${lineNo}: "beam" must be the word "Beam" or a number.`);
        return;
      }
    }

    if (entries.has(glyphKey)) {
      errors.push(`Line ${lineNo}: duplicate entry for "${glyphKey}" — later entry wins.`);
    } else {
      order.push(glyphKey);
    }
    entries.set(glyphKey, { key: glyphKey, sideDef, left, right, beam });
  });

  return { meta, entries, order, errors, activeVariant: {} };
}

export function serializeCust(cust) {
  const lines = [];
  const { meta, entries, order } = cust;
  if (meta.mBeam != null) lines.push(`mBeam=${meta.mBeam}`);
  if (meta.nBeam != null) lines.push(`nBeam=${meta.nBeam}`);
  if (meta.fBeam != null) lines.push(`fBeam=${meta.fBeam}`);
  if (meta.gBeam != null) lines.push(`gBeam=${meta.gBeam}`);
  if (meta.tabular?.length) lines.push(`tabular=${meta.tabular.join(",")}`);
  if (meta.tabularWidth != null) lines.push(`tabularWidth=${meta.tabularWidth}`);
  for (const key of order) {
    const e = entries.get(key);
    if (!e) continue;
    lines.push(`${key}=${e.sideDef},${e.left},${e.right},${e.beam}`);
  }
  return lines.join("\n") + "\n";
}

// --- helpers used by the CUST table editor -------------------------------

// Parse a spacing table and refuse to continue when it contains errors.
// Used by the panel when the user loads a .txt/.csv file.
export function loadCustText(text, sourceName = "table") {
  const cust = parseCust(text);
  if (cust.errors.length) {
    throw new CadenceError(
      `Could not read the spacing table (${sourceName}):\n${cust.errors.join("\n")}`
    );
  }
  return cust;
}

export function setCustEntry(cust, key, values) {
  const trimmed = String(key || "").trim();
  if (!trimmed) {
    throw new CadenceError("A spacing-table entry needs a glyph name.");
  }
  const sideDef = String(values.sideDef || "").toUpperCase();
  if (!SIDE_DEFS.includes(sideDef)) {
    throw new CadenceError(
      `Unknown side definition "${values.sideDef}" (expected one of ${SIDE_DEFS.join(", ")}).`
    );
  }
  const left = Number(values.left);
  const right = Number(values.right);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new CadenceError("Left and right cadence units must be numbers.");
  }
  let beam = values.beam;
  if (typeof beam === "string" && /^beam$/i.test(beam.trim())) {
    beam = "Beam";
  } else {
    beam = Number(beam);
    if (!Number.isFinite(beam)) {
      beam = "Beam";
    }
  }
  if (!cust.entries.has(trimmed)) {
    cust.order.push(trimmed);
  }
  cust.entries.set(trimmed, { key: trimmed, sideDef, left, right, beam });
  return cust;
}

export function deleteCustEntry(cust, key) {
  if (!cust.entries.has(key)) {
    return false;
  }
  cust.entries.delete(key);
  cust.order = cust.order.filter((k) => k !== key);
  return true;
}

// ---------------------------------------------------------------------
// Beam / stem measurement
//
// These functions are duck-typed: they only need a `StaticGlyphController`
// (or anything exposing `flattenedPathHitTester`, `bounds`, `xAdvance`,
// `leftMargin` and `rightMargin`), which keeps them unit-testable.
// ---------------------------------------------------------------------

// Cast a horizontal ray through the glyph at y === beamY and return the
// x positions where it crosses the (component-flattened) outline,
// sorted left to right. This is the Fontra equivalent of the LS
// Cadencer "m/n-Beam": a virtual horizontal line used to locate stems.
//
// `flattenedPathHitTester` is the hit tester of the *flattened* path
// (outline + components) — see the representation factory at
// src-js/fontra-core/src/glyph-controller.js:886-897. `rayIntersections`
// takes a pivot point, a NORMALIZED direction and an optional list of
// extra lines (src-js/fontra-core/src/path-hit-tester.js:70-87); each hit
// carries `.x` / `.y` (path-hit-tester.js:147-171).
export function beamCrossings(glyphController, beamY) {
  const hitTester = glyphController?.flattenedPathHitTester;
  if (!hitTester) {
    return [];
  }
  const hits = hitTester.rayIntersections({ x: 0, y: beamY }, { x: 1, y: 0 });
  return hits
    .map((h) => h.x)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
}

export function beamDiagnostics(glyphController, beamY) {
  const xs = beamCrossings(glyphController, beamY);
  return {
    crossingXs: xs,
    crossingCount: xs.length,
    stemCount: Math.floor(xs.length / 2),
    isUsable: xs.length >= 4 && xs.length % 2 === 0,
  };
}

// A reasonable starting point for the beam: the vertical middle of the
// glyph. The user should still nudge it so it actually crosses full
// stems without clipping a serif or a curved shoulder.
export function suggestBeamY(glyphController) {
  const b = glyphController?.bounds;
  if (!b) return 0;
  return Math.round((b.yMin + b.yMax) / 2);
}

// Measure the "stem interval" of a reference glyph ("n" or "m") at a
// given beam height: the rhythmic repeat distance between consecutive
// stems (left edge of one stem to the left edge of the next). For "n"
// there is exactly one interval; for "m" there are two, and they are
// averaged.
//
// The beam must cut the stems and nothing else, so the number of
// crossings has to be even and >= 4 (2 per stem).
export function measureStemInterval(glyphController, beamY) {
  const xs = beamCrossings(glyphController, beamY);
  if (xs.length < 4 || xs.length % 2 !== 0) {
    throw new CadenceError(
      `The beam at y=${beamY} does not cleanly cross full stems in the ` +
        `reference glyph (found ${xs.length} crossing${xs.length === 1 ? "" : "s"}, ` +
        `expected an even number \u2265 4). Raise or lower the beam so it cuts ` +
        `through the stem body, not a serif, curve, or dot above it.`
    );
  }
  const leftEdges = [];
  for (let i = 0; i < xs.length; i += 2) {
    leftEdges.push(xs[i]);
  }
  let total = 0;
  for (let i = 1; i < leftEdges.length; i++) {
    total += leftEdges[i] - leftEdges[i - 1];
  }
  const interval = total / (leftEdges.length - 1);
  return { interval, leftEdges, stemCount: leftEdges.length };
}

export function computeGridStepUnit(glyphController, beamY, gridSteps) {
  const { interval } = measureStemInterval(glyphController, beamY);
  if (!gridSteps || gridSteps <= 0) {
    throw new CadenceError("grid-steps must be a positive number.");
  }
  return interval / gridSteps;
}

// Measure one side of a glyph, per its side-definition character:
//   "X" -> the extreme (outermost point of the outline), i.e. the
//          glyph's own current left/right margin.
//   "S" -> the stem position at the beam height.
//
// `leftMargin` / `rightMargin` are getters on StaticGlyphController:
// leftMargin === bounds.xMin, rightMargin === xAdvance - bounds.xMax
// (src-js/fontra-core/src/glyph-controller.js:678-684).
export function measureSide(glyphController, sideChar, isRight, beamY) {
  if (sideChar === "X") {
    return isRight ? glyphController.rightMargin : glyphController.leftMargin;
  }
  const xs = beamCrossings(glyphController, beamY);
  if (!xs.length) {
    // The beam doesn't cross this glyph at all (e.g. a low-profile
    // mark). Fall back to the extreme measurement rather than failing
    // the whole batch.
    return isRight ? glyphController.rightMargin : glyphController.leftMargin;
  }
  return isRight ? glyphController.xAdvance - xs[xs.length - 1] : xs[0];
}

// Measure both sides of one layer, and report what looked suspicious.
export function measureLayerSides(glyphController, leftChar, rightChar, beamY) {
  const warnings = [];
  const left = measureSide(glyphController, leftChar, false, beamY);
  const right = measureSide(glyphController, rightChar, true, beamY);
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) {
    warnings.push("The glyph has no outline to measure.");
  }
  if ((leftChar === "S" || rightChar === "S") && glyphController?.bounds) {
    const xs = beamCrossings(glyphController, beamY);
    if (!xs.length) {
      warnings.push(
        `The beam (y=${beamY}) does not cross this glyph; the stem side was measured at the extreme instead.`
      );
    } else if (xs.length % 2 !== 0) {
      warnings.push(
        `The beam (y=${beamY}) crosses this glyph an odd number of times (${xs.length}); one side may be measured at the wrong edge.`
      );
    }
  }
  return { left, right, warnings };
}

// ---------------------------------------------------------------------
// Editor access — the only part of this module that talks to Fontra.
//
// Everything below uses the public surface of the objects that the editor
// hands to the plugin (`editor.fontController`, `editor.sceneController`).
// No Fontra module is imported, so this file stays loadable in plain Node.
// ---------------------------------------------------------------------

// Get the controller of ONE layer of a glyph.
//
// Preferred path: `sceneModel.getGlyphInstance(glyphName, layerName)`
// (src-js/views-editor/src/scene-model.js:606-612) — it is scene aware
// (it uses the font location the user is currently editing at) and, when
// the layer exists, the controller it returns is built directly on the
// layer's own StaticGlyph (src-js/fontra-core/src/glyph-controller.js:387-415),
// i.e. on exactly the object that the edit will mutate.
export async function getLayerGlyphController(editor, glyphName, layerName) {
  const sceneModel = editor.sceneController?.sceneModel;
  if (sceneModel?.getGlyphInstance) {
    const controller = await sceneModel.getGlyphInstance(glyphName, layerName);
    if (layerName == null) {
      return controller;
    }
    // The font controller silently falls back to the interpolated instance
    // when the requested layer does not exist on this glyph
    // (glyph-controller.js:450-457) — detect that and report "no layer".
    if (!controller || controller.layerName !== layerName) {
      return null;
    }
    return controller;
  }
  // Fallback: ask the font controller directly.
  // FontController.getGlyphInstance(glyphName, sourceLocation, layerName)
  // REQUIRES a source location: it builds its cache key with
  // locationToString(sourceLocation), and locationToString(undefined) runs
  // Object.keys(undefined) -> "TypeError: Cannot convert undefined or null
  // to object" (font-controller.js:636-641 -> var-model.js:285-292).
  // That is why the recovered draft's one-argument calls blew up.
  const fontController = editor.fontController;
  const varGlyph = await fontController.getGlyph(glyphName);
  const sourceIndex = varGlyph?.getSourceIndexForLayerName?.(layerName);
  return await fontController.getLayerGlyphController(glyphName, layerName, sourceIndex);
}

// Which layers of a glyph should be spaced?
//
//   "editing" (default) — the layer(s) the user is currently editing.
//       This mirrors what Fontra's own Selection Info panel does: it
//       iterates `sceneController.getEditingLayerFromGlyphLayers(glyph.layers)`
//       (src-js/views-editor/src/panel-selection-info.js:811-828) instead of
//       touching every layer of a variable font.
//   "all" — every layer of the glyph (the old "apply to all masters"
//       behaviour). Offered as an explicit opt-in, because silently
//       re-spacing every master of a variable font is rarely what the
//       user wants.
export async function resolveLayerNames(editor, glyphName, layerMode = "editing") {
  const fontController = editor.fontController;
  const sceneController = editor.sceneController;
  const varGlyph = await fontController.getGlyph(glyphName);
  const layers = varGlyph?.glyph?.layers || {};
  const allNames = Object.keys(layers).filter((name) => layers[name]?.glyph);
  if (layerMode === "all") {
    return { layerNames: allNames, fallback: false };
  }
  let editing = {};
  try {
    // scene-controller.js:1252-1267 — throws if nothing is selected, hence
    // the try/catch.
    editing = sceneController?.getEditingLayerFromGlyphLayers?.(layers) || {};
  } catch (e) {
    editing = {};
  }
  const editingNames = Object.keys(editing).filter((name) => allNames.includes(name));
  if (editingNames.length) {
    return { layerNames: editingNames, fallback: false };
  }
  if (allNames.length === 1) {
    // Nothing is being edited, but the glyph has a single layer: it is
    // unambiguous, so use it (and say so in the report).
    return { layerNames: allNames, fallback: true };
  }
  return { layerNames: [], fallback: false };
}

// Measure the cadence unit: the distance between the stems of the
// reference glyph at the beam height, divided by the number of grid steps.
export async function measureCadenceUnit({
  editor,
  refGlyphName = "n",
  beamY,
  gridSteps = DEFAULT_GRID_STEPS,
  layerName = null,
}) {
  const fontController = editor.fontController;
  const wanted = refGlyphName || "n";
  const candidates = [wanted];
  for (const name of DEFAULT_REF_GLYPHS) {
    if (!candidates.includes(name)) {
      candidates.push(name);
    }
  }
  const tried = [];
  for (const name of candidates) {
    if (!fontController.hasGlyph(name)) {
      tried.push(`"${name}" is not in the font`);
      continue;
    }
    const controller = await getLayerGlyphController(editor, name, layerName);
    if (!controller) {
      const message = layerName
        ? `"${name}" could not be loaded in layer "${layerName}".`
        : `"${name}" could not be loaded.`;
      if (name === wanted) {
        // Do not silently switch to another reference glyph: the user asked
        // for this one.
        throw new CadenceError(message);
      }
      tried.push(message);
      continue;
    }
    try {
      const { interval, leftEdges, stemCount } = measureStemInterval(controller, beamY);
      if (!gridSteps || gridSteps <= 0) {
        throw new CadenceError("grid-steps must be a positive number.");
      }
      return {
        refGlyphName: name,
        interval,
        leftEdges,
        stemCount,
        crossingCount: leftEdges.length * 2,
        gridSteps,
        cadenceUnit: interval / gridSteps,
        beamY,
        warnings: tried,
      };
    } catch (e) {
      tried.push(e.message);
      if (name === wanted) {
        // The requested reference glyph exists, but the beam does not work
        // on it: that is something the user has to fix — do not silently
        // switch to a different reference glyph.
        throw e;
      }
    }
  }
  throw new CadenceError(
    `Could not measure the reference glyph "${wanted}". ${tried.join(" ")}`.trim()
  );
}

// ---------------------------------------------------------------------
// Planning (read-only)
// ---------------------------------------------------------------------

// Compute, for one glyph, what its sidebearings *would* become.
// Nothing is written here.
export async function planGlyphSpacing({
  editor,
  glyphName,
  entry,
  defaultBeamY,
  gridStepUnit,
  layerMode = "editing",
}) {
  const fontController = editor.fontController;
  if (!fontController.hasGlyph(glyphName)) {
    return { glyphName, status: "missing", message: `Glyph "${glyphName}" is not in the font.` };
  }

  const varGlyph = await fontController.getGlyph(glyphName);
  // scene-controller.js:1359 — glyphs can be locked individually.
  if (varGlyph?.glyph?.customData?.["fontra.glyph.locked"]) {
    return { glyphName, status: "locked", message: "Glyph is locked; skipped." };
  }

  const { layerNames, fallback } = await resolveLayerNames(editor, glyphName, layerMode);
  if (!layerNames.length) {
    return {
      glyphName,
      status: "error",
      message:
        "No editable layer for this glyph. Open a glyph (or pick a layer) before running the spacer.",
    };
  }

  const beamY = entry.beam === "Beam" ? defaultBeamY : entry.beam;
  const leftChar = entry.sideDef[0];
  const rightChar = entry.sideDef[1];
  const desiredLeft = entry.left * gridStepUnit;
  const desiredRight = entry.right * gridStepUnit;

  const layers = [];
  for (const layerName of layerNames) {
    const controller = await getLayerGlyphController(editor, glyphName, layerName);
    if (!controller || !controller.bounds) {
      layers.push({
        layerName,
        status: "error",
        message: "No outline to measure.",
      });
      continue;
    }
    let measured;
    try {
      measured = measureLayerSides(controller, leftChar, rightChar, beamY);
    } catch (e) {
      layers.push({ layerName, status: "error", message: e.message });
      continue;
    }
    layers.push({
      layerName,
      status: "ok",
      currentLeft: measured.left,
      currentRight: measured.right,
      desiredLeft,
      desiredRight,
      deltaLeft: desiredLeft - measured.left,
      deltaRight: desiredRight - measured.right,
      xAdvanceBefore: controller.xAdvance,
      warnings: measured.warnings,
    });
  }

  const okLayers = layers.filter((l) => l.status === "ok");
  if (!okLayers.length) {
    return {
      glyphName,
      status: "error",
      sideDef: entry.sideDef,
      beamY,
      desiredLeft,
      desiredRight,
      layers,
      message: layers[0]?.message || "Could not measure the glyph.",
    };
  }

  const primary = okLayers[0];
  return {
    glyphName,
    status: "ok",
    kind: "spacing",
    sideDef: entry.sideDef,
    beamY,
    layerNames: okLayers.map((l) => l.layerName),
    currentLeft: primary.currentLeft,
    currentRight: primary.currentRight,
    desiredLeft,
    desiredRight,
    deltaLeft: primary.deltaLeft,
    deltaRight: primary.deltaRight,
    xAdvanceBefore: primary.xAdvanceBefore,
    layers,
    warnings: [
      ...(fallback ? ["No layer was being edited; the glyph's only layer was used."] : []),
      ...okLayers.flatMap((l) => l.warnings || []),
    ],
  };
}

// ---------------------------------------------------------------------
// Applying a plan (writing)
// ---------------------------------------------------------------------

// Apply a previously computed plan.
//
// The margin mechanics are the ones Fontra's own Selection Info panel uses
// (src-js/views-editor/src/panel-selection-info.js:248-281):
//   * the left margin IS bounds.xMin, so the *outline* has to move;
//     the advance width follows, keeping the right margin unchanged.
//   * the right margin IS xAdvance - bounds.xMax, so only the advance
//     width changes; the outline must not move.
//
// Only the layers that were planned are touched: the editing layer(s) by
// default (scene-controller.js:1252-1267), or all layers when explicitly
// asked for.
export async function applyPlan(editor, plan, { senderID, roundToInt = true } = {}) {
  if (plan.status !== "ok") {
    return plan;
  }
  const fontController = editor.fontController;
  const sceneController = editor.sceneController;

  // A read-only font silently ignores edits: scene-controller.js:1349-1352
  // dispatches "glyphEditCannotEditReadOnly" and returns without touching
  // the glyph. Bailing out here keeps the report honest.
  if (fontController.readOnly) {
    return {
      ...plan,
      status: "read-only",
      applied: false,
      message: "The font is read-only — nothing was changed.",
    };
  }

  const round = (v) => (roundToInt ? Math.round(v) : v);
  const targets = (plan.layers || []).filter((l) => l.status === "ok");
  if (!targets.length) {
    return { ...plan, applied: false, message: "Nothing to apply." };
  }
  if (!targets.some((t) => round(t.deltaLeft) || round(t.deltaRight))) {
    return {
      ...plan,
      applied: true,
      skippedNoOp: true,
      appliedLeft: 0,
      appliedRight: 0,
      message: "Already at the desired sidebearings — nothing to do.",
    };
  }

  // scene-controller.js:1222-1237:
  //   editNamedGlyphAndRecordChanges(glyphName, editFunc, senderID,
  //                                  requireSelectedLayer, ignoreGlyphLock)
  // `editFunc` receives the VariableGlyph and MUST return an undo label.
  await sceneController.editNamedGlyphAndRecordChanges(
    plan.glyphName,
    (glyph) => {
      for (const target of targets) {
        const layerGlyph = glyph.layers?.[target.layerName]?.glyph;
        if (!layerGlyph) {
          continue;
        }
        let dLeft = round(target.deltaLeft);
        let dRight = round(target.deltaRight);
        // Clamp, exactly like Fontra's own margin editor does:
        //   maybeClampValue(value, -layerGlyph.xAdvance, undefined)
        //     (panel-selection-info.js:251-255, :275-279)
        //   Math.max(xAdvance, 0)  (edit-tools-metrics.js:755-758)
        // The advance width may never become negative.
        if (dLeft) {
          dLeft = Math.max(dLeft, -layerGlyph.xAdvance);
          layerGlyph.move(dLeft, 0); // moves path, components, anchors, ...
          layerGlyph.xAdvance += dLeft;
        }
        if (dRight) {
          dRight = Math.max(dRight, -layerGlyph.xAdvance);
          layerGlyph.xAdvance = Math.max(layerGlyph.xAdvance + dRight, 0);
        }
        target.appliedLeft = dLeft;
        target.appliedRight = dRight;
        target.xAdvanceAfter = layerGlyph.xAdvance;
        target.clamped =
          Math.abs(dLeft - round(target.deltaLeft)) > 0.0001 ||
          Math.abs(dRight - round(target.deltaRight)) > 0.0001;
      }
      return `Auto-space ${plan.glyphName} (Cadence Spacer)`;
    },
    senderID,
    false, // requireSelectedLayer: the layers were resolved up-front
    false // ignoreGlyphLock: locked glyphs were filtered out while planning
  );

  // Verify that the edit actually landed. `editNamedGlyphAndRecordChanges`
  // returns undefined when it bailed out (read-only font, locked glyph),
  // so the plan entries would have no `xAdvanceAfter` — and if something
  // else went wrong, the model's advance width would differ.
  const varGlyph = await fontController.getGlyph(plan.glyphName);
  const appliedLayers = [];
  let allApplied = true;
  for (const target of targets) {
    const liveGlyph = varGlyph?.glyph?.layers?.[target.layerName]?.glyph;
    const liveAdvance = liveGlyph?.xAdvance;
    if (target.xAdvanceAfter === undefined) {
      allApplied = false;
      appliedLayers.push({
        layerName: target.layerName,
        status: "not-applied",
        message: "The edit did not reach the font.",
      });
    } else if (liveAdvance !== target.xAdvanceAfter) {
      allApplied = false;
      appliedLayers.push({
        layerName: target.layerName,
        status: "mismatch",
        message: `Expected an advance width of ${target.xAdvanceAfter}, found ${liveAdvance}.`,
      });
    } else {
      appliedLayers.push({
        layerName: target.layerName,
        status: "ok",
        appliedLeft: target.appliedLeft,
        appliedRight: target.appliedRight,
        xAdvanceAfter: liveAdvance,
        clamped: !!target.clamped,
      });
    }
  }

  const primary = appliedLayers.find((l) => l.status === "ok");
  return {
    ...plan,
    applied: allApplied,
    appliedLayers,
    appliedLeft: primary?.appliedLeft ?? 0,
    appliedRight: primary?.appliedRight ?? 0,
    message: allApplied
      ? primary?.clamped
        ? "Applied (the advance width was clamped to stay positive)."
        : "Applied."
      : "The edit could not be verified — nothing may have changed.",
  };
}

// ---------------------------------------------------------------------
// Optional second pass: fixed-width ("tabular") glyphs
//
// Matches LS Cadencer's "tab. figures" option: every listed glyph gets
// the same advance width, and its shape is centred inside that width.
// ---------------------------------------------------------------------

export async function planTabularWidths({ editor, cust, layerMode = "editing" }) {
  const { tabular, tabularWidth } = cust.meta;
  if (!tabular?.length || !tabularWidth) {
    return [];
  }
  const fontController = editor.fontController;
  const plans = [];

  for (const glyphName of tabular) {
    if (!fontController.hasGlyph(glyphName)) {
      plans.push({ glyphName, status: "missing", kind: "tabular", message: "Not in the font." });
      continue;
    }
    const varGlyph = await fontController.getGlyph(glyphName);
    if (varGlyph?.glyph?.customData?.["fontra.glyph.locked"]) {
      plans.push({ glyphName, status: "locked", kind: "tabular", message: "Glyph is locked." });
      continue;
    }
    const { layerNames, fallback } = await resolveLayerNames(editor, glyphName, layerMode);
    if (!layerNames.length) {
      plans.push({
        glyphName,
        status: "error",
        kind: "tabular",
        message: "No editable layer for this glyph.",
      });
      continue;
    }
    const layers = [];
    for (const layerName of layerNames) {
      const controller = await getLayerGlyphController(editor, glyphName, layerName);
      if (!controller || !controller.bounds) {
        layers.push({ layerName, status: "error", message: "No outline to measure." });
        continue;
      }
      const xAdvance = controller.xAdvance;
      const delta = tabularWidth - xAdvance;
      const shiftLeft = delta / 2;
      layers.push({
        layerName,
        status: "ok",
        currentLeft: controller.leftMargin,
        currentRight: controller.rightMargin,
        desiredLeft: controller.leftMargin + shiftLeft,
        desiredRight: controller.rightMargin + (delta - shiftLeft),
        deltaLeft: shiftLeft,
        deltaRight: delta - shiftLeft,
        xAdvanceBefore: xAdvance,
        xAdvanceDesired: tabularWidth,
      });
    }
    const okLayers = layers.filter((l) => l.status === "ok");
    if (!okLayers.length) {
      plans.push({
        glyphName,
        status: "error",
        kind: "tabular",
        layers,
        message: layers[0]?.message || "Could not measure the glyph.",
      });
      continue;
    }
    const primary = okLayers[0];
    plans.push({
      glyphName,
      status: "ok",
      kind: "tabular",
      currentLeft: primary.currentLeft,
      currentRight: primary.currentRight,
      desiredLeft: primary.desiredLeft,
      desiredRight: primary.desiredRight,
      deltaLeft: primary.deltaLeft,
      deltaRight: primary.deltaRight,
      xAdvanceBefore: primary.xAdvanceBefore,
      xAdvanceDesired: tabularWidth,
      layers,
      warnings: fallback ? ["No layer was being edited; the glyph's only layer was used."] : [],
    });
  }
  return plans;
}

// ---------------------------------------------------------------------
// Batch orchestration
// ---------------------------------------------------------------------

// Which glyphs does the table cover?
//
// The table drives the selection (not the font): every entry in the table
// becomes a target, so a table entry for a glyph that is not in the font
// is reported as "missing" instead of silently disappearing.
export function resolveTargets(cust, glyphNames) {
  const fontGlyphNames = new Set(glyphNames || []);
  const activeVariant = cust.activeVariant || {};

  // base glyph name -> table key that should be used for it
  const effective = new Map();
  for (const key of cust.order || []) {
    if (isAltKey(key)) {
      continue; // alternates are only used when they are the active variant
    }
    if (cust.entries.has(key)) {
      effective.set(baseGlyphName(key), key);
    }
  }
  for (const [base, activeKey] of Object.entries(activeVariant)) {
    if (cust.entries.has(activeKey)) {
      effective.set(base, activeKey);
    }
  }

  // Keep the table's own order.
  const ordered = [...effective.entries()].sort((a, b) => {
    const ia = cust.order.indexOf(a[1]);
    const ib = cust.order.indexOf(b[1]);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
  });

  const targets = [];
  for (const [base, key] of ordered) {
    const entry = cust.entries.get(key);
    if (!entry) {
      continue;
    }
    targets.push({
      glyphName: base,
      entry,
      tableKey: key,
      present: fontGlyphNames.has(base),
    });
  }
  return targets;
}

export function summarizeResults(results) {
  const summary = {
    total: results.length,
    ok: 0,
    missing: 0,
    locked: 0,
    error: 0,
    "read-only": 0,
  };
  for (const r of results) {
    const key = r?.status || "error";
    summary[key] = (summary[key] || 0) + 1;
  }
  return summary;
}

// Run the whole spacing pass.
//
// `dryRun` (the default) only computes the plan; pass dryRun: false to
// write the result into the font.
export async function runAutoSpacing({
  editor,
  cust,
  glyphNames,
  gridSteps = DEFAULT_GRID_STEPS,
  refGlyphName = "n",
  beamY,
  dryRun = true,
  senderID,
  onProgress,
  layerMode = "editing",
  roundToInt = true,
}) {
  const fontController = editor.fontController;
  const sceneController = editor.sceneController;

  if (!dryRun && fontController.readOnly) {
    throw new CadenceError("This font is read-only — cannot apply auto-spacing.");
  }

  // Measure the cadence unit in the layer that is being edited, so the
  // rhythm matches the layer that is actually re-spaced.
  const primaryLayer = sceneController?.editingLayerNames?.[0] ?? null;
  let cadence;
  try {
    cadence = await measureCadenceUnit({
      editor,
      refGlyphName,
      beamY,
      gridSteps,
      layerName: primaryLayer,
    });
  } catch (e) {
    if (primaryLayer == null) {
      throw e;
    }
    // The reference glyph may not exist in the layer that is being edited;
    // fall back to the font's default instance and say so.
    cadence = await measureCadenceUnit({
      editor,
      refGlyphName,
      beamY,
      gridSteps,
      layerName: null,
    });
    cadence.warnings.push(
      `The reference glyph could not be measured in layer "${primaryLayer}"; the default instance was used instead.`
    );
  }

  const targets = resolveTargets(cust, glyphNames);
  const results = [];
  let i = 0;
  for (const { glyphName, entry } of targets) {
    const plan = await planGlyphSpacing({
      editor,
      glyphName,
      entry,
      defaultBeamY: beamY,
      gridStepUnit: cadence.cadenceUnit,
      layerMode,
    });
    const result =
      !dryRun && plan.status === "ok"
        ? await applyPlan(editor, plan, { senderID, roundToInt })
        : plan;
    results.push(result);
    i++;
    if (onProgress) {
      onProgress(i, targets.length, result);
    }
  }

  return {
    dryRun,
    cadence,
    gridStepUnit: cadence.cadenceUnit,
    referenceInterval: cadence.interval,
    targetCount: targets.length,
    results,
    summary: summarizeResults(results),
  };
}

// Run the fixed-width pass (the table's "tabular=" list).
export async function runTabularPass({
  editor,
  cust,
  dryRun = true,
  senderID,
  onProgress,
  layerMode = "editing",
}) {
  const fontController = editor.fontController;
  if (!dryRun && fontController.readOnly) {
    throw new CadenceError("This font is read-only — cannot apply tabular widths.");
  }
  const plans = await planTabularWidths({ editor, cust, layerMode });
  const results = [];
  let i = 0;
  for (const plan of plans) {
    const result =
      !dryRun && plan.status === "ok"
        ? await applyPlan(editor, plan, { senderID, roundToInt: false })
        : plan;
    results.push(result);
    i++;
    if (onProgress) {
      onProgress(i, plans.length, result);
    }
  }
  return {
    dryRun,
    targetCount: plans.length,
    results,
    summary: summarizeResults(results),
  };
}

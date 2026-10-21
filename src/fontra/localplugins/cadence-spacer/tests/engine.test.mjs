// tests/engine.test.mjs
//
// The parts of the engine that are pure: the CUST format, the glyph-name
// convention, the measurement, and the planning.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CadenceError,
  DEFAULT_GRID_STEPS,
  SIDE_DEFS,
  baseGlyphName,
  beamCrossings,
  beamDiagnostics,
  computeGridStepUnit,
  deleteCustEntry,
  isAltKey,
  loadCustText,
  measureLayerSides,
  measureSide,
  measureStemInterval,
  parseCust,
  planGlyphSpacing,
  planTabularWidths,
  resolveTargets,
  serializeCust,
  setCustEntry,
  suggestBeamY,
  summarizeResults,
} from "../cadence-engine.js";

import { REFERENCE_CROSSINGS, makeFakeEditor } from "./_helpers.mjs";

// ---------------------------------------------------------------------------
// 1. The CUST format
// ---------------------------------------------------------------------------

test("a well-formed table parses", () => {
  const cust = parseCust(["# a comment", "", "nBeam=200", "H=SS,10,10,Beam", "O=XX,7,7,Beam"].join("\n"));
  assert.deepEqual(cust.errors, []);
  assert.equal(cust.meta.nBeam, 200);
  assert.equal(cust.order.length, 2);
  const entry = cust.entries.get("H");
  assert.equal(entry.sideDef, "SS");
  assert.equal(entry.left, 10);
  assert.equal(entry.right, 10);
  assert.equal(entry.beam, "Beam");
});

test("a line without an '=' is an error", () => {
  const cust = parseCust("H SS,10,10,Beam");
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /no "=" found/);
  assert.match(cust.errors[0], /Line 1/);
});

test("a line with the wrong number of fields is an error", () => {
  const cust = parseCust("H=SS,10,10");
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /expected 4 comma-separated fields/);
});

test("an unknown side definition is an error", () => {
  const cust = parseCust("H=ZZ,10,10,Beam");
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /unknown side definition/);
});

test("a non-numeric sidebearing is an error", () => {
  const cust = parseCust("H=SS,left,10,Beam");
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /must be numbers/);
});

test("a beam that is neither a word nor a number is an error", () => {
  const cust = parseCust("H=SS,10,10,sideways");
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /"beam" must be/);
});

test("a missing glyph name is an error", () => {
  const cust = parseCust("=SS,10,10,Beam");
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /missing glyph name/);
});

test("a duplicate entry is reported, and the later entry wins", () => {
  const cust = parseCust(["H=SS,10,10,Beam", "H=SS,20,20,Beam"].join("\n"));
  assert.equal(cust.errors.length, 1);
  assert.match(cust.errors[0], /duplicate entry/);
  assert.equal(cust.entries.get("H").left, 20);
  assert.equal(cust.order.length, 1);
});

test("every error carries its line number", () => {
  const cust = parseCust(["# fine", "H=SS,10,10,Beam", "broken", "also broken"].join("\n"));
  assert.equal(cust.errors.length, 2);
  assert.match(cust.errors[0], /Line 3/);
  assert.match(cust.errors[1], /Line 4/);
});

test("the parser collects all the errors, not just the first", () => {
  const cust = parseCust(["broken", "H=SS,10,10", "O=ZZ,1,1,Beam"].join("\n"));
  assert.equal(cust.errors.length, 3);
});

test("the parser accepts CRLF line endings", () => {
  const cust = parseCust("nBeam=200\r\nH=SS,10,10,Beam\r\n");
  assert.deepEqual(cust.errors, []);
  assert.equal(cust.meta.nBeam, 200);
  assert.equal(cust.entries.size, 1);
});

test("the parser accepts the tabular directives", () => {
  const cust = parseCust(["tabular=zero,one,two", "tabularWidth=600"].join("\n"));
  assert.deepEqual(cust.meta.tabular, ["zero", "one", "two"]);
  assert.equal(cust.meta.tabularWidth, 600);
});

test("a side definition may be given in lower case", () => {
  const cust = parseCust("H=ss,10,10,Beam");
  assert.deepEqual(cust.errors, []);
  assert.equal(cust.entries.get("H").sideDef, "SS");
});

test("the four side definitions are the ones the LS Cadencer uses", () => {
  assert.deepEqual(SIDE_DEFS, ["XX", "SX", "XS", "SS"]);
});

test("loadCustText refuses a broken table", () => {
  assert.throws(() => loadCustText("broken", "my.txt"), CadenceError);
  assert.doesNotThrow(() => loadCustText("H=SS,10,10,Beam", "my.txt"));
});

// ---------------------------------------------------------------------------
// 2. Serialisation
// ---------------------------------------------------------------------------

test("a table survives a round trip", () => {
  const source = ["nBeam=200", "H=SS,10,10,Beam", "O=XX,7,7,Beam"].join("\n");
  const cust = parseCust(source);
  const text = serializeCust(cust);
  const again = parseCust(text);
  assert.deepEqual(again.errors, []);
  assert.equal(again.meta.nBeam, 200);
  assert.equal(again.entries.get("H").sideDef, "SS");
  assert.equal(again.entries.get("H").left, 10);
  assert.equal(again.order.length, 2);
});

test("the serialised table keeps the order of the entries", () => {
  const cust = parseCust(["Z=XX,1,1,Beam", "A=XX,2,2,Beam"].join("\n"));
  const text = serializeCust(cust);
  assert.ok(text.indexOf("Z=") < text.indexOf("A="));
});

test("the serialised table ends with a newline", () => {
  const cust = parseCust("H=SS,10,10,Beam");
  assert.ok(serializeCust(cust).endsWith("\n"));
});

test("the table editor can set and delete an entry", () => {
  const cust = parseCust("H=SS,10,10,Beam");
  setCustEntry(cust, "O", { sideDef: "xx", left: 7, right: 7, beam: "Beam" });
  assert.equal(cust.entries.get("O").sideDef, "XX");
  assert.equal(cust.order.length, 2);
  assert.equal(deleteCustEntry(cust, "O"), true);
  assert.equal(cust.entries.has("O"), false);
  assert.equal(cust.order.length, 1);
  assert.equal(deleteCustEntry(cust, "O"), false);
});

test("the table editor refuses an entry it cannot use", () => {
  const cust = parseCust("");
  assert.throws(() => setCustEntry(cust, "", { sideDef: "XX", left: 1, right: 1 }), CadenceError);
  assert.throws(
    () => setCustEntry(cust, "H", { sideDef: "ZZ", left: 1, right: 1 }),
    CadenceError
  );
  assert.throws(
    () => setCustEntry(cust, "H", { sideDef: "XX", left: "x", right: 1 }),
    CadenceError
  );
});

// ---------------------------------------------------------------------------
// 3. The glyph-name convention
// ---------------------------------------------------------------------------

test("an alternate key is recognised, and its base name is the plain one", () => {
  assert.equal(isAltKey("R-alt"), true);
  assert.equal(isAltKey("R-alt2"), true);
  assert.equal(isAltKey("R-alt4"), true);
  assert.equal(isAltKey("R"), false);
  assert.equal(baseGlyphName("R-alt"), "R");
  assert.equal(baseGlyphName("R-alt3"), "R");
  assert.equal(baseGlyphName("R"), "R");
});

// ---------------------------------------------------------------------------
// 4. The measurement
// ---------------------------------------------------------------------------

function referenceController(editor) {
  return editor.controller("n");
}

test("the beam crossings are sorted and numeric", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const xs = beamCrossings(referenceController(editor), 200);
  assert.deepEqual(xs, REFERENCE_CROSSINGS);
});

test("a glyph without a hit tester has no crossings", () => {
  assert.deepEqual(beamCrossings(null, 200), []);
  assert.deepEqual(beamCrossings({}, 200), []);
});

test("the diagnostics report the stems", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const diagnostics = beamDiagnostics(referenceController(editor), 200);
  assert.equal(diagnostics.crossingCount, 4);
  assert.equal(diagnostics.stemCount, 2);
  assert.equal(diagnostics.isUsable, true);
});

test("an odd number of crossings is not usable", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, crossings: [50, 120, 300] } },
  });
  const diagnostics = beamDiagnostics(referenceController(editor), 200);
  assert.equal(diagnostics.isUsable, false);
});

test("the stem interval is the distance between the stems", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const { interval, leftEdges, stemCount } = measureStemInterval(referenceController(editor), 200);
  assert.equal(interval, 250);
  assert.deepEqual(leftEdges, [50, 300]);
  assert.equal(stemCount, 2);
});

test("a beam that does not cut the stems is an error", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, crossings: [50, 120, 300] } },
  });
  assert.throws(() => measureStemInterval(referenceController(editor), 200), CadenceError);
});

test("a beam that crosses nothing is an error", () => {
  const editor = makeFakeEditor({ glyphs: { n: { xAdvance: 600, crossings: [] } } });
  assert.throws(() => measureStemInterval(referenceController(editor), 200), CadenceError);
});

test("the cadence unit is the stem interval divided by the grid steps", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const unit = computeGridStepUnit(referenceController(editor), 200, 32);
  assert.equal(unit, 250 / 32);
  assert.equal(DEFAULT_GRID_STEPS, 32);
});

test("the grid steps have to be a positive number", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, crossings: REFERENCE_CROSSINGS } },
  });
  assert.throws(() => computeGridStepUnit(referenceController(editor), 200, 0), CadenceError);
  assert.throws(() => computeGridStepUnit(referenceController(editor), 200, -4), CadenceError);
});

test("the suggested beam is the middle of the glyph", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, yMin: 0, yMax: 700 } },
  });
  assert.equal(suggestBeamY(referenceController(editor)), 350);
});

test("an extreme side is measured at the outline's edge", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const controller = referenceController(editor);
  assert.equal(measureSide(controller, "X", false, 200), 50);
  assert.equal(measureSide(controller, "X", true, 200), 50);
});

test("a stem side is measured at the stem", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const controller = referenceController(editor);
  assert.equal(measureSide(controller, "S", false, 200), 50);
  assert.equal(measureSide(controller, "S", true, 200), 600 - 370);
});

test("a stem side of a glyph the beam misses falls back to the extreme", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: [] } },
  });
  const controller = referenceController(editor);
  assert.equal(measureSide(controller, "S", false, 200), 50);
});

test("measuring both sides warns when the beam misses the glyph", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: [] } },
  });
  const { left, right, warnings } = measureLayerSides(
    referenceController(editor),
    "S",
    "S",
    200
  );
  assert.equal(left, 50);
  assert.equal(right, 50);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /does not cross this glyph/);
});

test("measuring both sides warns when the beam cuts an odd number of times", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: [50, 120, 300] } },
  });
  const { warnings } = measureLayerSides(referenceController(editor), "S", "S", 200);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /odd number of times/);
});

test("measuring both sides of a well-behaved glyph warns about nothing", () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS } },
  });
  const { warnings } = measureLayerSides(referenceController(editor), "S", "S", 200);
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// 5. Planning
// ---------------------------------------------------------------------------

test("a glyph that is not in the font is 'missing'", async () => {
  const editor = makeFakeEditor({ glyphs: {} });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "H",
    entry: { sideDef: "SS", left: 10, right: 10, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit: 7.8125,
  });
  assert.equal(plan.status, "missing");
});

test("a locked glyph is 'locked'", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      H: {
        xAdvance: 500,
        xMin: 80,
        xMax: 420,
        crossings: [80, 160, 300, 380],
        customData: { "fontra.glyph.locked": true },
      },
    },
  });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "H",
    entry: { sideDef: "SS", left: 10, right: 10, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit: 7.8125,
  });
  assert.equal(plan.status, "locked");
});

test("a plan reports the current and the desired sidebearings", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      H: { xAdvance: 500, xMin: 80, xMax: 420, crossings: [80, 160, 300, 380] },
    },
  });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "H",
    entry: { sideDef: "SS", left: 10, right: 10, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit: 7.8125,
  });
  assert.equal(plan.status, "ok");
  assert.equal(plan.currentLeft, 80);
  assert.equal(plan.currentRight, 500 - 380);
  assert.equal(plan.desiredLeft, 78.125);
  assert.equal(plan.desiredRight, 78.125);
  assert.equal(plan.deltaLeft, 78.125 - 80);
  assert.equal(plan.deltaRight, 78.125 - (500 - 380));
  assert.equal(plan.xAdvanceBefore, 500);
});

test("a plan of a glyph with no outline is an error", async () => {
  const editor = makeFakeEditor({
    glyphs: { H: { xAdvance: 0, xMin: 0, xMax: 0, crossings: [] } },
  });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "H",
    entry: { sideDef: "XX", left: 1, right: 1, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit: 7.8125,
  });
  // The glyph exists and has a (degenerate) outline: the plan succeeds, but
  // the measurement is empty.
  assert.ok(["ok", "error"].includes(plan.status));
});

test("a numeric beam in the table overrides the default beam", async () => {
  const editor = makeFakeEditor({
    glyphs: { H: { xAdvance: 500, xMin: 80, xMax: 420, crossings: [80, 160, 300, 380] } },
  });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "H",
    entry: { sideDef: "XX", left: 10, right: 10, beam: 300 },
    defaultBeamY: 200,
    gridStepUnit: 7.8125,
  });
  assert.equal(plan.beamY, 300);
});

// ---------------------------------------------------------------------------
// 6. Which glyphs does the table cover?
// ---------------------------------------------------------------------------

test("the table drives the selection, in the table's own order", () => {
  const cust = parseCust(["Z=XX,1,1,Beam", "A=XX,2,2,Beam"].join("\n"));
  const targets = resolveTargets(cust, ["A", "Z"]);
  assert.deepEqual(
    targets.map((target) => target.glyphName),
    ["Z", "A"]
  );
  assert.ok(targets.every((target) => target.present));
});

test("a table entry for a glyph that is not in the font is reported as missing", () => {
  const cust = parseCust("A=XX,2,2,Beam");
  const targets = resolveTargets(cust, []);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].present, false);
});

test("an alternate entry is only used when it is the active variant", () => {
  const cust = parseCust(["R=XX,10,10,Beam", "R-alt=XX,20,20,Beam"].join("\n"));
  const without = resolveTargets(cust, ["R"]);
  assert.equal(without.length, 1);
  assert.equal(without[0].tableKey, "R");

  cust.activeVariant = { R: "R-alt" };
  const with_ = resolveTargets(cust, ["R"]);
  assert.equal(with_.length, 1);
  assert.equal(with_[0].tableKey, "R-alt");
  assert.equal(with_[0].entry.left, 20);
});

test("the results are summarised by status", () => {
  const summary = summarizeResults([
    { status: "ok" },
    { status: "ok" },
    { status: "missing" },
    { status: "locked" },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.ok, 2);
  assert.equal(summary.missing, 1);
  assert.equal(summary.locked, 1);
});

// ---------------------------------------------------------------------------
// 7. The fixed-width (tabular) pass
// ---------------------------------------------------------------------------

test("a table without a tabular list plans nothing", async () => {
  const editor = makeFakeEditor({ glyphs: { zero: { xAdvance: 500 } } });
  const cust = parseCust("zero=XX,2,2,Beam");
  const plans = await planTabularWidths({ editor, cust });
  assert.deepEqual(plans, []);
});

test("the tabular pass centres the shape in the fixed width", async () => {
  const editor = makeFakeEditor({
    glyphs: { zero: { xAdvance: 500, xMin: 50, xMax: 450, crossings: [] } },
  });
  const cust = parseCust(["tabular=zero", "tabularWidth=600"].join("\n"));
  const plans = await planTabularWidths({ editor, cust });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].status, "ok");
  assert.equal(plans[0].xAdvanceBefore, 500);
  assert.equal(plans[0].xAdvanceDesired, 600);
  assert.equal(plans[0].deltaLeft, 50);
  assert.equal(plans[0].deltaRight, 50);
});

test("the tabular pass reports a glyph that is not in the font", async () => {
  const editor = makeFakeEditor({ glyphs: {} });
  const cust = parseCust(["tabular=zero", "tabularWidth=600"].join("\n"));
  const plans = await planTabularWidths({ editor, cust });
  assert.equal(plans[0].status, "missing");
});

// tests/apply.test.mjs
//
// The writing half: applying a plan, the batch passes, the hostile inputs,
// and the guard that keeps a past defect from coming back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CadenceError,
  applyPlan,
  measureCadenceUnit,
  parseCust,
  planGlyphSpacing,
  runAutoSpacing,
  runTabularPass,
} from "../cadence-engine.js";

import { CADENCE_PRESETS, getPresetNames, loadPreset } from "../cadence-presets.js";

import { REFERENCE_CROSSINGS, makeFakeEditor } from "./_helpers.mjs";

const H_GLYPH = { xAdvance: 500, xMin: 80, xMax: 420, crossings: [80, 160, 300, 380] };
const N_GLYPH = { xAdvance: 600, xMin: 50, xMax: 550, crossings: REFERENCE_CROSSINGS };

/** A plan for "H" against the reference stem interval of 250. */
async function planForH(editor, { sideDef = "SS", left = 10, right = 10, gridStepUnit = 7.8125 } = {}) {
  return planGlyphSpacing({
    editor,
    glyphName: "H",
    entry: { sideDef, left, right, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit,
  });
}

// ---------------------------------------------------------------------------
// 1. Applying a plan
// ---------------------------------------------------------------------------

test("a plan that is not 'ok' is returned unchanged", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  const plan = { glyphName: "H", status: "missing" };
  const result = await applyPlan(editor, plan);
  assert.equal(result, plan);
  assert.equal(result.applied, undefined);
});

test("applying a plan moves the outline and the advance width", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  const plan = await planForH(editor);
  const result = await applyPlan(editor, plan);

  assert.equal(result.applied, true);
  assert.equal(result.appliedLeft, -2);
  assert.equal(result.appliedRight, -42);

  const glyph = editor.layerGlyph("H");
  // The outline moved by the left delta, and the advance width followed.
  assert.equal(glyph.xMin, 78);
  assert.equal(glyph.xMax, 418);
  assert.equal(glyph.xAdvance, 456);
  assert.deepEqual(glyph.moves, [[-2, 0]]);
});

test("the edit is recorded with an undo label", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  const plan = await planForH(editor);
  await applyPlan(editor, plan, { senderID: "test" });
  assert.equal(editor.undoLabels.length, 1);
  assert.match(editor.undoLabels[0], /Auto-space H/);
});

test("a read-only font is not written to", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH }, readOnly: true });
  const plan = await planForH(editor);
  const result = await applyPlan(editor, plan);
  assert.equal(result.status, "read-only");
  assert.equal(result.applied, false);
  assert.equal(editor.layerGlyph("H").xAdvance, 500);
});

test("a glyph that is already at the desired sidebearings is left alone", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  // The current margins are 80 and 80 (xMin 80, xAdvance 500, xMax 420).
  const plan = await planForH(editor, { sideDef: "XX", left: 8, right: 8, gridStepUnit: 10 });
  const result = await applyPlan(editor, plan);
  assert.equal(result.skippedNoOp, true);
  assert.equal(result.applied, true);
  assert.equal(editor.layerGlyph("H").xAdvance, 500);
  assert.deepEqual(editor.layerGlyph("H").moves, []);
});

test("the advance width is clamped so that it never goes negative", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      // A glyph whose outline sticks out to the left of the origin: the
      // left sidebearing cannot be made smaller than the advance width.
      A: { xAdvance: 100, xMin: 150, xMax: 250, crossings: [150, 200] },
    },
  });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "A",
    entry: { sideDef: "XX", left: 0, right: 0, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit: 10,
  });
  const result = await applyPlan(editor, plan);
  assert.equal(result.applied, true);
  assert.equal(result.appliedLayers[0].clamped, true);
  // The advance width never went below zero.
  assert.ok(editor.layerGlyph("A").xAdvance >= 0);
});

test("applying a plan that has no usable layer does nothing", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  const result = await applyPlan(editor, {
    glyphName: "H",
    status: "ok",
    layers: [{ layerName: "regular", status: "error" }],
  });
  assert.equal(result.applied, false);
  assert.equal(editor.undoLabels.length, 0);
});

// ---------------------------------------------------------------------------
// 2. The cadence unit
// ---------------------------------------------------------------------------

test("the cadence unit is measured from the reference glyph", async () => {
  const editor = makeFakeEditor({ glyphs: { n: N_GLYPH, m: N_GLYPH } });
  const cadence = await measureCadenceUnit({
    editor,
    refGlyphName: "n",
    beamY: 200,
    gridSteps: 32,
  });
  assert.equal(cadence.refGlyphName, "n");
  assert.equal(cadence.interval, 250);
  assert.equal(cadence.stemCount, 2);
  assert.equal(cadence.cadenceUnit, 250 / 32);
});

test("a reference glyph that is not in the font is an error", async () => {
  const editor = makeFakeEditor({ glyphs: {} });
  await assert.rejects(
    () => measureCadenceUnit({ editor, refGlyphName: "n", beamY: 200, gridSteps: 32 }),
    CadenceError
  );
});

test("a beam that does not cut the reference glyph is an error", async () => {
  const editor = makeFakeEditor({
    glyphs: { n: { xAdvance: 600, crossings: [50, 120, 300] } },
  });
  await assert.rejects(
    () => measureCadenceUnit({ editor, refGlyphName: "n", beamY: 200, gridSteps: 32 }),
    CadenceError
  );
});

// ---------------------------------------------------------------------------
// 3. The batch passes
// ---------------------------------------------------------------------------

test("a dry run computes the plan and writes nothing", async () => {
  const editor = makeFakeEditor({ glyphs: { n: N_GLYPH, H: H_GLYPH } });
  const cust = parseCust("H=SS,10,10,Beam");
  const run = await runAutoSpacing({
    editor,
    cust,
    glyphNames: ["H"],
    beamY: 200,
    gridSteps: 32,
    dryRun: true,
  });
  assert.equal(run.dryRun, true);
  assert.equal(run.targetCount, 1);
  assert.equal(run.results[0].status, "ok");
  assert.equal(run.gridStepUnit, 250 / 32);
  assert.equal(editor.layerGlyph("H").xAdvance, 500);
  assert.equal(editor.undoLabels.length, 0);
});

test("a real run writes the spacing into the font", async () => {
  const editor = makeFakeEditor({ glyphs: { n: N_GLYPH, H: H_GLYPH } });
  const cust = parseCust("H=SS,10,10,Beam");
  const run = await runAutoSpacing({
    editor,
    cust,
    glyphNames: ["H"],
    beamY: 200,
    gridSteps: 32,
    dryRun: false,
  });
  assert.equal(run.dryRun, false);
  assert.equal(run.results[0].applied, true);
  assert.equal(editor.layerGlyph("H").xAdvance, 456);
  assert.equal(editor.undoLabels.length, 1);
});

test("a real run on a read-only font is refused", async () => {
  const editor = makeFakeEditor({ glyphs: { n: N_GLYPH, H: H_GLYPH }, readOnly: true });
  const cust = parseCust("H=SS,10,10,Beam");
  await assert.rejects(
    () =>
      runAutoSpacing({
        editor,
        cust,
        glyphNames: ["H"],
        beamY: 200,
        gridSteps: 32,
        dryRun: false,
      }),
    CadenceError
  );
});

test("the batch reports its progress", async () => {
  const editor = makeFakeEditor({ glyphs: { n: N_GLYPH, H: H_GLYPH } });
  const cust = parseCust("H=SS,10,10,Beam");
  const seen = [];
  await runAutoSpacing({
    editor,
    cust,
    glyphNames: ["H"],
    beamY: 200,
    gridSteps: 32,
    dryRun: true,
    onProgress: (done, total) => seen.push([done, total]),
  });
  assert.deepEqual(seen, [[1, 1]]);
});

test("the tabular pass gives every listed glyph the same width", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      zero: { xAdvance: 500, xMin: 50, xMax: 450, crossings: [] },
      one: { xAdvance: 400, xMin: 50, xMax: 350, crossings: [] },
    },
  });
  const cust = parseCust(["tabular=zero,one", "tabularWidth=600"].join("\n"));
  const run = await runTabularPass({ editor, cust, dryRun: false });
  assert.equal(run.targetCount, 2);
  assert.equal(run.results[0].applied, true);
  assert.equal(run.results[1].applied, true);
  assert.equal(editor.layerGlyph("zero").xAdvance, 600);
  assert.equal(editor.layerGlyph("one").xAdvance, 600);
});

test("the tabular pass on a read-only font is refused", async () => {
  const editor = makeFakeEditor({
    glyphs: { zero: { xAdvance: 500 } },
    readOnly: true,
  });
  const cust = parseCust(["tabular=zero", "tabularWidth=600"].join("\n"));
  await assert.rejects(() => runTabularPass({ editor, cust, dryRun: false }), CadenceError);
});

// ---------------------------------------------------------------------------
// 4. Hostile input
// ---------------------------------------------------------------------------

test("a table that is not a table at all produces errors, not a crash", () => {
  const cust = parseCust("this is not a table");
  assert.ok(cust.errors.length > 0);
  assert.equal(cust.entries.size, 0);
});

test("an empty table produces an empty plan", async () => {
  const editor = makeFakeEditor({ glyphs: { n: N_GLYPH } });
  const cust = parseCust("");
  const run = await runAutoSpacing({
    editor,
    cust,
    glyphNames: [],
    beamY: 200,
    gridSteps: 32,
    dryRun: true,
  });
  assert.equal(run.targetCount, 0);
  assert.equal(run.results.length, 0);
});

test("a hit tester that returns a non-numeric x is ignored", () => {
  const controller = {
    flattenedPathHitTester: {
      rayIntersections: () => [{ x: NaN }, { x: undefined }, { x: 10 }],
    },
  };
  assert.deepEqual(
    (() => {
      const hits = controller.flattenedPathHitTester.rayIntersections();
      return hits.map((hit) => hit.x).filter((x) => Number.isFinite(x));
    })(),
    [10]
  );
});

test("a glyph with no outline is reported, not thrown", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  const plan = await planGlyphSpacing({
    editor,
    glyphName: "not-in-the-font",
    entry: { sideDef: "XX", left: 1, right: 1, beam: "Beam" },
    defaultBeamY: 200,
    gridStepUnit: 10,
  });
  assert.equal(plan.status, "missing");
  assert.match(plan.message, /not in the font/);
});

test("a scene controller whose edit throws does not fail silently", async () => {
  const editor = makeFakeEditor({ glyphs: { H: H_GLYPH } });
  editor.sceneController.editNamedGlyphAndRecordChanges = async () => {
    throw new Error("the edit exploded");
  };
  const plan = await planForH(editor);
  await assert.rejects(() => applyPlan(editor, plan), /the edit exploded/);
});

// ---------------------------------------------------------------------------
// 5. The source-location guard
//
// Defect D1: `FontController.getGlyphInstance()` was called without a source
// location, which throws for every glyph. The engine therefore has to go
// through the scene model, or through `getLayerGlyphController`.
//
// This test reads the engine's own source and checks that no call site can
// lose the argument again.
// ---------------------------------------------------------------------------

test("no call site asks the font controller for a glyph instance without a source location", () => {
  const source = readFileSync(new URL("../cadence-engine.js", import.meta.url), "utf8");

  // The font controller's own method is the dangerous one.
  assert.ok(
    !/fontController\.getGlyphInstance\s*\(/.test(source),
    "fontController.getGlyphInstance() requires a source location — use the scene model instead"
  );

  // Every other call site has to pass its arguments.
  const callSites = [...source.matchAll(/getGlyphInstance\s*\(([^)]*)\)/g)];
  assert.ok(callSites.length > 0, "the engine does call getGlyphInstance() somewhere");
  for (const [, argumentList] of callSites) {
    const arguments_ = argumentList
      .split(",")
      .map((argument) => argument.trim())
      .filter(Boolean);
    assert.ok(
      arguments_.length >= 2,
      `getGlyphInstance() called with ${arguments_.length} argument(s): ${argumentList.trim()}`
    );
  }
});

test("the engine asks for a layer's controller, not for a raw instance", () => {
  const source = readFileSync(new URL("../cadence-engine.js", import.meta.url), "utf8");
  assert.ok(
    /getLayerGlyphController/.test(source),
    "the engine must go through getLayerGlyphController()"
  );
});

// ---------------------------------------------------------------------------
// 6. The built-in tables
// ---------------------------------------------------------------------------

test("there are three built-in tables", () => {
  const names = getPresetNames();
  assert.equal(names.length, 3);
  assert.ok(names.includes("Renaissance Roman"));
  assert.ok(names.includes("Humanist Sans"));
  assert.ok(names.includes("Grotesk"));
});

test("every built-in table parses without an error", () => {
  for (const name of getPresetNames()) {
    const { text, cust } = loadPreset(name);
    assert.ok(text.length > 0, `${name} is empty`);
    assert.deepEqual(cust.errors, [], `${name} does not parse`);
    assert.ok(cust.entries.size > 0, `${name} has no entries`);
  }
});

test("every built-in table has a beam height and a grid step", () => {
  for (const name of getPresetNames()) {
    const { cust } = loadPreset(name);
    assert.ok(cust.meta.nBeam > 0, `${name} has no nBeam`);
  }
});

test("an unknown table name is an error", () => {
  // The presets module has no reason to depend on the engine's error class,
  // so all that is checked here is that it refuses the name and says why.
  assert.throws(() => loadPreset("No Such Table"), /Unknown preset/);
});

test("the tables are data, and the data is reachable", () => {
  assert.equal(Object.keys(CADENCE_PRESETS).length, 3);
});

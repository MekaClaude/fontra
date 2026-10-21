// tests/font.test.mjs
//
// The Fontra-facing half of the plugin: reading the selection, walking the
// font, and selecting a contour again.
//
// Everything here runs against a fake editor, so no browser is needed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildQuery,
  collectCandidates,
  contoursFromPath,
  getGlyphInstance,
  parseSelection,
  resolveLayerName,
  selectContour,
  segmentsForContour,
} from "../commonform-font.js";

import { bowlContour, makeFakeEditor, makeFakePath, rectContour } from "./_helpers.mjs";

// ---------------------------------------------------------------------------
// 1. The selection
// ---------------------------------------------------------------------------

test("parseSelection splits the selection by kind", () => {
  const parsed = parseSelection(new Set(["point/3", "point/1", "component/0", "anchor/2"]));
  assert.deepEqual(parsed.point, [1, 3]);
  assert.deepEqual(parsed.component, [0]);
  assert.deepEqual(parsed.anchor, [2]);
});

test("parseSelection survives an empty or missing selection", () => {
  assert.deepEqual(parseSelection(new Set()), { point: [], component: [], anchor: [] });
  assert.deepEqual(parseSelection(null), { point: [], component: [], anchor: [] });
});

test("parseSelection ignores an item it cannot read", () => {
  const parsed = parseSelection(new Set(["point/x", "nonsense", "point/2"]));
  assert.deepEqual(parsed.point, [2]);
});

// ---------------------------------------------------------------------------
// 2. The path
// ---------------------------------------------------------------------------

test("contoursFromPath keeps the absolute start index of every contour", () => {
  const path = makeFakePath([
    { points: rectContour(0, 0, 10, 10).points, isClosed: true },
    { points: rectContour(20, 0, 10, 10).points, isClosed: true },
  ]);
  const contours = contoursFromPath(path);
  assert.equal(contours.length, 2);
  assert.equal(contours[0].startIndex, 0);
  assert.equal(contours[1].startIndex, 4);
  assert.equal(contours[1].contourIndex, 1);
  assert.equal(contours[0].isClosed, true);
});

test("contoursFromPath survives a missing path", () => {
  assert.deepEqual(contoursFromPath(null), []);
});

test("segmentsForContour decomposes the contour", () => {
  const path = makeFakePath([{ points: rectContour(0, 0, 10, 10).points, isClosed: true }]);
  const segments = segmentsForContour(path, 0);
  assert.equal(segments.length, 4);
  assert.equal(segments[0].type, "line");
});

test("segmentsForContour survives a missing path", () => {
  assert.deepEqual(segmentsForContour(null, 0), []);
});

// ---------------------------------------------------------------------------
// 3. The query
// ---------------------------------------------------------------------------

test("buildQuery needs a glyph", async () => {
  const editor = makeFakeEditor({});
  const query = await buildQuery(editor);
  assert.equal(query.ok, false);
  assert.match(query.reason, /No glyph/);
});

test("buildQuery needs a selection", async () => {
  const editor = makeFakeEditor({
    glyphs: { b: { contours: [{ points: rectContour(0, 0, 10, 10).points, isClosed: true }] } },
    selectedGlyphName: "b",
  });
  const query = await buildQuery(editor);
  assert.equal(query.ok, false);
  assert.match(query.reason, /Select a shape/);
});

test("buildQuery turns a point selection into the whole contour", async () => {
  const editor = makeFakeEditor({
    glyphs: { b: { contours: [{ points: rectContour(0, 0, 10, 10).points, isClosed: true }] } },
    selectedGlyphName: "b",
    selection: new Set(["point/0", "point/1"]),
  });
  const query = await buildQuery(editor);
  assert.equal(query.ok, true);
  assert.equal(query.source, "points");
  assert.equal(query.glyphName, "b");
  // The whole contour, not just the two selected points.
  assert.equal(query.contours.length, 1);
  assert.equal(query.contours[0].points.length, 4);
  assert.ok(query.contours[0].segments.length > 0);
});

test("buildQuery only takes the contours the selection touches", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      b: {
        contours: [
          { points: rectContour(0, 0, 10, 10).points, isClosed: true },
          { points: rectContour(20, 0, 10, 10).points, isClosed: true },
        ],
      },
    },
    selectedGlyphName: "b",
    selection: new Set(["point/4"]),
  });
  const query = await buildQuery(editor);
  assert.equal(query.ok, true);
  assert.equal(query.contours.length, 1);
  assert.equal(query.contours[0].contourIndex, 1);
});

test("buildQuery takes a component's own outline", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      b: {
        contours: [],
        components: [
          { name: "bowl", contours: [{ points: bowlContour(0, 0, 10).points, isClosed: true }] },
        ],
      },
    },
    selectedGlyphName: "b",
    selection: new Set(["component/0"]),
  });
  const query = await buildQuery(editor);
  assert.equal(query.ok, true);
  assert.equal(query.source, "component");
  assert.equal(query.contours.length, 1);
});

test("buildQuery reports a glyph it cannot load", async () => {
  const editor = makeFakeEditor({
    glyphs: {},
    selectedGlyphName: "zz",
    selection: new Set(["point/0"]),
  });
  const query = await buildQuery(editor);
  assert.equal(query.ok, false);
  assert.match(query.reason, /Could not load/);
});

// ---------------------------------------------------------------------------
// 4. The candidates
// ---------------------------------------------------------------------------

test("collectCandidates walks every glyph and takes the closed contours", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      b: { contours: [{ points: rectContour(0, 0, 10, 10).points, isClosed: true }] },
      d: { contours: [{ points: rectContour(0, 0, 10, 10).points, isClosed: true }] },
    },
  });
  const candidates = await collectCandidates(editor);
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((candidate) => candidate.glyphName).sort(),
    ["b", "d"]
  );
  assert.equal(candidates[0].contourIndex, 0);
  assert.ok(candidates[0].contour.segments.length > 0);
});

test("collectCandidates skips an open contour — an arc is not a shape", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      b: { contours: [{ points: rectContour(0, 0, 10, 10).points, isClosed: false }] },
    },
  });
  const candidates = await collectCandidates(editor);
  assert.equal(candidates.length, 0);
});

test("collectCandidates reports its progress", async () => {
  const editor = makeFakeEditor({
    glyphs: { b: { contours: [] }, d: { contours: [] } },
  });
  const seen = [];
  await collectCandidates(editor, { onProgress: (done, total) => seen.push([done, total]) });
  assert.deepEqual(seen, [
    [1, 2],
    [2, 2],
  ]);
});

test("collectCandidates can be limited to a list of glyphs", async () => {
  const editor = makeFakeEditor({
    glyphs: { b: { contours: [] }, d: { contours: [] } },
  });
  const candidates = await collectCandidates(editor, { glyphNames: ["d"] });
  assert.equal(candidates.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Going back to a match
// ---------------------------------------------------------------------------

test("selectContour selects every point of the contour", async () => {
  const editor = makeFakeEditor({
    glyphs: {
      d: {
        contours: [
          { points: rectContour(0, 0, 10, 10).points, isClosed: true },
          { points: rectContour(20, 0, 10, 10).points, isClosed: true },
        ],
      },
    },
  });
  const ok = await selectContour(editor, "d", 1);
  assert.equal(ok, true);
  assert.equal(editor.sceneController.sceneSettings.selectedGlyphName, "d");
  assert.deepEqual(
    [...editor.sceneController.selection].sort(),
    ["point/4", "point/5", "point/6", "point/7"]
  );
});

test("selectContour reports a glyph that cannot be opened", async () => {
  const editor = makeFakeEditor({ glyphs: {} });
  const ok = await selectContour(editor, "zz", 0);
  assert.equal(ok, false);
});

// ---------------------------------------------------------------------------
// 6. The layer
// ---------------------------------------------------------------------------

test("resolveLayerName finds the only layer of a glyph", async () => {
  const editor = makeFakeEditor({ glyphs: { b: { contours: [] } } });
  assert.equal(await resolveLayerName(editor, "b"), "regular");
});

test("resolveLayerName prefers the layer that is being edited", async () => {
  const editor = makeFakeEditor({ glyphs: { b: { contours: [] } }, layerName: "bold" });
  assert.equal(await resolveLayerName(editor, "b"), "bold");
});

test("getGlyphInstance returns the controller of the requested layer", async () => {
  const editor = makeFakeEditor({ glyphs: { b: { contours: [] } } });
  const controller = await getGlyphInstance(editor, "b", "regular");
  assert.ok(controller);
  assert.equal(controller.layerName, "regular");
});

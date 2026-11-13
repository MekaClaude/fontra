// Pure data-logic tests for the sketch store: caps, decimation, guarded
// parsing, size-capped serialization, and persistence.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_KEY_PREFIX,
  MAX_STORE_BYTES,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_GLYPH,
  state,
  setProject,
  strokesFor,
  strokeCount,
  addStroke,
  clearGlyph,
  clearProject,
  distance,
  decimatePoints,
  capStrokePoints,
  serializeProject,
  parseSketches,
  schedulePersist,
  persist,
} from "../sketch-store.js";

installLocalStorageStub();

function installLocalStorageStub() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    _store: store,
  };
}

test("addStroke stores strokes per project and glyph", () => {
  setProject("proj-a");
  addStroke("proj-a", "A", { color: "#FF5470", width: 10, points: [[0, 0]] });
  addStroke("proj-a", "A", { color: "#2563EB", width: 12, points: [[1, 1]] });
  addStroke("proj-a", "B", { color: "#1D9E75", width: 14, points: [[2, 2]] });
  assert.equal(strokeCount("proj-a", "A"), 2);
  assert.equal(strokeCount("proj-a", "B"), 1);
  assert.equal(strokesFor("proj-a", "A")[0].color, "#FF5470");
  assert.equal(strokeCount("proj-a", "missing"), 0);
});

test("the per-glyph stroke cap drops the oldest strokes", () => {
  setProject("proj-cap");
  for (let index = 0; index < MAX_STROKES_PER_GLYPH + 10; index++) {
    addStroke("proj-cap", "A", {
      color: "#FF5470",
      width: 10,
      points: [[index, 0]],
    });
  }
  const strokes = strokesFor("proj-cap", "A");
  assert.equal(strokes.length, MAX_STROKES_PER_GLYPH);
  assert.equal(strokes[0].points[0][0], 10); // the first 10 strokes were dropped
});

test("clearGlyph and clearProject remove strokes and storage", () => {
  setProject("proj-clear");
  addStroke("proj-clear", "A", { color: "#FF5470", width: 10, points: [[0, 0]] });
  assert.ok(clearGlyph("proj-clear", "A"));
  assert.equal(strokeCount("proj-clear", "A"), 0);
  addStroke("proj-clear", "A", { color: "#FF5470", width: 10, points: [[0, 0]] });
  persist("proj-clear");
  assert.ok(localStorage.getItem(STORAGE_KEY_PREFIX + "proj-clear"));
  clearProject("proj-clear");
  assert.equal(strokeCount("proj-clear", "A"), 0);
  assert.equal(localStorage.getItem(STORAGE_KEY_PREFIX + "proj-clear"), null);
});

test("decimatePoints keeps endpoints and drops close intermediates", () => {
  const points = [
    [0, 0],
    [0.1, 0],
    [0.2, 0],
    [10, 0],
    [10.1, 0],
    [10.2, 0],
  ];
  const decimated = decimatePoints(points, 1);
  assert.deepEqual(decimated, [
    [0, 0],
    [10, 0],
    [10.2, 0],
  ]);
  // Degenerate inputs come back unchanged (copies).
  assert.deepEqual(decimatePoints([[1, 1]], 1), [[1, 1]]);
  assert.deepEqual(decimatePoints([[0, 0], [1, 1]], 5), [[0, 0], [1, 1]]);
});

test("capStrokePoints brings an over-long stroke under the cap", () => {
  const points = [];
  for (let index = 0; index < MAX_POINTS_PER_STROKE * 3; index++) {
    points.push([index * 0.01, 0]);
  }
  const capped = capStrokePoints(points, 0.01);
  assert.ok(capped.length <= MAX_POINTS_PER_STROKE);
  assert.deepEqual(capped[0], [0, 0]);
  const last = capped[capped.length - 1];
  assert.deepEqual(last, points[points.length - 1]);
});

test("distance works on point arrays", () => {
  assert.equal(distance([0, 0], [3, 4]), 5);
});

test("serialize/parse round-trips strokes (with coordinate rounding)", () => {
  const glyphs = new Map([
    [
      "A",
      [
        {
          color: "#FF5470",
          width: 24,
          points: [[1.234, -5.678], [10, 20], [30.5, 40.25]],
        },
        { color: "#2563EB", width: 8.125, points: [[0, 0], [1, 1]] },
      ],
    ],
    ["B", [{ color: "#18181B", width: 12, points: [[5, 5]] }]],
  ]);
  const json = serializeProject(glyphs);
  assert.ok(json.length <= MAX_STORE_BYTES);

  const parsed = parseSketches(json);
  assert.deepEqual([...parsed.keys()], ["A", "B"]);
  const [first, second] = parsed.get("A");
  assert.equal(first.color, "#FF5470");
  assert.equal(first.width, 24);
  assert.deepEqual(first.points, [[1.23, -5.68], [10, 20], [30.5, 40.25]]);
  assert.equal(second.width, 8.13);
});

test("parseSketches rejects malformed payloads without throwing", () => {
  for (const raw of [
    null,
    "",
    "not json{",
    "[]",
    JSON.stringify({ version: 2, glyphs: {} }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, glyphs: { A: "nope" } }),
    JSON.stringify({ version: 1, glyphs: { A: [null] } }),
    JSON.stringify({ version: 1, glyphs: { A: [{ c: "red", w: 5, p: [0, 0] }] } }),
    JSON.stringify({ version: 1, glyphs: { A: [{ c: "#FFF", w: 5, p: [0, 0, "x"] }] } }),
    JSON.stringify({ version: 1, glyphs: { A: [{ c: "#FFF", w: 5, p: [0, 0, NaN] }] } }),
  ]) {
    const parsed = parseSketches(raw);
    assert.equal(parsed.size, 0, `expected empty parse for: ${String(raw).slice(0, 40)}`);
  }
});

test("parseSketches keeps the valid part of a mixed payload", () => {
  const json = JSON.stringify({
    version: 1,
    glyphs: {
      A: [
        { c: "#FFF000", w: 5, p: [1, 2, 3, 4] },
        { c: "bogus", w: 5, p: [1, 2] },
        { c: "#00FF00", w: 7, p: [9, 9, 10, 10] },
      ],
    },
  });
  const parsed = parseSketches(json);
  assert.equal(parsed.size, 1);
  const strokes = parsed.get("A");
  assert.equal(strokes.length, 2);
  assert.deepEqual(strokes[0].points, [[1, 2], [3, 4]]);
  assert.deepEqual(strokes[1].points, [[9, 9], [10, 10]]);
});

test("parseSketches clamps unreasonable widths and caps points", () => {
  const manyPoints = [];
  for (let index = 0; index < MAX_POINTS_PER_STROKE + 100; index++) {
    manyPoints.push(index, 0);
  }
  const json = JSON.stringify({
    version: 1,
    glyphs: {
      A: [{ c: "#FFFFFF", w: 999999, p: manyPoints }],
    },
  });
  const stroke = parseSketches(json).get("A")[0];
  assert.equal(stroke.width, 1000);
  assert.equal(stroke.points.length, MAX_POINTS_PER_STROKE);
});

test("persist writes to localStorage and schedulePersist debounces", async () => {
  setProject("proj-save");
  addStroke("proj-save", "A", { color: "#FF5470", width: 10, points: [[3, 4]] });
  schedulePersist("proj-save", 15);
  // A second call re-schedules; still nothing written before the delay.
  schedulePersist("proj-save", 15);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(localStorage.getItem(STORAGE_KEY_PREFIX + "proj-save"), null);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const raw = localStorage.getItem(STORAGE_KEY_PREFIX + "proj-save");
  assert.ok(raw);
  const data = JSON.parse(raw);
  assert.equal(data.glyphs.A.length, 1);
  assert.equal(data.glyphs.A[0].p[0], 3);
  assert.equal(state.projectId, "proj-save");
});

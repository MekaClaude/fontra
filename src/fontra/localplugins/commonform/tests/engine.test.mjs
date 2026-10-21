// tests/engine.test.mjs
//
// The engine's own tests: the geometry, the signature, the tolerances and the
// three tiers.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_NEAR_FACTOR,
  DEFAULT_NEAR_FLOOR,
  DEFAULT_SIGNATURE_COUNT,
  DEFAULT_TOLERANCE_FACTOR,
  DEFAULT_TOLERANCE_FLOOR,
  comparePrepared,
  compareSignatures,
  contourFeatures,
  defaultSearchOptions,
  extractSelection,
  findMatches,
  mirrorSignature,
  nearToleranceFor,
  pointTypeSignature,
  polygonCentroid,
  prepareContour,
  radialSignature,
  segmentsToPolyline,
  splitContourBySelectedIndices,
  toleranceFor,
} from "../commonform-engine.js";

import {
  asymmetricContour,
  bowlContour,
  circleContour,
  perturbedContour,
  rectContour,
  translatedContour,
  withPolyline,
  withSegments,
} from "./_helpers.mjs";

const prepared = (contour) => prepareContour(withPolyline(contour));

// ---------------------------------------------------------------------------
// 1. The selection is split into runs
// ---------------------------------------------------------------------------

test("a selection of the whole contour is one closed run", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const runs = splitContourBySelectedIndices(points, [0, 1, 2, 3], true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].isClosed, true);
  assert.equal(runs[0].points.length, 4);
});

test("a run in the middle of a contour is an open arc, not a shape", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const runs = splitContourBySelectedIndices(points, [1, 2], true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].isClosed, false);
});

test("a run that wraps around the start is one run, and it is closed", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // The last and the first point: a wrapping run.
  const runs = splitContourBySelectedIndices(points, [3, 0], true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].isClosed, true);
  assert.deepEqual(
    runs[0].points.map((point) => point.x),
    [0, 0]
  );
});

test("two separate runs are two shapes", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const runs = splitContourBySelectedIndices(points, [0, 2], true);
  assert.equal(runs.length, 2);
  assert.ok(runs.every((run) => run.isClosed === false));
});

test("an empty selection yields no runs", () => {
  assert.deepEqual(splitContourBySelectedIndices([{ x: 0, y: 0 }], [], true), []);
});

test("extractSelection maps absolute indices back onto the contour", () => {
  const contours = [
    { points: rectContour(0, 0, 10, 10).points, isClosed: true, startIndex: 0 },
    { points: rectContour(20, 0, 10, 10).points, isClosed: true, startIndex: 4 },
  ];
  // Every point of both contours is selected, so both runs are closed shapes.
  const result = extractSelection(contours, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(result.touchedContours, [0, 1]);
  assert.equal(result.contours.length, 2);
  assert.equal(result.closedCount, 2);
});

test("extractSelection reports a partial run as an open arc", () => {
  const contours = [
    { points: rectContour(0, 0, 10, 10).points, isClosed: true, startIndex: 0 },
  ];
  const result = extractSelection(contours, [0, 1]);
  assert.equal(result.contours.length, 1);
  assert.equal(result.closedCount, 0);
  assert.equal(result.contours[0].isClosed, false);
});

test("extractSelection finds nothing when the selection is elsewhere", () => {
  const contours = [
    { points: rectContour(0, 0, 10, 10).points, isClosed: true, startIndex: 0 },
  ];
  const result = extractSelection(contours, [99]);
  assert.equal(result.contours.length, 0);
  assert.deepEqual(result.touchedContours, []);
});

// ---------------------------------------------------------------------------
// 2. The features
// ---------------------------------------------------------------------------

test("contourFeatures measures the bounding box", () => {
  const features = contourFeatures(rectContour(10, 20, 30, 40));
  assert.equal(features.xMin, 10);
  assert.equal(features.yMin, 20);
  assert.equal(features.xMax, 40);
  assert.equal(features.yMax, 60);
  assert.equal(features.width, 30);
  assert.equal(features.height, 40);
  assert.equal(features.pointCount, 4);
  assert.equal(features.closed, true);
});

test("contourFeatures keeps the aspect ratio at or above 1", () => {
  const wide = contourFeatures(rectContour(0, 0, 100, 10));
  const tall = contourFeatures(rectContour(0, 0, 10, 100));
  assert.equal(wide.aspect, 10);
  assert.equal(tall.aspect, 10);
});

test("contourFeatures survives an empty contour", () => {
  const features = contourFeatures({ points: [] });
  assert.equal(features.pointCount, 0);
  assert.equal(features.diagonal, 1);
  assert.ok(Number.isFinite(features.aspect));
});

test("pointTypeSignature counts the point kinds", () => {
  const points = [
    { x: 0, y: 0, type: "oncurve" },
    { x: 1, y: 0, type: "cubic" },
    { x: 2, y: 0, type: "oncurve" },
    { x: 3, y: 0, type: "quad" },
  ];
  // The signature is sorted, so the order of the points does not matter.
  assert.equal(pointTypeSignature(points), "cooq");
  assert.equal(pointTypeSignature([]), "");
});

// ---------------------------------------------------------------------------
// 3. Flattening
// ---------------------------------------------------------------------------

test("segmentsToPolyline flattens a line to its end point", () => {
  const polyline = segmentsToPolyline([
    { type: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  ]);
  assert.deepEqual(polyline, [{ x: 10, y: 0 }]);
});

test("segmentsToPolyline samples a curve", () => {
  const polyline = segmentsToPolyline(
    [{ type: "cubic", points: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }] }],
    4
  );
  assert.equal(polyline.length, 4);
  assert.equal(polyline[0].x, 1.5625); // the cubic at t = 1/4
  assert.equal(polyline[3].x, 10);
});

test("segmentsToPolyline ignores a malformed segment", () => {
  const polyline = segmentsToPolyline([{ type: "line", points: [{ x: 0, y: 0 }] }]);
  assert.deepEqual(polyline, []);
});

// ---------------------------------------------------------------------------
// 4. The signature
// ---------------------------------------------------------------------------

test("the centroid of a square is its centre", () => {
  const centroid = polygonCentroid([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
  assert.ok(Math.abs(centroid.x - 5) < 1e-9);
  assert.ok(Math.abs(centroid.y - 5) < 1e-9);
  assert.equal(centroid.area, 100);
});

test("the centroid of a degenerate polygon falls back to the middle of its box", () => {
  const centroid = polygonCentroid([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
  assert.equal(centroid.x, 5);
  assert.equal(centroid.y, 0);
  assert.equal(centroid.area, 0);
});

test("the signature of a circle is the same in every direction", () => {
  const circle = circleContour(0, 50, 64);
  const signature = radialSignature(circle.points, 16);
  for (const value of signature.values) {
    assert.ok(Math.abs(value - 50) < 1.5, `radius was ${value}`);
  }
});

test("the signature is measured from the centroid, so position does not matter", () => {
  const here = radialSignature(circleContour(0, 50, 64).points, 32);
  const there = radialSignature(circleContour(1000, 50, 64).points, 32);
  for (let k = 0; k < here.values.length; k++) {
    assert.ok(Math.abs(here.values[k] - there.values[k]) < 1e-6);
  }
});

test("the signature of an empty polyline is all zeroes", () => {
  const signature = radialSignature([], 8);
  assert.equal(signature.values.length, 8);
  assert.ok(signature.values.every((value) => value === 0));
});

test("mirroring a signature twice gives the original back", () => {
  const signature = radialSignature(asymmetricContour().points, 64);
  const twice = mirrorSignature(mirrorSignature(signature));
  for (let k = 0; k < signature.values.length; k++) {
    assert.ok(Math.abs(twice.values[k] - signature.values[k]) < 1e-12);
  }
});

// ---------------------------------------------------------------------------
// 5. The tolerances
// ---------------------------------------------------------------------------

test("the default tolerance is 2 units, or 0.2 % of the size", () => {
  const options = defaultSearchOptions();
  assert.equal(options.toleranceFloor, DEFAULT_TOLERANCE_FLOOR);
  assert.equal(options.toleranceFactor, DEFAULT_TOLERANCE_FACTOR);
  // A small shape: the floor wins.
  assert.equal(toleranceFor(100, options), 2);
  // A big shape: the relative factor wins.
  assert.equal(toleranceFor(100000, options), 200);
});

test("the near tolerance is 20 units, or 5 % of the size", () => {
  const options = defaultSearchOptions();
  assert.equal(options.nearFloor, DEFAULT_NEAR_FLOOR);
  assert.equal(options.nearFactor, DEFAULT_NEAR_FACTOR);
  assert.equal(nearToleranceFor(100, options), 20);
  assert.equal(nearToleranceFor(10000, options), 500);
});

test("the default signature has 64 directions", () => {
  assert.equal(DEFAULT_SIGNATURE_COUNT, 64);
  assert.equal(defaultSearchOptions().signatureCount, 64);
});

// ---------------------------------------------------------------------------
// 6. The tiers
// ---------------------------------------------------------------------------

test("an exact copy is 'identical'", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const copy = prepared(translatedContour(bowlContour(120, 200, 24), 40, 7));
  const result = comparePrepared(query, copy);
  assert.ok(result);
  assert.equal(result.tier, "identical");
  // A translation changes nothing about the shape, but the floating point
  // arithmetic leaves a rounding error of about 1e-12.
  assert.ok(result.distance < 1e-6, `distance was ${result.distance}`);
  assert.equal(result.sameNodes, true);
});

test("a copy that is a little off is 'the same'", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidate = prepared(perturbedContour(bowlContour(120, 200, 24), 1));
  const result = comparePrepared(query, candidate);
  assert.ok(result);
  assert.equal(result.tier, "same");
  assert.ok(result.distance > 0);
});

test("a copy that is clearly off is 'near', or nothing at all", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidate = prepared(perturbedContour(bowlContour(120, 200, 24), 8));
  const result = comparePrepared(query, candidate);
  if (result) {
    assert.equal(result.tier, "near");
    assert.ok(result.distance > toleranceFor(24 * Math.SQRT2, defaultSearchOptions()));
  }
});

test("a different shape does not match at all", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidate = prepared(circleContour(400, 200));
  assert.equal(comparePrepared(query, candidate), null);
});

test("the comparison is scale invariant by default", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const bigger = prepared(bowlContour(120, 200, 48));
  const result = comparePrepared(query, bigger);
  assert.ok(result, "the same shape, drawn twice as big, is still the same shape");
  assert.equal(result.sameSize, false);
});

test("without scale invariance a bigger copy does not match", () => {
  const options = { ...defaultSearchOptions(), scaleInvariant: false };
  const query = prepareContour(withPolyline(bowlContour(120, 200, 24)), options);
  const bigger = prepareContour(withPolyline(bowlContour(120, 200, 48)), options);
  const result = comparePrepared(query, bigger, options);
  assert.equal(result, null);
});

test("a mirrored copy is only found when mirroring is allowed", () => {
  const query = prepared(asymmetricContour());
  const mirrored = prepared({
    points: asymmetricContour().points.map((point) => ({ ...point, x: -point.x })),
    isClosed: true,
  });
  assert.ok(comparePrepared(query, mirrored));

  const noMirror = { ...defaultSearchOptions(), allowMirrored: false };
  assert.equal(comparePrepared(query, mirrored, noMirror), null);
});

test("the pre-filter throws away a shape with a wildly different aspect ratio", () => {
  const query = prepared(rectContour(0, 0, 100, 100));
  const candidate = prepared(rectContour(0, 0, 1000, 10));
  assert.equal(comparePrepared(query, candidate), null);
});

test("compareSignatures of two empty signatures is infinite", () => {
  const empty = { values: new Float64Array(0), size: 1 };
  const result = compareSignatures(empty, empty);
  assert.equal(result.rms, Infinity);
  assert.equal(result.max, Infinity);
});

// ---------------------------------------------------------------------------
// 7. prepareContour
// ---------------------------------------------------------------------------

test("prepareContour measures the diagonal of the shape", () => {
  const preparedContour = prepareContour(withPolyline(rectContour(0, 0, 30, 40)));
  assert.equal(preparedContour.features.diagonal, 50);
});

test("prepareContour prefers an existing polyline", () => {
  const contour = withPolyline(rectContour(0, 0, 30, 40));
  const preparedContour = prepareContour(contour);
  assert.equal(preparedContour.polyline.length, 4);
});

test("prepareContour falls back to the segments when there is no polyline", () => {
  const preparedContour = prepareContour(withSegments(rectContour(0, 0, 30, 40)));
  assert.equal(preparedContour.polyline.length, 4);
});

// ---------------------------------------------------------------------------
// 8. findMatches
// ---------------------------------------------------------------------------

test("findMatches reports nothing for an empty candidate list", () => {
  const query = prepared(bowlContour(120, 200, 24));
  assert.deepEqual(findMatches(query, []), []);
});

test("findMatches accepts a bare prepared candidate as well as a pair", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidate = prepared(translatedContour(bowlContour(120, 200, 24), 3, 4));
  const matches = findMatches(query, [candidate]);
  assert.equal(matches.length, 1);
  assert.ok(matches[0].distance < 1e-6);
});

test("findMatches leaves out the glyph the query shape came from", () => {
  // The shape the designer is looking at is not a copy of itself: the glyph it
  // was taken from must not turn up in the results as a 0-unit "identical"
  // match.
  const query = prepared(bowlContour(120, 200, 24));
  const options = { ...defaultSearchOptions(), sourceGlyphName: "b" };
  const candidates = [
    {
      prepared: prepared(translatedContour(bowlContour(120, 200, 24), 3, 4)),
      meta: { glyphName: "b" },
    },
    {
      prepared: prepared(translatedContour(bowlContour(120, 200, 24), 40, 0)),
      meta: { glyphName: "d" },
    },
  ];
  const matches = findMatches(query, candidates, options);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].glyphName, "d");
});

test("findMatches keeps the source glyph when no source glyph is given", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidates = [
    {
      prepared: prepared(translatedContour(bowlContour(120, 200, 24), 3, 4)),
      meta: { glyphName: "b" },
    },
  ];
  const matches = findMatches(query, candidates, defaultSearchOptions());
  assert.equal(matches.length, 1);
  assert.equal(matches[0].glyphName, "b");
});

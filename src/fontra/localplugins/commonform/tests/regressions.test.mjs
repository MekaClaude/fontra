// tests/regressions.test.mjs
//
// Regression tests for the bugs that actually bit, in the plugin and in the
// test harness that was supposed to catch them.
//
// Every test in this file exists because something went wrong for real:
//
//   * the whole geometric comparison was silently disabled, because the
//     polyline was never built from the contour's segments,
//   * the test helper papered over that by attaching the polyline by hand,
//     so the suite was green while the feature did nothing,
//   * the tolerance summary counted "near" matches as "the same",
//   * and a GLIF contour with a duplicated closing point was not recognised
//     as a shape.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  comparePrepared,
  contourFeatures,
  findMatches,
  flipSignature,
  mirrorSignature,
  orientationVariants,
  prepareContour,
  radialSignature,
  rotateSignature,
  segmentsToPolyline,
  summarizeMatches,
} from "../commonform-engine.js";

import {
  asymmetricContour,
  bowlContour,
  circleContour,
  mirroredContour,
  perturbedContour,
  rectContour,
  translatedContour,
  withPolyline,
} from "./_helpers.mjs";

/** A contour as the engine gets it from the panel: with its polyline. */
const prepared = (contour) => prepareContour(withPolyline(contour));

// ---------------------------------------------------------------------------
// 1. The polyline has to be built from the segments
// ---------------------------------------------------------------------------

test("prepareContour builds the polyline from the segments", () => {
  // A contour as the plugin really receives it: points + segments, and no
  // polyline. Before the fix, the signature was measured on an *empty*
  // polyline, so every shape looked identical to every other shape.
  const contour = bowlContour(120, 200, 24);
  const segments = [];
  for (let i = 0; i < contour.points.length; i++) {
    const a = contour.points[i];
    const b = contour.points[(i + 1) % contour.points.length];
    segments.push({ type: "line", points: [a, b] });
  }

  const prepared = prepareContour({ points: contour.points, isClosed: true, segments });
  assert.ok(prepared.polyline.length > 0, "the polyline must not be empty");
  assert.ok(
    prepared.signature.meanRadius > 0,
    "the signature must have a real radius"
  );
});

test("two different shapes do not match when only segments are given", () => {
  // The regression that mattered: with an empty polyline on both sides the
  // distance was 0 for every pair, so the search "found" everything.
  const asSegments = (contour) => {
    const segments = [];
    for (let i = 0; i < contour.points.length; i++) {
      const a = contour.points[i];
      const b = contour.points[(i + 1) % contour.points.length];
      segments.push({ type: "line", points: [a, b] });
    }
    return { points: contour.points, isClosed: true, segments };
  };

  const query = prepareContour(asSegments(bowlContour(120, 200, 24)));
  const circle = prepareContour(asSegments(circleContour(100, 48)));
  const result = comparePrepared(query, circle);
  assert.ok(
    !result || result.distance > 1,
    "a circle must not be reported as the same shape as a bowl"
  );
});

test("a shape still matches itself when only segments are given", () => {
  const asSegments = (contour) => {
    const segments = [];
    for (let i = 0; i < contour.points.length; i++) {
      const a = contour.points[i];
      const b = contour.points[(i + 1) % contour.points.length];
      segments.push({ type: "line", points: [a, b] });
    }
    return { points: contour.points, isClosed: true, segments };
  };
  const query = prepareContour(asSegments(bowlContour(120, 200, 24)));
  const copy = prepareContour(asSegments(translatedContour(bowlContour(120, 200, 24), 40, 7)));
  const result = comparePrepared(query, copy);
  assert.ok(result, "the same shape must match itself");
  assert.ok(result.distance < 0.001, `distance was ${result.distance}`);
});

// ---------------------------------------------------------------------------
// 2. The orientation of a copy
// ---------------------------------------------------------------------------

test("a vertically mirrored copy matches, and is reported as mirrored", () => {
  const query = prepared(asymmetricContour());
  const candidate = prepared(mirroredContour(asymmetricContour()));
  const result = comparePrepared(query, candidate);
  assert.ok(result, "the mirrored bowl must match");
  assert.equal(result.orientation, "mirrored");
  assert.ok(result.mirrored);
});

test("a horizontally flipped copy matches", () => {
  const query = prepared(asymmetricContour());
  const flipped = {
    points: asymmetricContour().points.map((point) => ({ ...point, y: -point.y })),
    isClosed: true,
  };
  const result = comparePrepared(query, prepared(flipped));
  assert.ok(result, "the flipped bowl must match");
  assert.equal(result.orientation, "flipped");
});

test("a copy turned through 180 degrees matches", () => {
  const query = prepared(asymmetricContour());
  const turned = {
    points: asymmetricContour().points.map((point) => ({ ...point, x: -point.x, y: -point.y })),
    isClosed: true,
  };
  const result = comparePrepared(query, prepared(turned));
  assert.ok(result, "the turned bowl must match");
  assert.equal(result.orientation, "rotated");
});

test("the orientation transforms are the index remaps they claim to be", () => {
  const contour = bowlContour(120, 200, 24);
  const signature = radialSignature(
    segmentsToPolyline(
      contour.points.map((point, i) => ({
        type: "line",
        points: [
          point,
          contour.points[(i + 1) % contour.points.length],
        ],
      })),
      8
    )
  );
  const count = signature.values.length;
  const half = count / 2;

  const mirrored = mirrorSignature(signature);
  for (let k = 0; k < count; k++) {
    assert.equal(mirrored.values[k], signature.values[((half - k) % count + count) % count]);
  }

  const flipped = flipSignature(signature);
  for (let k = 0; k < count; k++) {
    assert.equal(flipped.values[k], signature.values[(count - k) % count]);
  }

  const rotated = rotateSignature(signature);
  for (let k = 0; k < count; k++) {
    assert.equal(rotated.values[k], signature.values[(k + half) % count]);
  }
});

test("there are four orientations, and no quarter turn among them", () => {
  const contour = bowlContour(120, 200, 24);
  const signature = radialSignature(
    segmentsToPolyline(
      contour.points.map((point, i) => ({
        type: "line",
        points: [point, contour.points[(i + 1) % contour.points.length]],
      })),
      8
    )
  );
  const names = orientationVariants(signature).map((variant) => variant.name);
  assert.deepEqual(names, ["as-drawn", "mirrored", "flipped", "rotated"]);
});

// ---------------------------------------------------------------------------
// 3. The summary must not claim that a near-match is "the same"
// ---------------------------------------------------------------------------

test("summarizeMatches counts the three tiers separately", () => {
  const summary = summarizeMatches([
    { tier: "identical", distance: 0, mirrored: false, orientation: "as-drawn", glyphName: "a" },
    { tier: "same", distance: 1, mirrored: false, orientation: "as-drawn", glyphName: "b" },
    { tier: "near", distance: 9, mirrored: true, orientation: "mirrored", glyphName: "c" },
    { tier: "near-mirrored", distance: 12, mirrored: true, orientation: "mirrored", glyphName: "d" },
  ]);
  assert.equal(summary.count, 4);
  assert.equal(summary.identical, 1);
  assert.equal(summary.same, 1);
  assert.equal(summary.near, 2);
  assert.equal(summary.mirrored, 2);
  assert.equal(summary.turned, 2);
});

test("summarizeMatches leaves the shape you are looking at out of the drift", () => {
  // The shape itself matches itself perfectly; that is not a "copy", and
  // reporting "the copies differ by up to 0 units" would be nonsense.
  const summary = summarizeMatches(
    [
      { tier: "identical", distance: 0, mirrored: false, orientation: "as-drawn", glyphName: "b" },
      { tier: "near", distance: 4, mirrored: false, orientation: "as-drawn", glyphName: "d" },
    ],
    { sourceGlyphName: "b" }
  );
  assert.equal(summary.driftIsRecurrence, false);
  assert.equal(summary.worst.glyphName, "d");
  assert.equal(summary.worst.distance, 4);
});

test("summarizeMatches reports the drift over the real copies", () => {
  const summary = summarizeMatches(
    [
      { tier: "identical", distance: 0, mirrored: false, orientation: "as-drawn", glyphName: "b" },
      { tier: "same", distance: 1.2, mirrored: false, orientation: "as-drawn", glyphName: "d" },
      { tier: "same", distance: 1.8, mirrored: true, orientation: "mirrored", glyphName: "p" },
      { tier: "near", distance: 20, mirrored: false, orientation: "as-drawn", glyphName: "o" },
    ],
    { sourceGlyphName: "b" }
  );
  assert.equal(summary.driftIsRecurrence, true);
  assert.equal(summary.worst.glyphName, "p");
  assert.equal(summary.worst.distance, 1.8);
});

// ---------------------------------------------------------------------------
// 4. A contour whose closing point is repeated is still a shape
// ---------------------------------------------------------------------------

test("a contour that repeats its first point is recognised as closed", () => {
  // Some UFO writers repeat the start point at the end instead of marking
  // the contour closed. The first and the last point then coincide.
  const contour = rectContour(0, 0, 100, 200);
  const points = [...contour.points, { ...contour.points[0] }];
  const features = contourFeatures({ points, isClosed: false });
  assert.equal(features.pointCount, 5);
  const first = points[0];
  const last = points[points.length - 1];
  assert.equal(first.x, last.x);
  assert.equal(first.y, last.y);
});

// ---------------------------------------------------------------------------
// 5. A perturbed copy still matches; a different shape does not
// ---------------------------------------------------------------------------

test("a slightly perturbed copy still matches", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidate = prepared(perturbedContour(bowlContour(120, 200, 24), 0.5));
  const result = comparePrepared(query, candidate);
  assert.ok(result, "a small perturbation must still match");
});

test("findMatches sorts the best match first", () => {
  const query = prepared(bowlContour(120, 200, 24));
  const candidates = [
    { prepared: prepared(perturbedContour(bowlContour(120, 200, 24), 2)), meta: { glyphName: "near" } },
    { prepared: prepared(translatedContour(bowlContour(120, 200, 24), 10, 3)), meta: { glyphName: "exact" } },
  ];
  const matches = findMatches(query, candidates);
  assert.ok(matches.length >= 2);
  assert.equal(matches[0].glyphName, "exact");
  assert.ok(matches[0].distance <= matches[1].distance);
});

test("summarizeMatches does not count the shape you are looking at as a copy", () => {
  const summary = summarizeMatches(
    [
      { tier: "identical", distance: 0, mirrored: false, orientation: "as-drawn", glyphName: "b" },
      { tier: "near", distance: 4, mirrored: false, orientation: "as-drawn", glyphName: "d" },
      { tier: "near", distance: 6, mirrored: true, orientation: "mirrored", glyphName: "p" },
    ],
    { sourceGlyphName: "b" }
  );
  // The shape matches itself perfectly; that is not a *copy* of it.
  assert.equal(summary.count, 2);
  assert.equal(summary.total, 3);
  assert.equal(summary.identical, 0);
  assert.equal(summary.near, 2);
  assert.equal(summary.self.glyphName, "b");
  assert.equal(summary.self.distance, 0);
});

test("summarizeMatches still counts everything when there is no source glyph", () => {
  const summary = summarizeMatches([
    { tier: "identical", distance: 0, mirrored: false, orientation: "as-drawn", glyphName: "b" },
    { tier: "near", distance: 4, mirrored: false, orientation: "as-drawn", glyphName: "d" },
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.total, 2);
  assert.equal(summary.identical, 1);
});

test("summarizeMatches knows the closest copy, not just the worst", () => {
  const summary = summarizeMatches(
    [
      { tier: "identical", distance: 0, mirrored: false, orientation: "as-drawn", glyphName: "b" },
      { tier: "near", distance: 3.2, mirrored: false, orientation: "as-drawn", glyphName: "d" },
      { tier: "near", distance: 25.2, mirrored: true, orientation: "mirrored", glyphName: "o" },
    ],
    { sourceGlyphName: "b" }
  );
  assert.equal(summary.closest.glyphName, "d");
  assert.equal(summary.closest.distance, 3.2);
  assert.equal(summary.worst.glyphName, "o");
  assert.equal(summary.worst.distance, 25.2);
});

// commonform-engine.js
//
// The geometry of "common forms": the shapes that a typeface reuses from one
// glyph to the next.
//
// In type design, a *common form* is a shape that appears in more than one
// glyph — the bowl of b/d/p/q, the arm of R and k, the shoulder of n and m.
// A typeface that is built from common forms is a typeface whose parts agree
// with each other; one that only *looks* like it is has shapes that were
// re-drawn by hand and have drifted apart.
//
// This module is the engine. It is deliberately pure:
//
//   * no DOM,
//   * no Fontra imports,
//   * no I/O.
//
// It works on plain data — arrays of {x, y} points — so it can be unit-tested
// in plain Node with `node --test`, and so the same code can be reused for a
// batch job over a whole font.
//
// The Fontra-facing parts (reading the selection, walking the font, drawing
// the highlights) live in the panel and the layer.
//
// ---------------------------------------------------------------------------
// The shape descriptor
// ---------------------------------------------------------------------------
//
// Comparing two outlines point by point does not work, because two drawings
// of the same shape do not have to start at the same point on the outline,
// and do not have to have the same number of nodes.
//
// What this engine uses instead is the *radial signature*: the distance from
// the shape's centroid to its outline, measured in a fixed number of
// directions around it. Two drawings of the same shape have the same
// signature, no matter where they start or how their nodes are distributed.
//
// From one signature pair come two numbers:
//
//   rms — the overall difference. "On average, how far apart are the two
//         outlines?"
//   max — the worst difference. "How far apart are they at the worst point?"
//
// The *max* is the interesting one for a type designer: it is what says
// "this is the same bowl, except that one node is 11 units off". That is
// exactly the kind of sloppiness a common-form search should surface.

/** The point type of an off-curve cubic control point, as Fontra spells it. */
export const OFF_CURVE_CUBIC = "cubic";
/** The point type of an off-curve quadratic control point. */
export const OFF_CURVE_QUAD = "quad";

/** How many points a flattened curve is sampled at. */
export const DEFAULT_STEPS_PER_CURVE = 8;
/** How many directions the radial signature is measured in. */
export const DEFAULT_SIGNATURE_COUNT = 64;

/**
 * The default tolerance, as a fraction of the query shape's size.
 *
 * The rule the plugin uses is: `max(absoluteFloor, size * relativeFactor)`.
 * The floor is 2 font units — below that, two drawings are the same drawing.
 * The relative factor lets the tolerance grow with the glyph, so that the
 * same 2-unit slack is not a big deal in a 2000-unit display cut and is a big
 * deal in a 300-unit text cut.
 */
export const DEFAULT_TOLERANCE_FLOOR = 2;
export const DEFAULT_TOLERANCE_FACTOR = 0.002;

/** Beyond the "same" threshold, how far a shape may be and still be reported. */
export const DEFAULT_NEAR_FACTOR = 0.05;
export const DEFAULT_NEAR_FLOOR = 20;

/** How close two points must be for two drawings to count as the same drawing. */
export const IDENTICAL_EPSILON = 0.02;
// How much better an orientation has to be to be preferred over the one
// already found. Keeps the result deterministic for symmetric shapes.
export const ORIENTATION_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Selection → shape
// ---------------------------------------------------------------------------

/**
 * Split a contour's point list into the runs of *selected* points.
 *
 * A selection in Fontra is a set of point indices; the indices of one contour
 * need not be contiguous, and they may wrap around the start of the contour.
 * A run that wraps is closed (it is a whole shape); a run in the middle is
 * open (it is an arc, and an arc has no shape to compare).
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {Array<number>} selectedLocalIndices  indices *within* this contour
 * @param {boolean} isClosed
 * @returns {Array<{points: Array, isClosed: boolean}>}
 */
export function splitContourBySelectedIndices(points, selectedLocalIndices, isClosed) {
  const total = points.length;
  if (!total || !selectedLocalIndices.length) {
    return [];
  }

  const selected = new Set(selectedLocalIndices);
  const runs = [];
  let current = null;

  // Walk the contour once, starting at the first selected index, so that a
  // wrapping run is seen as one run instead of two.
  const first = Math.min(...selectedLocalIndices);
  for (let k = 0; k < total; k++) {
    const index = (first + k) % total;
    if (selected.has(index)) {
      if (!current) {
        current = { indices: [] };
        runs.push(current);
      }
      current.indices.push(index);
    } else if (current) {
      current = null;
    }
  }

  // A run that starts at index 0 and ends at the last index wraps around the
  // start of the contour: it is one run, not two, and it is closed.
  if (isClosed && runs.length > 1) {
    const firstRun = runs[0];
    const lastRun = runs[runs.length - 1];
    if (
      firstRun.indices[0] === 0 &&
      lastRun.indices[lastRun.indices.length - 1] === total - 1
    ) {
      firstRun.indices = [...lastRun.indices, ...firstRun.indices];
      runs.pop();
    }
  }

  return runs.map((run) => {
    const coversAll = run.indices.length === total;
    // A run that contains both the first and the last point of the contour
    // wraps around the start: it is a closed shape, not an arc.
    const wraps =
      isClosed &&
      !coversAll &&
      run.indices.includes(0) &&
      run.indices.includes(total - 1);
    return {
      points: run.indices.map((i) => points[i]),
      isClosed: coversAll || wraps,
    };
  });
}

/**
 * Extract the shapes touched by a selection.
 *
 * @param {Array<{points: Array, isClosed: boolean, startIndex: number}>} contours
 *        `startIndex` is the *absolute* index of the contour's first point in
 *        the path, so that absolute point indices can be mapped back onto it.
 * @param {Array<number>} selectedAbsoluteIndices
 * @returns {{contours: Array, touchedContours: Array<number>, closedCount: number}}
 */
export function extractSelection(contours, selectedAbsoluteIndices) {
  const selected = new Set(selectedAbsoluteIndices);
  const byContour = new Map();

  for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
    const contour = contours[contourIndex];
    const start = contour.startIndex ?? 0;
    const local = [];
    for (let i = 0; i < contour.points.length; i++) {
      if (selected.has(start + i)) {
        local.push(i);
      }
    }
    if (local.length) {
      byContour.set(contourIndex, local);
    }
  }

  const extracted = [];
  for (const [contourIndex, local] of byContour) {
    const contour = contours[contourIndex];
    for (const run of splitContourBySelectedIndices(
      contour.points,
      local,
      contour.isClosed
    )) {
      extracted.push({ ...run, sourceContourIndex: contourIndex });
    }
  }

  return {
    contours: extracted,
    touchedContours: [...byContour.keys()],
    closedCount: extracted.filter((c) => c.isClosed).length,
  };
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * Cheap, scale-independent features of a contour, used to throw away
 * candidates before the expensive comparison.
 *
 * These are computed from the *control points* only, so no curve has to be
 * evaluated: that is what makes them cheap enough to run on every contour of
 * every glyph in a font.
 */
export function contourFeatures(contour) {
  const points = contour.points || [];
  const count = points.length;

  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const point of points) {
    if (point.x < xMin) xMin = point.x;
    if (point.y < yMin) yMin = point.y;
    if (point.x > xMax) xMax = point.x;
    if (point.y > yMax) yMax = point.y;
  }
  if (!count) {
    xMin = yMin = xMax = yMax = 0;
  }

  const width = xMax - xMin;
  const height = yMax - yMin;
  const diagonal = Math.hypot(width, height) || 1;

  return {
    pointCount: count,
    closed: !!contour.isClosed,
    xMin,
    yMin,
    xMax,
    yMax,
    width,
    height,
    diagonal,
    // The aspect ratio, always >= 1 so that a shape and its quarter-turn
    // compare equal.
    aspect: width > 0 && height > 0 ? Math.max(width / height, height / width) : 1,
    // The point count relative to the size — a proxy for "how much detail is
    // in this shape", independent of how big it is.
    density: count / diagonal,
  };
}

/** The multiset of a contour's point types, sorted — used to spot identical drawings. */
export function pointTypeSignature(points) {
  return (points || [])
    .map((point) =>
      point.type === OFF_CURVE_CUBIC ? "c" : point.type === OFF_CURVE_QUAD ? "q" : "o"
    )
    .sort()
    .join("");
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

function evaluateCubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function evaluateQuad(p0, p1, p2, t) {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x,
    y: a * p0.y + b * p1.y + c * p2.y,
  };
}

/**
 * Flatten a list of segments into a polyline.
 *
 * The segment shape is the one Fontra's `path.iterContourDecomposedSegments()`
 * produces, so no bezier interpretation has to be reinvented here.
 *
 * @param {Array<{type: string, points: Array<{x: number, y: number}>}>} segments
 * @param {number} stepsPerCurve
 * @returns {Array<{x: number, y: number}>}
 */
export function segmentsToPolyline(segments, stepsPerCurve = DEFAULT_STEPS_PER_CURVE) {
  const polyline = [];
  const steps = Math.max(1, stepsPerCurve);

  for (const segment of segments || []) {
    const points = segment.points || [];
    if (segment.type === "line") {
      if (points.length >= 2) {
        polyline.push({ x: points[1].x, y: points[1].y });
      }
    } else if (segment.type === "quad") {
      if (points.length >= 3) {
        const [p0, p1, p2] = points;
        for (let i = 1; i <= steps; i++) {
          polyline.push(evaluateQuad(p0, p1, p2, i / steps));
        }
      }
    } else if (segment.type === "cubic") {
      if (points.length >= 4) {
        const [p0, p1, p2, p3] = points;
        for (let i = 1; i <= steps; i++) {
          polyline.push(evaluateCubic(p0, p1, p2, p3, i / steps));
        }
      }
    }
  }
  return polyline;
}

// ---------------------------------------------------------------------------
// The radial signature
// ---------------------------------------------------------------------------

/**
 * The area centroid of a closed polyline.
 *
 * Falls back to the middle of the bounding box when the polygon has no area
 * (a degenerate contour), so that the signature never has a NaN origin.
 */
export function polygonCentroid(polyline) {
  const n = polyline.length;
  if (!n) {
    return { x: 0, y: 0, area: 0 };
  }

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = polyline[i];
    const b = polyline[(i + 1) % n];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const point of polyline) {
      xMin = Math.min(xMin, point.x);
      yMin = Math.min(yMin, point.y);
      xMax = Math.max(xMax, point.x);
      yMax = Math.max(yMax, point.y);
    }
    return { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2, area: 0 };
  }
  return { x: cx / (6 * area), y: cy / (6 * area), area };
}

/**
 * The radial signature of a closed polyline.
 *
 * For each of `count` directions around the centroid, the distance to the
 * *farthest* point of the outline along that ray. The farthest rule keeps the
 * signature well defined for outlines that are not star-shaped (a "C", whose
 * centroid sits in its opening), at the cost of describing the outer
 * envelope rather than the inner one.
 *
 * `size` is the diagonal of the shape's bounding box: the measure the
 * signature is compared against, and the measure the tolerance is a fraction
 * of. Using one measure for both is what keeps "0.5% of the size" and
 * "0.5 units" meaning the same thing.
 *
 * @returns {{values: Float64Array, centroid: {x: number, y: number},
 *            meanRadius: number, size: number}}
 */
export function radialSignature(polyline, count = DEFAULT_SIGNATURE_COUNT) {
  const values = new Float64Array(count);
  const n = polyline.length;
  if (n < 2) {
    return { values, centroid: { x: 0, y: 0 }, meanRadius: 0, size: 1 };
  }

  const centroid = polygonCentroid(polyline);
  const { x: cx, y: cy } = centroid;

  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const point of polyline) {
    xMin = Math.min(xMin, point.x);
    yMin = Math.min(yMin, point.y);
    xMax = Math.max(xMax, point.x);
    yMax = Math.max(yMax, point.y);
  }
  const size = Math.hypot(xMax - xMin, yMax - yMin) || 1;

  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let farthest = 0;

    for (let i = 0; i < n; i++) {
      const p0 = polyline[i];
      const p1 = polyline[(i + 1) % n];
      const ex = p1.x - p0.x;
      const ey = p1.y - p0.y;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-12) {
        continue; // the ray is parallel to the segment
      }
      const px = p0.x - cx;
      const py = p0.y - cy;
      // p0 + t * e = centroid + s * d
      const s = (px * ey - py * ex) / denominator;
      const t = (px * dy - py * dx) / denominator;
      if (s > 0 && t >= 0 && t <= 1 && s > farthest) {
        farthest = s;
      }
    }
    values[k] = farthest;
  }

  let total = 0;
  for (const value of values) {
    total += value;
  }
  return { values, centroid, meanRadius: total / count, size };
}

/**
 * The mirrored radial signature.
 *
 * Mirroring on the vertical axis maps the direction θ to π − θ, so the
 * mirrored signature is the original one with its index remapped — no second
 * ray-casting pass needed.
 */
export function mirrorSignature(signature) {
  const count = signature.values.length;
  const values = new Float64Array(count);
  const half = count / 2;
  for (let k = 0; k < count; k++) {
    values[k] = signature.values[((half - k) % count + count) % count];
  }
  return { ...signature, values };
}

/**
 * The signature of the shape reflected across the *horizontal* axis.
 *
 * A vertical reflection maps the direction θ to −θ, so the signature is the
 * original one with its index mirrored the other way round.
 */
export function flipSignature(signature) {
  const count = signature.values.length;
  const values = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    values[k] = signature.values[(count - k) % count];
  }
  return { ...signature, values };
}

/**
 * The signature of the shape turned through 180°.
 *
 * A half turn maps the direction θ to θ + π, so the index is shifted by half
 * the circle.
 */
export function rotateSignature(signature) {
  const count = signature.values.length;
  const values = new Float64Array(count);
  const half = count / 2;
  for (let k = 0; k < count; k++) {
    values[k] = signature.values[(k + half) % count];
  }
  return { ...signature, values };
}

/**
 * Every orientation of a signature that a typeface can legitimately reuse:
 * as drawn, mirrored across the vertical axis (the bowl of b against the bowl
 * of d), mirrored across the horizontal axis (the bowl of b against the bowl
 * of p), and turned through 180° (the bowl of b against the bowl of q).
 *
 * A quarter turn is deliberately *not* included: the horizontal arm of an H
 * is not the same shape as the vertical stem of an l, and a type designer
 * never means it.
 */
export function orientationVariants(signature) {
  return [
    { name: "as-drawn", signature },
    { name: "mirrored", signature: mirrorSignature(signature) },
    { name: "flipped", signature: flipSignature(signature) },
    { name: "rotated", signature: rotateSignature(signature) },
  ];
}

/**
 * Compare two radial signatures.
 *
 * By default both are normalised by their own mean radius, so the comparison
 * is scale-invariant: "the same shape, drawn larger" compares equal. When
 * `scaleInvariant` is false the candidate is normalised by the *query's*
 * mean radius instead, so a shape that was drawn at another size no longer
 * matches.
 *
 * The result is in *relative* units — multiply by the query's size to get
 * font units.
 *
 * @returns {{rms: number, max: number}} the overall and the worst difference
 */
export function compareSignatures(a, b, { scaleInvariant = true } = {}) {
  const count = a.values.length;
  if (!count || !(a.size > 0) || !(b.size > 0)) {
    return { rms: Infinity, max: Infinity };
  }
  const divisorA = a.size;
  const divisorB = scaleInvariant ? b.size : a.size;
  let sumSquares = 0;
  let max = 0;
  for (let k = 0; k < count; k++) {
    const difference = a.values[k] / divisorA - b.values[k] / divisorB;
    sumSquares += difference * difference;
    const absolute = Math.abs(difference);
    if (absolute > max) {
      max = absolute;
    }
  }
  return { rms: Math.sqrt(sumSquares / count), max };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The default options for a search.
 */
export function defaultSearchOptions() {
  return {
    // Scale-invariant: "the same shape, drawn bigger" counts as the same shape.
    scaleInvariant: true,
    // Allow a mirrored match (the bowl of b against the bowl of d).
    allowMirrored: true,
    // The "same" threshold: max(floor, size * factor), in query units.
    toleranceFloor: DEFAULT_TOLERANCE_FLOOR,
    toleranceFactor: DEFAULT_TOLERANCE_FACTOR,
    // The "worth reporting" threshold.
    nearFloor: DEFAULT_NEAR_FLOOR,
    nearFactor: DEFAULT_NEAR_FACTOR,
    // Pre-filter: how far the aspect ratio and the point density may differ.
    maxAspectRatio: 2.0,
    maxDensityRatio: 4.0,
    // How many directions the signature is measured in.
    signatureCount: DEFAULT_SIGNATURE_COUNT,
    stepsPerCurve: DEFAULT_STEPS_PER_CURVE,
  };
}

/**
 * The tolerance for a given query shape, in font units.
 *
 * `max(floor, size * factor)` — the rule from `defaultSearchOptions()`.
 */
export function toleranceFor(querySize, options = defaultSearchOptions()) {
  return Math.max(options.toleranceFloor, querySize * options.toleranceFactor);
}

/** The "worth reporting" threshold for a given query shape, in font units. */
export function nearToleranceFor(querySize, options = defaultSearchOptions()) {
  return Math.max(options.nearFloor, querySize * options.nearFactor);
}

/**
 * Turn a contour into the thing that is actually compared: a flattened
 * polyline and its radial signature.
 */
export function prepareContour(contour, options = defaultSearchOptions()) {
  const features = contourFeatures(contour);
  // The polyline is what the signature is measured on, so it has to be there.
  // A contour that comes from a Fontra path carries its *segments*; the
  // polyline is derived from them here, so that the engine's contract is
  // self-sufficient and a caller cannot accidentally compare an empty
  // polyline (which would make every shape look identical to every other).
  const polyline = contour.polyline?.length
    ? contour.polyline
    : segmentsToPolyline(contour.segments || [], options.stepsPerCurve);
  const signature = radialSignature(polyline, options.signatureCount);
  return {
    features,
    polyline,
    signature,
    typeSignature: pointTypeSignature(contour.points || []),
  };
}

/**
 * Compare one candidate contour with the query.
 *
 * @param {object} query   the prepared query
 * @param {object} candidate the prepared candidate
 * @param {object} options
 * @returns {{distance: number, rms: number, tier: string, mirrored: boolean,
 *            sameNodes: boolean} | null}
 *          `null` when the candidate is not worth reporting.
 *
 * `distance` is the *worst* difference between the two outlines, in font
 * units — the number a type designer cares about: "the same bowl, except
 * that one node is 11 units off". `rms` is the overall difference.
 */
export function comparePrepared(query, candidate, options = defaultSearchOptions()) {
  // --- the cheap pre-filter -------------------------------------------
  const qf = query.features;
  const cf = candidate.features;

  if (qf.aspect / cf.aspect > options.maxAspectRatio) {
    return null;
  }
  if (cf.density / qf.density > options.maxDensityRatio) {
    return null;
  }
  if (qf.density / cf.density > options.maxDensityRatio) {
    return null;
  }

  // --- the comparison --------------------------------------------------
  // Every orientation the candidate may legitimately have: as drawn, mirrored
  // across the vertical axis, mirrored across the horizontal axis, or turned
  // through 180°. The best one wins, and the winner is reported.
  let comparison = { rms: Infinity, max: Infinity };
  let orientation = "as-drawn";
  let mirrored = false;

  const variants = options.allowMirrored
    ? orientationVariants(candidate.signature)
    : [{ name: "as-drawn", signature: candidate.signature }];

  for (const variant of variants) {
    const candidateComparison = compareSignatures(
      query.signature,
      variant.signature,
      options
    );
    // The comparison is with an epsilon, so that two orientations that are
    // equally good are decided by the *order* they are tried in, and not by
    // a difference in the last bit of a float. Without it, a shape that is
    // symmetric in more than one way is reported with a random orientation.
    if (candidateComparison.max < comparison.max - ORIENTATION_EPSILON) {
      comparison = candidateComparison;
      orientation = variant.name;
      mirrored = variant.name !== "as-drawn";
    }
  }

  // The distances are reported in the *query's* units, so that the tolerance
  // and the number mean the same thing. The signature is measured relative to
  // the shape's size, so multiplying by the query's size turns it back into
  // font units.
  const querySize = qf.diagonal;
  const distance = comparison.max * querySize;
  const rms = comparison.rms * querySize;

  const sameNodes =
    qf.pointCount === cf.pointCount && query.typeSignature === candidate.typeSignature;

  const sameTolerance = toleranceFor(querySize, options);
  const nearTolerance = nearToleranceFor(querySize, options);

  // "The same shape" and "the same drawing" are not the same thing: a bowl
  // that was scaled up is the same form, but it is not the same drawing.
  const sameSize = Math.abs(cf.diagonal - qf.diagonal) <= sameTolerance;

  let tier = null;
  if (distance <= IDENTICAL_EPSILON && sameNodes) {
    tier = mirrored ? "identical-mirrored" : "identical";
  } else if (distance <= sameTolerance) {
    tier = mirrored ? "same-mirrored" : "same";
  } else if (distance <= nearTolerance) {
    tier = mirrored ? "near-mirrored" : "near";
  }

  if (!tier) {
    return null;
  }

  return {
    distance,
    rms,
    tier,
    mirrored,
    // Which way round the candidate had to be turned to match: "as-drawn",
    // "mirrored" (vertical axis), "flipped" (horizontal axis) or "rotated"
    // (180°).
    orientation,
    sameNodes,
    sameSize,
  };
}

/**
 * Find the contours that match the query.
 *
 * @param {object} query        a prepared query (see `prepareContour`)
 * @param {Array<object>} candidates  prepared candidates, each with a
 *                                    `meta` object describing where it came from
 * @param {object} options
 * @returns {Array<object>} the matches, best (smallest distance) first
 */
export function findMatches(query, candidates, options = defaultSearchOptions()) {
  const matches = [];
  for (const entry of candidates) {
    // A candidate is either a prepared contour, or a {prepared, meta} pair.
    const candidate = entry.prepared || entry;
    const meta = entry.meta || {};
    const result = comparePrepared(query, candidate, options);
    if (result) {
      matches.push({ ...meta, ...result });
    }
  }
  matches.sort((a, b) => a.distance - b.distance);
  return matches;
}

/**
 * Summarise a set of matches into the "inconsistency" reading: how far the
 * copies of this shape have drifted apart.
 */
export function summarizeMatches(matches, options = defaultSearchOptions()) {
  if (!matches.length) {
    return {
      count: 0,
      total: 0,
      self: null,
      worst: null,
      closest: null,
      spread: 0,
      identical: 0,
      same: 0,
      near: 0,
      mirrored: 0,
      turned: 0,
    };
  }
  // The shape the designer is looking at is not a copy of itself, so it is
  // counted separately and left out of the numbers below.
  const isCopy = (m) => m.glyphName !== options.sourceGlyphName;
  const copies = matches.filter(isCopy);
  const self = matches.find((m) => !isCopy(m)) || null;

  // The three tiers are counted separately. "identical" and "same" are
  // *recurrences* — the shape really does occur again, within the tolerance.
  // "near" is the "worth a look" band: similar, but outside the tolerance.
  const identical = copies.filter((m) => m.tier.startsWith("identical")).length;
  const same = copies.filter((m) => m.tier.startsWith("same")).length;
  const near = copies.filter((m) => m.tier.startsWith("near")).length;
  const mirrored = copies.filter((m) => m.mirrored).length;
  const turned = copies.filter(
    (m) => m.orientation && m.orientation !== "as-drawn"
  ).length;
  // The drift is reported over the *recurrences* — the copies that really are
  // the same shape. When there are none, the worst near-match is reported
  // instead, and `driftIsRecurrence` says so.
  const recurrences = copies.filter(
    (m) => m.tier.startsWith("identical") || m.tier.startsWith("same")
  );
  const driftIsRecurrence = recurrences.length > 0;
  const pool = driftIsRecurrence ? recurrences : copies.length ? copies : matches;
  const worst = pool.reduce((a, b) => (b.distance > a.distance ? b : a));
  // The closest copy of all — the one that comes nearest to being the same
  // shape, which is what a designer wants to know when nothing is within the
  // tolerance.
  const closest = (copies.length ? copies : matches).reduce((a, b) =>
    b.distance < a.distance ? b : a
  );
  return {
    count: copies.length,
    total: matches.length,
    self,
    identical,
    same,
    near,
    mirrored,
    turned,
    worst,
    closest,
    driftIsRecurrence,
    spread: worst.distance - matches[0].distance,
  };
}

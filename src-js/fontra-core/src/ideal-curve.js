/*
 * ideal-curve.js — "right trajectory" analysis for Bézier segments.
 *
 * A curve has a *right trajectory*: the path it should follow when the classic
 * rules of Bézier construction are respected. This module implements those
 * rules as pure functions, so the same logic can drive the editor overlay, the
 * unit tests, and any other consumer.
 *
 * The rules
 * ---------
 *
 * 1. A curve that is meant to be round is an arc. The cubic that approximates a
 *    circular arc puts its control points on the tangents at the anchors, at
 *    the classic "kappa" distance:
 *
 *        d = (4/3) · R · tan(theta / 4)
 *
 *    where theta is the sweep angle of the arc and R its radius. For a quarter
 *    circle this collapses to d = 0.5523 · R — the number every type designer
 *    already knows. For a straight line it collapses to d = chord / 3.
 *
 * 2. Both ends of an arc describe the *same* circle, so the tangent-chord
 *    angle at the start and at the end must match, and the two handles must
 *    have the same length. When they do not, the curve is not an arc.
 *
 * 3. A curve with an inflection (an S-curve) cannot be an arc. Its correct
 *    form is point symmetric: the second half is the 180° rotation of the
 *    first half about the midpoint of the chord. The tangents at both ends
 *    must therefore point in the same direction, and the handles must have
 *    the same length.
 *
 * 4. At a smooth anchor the incoming and outgoing tangents must be collinear
 *    (otherwise the anchor is a kink, and variable-font interpolation gets
 *    wonky), and the two handles should be of comparable length (otherwise
 *    the curve looks unbalanced).
 *
 * A quadratic is handled too: its correct form for an arc is the
 * intersection of the two tangents.
 */

import {
  addVectors,
  distance,
  dotVector,
  mulVectorScalar,
  normalizeVector,
  subVectors,
  vectorLength,
} from "./vector.js";

const EPSILON = 1e-9;
const DEG = 180 / Math.PI;

/** The classic kappa: the handle length of a quarter-circle cubic, per unit radius. */
export const KAPPA = (4 / 3) * Math.tan(Math.PI / 8); // 0.5522847498307936

export const SEVERITY_OK = "ok";
export const SEVERITY_WARN = "warn";
export const SEVERITY_ERROR = "error";

export const RULE_TRAJECTORY = "trajectory";
export const RULE_ARC = "arc";
export const RULE_S_SYMMETRY = "s-symmetry";
export const RULE_CONTINUITY = "continuity";
export const RULE_BALANCE = "balance";

export const RULE_LABELS = {
  [RULE_TRAJECTORY]: "Trajectory",
  [RULE_ARC]: "Arc consistency",
  [RULE_S_SYMMETRY]: "S-curve symmetry",
  [RULE_CONTINUITY]: "Tangent continuity",
  [RULE_BALANCE]: "Handle balance",
};

export const DEFAULT_TOLERANCES = {
  // Maximum relative deviation of a handle length from the ideal arc distance.
  handleRelative: 0.08,
  // Absolute floor for the handle tolerance, in font units.
  handleAbsolute: 0.75,
  // Maximum deviation of a tangent-chord angle, in degrees.
  angle: 2.5,
  // Maximum relative difference between two handle lengths.
  balance: 0.25,
};

export const STRICTNESS_PRESETS = {
  strict: { label: "Strict", factor: 0.5 },
  standard: { label: "Standard", factor: 1 },
  relaxed: { label: "Relaxed", factor: 2 },
};

const SEVERITY_RANK = { [SEVERITY_OK]: 0, [SEVERITY_WARN]: 1, [SEVERITY_ERROR]: 2 };

export function crossVector(vectorA, vectorB) {
  return vectorA.x * vectorB.y - vectorA.y * vectorB.x;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

export function worstSeverity(severities) {
  let worst = SEVERITY_OK;
  for (const severity of severities) {
    if (severityRank(severity) > severityRank(worst)) {
      worst = severity;
    }
  }
  return worst;
}

/** The angle between two vectors, in radians. */
export function angleBetweenVectors(vectorA, vectorB) {
  const lengthA = vectorLength(vectorA);
  const lengthB = vectorLength(vectorB);
  if (lengthA < EPSILON || lengthB < EPSILON) {
    return 0;
  }
  const cosine = clamp(dotVector(vectorA, vectorB) / (lengthA * lengthB), -1, 1);
  return Math.acos(cosine);
}

/** The signed angle from vectorA to vectorB, in radians, in the range -pi..pi. */
export function signedAngleBetweenVectors(vectorA, vectorB) {
  return Math.atan2(crossVector(vectorA, vectorB), dotVector(vectorA, vectorB));
}

export function getTolerances(options = {}) {
  const strictness = options.strictness || "standard";
  const factor = STRICTNESS_PRESETS[strictness]?.factor ?? 1;
  const base = { ...DEFAULT_TOLERANCES, ...(options.tolerances || {}) };
  return {
    handleRelative: base.handleRelative * factor,
    handleAbsolute: base.handleAbsolute * factor,
    angle: base.angle * factor,
    balance: base.balance * factor,
  };
}

function severityFromRatio(ratio) {
  if (ratio > 1) {
    return SEVERITY_ERROR;
  }
  if (ratio > 0.5) {
    return SEVERITY_WARN;
  }
  return SEVERITY_OK;
}

export function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  };
}

export function quadPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

export function sampleCubic(p0, p1, p2, p3, count = 32) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push(cubicPoint(p0, p1, p2, p3, i / (count - 1)));
  }
  return points;
}

export function sampleQuad(p0, p1, p2, count = 32) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push(quadPoint(p0, p1, p2, i / (count - 1)));
  }
  return points;
}

/** Sample a circular arc, described as center + radius + signed sweep. */
export function sampleArc(arc, count = 32) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = arc.startAngle + arc.sweep * t;
    points.push({
      x: arc.center.x + arc.radius * Math.cos(angle),
      y: arc.center.y + arc.radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Compute the reference ("right") trajectory of a cubic segment.
 *
 * Returns null when the segment is degenerate: a zero length handle leaves the
 * tangent — and therefore the trajectory — undefined.
 */
export function computeIdealCubic(p0, p1, p2, p3) {
  const chord = subVectors(p3, p0);
  const chordLength = vectorLength(chord);
  if (chordLength < EPSILON) {
    return null;
  }

  const handle0 = subVectors(p1, p0);
  const handle1 = subVectors(p3, p2);
  const length0 = vectorLength(handle0);
  const length1 = vectorLength(handle1);
  if (length0 < EPSILON || length1 < EPSILON) {
    return null;
  }

  // Travel direction at the start, and the outward direction at the end.
  const tangent0 = mulVectorScalar(handle0, 1 / length0);
  const tangent1 = mulVectorScalar(handle1, 1 / length1);

  const chordUnit = mulVectorScalar(chord, 1 / chordLength);
  const side0 = crossVector(chord, tangent0);
  const side1 = crossVector(chord, tangent1);

  // Both tangents on the same side of the chord means the curve has an
  // inflection: an S-curve, which cannot be an arc.
  const isSCurve = side0 * side1 > 0;

  // The tangent-chord angle at each end. For a true arc both equal theta/2.
  const angle0 = angleBetweenVectors(chordUnit, tangent0);
  const angle1 = angleBetweenVectors(chordUnit, tangent1);

  if (isSCurve) {
    // The correct S-curve is point symmetric about the midpoint of the chord:
    // both ends point the same way, and both handles are equally long.
    const average = addVectors(tangent0, tangent1);
    const averageLength = vectorLength(average);
    const averageTangent =
      averageLength < EPSILON
        ? { x: -chordUnit.y, y: chordUnit.x }
        : mulVectorScalar(average, 1 / averageLength);
    const handleLength = (length0 + length1) / 2;
    return {
      kind: "s-curve",
      isSCurve: true,
      anchors: [p0, p3],
      controlPoints: [
        addVectors(p0, mulVectorScalar(averageTangent, handleLength)),
        subVectors(p3, mulVectorScalar(averageTangent, handleLength)),
      ],
      // The depth of an S-curve is a design decision, not a geometric
      // constraint, so there is no sweep angle to report.
      sweep: null,
      tangent0: averageTangent,
      tangent1: averageTangent,
      handleLength: handleLength,
      actualHandleLengths: [length0, length1],
      sweep: angle0 + angle1,
      radius: null,
      arc: null,
      chordLength: chordLength,
      // How far the two ends of the S point in different directions.
      tangentAsymmetry: angleBetweenVectors(tangent0, tangent1),
      // How far the two handles differ in length.
      handleAsymmetry: Math.abs(length0 - length1),
    };
  }

  // The sweep of the arc that the two tangents describe.
  const sweep = angle0 + angle1;
  if (sweep < EPSILON) {
    // Perfectly straight: the ideal handles sit at a third of the chord.
    const handleLength = chordLength / 3;
    return {
      kind: "arc",
      isSCurve: false,
      anchors: [p0, p3],
      controlPoints: [
        addVectors(p0, mulVectorScalar(tangent0, handleLength)),
        subVectors(p3, mulVectorScalar(tangent1, handleLength)),
      ],
      tangent0: tangent0,
      tangent1: tangent1,
      handleLength: handleLength,
      actualHandleLengths: [length0, length1],
      sweep: 0,
      radius: Infinity,
      arc: null,
      chordLength: chordLength,
      tangentAsymmetry: Math.abs(angle0 - angle1),
      handleAsymmetry: Math.abs(length0 - length1),
    };
  }

  const radius = chordLength / (2 * Math.sin(sweep / 2));
  const handleLength = (4 / 3) * radius * Math.tan(sweep / 4);

  const control0 = addVectors(p0, mulVectorScalar(tangent0, handleLength));
  const control1 = subVectors(p3, mulVectorScalar(tangent1, handleLength));

  // The circle the ideal arc lives on: its center sits on the perpendicular
  // bisector of the chord, on the side opposite the bulge. The circle only
  // describes this curve when both ends agree on it, so it is reported as the
  // reference arc only for a consistent pair of tangents.
  const midpoint = mulVectorScalar(addVectors(p0, p3), 0.5);
  const normal = { x: -chordUnit.y, y: chordUnit.x };
  const bulgeSign = side0 > 0 ? 1 : -1;
  const center = subVectors(
    midpoint,
    mulVectorScalar(normal, radius * Math.cos(sweep / 2) * bulgeSign)
  );

  const startAngle = Math.atan2(p0.y - center.y, p0.x - center.x);
  // The arc is traversed away from its center, so a left bulge reads clockwise.
  const signedSweep = -bulgeSign * sweep;

  const isConsistentArc = Math.abs(angle0 - angle1) < 0.05 * (Math.PI / 180);

  return {
    kind: "arc",
    isSCurve: false,
    anchors: [p0, p3],
    controlPoints: [control0, control1],
    tangent0: tangent0,
    tangent1: tangent1,
    handleLength: handleLength,
    actualHandleLengths: [length0, length1],
    sweep: sweep,
    radius: radius,
    arc: isConsistentArc
      ? {
          center: center,
          radius: radius,
          startAngle: startAngle,
          sweep: signedSweep,
        }
      : null,
    chordLength: chordLength,
    tangentAsymmetry: Math.abs(angle0 - angle1),
    handleAsymmetry: Math.abs(length0 - length1),
  };
}

/**
 * The reference form of a quadratic segment: the control point of a quadratic
 * that approximates a circular arc is the intersection of the two tangents.
 */
export function computeIdealQuad(p0, p1, p2) {
  const chord = subVectors(p2, p0);
  const chordLength = vectorLength(chord);
  if (chordLength < EPSILON) {
    return null;
  }

  const startDirection = subVectors(p1, p0);
  const endDirection = subVectors(p2, p1);
  if (vectorLength(startDirection) < EPSILON || vectorLength(endDirection) < EPSILON) {
    return null;
  }

  const startTangent = normalizeVector(startDirection);
  const endTangent = normalizeVector(endDirection);
  const startNormal = { x: -startTangent.y, y: startTangent.x };
  const endNormal = { x: -endTangent.y, y: endTangent.x };

  const denominator = crossVector(startNormal, endNormal);
  if (Math.abs(denominator) < EPSILON) {
    // Parallel tangents: the arc is a half circle, and the control point is
    // the midpoint of the chord pushed out by the radius.
    const chordUnit = mulVectorScalar(chord, 1 / chordLength);
    const normal = { x: -chordUnit.y, y: chordUnit.x };
    const radius = chordLength / 2;
    const midpoint = mulVectorScalar(addVectors(p0, p2), 0.5);
    const bulgeSign = crossVector(chord, startTangent) > 0 ? 1 : -1;
    return {
      kind: "arc",
      isSCurve: false,
      anchors: [p0, p2],
      controlPoints: [
        subVectors(midpoint, mulVectorScalar(normal, radius * bulgeSign)),
      ],
      tangent0: startTangent,
      tangent1: endTangent,
      handleLength: null,
      actualHandleLengths: [vectorLength(startDirection), vectorLength(endDirection)],
      sweep: Math.PI,
      radius: radius,
      arc: null,
      chordLength: chordLength,
      tangentAsymmetry: angleBetweenVectors(startTangent, endTangent),
      handleAsymmetry: Math.abs(
        vectorLength(startDirection) - vectorLength(endDirection)
      ),
    };
  }

  const t = crossVector(subVectors(p2, p0), endNormal) / denominator;
  const controlPoint = addVectors(p0, mulVectorScalar(startNormal, t));

  return {
    kind: "arc",
    isSCurve: false,
    anchors: [p0, p2],
    controlPoints: [controlPoint],
    tangent0: startTangent,
    tangent1: endTangent,
    handleLength: null,
    actualHandleLengths: [vectorLength(startDirection), vectorLength(endDirection)],
    sweep: angleBetweenVectors(startTangent, endTangent),
    radius: null,
    arc: null,
    chordLength: chordLength,
    tangentAsymmetry: angleBetweenVectors(startTangent, endTangent),
    handleAsymmetry: Math.abs(
      vectorLength(startDirection) - vectorLength(endDirection)
    ),
  };
}

function maxCurveDeviation(actualPoints, idealPoints) {
  let maxDeviation = 0;
  const count = Math.min(actualPoints.length, idealPoints.length);
  for (let i = 0; i < count; i++) {
    const deviation = distance(actualPoints[i], idealPoints[i]);
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
    }
  }
  return maxDeviation;
}

/**
 * Analyze a cubic segment against the rules, and report what is wrong.
 */
export function analyzeCubicSegment(p0, p1, p2, p3, options = {}) {
  const tolerances = getTolerances(options);
  const ideal = computeIdealCubic(p0, p1, p2, p3);
  if (!ideal) {
    return {
      type: "cubic",
      points: [p0, p1, p2, p3],
      ideal: null,
      issues: [],
      severity: SEVERITY_OK,
      degenerate: true,
    };
  }

  const issues = [];
  const [length0, length1] = ideal.actualHandleLengths;
  const idealLength = ideal.handleLength;
  const handleTolerance = Math.max(
    tolerances.handleAbsolute,
    tolerances.handleRelative * idealLength
  );

  // Rule 1: the handles must sit at the arc distance. An S-curve has no arc
  // distance — its depth is a design decision — so the rule does not apply.
  if (!ideal.isSCurve) {
    const delta0 = Math.abs(length0 - idealLength);
    const delta1 = Math.abs(length1 - idealLength);
    const worstDelta = Math.max(delta0, delta1);
    const trajectoryRatio = worstDelta / handleTolerance;
    if (trajectoryRatio > 0.5) {
      const relative = (worstDelta / idealLength) * 100;
      issues.push({
        rule: RULE_TRAJECTORY,
        severity: severityFromRatio(trajectoryRatio),
        value: worstDelta,
        tolerance: handleTolerance,
        message:
          `Handles are ${relative.toFixed(0)}% off the arc distance ` +
          `(${worstDelta.toFixed(1)} units, ideal ${idealLength.toFixed(1)}).`,
        detail:
          `A curve of this sweep should have its handles ${idealLength.toFixed(1)} ` +
          `units long. This one is ${length0.toFixed(1)} and ${length1.toFixed(1)}.`,
      });
    }
  }

  // Rule 2: both ends of an arc describe the same circle.
  if (!ideal.isSCurve) {
    const angleDeviation = ideal.tangentAsymmetry * DEG;
    const angleTolerance = tolerances.angle;
    if (angleDeviation > angleTolerance) {
      issues.push({
        rule: RULE_ARC,
        severity: severityFromRatio(angleDeviation / angleTolerance),
        value: angleDeviation,
        tolerance: angleTolerance,
        message:
          `The two ends describe different arcs ` +
          `(tangent angles differ by ${angleDeviation.toFixed(1)}°).`,
        detail:
          "For a true circular arc the tangent-chord angle at the start and " +
          "at the end must be the same.",
      });
    }
  } else {
    // Rule 3: an S-curve must be point symmetric.
    const angleDeviation = ideal.tangentAsymmetry * DEG;
    const angleTolerance = tolerances.angle;
    const handleDeviation = ideal.handleAsymmetry;
    const handleToleranceS = Math.max(
      tolerances.handleAbsolute,
      tolerances.balance * Math.min(length0, length1)
    );
    const ratio = Math.max(
      angleDeviation / angleTolerance,
      handleDeviation / handleToleranceS
    );
    if (ratio > 0.5) {
      issues.push({
        rule: RULE_S_SYMMETRY,
        severity: severityFromRatio(ratio),
        value: Math.max(angleDeviation, handleDeviation),
        tolerance: angleTolerance,
        message:
          `S-curve is not point symmetric ` +
          `(ends point ${angleDeviation.toFixed(1)}° apart, ` +
          `handles differ by ${handleDeviation.toFixed(1)}).`,
        detail:
          "The second half of an S-curve should be the 180° rotation of the " +
          "first half about the midpoint of the chord.",
      });
    }
  }

  const actualPoints = sampleCubic(p0, p1, p2, p3);
  const idealPoints = sampleCubic(
    ideal.anchors[0],
    ideal.controlPoints[0],
    ideal.controlPoints[1],
    ideal.anchors[1]
  );
  const maxDeviation = maxCurveDeviation(actualPoints, idealPoints);

  return {
    type: "cubic",
    points: [p0, p1, p2, p3],
    ideal: ideal,
    actualPoints: actualPoints,
    idealPoints: idealPoints,
    maxDeviation: maxDeviation,
    maxDeviationRelative: ideal.chordLength
      ? maxDeviation / ideal.chordLength
      : 0,
    issues: issues,
    severity: worstSeverity(issues.map((issue) => issue.severity)),
    degenerate: false,
  };
}

/**
 * Analyze a quadratic segment against the rules.
 */
export function analyzeQuadSegment(p0, p1, p2, options = {}) {
  const ideal = computeIdealQuad(p0, p1, p2);
  if (!ideal) {
    return {
      type: "quad",
      points: [p0, p1, p2],
      ideal: null,
      issues: [],
      severity: SEVERITY_OK,
      degenerate: true,
    };
  }

  const issues = [];
  const angleDeviation = ideal.tangentAsymmetry * DEG;
  const tolerances = getTolerances(options);
  if (angleDeviation > tolerances.angle) {
    issues.push({
      rule: RULE_ARC,
      severity: severityFromRatio(angleDeviation / tolerances.angle),
      value: angleDeviation,
      tolerance: tolerances.angle,
      message:
        `Quadratic tangents differ by ${angleDeviation.toFixed(1)}° ` +
        `— the curve is not a clean arc.`,
      detail:
        "The control point of a quadratic arc is the intersection of the " +
        "two tangents.",
    });
  }

  const actualPoints = sampleQuad(p0, p1, p2);
  const idealPoints = sampleQuad(
    ideal.anchors[0],
    ideal.controlPoints[0],
    ideal.anchors[1]
  );

  return {
    type: "quad",
    points: [p0, p1, p2],
    ideal: ideal,
    actualPoints: actualPoints,
    idealPoints: idealPoints,
    maxDeviation: maxCurveDeviation(actualPoints, idealPoints),
    maxDeviationRelative: ideal.chordLength
      ? maxCurveDeviation(actualPoints, idealPoints) / ideal.chordLength
      : 0,
    issues: issues,
    severity: worstSeverity(issues.map((issue) => issue.severity)),
    degenerate: false,
  };
}

function getContourPointRange(path, contourIndex) {
  const endPoint = path.contourInfo[contourIndex].endPoint;
  const startPoint =
    contourIndex === 0 ? 0 : path.contourInfo[contourIndex - 1].endPoint + 1;
  return { startPoint, endPoint };
}

/**
 * Move the handles of a segment onto its ideal trajectory.
 *
 * The anchors are never touched: only the off-curve control points move, and
 * they move along the tangents they already have, so the shape of the curve
 * around it does not change.
 *
 * Returns true when the path was changed.
 */
export function applyIdealHandles(path, entry) {
  const ideal = entry.analysis?.ideal;
  if (!ideal || !entry.pointIndices) {
    return false;
  }

  if (entry.type === "cubic" && entry.pointIndices.length === 4) {
    const [control0, control1] = ideal.controlPoints;
    path.setPointPosition(entry.pointIndices[1], control0.x, control0.y);
    path.setPointPosition(entry.pointIndices[2], control1.x, control1.y);
    return true;
  }

  if (entry.type === "quad" && entry.pointIndices.length === 3) {
    const [control0] = ideal.controlPoints;
    path.setPointPosition(entry.pointIndices[1], control0.x, control0.y);
    return true;
  }

  return false;
}

/**
 * Analyze a whole path: every curve segment, plus the anchors between them.
 *
 * The returned structure is intentionally plain data, so it can be cached,
 * serialized, and rendered by the overlay without further processing.
 */
export function analyzePath(path, options = {}) {
  const tolerances = getTolerances(options);
  const contours = [];
  const segments = [];
  const issues = [];

  for (let contourIndex = 0; contourIndex < path.numContours; contourIndex++) {
    const contourSegments = [];
    let segmentIndex = 0;

    for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
      const entry = {
        contourIndex: contourIndex,
        segmentIndex: segmentIndex++,
        type: segment.type,
        pointIndices: segment.pointIndices || null,
        parentPointIndices: segment.parentPointIndices || null,
        points: segment.points,
        analysis: null,
      };

      if (segment.type === "cubic" && segment.points.length === 4) {
        entry.analysis = analyzeCubicSegment(...segment.points, options);
      } else if (segment.type === "quad" && segment.points.length === 3) {
        entry.analysis = analyzeQuadSegment(...segment.points, options);
      }

      if (entry.analysis) {
        issues.push(
          ...entry.analysis.issues.map((issue) => ({ ...issue, segment: entry }))
        );
      }

      contourSegments.push(entry);
      segments.push(entry);
    }

    contours.push({ contourIndex: contourIndex, segments: contourSegments });
  }

  // Node rules: they need the segments that meet at an anchor, so they are
  // evaluated after the segments of all contours are known.
  const nodeIssues = analyzeNodes(path, segments, tolerances);
  issues.push(...nodeIssues);

  return {
    contours: contours,
    segments: segments,
    issues: issues,
    severity: worstSeverity(issues.map((issue) => issue.severity)),
    issueCount: issues.length,
  };
}

function analyzeNodes(path, segments, tolerances) {
  const issues = [];

  // Group the curve segments by the anchor they start from, so we can pair up
  // the segment that arrives at an anchor with the one that leaves it.
  const byStartAnchor = new Map();
  for (const segment of segments) {
    if (!segment.analysis || segment.type !== "cubic" || !segment.pointIndices) {
      continue;
    }
    const startIndex = segment.pointIndices[0];
    if (!byStartAnchor.has(startIndex)) {
      byStartAnchor.set(startIndex, []);
    }
    byStartAnchor.get(startIndex).push(segment);
  }

  for (const segment of segments) {
    if (!segment.analysis || segment.type !== "cubic" || !segment.pointIndices) {
      continue;
    }
    const endIndex = segment.pointIndices[3];
    const nextSegments = byStartAnchor.get(endIndex);
    if (!nextSegments || !nextSegments.length) {
      continue;
    }
    const nextSegment = nextSegments[0];
    if (nextSegment.analysis?.degenerate) {
      continue;
    }

    const anchor = segment.points[3];
    const incomingHandle = segment.points[2];
    const outgoingHandle = nextSegment.points[1];

    const point = path.getPoint(endIndex);
    if (!point || point.type || !point.smooth) {
      // Off-curve point, or a corner: the two handles are independent by
      // design, so the node rules do not apply.
      continue;
    }

    const incomingLength = distance(anchor, incomingHandle);
    const outgoingLength = distance(anchor, outgoingHandle);
    if (incomingLength < EPSILON || outgoingLength < EPSILON) {
      continue;
    }

    const incomingDirection = normalizeVector(subVectors(anchor, incomingHandle));
    const outgoingDirection = normalizeVector(subVectors(outgoingHandle, anchor));
    const angleDeviation = angleBetweenVectors(incomingDirection, outgoingDirection) * DEG;

    if (angleDeviation > tolerances.angle) {
      issues.push({
        rule: RULE_CONTINUITY,
        severity: severityFromRatio(angleDeviation / tolerances.angle),
        value: angleDeviation,
        tolerance: tolerances.angle,
        pointIndex: endIndex,
        contourIndex: segment.contourIndex,
        segment: segment,
        message:
          `Smooth anchor has a ${angleDeviation.toFixed(1)}° kink ` +
          `between its handles.`,
        detail:
          "The handles of a smooth anchor must be collinear. A kink here " +
          "also distorts variable-font interpolation.",
      });
    }

    const handleDelta = Math.abs(incomingLength - outgoingLength);
    const balanceTolerance = Math.max(
      tolerances.handleAbsolute,
      tolerances.balance * Math.min(incomingLength, outgoingLength)
    );
    if (handleDelta > balanceTolerance) {
      const relative = (handleDelta / Math.max(incomingLength, outgoingLength)) * 100;
      issues.push({
        rule: RULE_BALANCE,
        severity: severityFromRatio(handleDelta / balanceTolerance),
        value: handleDelta,
        tolerance: balanceTolerance,
        pointIndex: endIndex,
        contourIndex: segment.contourIndex,
        segment: segment,
        message: `Handles at this anchor differ by ${relative.toFixed(0)}%.`,
        detail:
          "Unequal handles at a smooth anchor make the curve look wobbly " +
          "where it leaves the anchor.",
      });
    }
  }

  return issues;
}

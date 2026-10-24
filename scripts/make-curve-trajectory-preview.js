/*
 * Generates the data for docs/curve-trajectory-preview.html.
 *
 * The analysis needs the real VarPackedPath, which pulls in a TypeScript
 * module the browser cannot load, so the analysis is done here, in Node, and
 * the preview page draws the result with the real drawing code.
 *
 * Run with:  node scripts/make-curve-trajectory-preview.js
 */

import fs from "fs";

import { analyzePath } from "@fontra/core/ideal-curve.js";
import { VarPackedPath } from "@fontra/core/var-path.js";

const K = 0.5522847498307936;

function polar(cx, cy, r, degrees) {
  const a = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

function tangent(degrees) {
  // The direction of travel along the circle, for a decreasing angle (the
  // screen y axis points down, so this is clockwise on screen).
  const a = (degrees * Math.PI) / 180;
  return { x: Math.sin(a), y: Math.cos(a) };
}

/** A quarter circle, with handles scaled by handleFactor. */
function quarter(cx, cy, r, from, to, handleFactor) {
  const p0 = polar(cx, cy, r, from);
  const p3 = polar(cx, cy, r, to);
  const d = K * r * handleFactor;
  const t0 = tangent(from);
  const t1 = tangent(to);
  return {
    p0: p0,
    c0: { x: p0.x + t0.x * d, y: p0.y + t0.y * d },
    c1: { x: p3.x - t1.x * d, y: p3.y - t1.y * d },
    p3: p3,
  };
}

// A rounded "O": four quarter circles. Two are correct, one is slightly off
// and one is clearly off.
const O = {
  cx: 190,
  cy: 190,
  r: 88,
  quarters: [
    quarter(190, 190, 88, 90, 0, 1.0),
    quarter(190, 190, 88, 0, -90, 1.24),
    quarter(190, 190, 88, -90, -180, 1.1),
    quarter(190, 190, 88, 180, 90, 1.0),
  ],
};

// An S-curve: the second half is not the rotation of the first.
const S = {
  points: [
    { x: 420, y: 110 },
    { x: 470, y: 235, type: "cubic" },
    { x: 500, y: 95, type: "cubic" },
    { x: 560, y: 210 },
  ],
};

function buildO() {
  const path = new VarPackedPath();
  const points = [];
  for (const q of O.quarters) {
    points.push({ x: q.p0.x, y: q.p0.y });
    points.push({ x: q.c0.x, y: q.c0.y, type: "cubic" });
    points.push({ x: q.c1.x, y: q.c1.y, type: "cubic" });
  }
  const last = O.quarters[O.quarters.length - 1];
  points.push({ x: last.p3.x, y: last.p3.y });
  path.appendUnpackedContour({ isClosed: true, points: points });
  return path;
}

function buildS() {
  const path = new VarPackedPath();
  path.appendUnpackedContour({ isClosed: false, points: S.points });
  return path;
}

function stripCycles(analysis) {
  const segments = analysis.segments.map((entry) => ({
    contourIndex: entry.contourIndex,
    segmentIndex: entry.segmentIndex,
    type: entry.type,
    pointIndices: entry.pointIndices,
    points: entry.points,
    analysis: entry.analysis,
  }));
  const issues = analysis.issues.map((issue) => ({
    rule: issue.rule,
    severity: issue.severity,
    message: issue.message,
    value: issue.value,
    segment: issue.segment
      ? {
          contourIndex: issue.segment.contourIndex,
          segmentIndex: issue.segment.segmentIndex,
        }
      : null,
  }));
  return { segments: segments, issues: issues };
}

const oAnalysis = analyzePath(buildO(), { strictness: "standard" });
const sAnalysis = analyzePath(buildS(), { strictness: "standard" });

const data = {
  o: {
    segments: stripCycles(oAnalysis).segments,
    issues: stripCycles(oAnalysis).issues,
    contour: {
      points: buildO()
        .getPoint
        ? null
        : null,
    },
  },
  s: {
    segments: stripCycles(sAnalysis).segments,
    issues: stripCycles(sAnalysis).issues,
  },
  outline: {
    o: O.quarters.map((q) => [q.p0, q.c0, q.c1, q.p3]),
    s: S.points,
  },
};

fs.writeFileSync(
  new URL("../docs/curve-trajectory-preview-data.json", import.meta.url),
  JSON.stringify(data, null, 1)
);

console.log(
  `O: ${data.o.segments.length} segments, ${data.o.issues.length} issues`
);
console.log(
  `S: ${data.s.segments.length} segments, ${data.s.issues.length} issues`
);
for (const issue of data.o.issues) {
  console.log(`  - [${issue.severity}] ${issue.message}`);
}
for (const issue of data.s.issues) {
  console.log(`  - [${issue.severity}] ${issue.message}`);
}

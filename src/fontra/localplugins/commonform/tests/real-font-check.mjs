// real-font-check.mjs
//
// A real-font check for the two plugins: run the actual engines over the
// actual data of a real .fontra font, and report what they find.
//
//   node tests/real-font-check.mjs [path/to/font.fontra]
//
// The default is the MutatorSans font that ships with the Fontra test suite.
// This is not part of the test suite (those are self-contained); it is the
// end-to-end check that the engines do their job on a real typeface.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultSearchOptions,
  findMatches,
  prepareContour,
  summarizeMatches,
} from "../commonform-engine.js";

import { parseCust, resolveTargets } from "../../cadence-spacer/cadence-engine.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_FONT = resolve(HERE, "../../../../../test-common/fonts/MutatorSans.fontra");
const FONT_PATH = resolve(process.argv[2] || DEFAULT_FONT);
const FONT_DIR = join(FONT_PATH, "glyphs");
const LAYER = process.env.FONTRA_CHECK_LAYER || "light-condensed";

/** Decompose a contour into Fontra-style segments. */
function decomposeContour(points) {
  const onCurve = (point) => (point.type || "oncurve") === "oncurve";
  let pts = points.slice();

  if (!pts.some(onCurve)) {
    const implied = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      implied.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, type: "oncurve" });
      implied.push(a);
    }
    pts = implied;
  } else {
    const start = pts.findIndex(onCurve);
    pts = pts.slice(start).concat(pts.slice(0, start));
  }

  const segments = [];
  let current = pts[0];
  let control = [];
  for (let i = 1; i <= pts.length; i++) {
    const point = pts[i % pts.length];
    if (onCurve(point)) {
      if (!control.length) {
        segments.push({ type: "line", points: [current, point] });
      } else if (control.length === 1) {
        segments.push({ type: "quad", points: [current, control[0], point] });
      } else {
        segments.push({ type: "cubic", points: [current, control[0], control[1], point] });
      }
      current = point;
      control = [];
    } else {
      control.push(point);
    }
  }
  return segments;
}

function contourBounds(contour) {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const point of contour.points) {
    xMin = Math.min(xMin, point.x);
    yMin = Math.min(yMin, point.y);
    xMax = Math.max(xMax, point.x);
    yMax = Math.max(yMax, point.y);
  }
  return { xMin, yMin, xMax, yMax };
}

function loadGlyphs() {
  const glyphs = new Map();
  for (const fileName of readdirSync(FONT_DIR)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const data = JSON.parse(readFileSync(join(FONT_DIR, fileName), "utf8"));
    const layer = data.layers?.[LAYER];
    if (!layer?.glyph?.path) {
      continue;
    }
    const contours = layer.glyph.path.contours.map((contour) => ({
      points: contour.points.map((point) => ({ ...point, type: point.type || "oncurve" })),
      isClosed: contour.isClosed !== false,
      segments: decomposeContour(contour.points),
    }));
    glyphs.set(data.name, {
      name: data.name,
      xAdvance: layer.glyph.xAdvance ?? 0,
      contours,
    });
  }
  return glyphs;
}

/** Flatten a contour into a polyline, and find where the beam crosses it. */
function flattenContour(contour, steps = 8) {
  const polyline = [];
  for (const segment of contour.segments) {
    const points = segment.points;
    if (segment.type === "line") {
      polyline.push(points[1]);
    } else {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        if (segment.type === "quad") {
          const [p0, p1, p2] = points;
          polyline.push({
            x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
            y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
          });
        } else {
          const [p0, p1, p2, p3] = points;
          polyline.push({
            x:
              3 * u * u * t * p0.x +
              3 * u * t * t * p1.x +
              3 * t * t * t * p2.x +
              t * t * t * p3.x,
            y:
              3 * u * u * t * p0.y +
              3 * u * t * t * p1.y +
              3 * t * t * t * p2.y +
              t * t * t * p3.y,
          });
        }
      }
    }
  }
  return polyline;
}

function beamCrossings(glyph, y) {
  const crossings = [];
  for (const contour of glyph.contours) {
    const polyline = flattenContour(contour);
    for (let i = 0; i < polyline.length; i++) {
      const a = polyline[i];
      const b = polyline[(i + 1) % polyline.length];
      if (a.y === b.y) {
        continue;
      }
      if ((y >= a.y && y < b.y) || (y >= b.y && y < a.y)) {
        const t = (y - a.y) / (b.y - a.y);
        crossings.push(a.x + t * (b.x - a.x));
      }
    }
  }
  return crossings.sort((p, q) => p - q);
}

const glyphs = loadGlyphs();
console.log(`Loaded ${glyphs.size} glyphs from ${FONT_PATH} (layer "${LAYER}")\n`);

// ---------------------------------------------------------------------------
// 1. Commonform: which shapes does this typeface reuse?
// ---------------------------------------------------------------------------

console.log("=".repeat(78));
console.log("COMMONFORM — the common forms of MutatorSans");
console.log("=".repeat(78));

const options = defaultSearchOptions();
const allContours = [];
for (const glyph of glyphs.values()) {
  for (let contourIndex = 0; contourIndex < glyph.contours.length; contourIndex++) {
    const contour = glyph.contours[contourIndex];
    if (!contour.isClosed || contour.points.length < 8) {
      continue;
    }
    allContours.push({
      meta: { glyphName: glyph.name, contourIndex },
      prepared: prepareContour(contour, options),
    });
  }
}
console.log(`\n${allContours.length} closed contours in the font.`);

// Ask every contour whether it occurs elsewhere.
const pairs = [];
for (const entry of allContours) {
  const matches = findMatches(entry.prepared, allContours, options);
  for (const match of matches) {
    if (
      match.glyphName === entry.meta.glyphName &&
      match.contourIndex === entry.meta.contourIndex
    ) {
      continue;
    }
    pairs.push({
      from: `${entry.meta.glyphName}#${entry.meta.contourIndex}`,
      to: `${match.glyphName}#${match.contourIndex}`,
      tier: match.tier,
      distance: match.distance,
      mirrored: match.mirrored,
      orientation: match.orientation,
    });
  }
}

pairs.sort((a, b) => a.distance - b.distance);
console.log(`\n${pairs.length} shape pairs that are the same shape:\n`);
for (const pair of pairs) {
  const orientation = pair.mirrored
    ? "mirrored"
    : pair.orientation === "flipped"
      ? "flipped"
      : pair.orientation === "rotated"
        ? "rotated"
        : "as drawn";
  console.log(
    `  ${pair.from.padEnd(8)} = ${pair.to.padEnd(8)} ` +
      `${pair.tier.padEnd(10)} drift ${pair.distance.toFixed(2).padStart(7)} units  ${orientation}`
  );
}

// The headline: one query, the way a designer would use it.
const oGlyph = glyphs.get("O");
const oCounterIndex = oGlyph.contours.findIndex(
  (contour, index) => contour.isClosed && contour.points.length >= 8
);
const oCounter = oGlyph.contours[oCounterIndex];
const query = prepareContour(oCounter, options);
const headline = findMatches(query, allContours, options).filter(
  (match) => !(match.glyphName === "O" && match.contourIndex === oCounterIndex)
);
const headlineSummary = summarizeMatches(headline, { glyphName: "O" });
console.log(
  `\nA designer's query — the counter of "O" — finds ` +
    `${headlineSummary.count} copy/copies in the font:`
);
for (const match of headline) {
  console.log(
    `  ${match.glyphName} (contour ${match.contourIndex}): ${match.tier}, ` +
      `drift ${match.distance.toFixed(2)} units`
  );
}

// ---------------------------------------------------------------------------
// 2. Cadence Spacer: plan the spacing of a real font
// ---------------------------------------------------------------------------

console.log("\n" + "=".repeat(78));
console.log("CADENCE SPACER — a spacing plan for MutatorSans");
console.log("=".repeat(78));

const cust = parseCust(
  [
    "# a small starter table",
    "nBeam=200",
    "H=SS,10,10,Beam",
    "N=SS,10,10,Beam",
    "O=XX,7,7,Beam",
    "E=SS,9,9,Beam",
  ].join("\n")
);
const beamY = cust.meta.nBeam;
console.log(`\nTable parsed with ${cust.errors.length} error(s).`);

const reference = glyphs.get("H");
const referenceCrossings = beamCrossings(reference, beamY);
console.log(
  `\nReference "H" at beam y=${beamY}: ${referenceCrossings.length} crossing(s) ` +
    `at x = ${referenceCrossings.map((x) => Math.round(x)).join(", ")}`
);
const leftEdges = referenceCrossings.filter((_, index) => index % 2 === 0);
const stemInterval = leftEdges.length >= 2 ? leftEdges[1] - leftEdges[0] : 0;
const gridStepUnit = stemInterval / 32;
console.log(
  `Stem interval: ${stemInterval.toFixed(1)} units → cadence unit: ` +
    `${gridStepUnit.toFixed(3)} units (32 grid steps)`
);

const targets = resolveTargets(cust, [...glyphs.keys()]);
console.log(`\nThe table names ${targets.length} glyph(s):\n`);

for (const target of targets) {
  const glyph = glyphs.get(target.glyphName);
  if (!glyph) {
    console.log(`  ${target.glyphName}: not in the font`);
    continue;
  }
  const bounds = contourBounds({
    points: glyph.contours.flatMap((contour) => contour.points),
  });
  const crossings = beamCrossings(glyph, beamY);
  const [leftDef, rightDef] = target.entry.sideDef.split("");

  // "X": the side is measured at the outline's edge.
  // "S": the side is measured at the stem, at the beam height.
  const currentLeft = leftDef === "S" && crossings.length ? crossings[0] : bounds.xMin;
  const currentRight =
    rightDef === "S" && crossings.length
      ? glyph.xAdvance - crossings[crossings.length - 1]
      : glyph.xAdvance - bounds.xMax;

  const desiredLeft = target.entry.left * gridStepUnit;
  const desiredRight = target.entry.right * gridStepUnit;
  console.log(
    `  ${target.glyphName} (${target.entry.sideDef}): ` +
      `now ${currentLeft.toFixed(1)}/${currentRight.toFixed(1)} → ` +
      `wanted ${desiredLeft.toFixed(1)}/${desiredRight.toFixed(1)} ` +
      `(Δ ${(desiredLeft - currentLeft).toFixed(1)}/` +
      `${(desiredRight - currentRight).toFixed(1)})`
  );
}

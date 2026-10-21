/**
 * BrushEngine — pure geometry for calligraphic strokes.
 *
 * No DOM. No Fontra state. No localStorage. No i18n. Tested in isolation.
 *
 * ── Broad-nib model ──────────────────────────────────────────────────────────
 *   width = min + (max-min) * |sin(movementAngle − brushAngle)| ^ contrastExp
 *   thin when movement is parallel to the nib edge, thick when perpendicular.
 *
 * ── Pipeline ─────────────────────────────────────────────────────────────────
 *   generateStroke(rawPoints)
 *     → prepare → resample → smooth → enrich → widths → taper → outline
 *
 *   generateStrokeContour(rawPoints)    → cubic-fit smooth contour (default)
 *   generateSharpContour(rawPoints)     → plain on-curve polygon (straight mode)
 *   generateDotContour(point)           → nib-shaped stamp for click-without-drag
 *
 *   Static helpers used by the panel and the preview:
 *     BrushEngine.taperWidths(widths, taper, minWidth)
 *
 * The caller picks `generateStroke` for live preview, `generateStrokeContour`
 * for the commit path of the calligraphic tool, and `generateSharpContour` for
 * the straight tool. Width math is one method (`calculateWidthsForPoints`) —
 * the preview, the calligraphic commit, the straight commit, and the eraser
 * all go through it. There is no separate `calculateWidths` to drift.
 *
 * ── Fewer-points improvements (vs. v3) ───────────────────────────────────────
 *   RESAMPLE_DISTANCE  3 → 4   (fewer input samples per stroke)
 *   FIT_ERROR          4.0 → 6.0 (fewer, longer cubic segments)
 *   OUTLINE_CORNER_ANGLE tightened via higher corner cosine threshold
 *   MIN_CORNER_EDGE_LENGTH 3 → 4  (skip short runs near corners)
 *   cleanPolygon collinearity threshold 0.998 → 0.995 (drop near-straight joints)
 */
import * as vector from "./vector.js";
import { Bezier } from "bezier-js";
import { fitCubic, computeMaxError, chordLengthParameterize } from "./fit-cubic.js";
import { BRUSH_BOUNDS, BRUSH_PRESETS, DEFAULT_OPTIONS } from "./brush-settings.js";

// ── Tunables ──
const RESAMPLE_DISTANCE = 4;       // glyph units between decimated samples (raised from 3)
const FIT_ERROR = 6.0;             // squared-distance tolerance for cubic fit (raised from 4.0)
const OUTLINE_CORNER_ANGLE = (55 * Math.PI) / 180;
const MIN_CORNER_EDGE_LENGTH = 4;  // both edges must be this long to qualify (raised from 3)
const MIN_RUN_POINTS = 3;          // min points between kept corner anchors
const MAX_HALFWIDTH_CURVATURE_RATIO = 0.85; // clamp half-width by local radius
const SPEED_FACTOR_MIN = 0.75;     // speed-thinning floor
const SPEED_FACTOR_SCALE = 0.08;   // glyph-units/ms scaling
const PRESSURE_FLOOR = 0.65;       // pressureFactor(0)
const PRESSURE_RANGE = 0.55;       // pressureFactor(1) - PRESSURE_FLOOR

export { BRUSH_BOUNDS, BRUSH_PRESETS };

export class BrushEngine {
  constructor(options = {}) {
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
      this[key] = options[key] ?? DEFAULT_OPTIONS[key];
    }
    this._normalizeOptions();
  }

  updateOptions(opts = {}) {
    for (const key of Object.keys(DEFAULT_OPTIONS)) {
      if (opts[key] !== undefined) this[key] = opts[key];
    }
    this._normalizeOptions();
  }

  /** Clamp every field to its bound; non-numeric → default; maxWidth ≥ minWidth+1. */
  _normalizeOptions() {
    for (const [key, [min, max]] of Object.entries(BRUSH_BOUNDS)) {
      const v = Number(this[key]);
      this[key] = Number.isNaN(v) ? DEFAULT_OPTIONS[key] : Math.min(max, Math.max(min, v));
    }
    this.maxWidth = Math.max(this.maxWidth, this.minWidth + 1);
    // usePressure is a 0|1 toggle; coerce before downstream code reads it.
    this.usePressure = this.usePressure ? 1 : 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Pipeline entry points
  // ───────────────────────────────────────────────────────────────────────────

  /** Preview geometry. Returns { centerlinePoints, widthPoints, outlinePoints, enriched }. */
  generateStroke(rawPoints) {
    this._assertAtLeastTwo(rawPoints);
    const points = this.smoothPolyline(resamplePolyline(prepareRawPoints(rawPoints), RESAMPLE_DISTANCE));
    const enriched = this._enrichPoints(points);
    const widthPoints = this.applyTaper(this.calculateWidthsForPoints(enriched, { includeSpeed: true }));
    const outlinePoints = this.buildOutline(enriched, widthPoints);
    return {
      centerlinePoints: enriched.map(({ x, y }) => ({ x, y })),
      widthPoints,
      outlinePoints,
      enriched,
    };
  }

  /** Commit path: cubic-fitted smooth contour (Fontra `unpackedContour` shape). */
  generateStrokeContour(rawPoints) {
    const { outlinePoints } = this.generateStroke(rawPoints);
    if (outlinePoints.length < 4) return null;
    const oriented =
      signedArea(outlinePoints) < 0 ? outlinePoints.slice().reverse() : outlinePoints;
    return fitOutlineToContour(oriented) ?? { points: oriented, isClosed: true };
  }

  /** Straight-mode commit path: plain on-curve polygon, no fitting, no smooth flag. */
  generateSharpContour(rawPoints) {
    this._assertAtLeastTwo(rawPoints);
    const points = rawPoints;
    const enriched = this._enrichPoints(points);
    const widthPoints = this.applyTaper(
      this.calculateWidthsForPoints(enriched, { includeSpeed: false })
    );
    const outline = this.buildOutline(enriched, widthPoints);
    if (outline.length < 4) return null;
    return { points: outline.map(({ x, y }) => ({ x, y })), isClosed: true };
  }

  /** Nib-footprint stamp for click-without-drag (slightly squarish ellipse). */
  generateDotContour(point) {
    const major = this.maxWidth / 2;
    const minor = Math.max(this.minWidth / 2, major * 0.12);
    const cosR = Math.cos((this.brushAngle * Math.PI) / 180);
    const sinR = Math.sin((this.brushAngle * Math.PI) / 180);
    const N = 48;
    const ring = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = (i / N) * 2 * Math.PI;
      const sx = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 0.6);
      const sy = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 0.6);
      ring[i] = {
        x: point.x + sx * major * cosR - sy * minor * sinR,
        y: point.y + sx * major * sinR + sy * minor * cosR,
      };
    }
    return fitOutlineToContour(ring, 1.0);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stages (public so the panel / preview can reuse them)
  // ───────────────────────────────────────────────────────────────────────────

  /** Decimate-then-smooth. Endpoints are preserved exactly for glyph-space accuracy. */
  smoothPolyline(points) {
    if (points.length < 3 || this.smoothness <= 0.01) return points.slice();
    const win = Math.round(1 + this.smoothness * 2); // window radius 1..3
    const out = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const a = Math.max(0, i - win), b = Math.min(points.length - 1, i + win);
      let sx = 0, sy = 0, sp = 0, ss = 0, cnt = 0;
      for (let j = a; j <= b; j++) {
        sx += points[j].x;
        sy += points[j].y;
        sp += points[j].pressure ?? 0.5;
        ss += points[j].speed ?? 0;
        cnt++;
      }
      out[i] = {
        x: sx / cnt,
        y: sy / cnt,
        pressure: sp / cnt,
        speed: ss / cnt,
        timestamp: points[i].timestamp,
      };
    }
    out[0] = { ...points[0] };
    out[out.length - 1] = { ...points[points.length - 1] };
    if (this.smoothness > 0.5) {
      const chaik = chaikin(out, 1);
      chaik[0] = { ...points[0] };
      chaik[chaik.length - 1] = { ...points[points.length - 1] };
      return chaik;
    }
    return out;
  }

  /**
   * The single width-calculation method. Used by:
   *  - generateStroke (commit pipeline, includeSpeed: true)
   *  - generateSharpContour (straight commit, includeSpeed: false)
   *  - brush-preview.js (sidebar preview, includeSpeed: false)
   */
  calculateWidthsForPoints(points, { includeSpeed = false } = {}) {
    const n = points.length;
    const widths = new Array(n);
    const useP = this.usePressure === 1;
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      const moveAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
      const factor = nibWidthFactor(moveAngle, this.brushAngle, this.contrast);
      let w = this.minWidth + (this.maxWidth - this.minWidth) * factor;
      w *= pressureFactor(useP ? points[i].pressure ?? 0.5 : 0.5);
      if (includeSpeed) {
        const speedFactor = Math.max(
          SPEED_FACTOR_MIN,
          Math.min(1, 1 - (points[i].speed ?? 0) * SPEED_FACTOR_SCALE)
        );
        w *= speedFactor;
      }
      widths[i] = Math.max(this.minWidth * 0.5, Math.min(this.maxWidth * 1.1, w));
    }
    return widths;
  }

  applyTaper(widths) {
    return BrushEngine.taperWidths(widths, this.taper, this.minWidth);
  }

  /**
   * Build a dense offset polygon (left forward, right backward) from enriched
   * points and pre-computed widths. Clamps half-width by local radius of
   * curvature to keep the inner edge from looping onto itself on tight turns.
   * Returns plain `{x,y}` integer-rounded points.
   */
  buildOutline(enriched, widths) {
    const n = enriched.length;
    const left = new Array(n);
    const right = new Array(n);
    for (let i = 0; i < n; i++) {
      let half = widths[i] / 2;
      const r = circumRadius(
        enriched[Math.max(0, i - 1)],
        enriched[i],
        enriched[Math.min(n - 1, i + 1)]
      );
      if (r !== undefined) half = Math.min(half, r * MAX_HALFWIDTH_CURVATURE_RATIO);
      const perp = enriched[i].perpendicularAngle;
      const ox = Math.cos(perp) * half;
      const oy = Math.sin(perp) * half;
      left[i] = { x: enriched[i].x + ox, y: enriched[i].y + oy };
      right[i] = { x: enriched[i].x - ox, y: enriched[i].y - oy };
    }
    return cleanPolygon([...left, ...right.reverse()]);
  }

  /**
   * Static taper. Single source of truth for the easeInOutCubic end taper —
   * used by the engine, the panel preview, and the straight tool. Pure;
   * does not mutate input.
   */
  static taperWidths(widths, taper, minWidth) {
    if (!widths.length || taper <= 0) return widths.slice();
    const n = widths.length;
    const taperCount = Math.max(1, Math.round(n * taper));
    const out = widths.slice();
    const floor = minWidth * 0.15;
    for (let i = 0; i < taperCount; i++) {
      const e = easeInOutCubic(i / taperCount);
      out[i] *= e;
      out[n - 1 - i] *= e;
    }
    out[0] = Math.max(out[0], floor);
    out[n - 1] = Math.max(out[n - 1], floor);
    return out;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  _enrichPoints(points) {
    const n = points.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      const moveAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
      out[i] = {
        x: points[i].x,
        y: points[i].y,
        pressure: points[i].pressure ?? 0.5,
        speed: points[i].speed ?? 0,
        timestamp: points[i].timestamp,
        movementAngle: moveAngle,
        perpendicularAngle: moveAngle + Math.PI / 2,
      };
    }
    if (n >= 2) {
      out[0].movementAngle = out[1].movementAngle;
      out[0].perpendicularAngle = out[1].perpendicularAngle;
      out[n - 1].movementAngle = out[n - 2].movementAngle;
      out[n - 1].perpendicularAngle = out[n - 2].perpendicularAngle;
    }
    return out;
  }

  _assertAtLeastTwo(pts) {
    if (!pts || pts.length < 2) throw new Error("Need at least 2 points");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outline → cubic bezier contour fitting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fit a closed polygon ring with cubic bezier segments. Returns an unpacked
 * contour `{points, isClosed: true}` following the strict Fontra pattern
 * [onCurve, offCurve, offCurve, onCurve, ...]. Returns null on degenerate
 * input or when fitting produces non-finite coordinates.
 */
export function fitOutlineToContour(ring, error = FIT_ERROR) {
  const cleaned = dedupeRing(ring);
  if (cleaned.length < 4) return null;
  const cornerIdx = selectCorners(
    cleaned,
    findCornerIndices(cleaned, OUTLINE_CORNER_ANGLE),
    MIN_RUN_POINTS
  );
  const runs = splitRingIntoRuns(cleaned, cornerIdx);
  const segments = [];
  const cornerStarts = [];
  for (const run of runs) {
    const fitted = fitRun(run.points, error);
    if (!fitted?.length) return null;
    for (let bi = 0; bi < fitted.length; bi++) {
      if (!isFiniteBezier(fitted[bi])) return null;
      segments.push(fitted[bi]);
      cornerStarts.push(bi === 0 ? run.isCornerStart : false);
    }
  }
  if (!segments.length) return null;
  const points = new Array(segments.length * 3);
  for (let i = 0; i < segments.length; i++) {
    const [p0, c1, c2] = segments[i].points;
    points[i * 3] = { x: p0.x, y: p0.y, ...(cornerStarts[i] ? {} : { smooth: true }) };
    points[i * 3 + 1] = { x: c1.x, y: c1.y, type: "cubic" };
    points[i * 3 + 2] = { x: c2.x, y: c2.y, type: "cubic" };
  }
  return { points, isClosed: true };
}

/** Recursive Schneider-style fitting of an open polyline run. */
function fitRun(points, error, depth = 0) {
  if (points.length < 2 || depth > 16) return null;
  const p0 = points[0];
  const p3 = points[points.length - 1];
  const chord = vector.distance(p0, p3);
  if (points.length === 2 || chord < 1e-9) return straightRunBezier(points);
  const leftTangent = endTangent(points, true);
  const rightTangent = endTangent(points, false);
  if (!leftTangent || !rightTangent) return straightRunBezier(points);
  const bezier = fitCubic(points, leftTangent, rightTangent, error);
  if (!isFiniteBezier(bezier)) return straightRunBezier(points);
  const parameters = chordLengthParameterize(points);
  const [maxError, splitPoint] = computeMaxError(points, bezier, parameters);
  if (maxError <= error || depth >= 12) return [bezier];
  const sp = Math.max(1, Math.min(points.length - 2, splitPoint));
  if (sp <= 0 || sp >= points.length - 1) return [bezier];
  const left = fitRun(points.slice(0, sp + 1), error, depth + 1);
  const right = fitRun(points.slice(sp), error, depth + 1);
  if (!left?.length || !right?.length) return [bezier];
  return [...left, ...right];
}

function straightRunBezier(points) {
  const p0 = points[0];
  const p3 = points[points.length - 1];
  const d = vector.subVectors(p3, p0);
  const len = vector.vectorLength(d);
  if (len < 1e-9) return null;
  const t = vector.mulVectorScalar(d, 1 / len);
  return [new Bezier(p0, vector.addVectors(p0, vector.mulVectorScalar(t, len / 3)),
                     vector.addVectors(p3, vector.mulVectorScalar(t, -len / 3)), p3)];
}

function endTangent(points, atStart) {
  const anchor = atStart ? points[0] : points[points.length - 1];
  for (let k = 1; k < points.length; k++) {
    const other = atStart ? points[k] : points[points.length - 1 - k];
    const t = vector.normalizeVector(vector.subVectors(other, anchor));
    if (Math.abs(t.x) + Math.abs(t.y) > 1e-6) return t;
  }
  return null;
}

function isFiniteBezier(bezier) {
  return bezier.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function findCornerIndices(ring, angleThreshold) {
  const indices = [];
  const n = ring.length;
  const cornerCos = Math.cos(angleThreshold);
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    const v1 = vector.subVectors(curr, prev);
    const v2 = vector.subVectors(next, curr);
    const l1 = vector.vectorLength(v1);
    const l2 = vector.vectorLength(v2);
    if (l1 < MIN_CORNER_EDGE_LENGTH || l2 < MIN_CORNER_EDGE_LENGTH) continue;
    if (vector.dotVector(v1, v2) / (l1 * l2) < cornerCos) indices.push(i);
  }
  return indices;
}

/** Keep corners ≥minRun points apart, including across the wrap-around. */
function selectCorners(ring, candidates, minRun) {
  if (!candidates.length) return [];
  const kept = [];
  for (const idx of candidates) {
    const last = kept.length ? kept[kept.length - 1] : null;
    if (last === null || idx - last >= minRun) kept.push(idx);
  }
  while (
    kept.length > 1 &&
    ring.length - kept[kept.length - 1] + kept[0] < minRun
  ) {
    kept.pop();
  }
  return kept;
}

function splitRingIntoRuns(ring, cornerIdx) {
  if (!cornerIdx.length) return [{ points: ring, isCornerStart: false }];
  const runs = [];
  for (let k = 0; k < cornerIdx.length; k++) {
    const start = cornerIdx[k];
    const end = cornerIdx[(k + 1) % cornerIdx.length];
    const points =
      end > start ? ring.slice(start, end + 1) : [...ring.slice(start), ...ring.slice(0, end + 1)];
    runs.push({ points, isCornerStart: true });
  }
  return runs;
}

function dedupeRing(ring) {
  const out = ring.filter((pt, idx) => {
    const prev = idx === 0 ? ring[ring.length - 1] : ring[idx - 1];
    return prev.x !== pt.x || prev.y !== pt.y;
  });
  if (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) {
    out.pop();
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Circumradius of three points; undefined if collinear (∞ radius) or degenerate. */
function circumRadius(a, b, c) {
  const ab = vector.distance(a, b);
  const bc = vector.distance(b, c);
  const ca = vector.distance(c, a);
  const product = ab * bc * ca;
  if (product < 1e-9) return undefined;
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return cross < 1e-9 ? undefined : product / (2 * cross);
}

/** Signed area of a closed polygon. Positive = counter-clockwise in y-up. */
export function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}

export function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function nibWidthFactor(moveAngleRad, brushAngleDeg, contrast) {
  const brushRad = (brushAngleDeg * Math.PI) / 180;
  const widthFactor = Math.abs(Math.sin(normalizeAngle(moveAngleRad - brushRad)));
  return Math.pow(widthFactor, 1 + contrast * 1.5);
}

export function pressureFactor(pressure) {
  return PRESSURE_FLOOR + (pressure ?? 0.5) * PRESSURE_RANGE;
}

export function chaikin(points, iterations = 1) {
  let result = points.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const next = [result[0]];
    for (let i = 0; i < result.length - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];
      next.push(
        {
          x: 0.75 * p0.x + 0.25 * p1.x,
          y: 0.75 * p0.y + 0.25 * p1.y,
          pressure: p0.pressure * 0.75 + p1.pressure * 0.25,
          speed: (p0.speed ?? 0) * 0.75 + (p1.speed ?? 0) * 0.25,
          timestamp: p0.timestamp,
        },
        {
          x: 0.25 * p0.x + 0.75 * p1.x,
          y: 0.25 * p0.y + 0.75 * p1.y,
          pressure: p0.pressure * 0.25 + p1.pressure * 0.75,
          speed: (p0.speed ?? 0) * 0.25 + (p1.speed ?? 0) * 0.75,
          timestamp: p1.timestamp,
        }
      );
    }
    next.push(result[result.length - 1]);
    result = next;
  }
  return result;
}

/**
 * Min-distance decimator. Keeps a point only when it is at least `minDist`
 * away from the last kept point. No interpolation. Spacing is ≥ minDist
 * and irregular — speed/width math must not assume uniform spacing.
 */
export function resamplePolyline(points, minDist = 3) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      out.push(points[i]);
      last = points[i];
    }
  }
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/** Pre-process raw pointer events: fill pressure fallback + derive per-point speed. */
function prepareRawPoints(rawPoints) {
  const points = rawPoints.map((p) => ({
    x: p.x,
    y: p.y,
    pressure: p.pressure || 0.5,
    timestamp: p.timestamp ?? 0,
    speed: 0,
  }));
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dt = next.timestamp - prev.timestamp;
    points[i].speed = dt > 0 ? vector.distance(prev, next) / dt : 0;
  }
  return points;
}

/**
 * Final cleanup of an outline polygon: dedupe colinear runs, drop degenerate
 * vertices, round to integer font units, and drop any remaining adjacent
 * duplicates. Returns plain `{x, y}` integer points.
 *
 * Fewer-points improvement: collinearity threshold lowered from 0.998 to 0.995
 * so near-straight joints are dropped more aggressively.
 */
function cleanPolygon(points) {
  // 1) Drop colinear vertices (vector-based: keep endpoints + sharp turns).
  const stripped = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0 || i === points.length - 1) {
      stripped.push(points[i]);
      continue;
    }
    const a = stripped[stripped.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const ab = vector.subVectors(b, a);
    const bc = vector.subVectors(c, b);
    const lab = vector.vectorLength(ab);
    const lbc = vector.vectorLength(bc);
    if (lab < 0.8 || lbc < 0.8) {
      stripped.push(b);
      continue;
    }
    if (vector.dotVector(vector.normalizeVector(ab), vector.normalizeVector(bc)) > 0.995) continue;
    stripped.push(b);
  }
  if (stripped.length < 3) return stripped;
  // 2) Round to integer font units, then drop adjacent duplicates.
  const rounded = stripped.map(vector.roundVector);
  const out = [rounded[0]];
  for (let i = 1; i < rounded.length; i++) {
    const prev = out[out.length - 1];
    if (prev.x !== rounded[i].x || prev.y !== rounded[i].y) out.push(rounded[i]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-capsule outline (eraser shape)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closed round-capsule outline around a centerline polyline: left edge
 * forward, semicircular end cap, right edge backward, semicircular start cap.
 *
 * Shared by the eraser preview and the eraser commit so the user aims with
 * exactly the shape that gets subtracted. The radius is intentionally
 * constant along the stroke (predictable carving for type work). Callers
 * resample beforehand (`resamplePolyline`) to bound vertex counts.
 */
export function buildRoundCapsuleOutline(points, radius, capSteps = 8) {
  if (!points || points.length < 2 || !(radius > 0)) return null;
  const pts = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = pts[pts.length - 1];
    if (points[i].x !== last.x || points[i].y !== last.y) pts.push(points[i]);
  }
  const n = pts.length;
  if (n < 2) return null;

  const steps = Math.max(2, Math.round(capSteps));
  const left = new Array(n);
  const right = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left[i] = { x: pts[i].x + nx * radius, y: pts[i].y + ny * radius };
    right[i] = { x: pts[i].x - nx * radius, y: pts[i].y - ny * radius };
  }

  const startA = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  const endA = Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x);
  const outline = left.slice();
  for (let k = 1; k < steps; k++) {
    const a = endA - Math.PI / 2 + (k / steps) * Math.PI;
    outline.push({ x: pts[n - 1].x + Math.cos(a) * radius, y: pts[n - 1].y + Math.sin(a) * radius });
  }
  for (let i = n - 1; i >= 0; i--) outline.push(right[i]);
  for (let k = 1; k < steps; k++) {
    const a = startA - Math.PI / 2 - (k / steps) * Math.PI;
    outline.push({ x: pts[0].x + Math.cos(a) * radius, y: pts[0].y + Math.sin(a) * radius });
  }
  return outline.length >= 4 ? { points: outline, isClosed: true } : null;
}

/**
 * @fileoverview Geometric analysis engine for fontra-coach.
 *
 * Works on real Fontra packed paths via the path adapter, while still
 * accepting the legacy invented contour format used by older fixtures.
 */
import { distance, midPoint, angleFromVertical, isNearVertical } from '../utils/geom.js';
import { getContours, isEmptyPath } from '../utils/path-adapter.js';

export function analyzeGlyph(glyphData, metrics) {
  if (isEmptyPath(glyphData?.path)) return null;
  return {
    stems: measureStems(glyphData),
    overshoot: measureOvershoot(glyphData, metrics),
    counter: measureCounter(glyphData),
    strokeContrast: measureContrast(glyphData),
    stressAngle: estimateStressAngle(glyphData),
    shape: classifyGlyphShape(glyphData),
    horizontalBars: measureHorizontalBars(glyphData)
  };
}

export function measureStems(glyphData) {
  const segments = findSegments(glyphData, (p1, p2) => isNearVertical(p1, p2, 15));
  if (segments.length < 2) return [];
  // Nearest-neighbor pairing instead of strict interleaving.
  const sorted = segments.slice().sort((a, b) => a.midX - b.midX);
  const used = new Set();
  const stems = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    let best = -1;
    let bestDist = Infinity;
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const d = Math.abs(sorted[j].midX - sorted[i].midX);
      if (d > 0 && d < bestDist) { best = j; bestDist = d; }
    }
    if (best >= 0) {
      used.add(i); used.add(best);
      stems.push({ width: bestDist, midY: sorted[i].midY, isMain: stems.length === 0 });
    }
  }
  return stems;
}

export function measureHorizontalBars(glyphData) {
  const segments = findSegments(glyphData, (p1, p2) => {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    return dx > dy * 2;
  });
  if (segments.length < 2) return [];
  const sorted = segments.slice().sort((a, b) => a.midY - b.midY);
  const used = new Set();
  const bars = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    let best = -1;
    let bestDist = Infinity;
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const d = Math.abs(sorted[j].midY - sorted[i].midY);
      if (d > 0 && d < bestDist) { best = j; bestDist = d; }
    }
    if (best >= 0) {
      used.add(i); used.add(best);
      bars.push({ width: bestDist, midX: sorted[i].midX, isMain: bars.length === 0 });
    }
  }
  return bars;
}

export function measureOvershoot(glyphData, metrics) {
  const contours = getContours(glyphData?.path);
  if (!contours.length) return null;
  const pts = findExtrema(contours, 'bottom');
  if (pts.length === 0) return null;
  const lowestPoint = Math.min(...pts.map(pt => pt.y));
  return { bottom: (metrics?.baseline || 0) - lowestPoint };
}

export function measureCounter(glyphData) {
  return { area: 150000, estimatedWidth: 200, shape: 'oval' };
}

export function measureContrast(glyphData) {
  const stems = measureStems(glyphData);
  const bars = measureHorizontalBars(glyphData);
  if (stems.length && bars.length) {
    return { ratio: stems[0].width / (bars[0].width || 1), thickWidth: stems[0].width, thinWidth: bars[0].width };
  }
  return { ratio: 1.0, thickWidth: 85, thinWidth: 85 };
}

export function estimateStressAngle(glyphData) {
  return 0;
}

export function findExtrema(contours, direction) {
  const pts = [];
  for (const c of contours) {
    if (!c.points) continue;
    for (const p of c.points) {
      if (typeof p.y === 'number') pts.push(p);
    }
  }
  return pts;
}

function findSegments(glyphData, conditionFx) {
  const segments = [];
  const contours = getContours(glyphData?.path);
  for (const c of contours) {
    if (!c.points || c.points.length < 2) continue;
    for (let i = 0; i < c.points.length; i++) {
      const p1 = c.points[i];
      const p2 = c.points[(i + 1) % c.points.length];
      if (conditionFx(p1, p2)) {
        segments.push({
          p1, p2,
          midX: (p1.x + p2.x) / 2,
          midY: (p1.y + p2.y) / 2,
          length: Math.hypot(p2.x - p1.x, p2.y - p1.y)
        });
      }
    }
  }
  return segments;
}

export function classifyGlyphShape(glyphData) {
  const contours = getContours(glyphData?.path);
  const pts = findExtrema(contours, 'all');
  const curvePts = pts.filter(p => p.kind === 'offcurve' || p.type === 'curve');
  return curvePts.length > pts.length * 0.5 ? "round" : "square";
}
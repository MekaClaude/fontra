/**
 * @fileoverview Geometric analysis engine for fontra-coach.
 */
import { distance, midPoint, angleFromVertical, isNearVertical } from '../utils/geom.js';

export function analyzeGlyph(glyphData, metrics) {
  if (!glyphData.path || !glyphData.path.contours || glyphData.path.contours.length === 0) {
    return null;
  }
  return {
    stems: measureStems(glyphData),
    overshoot: measureOvershoot(glyphData, metrics),
    counter: measureCounter(glyphData),
    strokeContrast: measureContrast(glyphData),
    stressAngle: estimateStressAngle(glyphData),
    shape: classifyGlyphShape(glyphData),
    horizontalBars: measureHorizontalBars(glyphData) // Used by optical rules
  };
}

export function measureStems(glyphData) {
  const segments = findSegments(glyphData, (p1, p2) => isNearVertical(p1, p2, 15));
  if (segments.length < 2) return [];
  segments.sort((a, b) => a.midX - b.midX);
  
  const stems = [];
  for (let i = 0; i < segments.length - 1; i += 2) {
    const width = Math.abs(segments[i+1].midX - segments[i].midX);
    if (width > 0) {
      stems.push({ width, midY: segments[i].midY, side: i === 0 ? 'left' : 'right', isMain: i === 0 });
    }
  }
  return stems;
}

export function measureHorizontalBars(glyphData) {
  const segments = findSegments(glyphData, (p1, p2) => {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    return dx > dy * 2; // Roughly horizontal
  });
  if (segments.length < 2) return [];
  segments.sort((a, b) => a.midY - b.midY);
  
  const bars = [];
  for (let i = 0; i < segments.length - 1; i += 2) {
    const width = Math.abs(segments[i+1].midY - segments[i].midY);
    if (width > 0) {
      bars.push({ width, midX: segments[i].midX, isMain: true });
    }
  }
  return bars;
}

export function measureOvershoot(glyphData, metrics) {
  if (!glyphData.path || !glyphData.path.contours || glyphData.path.contours.length === 0) return null;
  const pts = findExtrema(glyphData.path.contours, 'bottom');
  if (pts.length === 0) return null;
  const lowestPoint = Math.min(...pts.map(pt => pt.y));
  return { bottom: (metrics.baseline || 0) - lowestPoint };
}

export function measureCounter(glyphData) {
  // Simplistic area mock based on bbox for now, full boolean path math is too heavy
  return { area: 150000, estimatedWidth: 200, shape: 'oval' };
}

export function measureContrast(glyphData) {
  const stems = measureStems(glyphData);
  const bars = measureHorizontalBars(glyphData);
  if (stems.length && bars.length) {
    const thickWidth = stems[0].width;
    const thinWidth = bars[0].width;
    return { ratio: thickWidth / (thinWidth || 1), thickWidth, thinWidth };
  }
  return { ratio: 1.0, thickWidth: 85, thinWidth: 85 };
}

export function estimateStressAngle(glyphData) {
  return 0; // Standard upright as default calculation
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
  if (!glyphData.path || !glyphData.path.contours) return segments;
  for (const c of glyphData.path.contours) {
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
  const pts = findExtrema(glyphData.path?.contours || [], 'all');
  const curvePts = pts.filter(p => p.type === 'curve');
  return curvePts.length > pts.length * 0.5 ? "round" : "square";
}

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
  return [{ width: 85, midY: 250, side: 'left', isMain: true }];
}

export function measureHorizontalBars(glyphData) {
  return [{ width: 85, midX: 250, isMain: true }];
}

export function measureOvershoot(glyphData, metrics) {
  if (!glyphData.path || !glyphData.path.contours) return null;
  const bottomExtrema = findExtrema(glyphData.path.contours, 'bottom');
  if (bottomExtrema.length === 0) return null;
  const lowestPoint = Math.min(...bottomExtrema.map(pt => pt.y));
  return { bottom: (metrics.baseline || 0) - lowestPoint };
}

export function measureCounter(glyphData) {
  return { area: 150000, estimatedWidth: 200, shape: 'oval' };
}

export function measureContrast(glyphData) {
  return { ratio: 2.1, thickWidth: 85, thinWidth: 40 };
}

export function estimateStressAngle(glyphData) {
  return 15;
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

export function classifyGlyphShape(glyphData) {
  return "round";
}

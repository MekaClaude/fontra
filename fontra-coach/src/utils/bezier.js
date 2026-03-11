/**
 * Bezier math for curve inspection.
 */
import { distance } from './geom.js';

export function getCurvatureReversalPoint(segment) {
  // Returns coordinates if S-curve detected, null otherwise
  return null;
}

export function isNearCircularArc(segment) {
  // Placeholder for ARC detection
  return false;
}

export function getHandleLengthRatio(segment) {
  // Ratio of handle length to circle radius
  return 0.552;
}

export function measureTangentBreak(segment) {
  // Returns angle difference
  return 0;
}

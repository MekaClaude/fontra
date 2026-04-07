/**
 * Shared state for Triangle Guardian plugin.
 *
 * This module provides a singleton-like state object that is shared
 * between the panel UI and the visualization layer. Changes to this
 * state trigger canvas updates and violation re-scans.
 *
 * @module triangle-guardian-state
 */

/** @type {TriangleGuardianState} */
export const state = {
  /** Whether the triangle guardian visualization is enabled */
  enabled: true,
  /** Show triangles for all segments regardless of selection */
  educationalMode: false,
  /** Highlight segments whose control points violate the triangle guideline */
  showAllSegments: false,
  /** Draw red markers on control points that fall outside the triangle */
  highlightViolations: true,
  /** Show "S" labels on S-curve segments */
  showSCurveLabels: true,
  /** Opacity of triangle fills (0.0 to 1.0) */
  triangleOpacity: 0.18,
};

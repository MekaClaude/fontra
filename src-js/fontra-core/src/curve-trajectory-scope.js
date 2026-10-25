import { SEVERITY_OK } from "./ideal-curve.js";

/**
 * Scope handling for the Curve Trajectory tool.
 *
 * The tool can show its overlay for the glyph that is being edited, for the
 * selected glyph, or for all glyphs in the text. The scope maps onto the
 * editor's glyph selection modes, so the overlay and the panel always agree
 * on which glyphs are in scope.
 */

export const CURVE_TRAJECTORY_SCOPES = ["editing", "selected", "all"];

export const SCOPE_SELECTION_MODES = {
  editing: "editing",
  selected: "selected",
  all: "all",
};

/**
 * Map a scope onto one of the editor's glyph selection modes.
 * Unknown scopes fall back to "editing".
 */
export function scopeToSelectionMode(scope) {
  return SCOPE_SELECTION_MODES[scope] || SCOPE_SELECTION_MODES.editing;
}

const SEVERITY_ORDER = { error: 0, warn: 1, ok: 2 };

/**
 * Order findings by severity, then by glyph, then by their place in the path,
 * so the list is stable and easy to scan.
 */
export function compareFindings(a, b) {
  const orderA = SEVERITY_ORDER[a.severity] ?? 3;
  const orderB = SEVERITY_ORDER[b.severity] ?? 3;
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  if (a.glyphName !== b.glyphName) {
    return a.glyphName < b.glyphName ? -1 : 1;
  }
  const contourA = a.segment?.contourIndex ?? 0;
  const contourB = b.segment?.contourIndex ?? 0;
  if (contourA !== contourB) {
    return contourA - contourB;
  }
  const segmentA = a.segment?.segmentIndex ?? 0;
  const segmentB = b.segment?.segmentIndex ?? 0;
  return segmentA - segmentB;
}

/**
 * Aggregate the analyses of the glyphs in scope into a single findings list,
 * plus the counts that the panel's summary shows.
 *
 * `glyphAnalyses` is a list of `{ glyphName, analysis }` objects, where
 * `analysis` is the result of `analyzePath()` — or null for a glyph that has
 * no path to analyse.
 */
export function aggregateScopeFindings(glyphAnalyses) {
  const findings = [];
  let glyphCount = 0;
  let curveCount = 0;
  let offCount = 0;

  for (const { glyphName, analysis } of glyphAnalyses) {
    if (!analysis) {
      continue;
    }
    glyphCount++;

    for (const segment of analysis.segments) {
      if (!segment.analysis || segment.analysis.degenerate) {
        continue;
      }
      curveCount++;
      if (segment.analysis.severity !== SEVERITY_OK) {
        offCount++;
      }
    }

    for (const issue of analysis.issues) {
      findings.push({ ...issue, glyphName });
    }
  }

  findings.sort(compareFindings);

  return { findings, glyphCount, curveCount, offCount };
}

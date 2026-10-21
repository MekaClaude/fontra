// commonform-state.js
//
// The small shared store that the sidebar panel and the canvas layer agree on.
//
// It is a plain object, for the same reason the reference "triangle-guardian"
// plugin uses a plain object: plugins are loaded at *runtime* with a native
// dynamic import (see editor.js#initPlugins), so Fontra's internal
// `@fontra/...` path aliases — which only the bundler resolves — cannot be
// imported from here. Relative imports between files inside this plugin's own
// folder work fine, because the browser resolves them against this file's own
// URL.
//
// The panel writes to it, the layer reads from it, and the engine knows
// nothing about it.

import {
  DEFAULT_NEAR_FACTOR,
  DEFAULT_NEAR_FLOOR,
  DEFAULT_TOLERANCE_FACTOR,
  DEFAULT_TOLERANCE_FLOOR,
} from "./commonform-engine.js";

export const state = {
  // Set by start.js
  pluginPath: null,

  // --- the query -----------------------------------------------------------
  // The shape the designer picked: { ok, contours, glyphName, source, layerName }
  query: null,
  // Why there is no query (a human-readable sentence).
  queryError: null,

  // --- the search ----------------------------------------------------------
  isSearching: false,
  progress: { done: 0, total: 0 },
  // The matches of the last search, best first. Each one is
  //   { glyphName, contourIndex, distance, rms, tier, mirrored, orientation,
  //     sameNodes, sameSize }
  matches: [],
  // The summary of the last search — see `summarizeMatches()` in the engine.
  summary: null,

  // --- settings ------------------------------------------------------------
  // The "same shape" threshold: max(toleranceFloor, size * toleranceFactor),
  // in font units. The default is 2 units, or 0.2 % of the shape's size.
  toleranceFloor: DEFAULT_TOLERANCE_FLOOR,
  toleranceFactor: DEFAULT_TOLERANCE_FACTOR,
  // The "worth reporting" threshold — the band between "the same" and
  // "not the same, but look at it anyway".
  nearFloor: DEFAULT_NEAR_FLOOR,
  nearFactor: DEFAULT_NEAR_FACTOR,
  // "The same shape, drawn bigger" counts as the same shape.
  scaleInvariant: true,
  // The bowl of b against the bowl of d.
  allowMirrored: true,

  // --- what the canvas layer draws ----------------------------------------
  showIdentical: true,
  showSame: true,
  showNear: true,
};

/**
 * Forget the last search.
 *
 * Called when the selection changes, so that a stale result is never shown
 * next to a different query.
 */
export function clearSearch() {
  state.matches = [];
  state.summary = null;
  state.progress = { done: 0, total: 0 };
}

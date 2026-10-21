// commonform-state.js
//
// The shared store that the sidebar panel and the canvas layer agree on.
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
//
// The object is backed by the tiny observable store below, so the settings
// the user can change are remembered between sessions. The runtime state
// (the query, the matches of the last search) is not persisted.
//
// `SimpleObservable` is deliberately duplicated from the Cadence Spacer
// plugin rather than shared between the two: each plugin folder has to stay
// self-contained, so that it can be dropped into a Fontra Pak's `localplugins`
// directory on its own.

import {
  DEFAULT_NEAR_FACTOR,
  DEFAULT_NEAR_FLOOR,
  DEFAULT_TOLERANCE_FACTOR,
  DEFAULT_TOLERANCE_FLOOR,
} from "./commonform-engine.js";

/**
 * A tiny reactive key/value store.
 *
 * Why not import Fontra's own `ObservableController`
 * (`@fontra/core/observable-object.ts`)? Because this plugin is loaded at
 * *runtime* via a plain `import()` of a URL (see editor.js#initPlugins),
 * not bundled by the app's build step. Fontra's internal `@fontra/...`
 * path aliases are only resolved by the bundler, so a dynamically loaded
 * plugin module cannot reliably `import` them.
 *
 * This class gives us the same practical features we need from
 * ObservableController: a reactive model, key listeners, and localStorage
 * persistence, without depending on any Fontra internals.
 */
export class SimpleObservable {
  constructor(initialModel = {}) {
    this._listeners = new Map(); // key -> Set<fn>
    this._anyListeners = new Set();
    const self = this;
    this.model = new Proxy(
      { ...initialModel },
      {
        set(target, prop, value) {
          const oldValue = target[prop];
          target[prop] = value;
          if (oldValue !== value) {
            self._notify(prop, oldValue, value);
          }
          return true;
        },
      }
    );
  }

  addKeyListener(key, fn) {
    const keys = Array.isArray(key) ? key : [key];
    const unsubs = keys.map((k) => {
      if (!this._listeners.has(k)) {
        this._listeners.set(k, new Set());
      }
      const set = this._listeners.get(k);
      set.add(fn);
      return () => set.delete(fn);
    });
    return () => unsubs.forEach((u) => u());
  }

  addAnyListener(fn) {
    this._anyListeners.add(fn);
    return () => this._anyListeners.delete(fn);
  }

  setItem(key, value) {
    // Explicit setter. This mirrors the *shape* of Fontra's own
    // ObservableController.setItem(key, newValue, senderInfo?) — but note
    // that Fontra's version emits a `senderInfo` argument and uses a
    // completely different change-broadcast mechanism, so this is a local
    // API, not a drop-in replacement.
    this.model[key] = value;
  }

  _notify(key, oldValue, newValue) {
    const event = { key, oldValue, newValue };
    this._listeners.get(key)?.forEach((fn) => fn(event));
    this._anyListeners.forEach((fn) => fn(event));
  }

  // Persist a *subset* of keys to localStorage, and load them back
  // immediately. Call once, right after construction.
  //
  // NOTE: this is a *local* API and deliberately NOT shaped like Fontra's
  // `ObservableController.synchronizeWithLocalStorage(prefix, readItems)`,
  // which synchronizes an entire model under a *prefix* and uses the
  // storage key `<prefix><modelKey>`
  // (src-js/fontra-core/src/observable-object.ts:107-113, :247-263).
  // The name below says "keys" to make the difference explicit.
  synchronizeKeysWithLocalStorage(storageKey, keys) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const k of keys) {
          if (k in saved) {
            this.model[k] = saved[k];
          }
        }
      }
    } catch (e) {
      console.warn("[Commonform] could not load saved settings:", e);
    }
    // Only a change to a persisted key writes to localStorage. The model also
    // carries runtime state that changes often (the matches of the last
    // search), and that must not cause a write per change.
    const save = () => {
      try {
        const toSave = {};
        for (const k of keys) {
          toSave[k] = this.model[k];
        }
        localStorage.setItem(storageKey, JSON.stringify(toSave));
      } catch (e) {
        // localStorage may be unavailable (private browsing, quota, etc).
        // Not fatal: the plugin just won't remember settings.
      }
    };
    for (const k of keys) {
      this.addKeyListener(k, save);
    }
    return save;
  }
}

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

// The settings the user can change are remembered between sessions; the
// runtime state is not.
export const PERSISTED_KEYS = [
  "toleranceFloor",
  "toleranceFactor",
  "nearFloor",
  "nearFactor",
  "scaleInvariant",
  "allowMirrored",
  "showIdentical",
  "showSame",
  "showNear",
];

export const settings = new SimpleObservable({
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
});

settings.synchronizeKeysWithLocalStorage("fontra.commonform.settings", PERSISTED_KEYS);

// `state` *is* the settings model, plus the runtime bits. Reading or writing
// `state.toleranceFloor` therefore reads or writes the persisted value, and
// the panel and the layer keep talking to `state` exactly as before.
export const state = settings.model;

// Set by start.js
state.pluginPath = null;

// --- the query -----------------------------------------------------------
// The shape the designer picked: { ok, contours, glyphName, source, layerName }
state.query = null;
// Why there is no query (a human-readable sentence).
state.queryError = null;

// --- the search ----------------------------------------------------------
state.isSearching = false;
state.progress = { done: 0, total: 0 };
// The matches of the last search, best first. Each one is
//   { glyphName, contourIndex, distance, rms, tier, mirrored, orientation,
//     sameNodes, sameSize }
state.matches = [];
// The summary of the last search — see `summarizeMatches()` in the engine.
state.summary = null;

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

// cadence-state.js
//
// Two things live here:
//
// 1. `state` — a small plain object shared between the sidebar panel and the
//    canvas layer (the same trick the reference "triangle-guardian" plugin
//    uses with its own `triangle-guardian-state.js`).
// 2. `SimpleObservable` — a tiny reactive key/value store.
//
// Why not import Fontra's own `ObservableController`
// (`@fontra/core/observable-object.ts`)? Because this plugin is loaded at
// *runtime* via a plain `import()` of a URL (see editor.js#initPlugins),
// not bundled by the app's build step. Fontra's internal `@fontra/...`
// path aliases are only resolved by the bundler, so a dynamically loaded
// plugin module cannot reliably `import` them (this mirrors what the
// bundled `triangle-guardian` example plugin does: it avoids importing
// any Fontra-internal module and only uses what is handed to it via the
// `editor` object). Relative imports between files that live *inside
// this plugin's own folder* work fine, because those are resolved by the
// browser against start.js's own URL, not through the bundler.
//
// This class gives us the same practical features we need from
// ObservableController: reactive model, key listeners, and
// localStorage persistence, without depending on any Fontra internals.

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
      console.warn("[cadence-spacer] could not load saved settings:", e);
    }
    this.addAnyListener(() => {
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
    });
  }
}

// ---------------------------------------------------------------------------
// Shared runtime state (panel <-> canvas layer)
// ---------------------------------------------------------------------------

export const state = {
  // Set by start.js
  pluginPath: null,

  // Layer on/off + what the layer draws
  enabled: true,
  showBeam: true,
  showCrossings: true,
  showSidebearings: true,
  showDesired: false,

  // Measurement settings (mirrored into the panel's controls)
  beamY: 200,
  gridSteps: 32,
  refGlyphName: "n",

  // Last dry-run result, keyed by glyph name:
  //   { currentLeft, currentRight, desiredLeft, desiredRight }
  // The canvas layer uses this to draw the "desired" sidebearing markers.
  plans: new Map(),
};

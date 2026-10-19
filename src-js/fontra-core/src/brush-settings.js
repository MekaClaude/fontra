/**
 * brush-settings — single source of truth for every brush-related default,
 * bound, and preset. The engine, the tool layer, and the sidebar panel all
 * import from here. Adding a knob in one file used to require three edits;
 * now it requires one.
 *
 * Schema:
 *  BRUSH_BOUNDS          per-engine-field [min, max] used by BrushEngine._normalizeOptions
 *  BRUSH_TOOL_BOUNDS     per-tool-field [min, max] used by BrushToolBase.updateSettings
 *  BRUSH_PRESETS         user-facing (label, minWidth, maxWidth) presets
 *  DEFAULT_OPTIONS       engine field defaults (constructor / updateOptions fallback)
 *  DEFAULT_BRUSH_SETTINGS combined defaults (engine + tool) for the panel
 *  BRUSH_SHARED_DEFAULTS alias of DEFAULT_BRUSH_SETTINGS (legacy import name)
 *
 * Invariant: every numeric default sits inside its bound, and minWidth < maxWidth
 * for every preset.
 */

export const BRUSH_BOUNDS = {
  brushAngle: [-90, 90],
  minWidth: [1, 200],
  maxWidth: [2, 400],
  contrast: [0, 1],
  smoothness: [0, 1],
  taper: [0, 0.4],
  usePressure: [0, 1],
};

/** Bounds the engine does not own: tool-level fields (storage, sliders, dispatch). */
export const BRUSH_TOOL_BOUNDS = {
  simplify: [0, 1],
  usePressure: [0, 1],
  autoUnion: [0, 1],
  eraserWidth: [8, 120],
  sculptRadius: [10, 150],
  sculptStrength: [0.05, 1],
};

/** Engine defaults — used by the constructor and as the NaN fallback. */
export const DEFAULT_OPTIONS = {
  brushAngle: 30,
  minWidth: 18,
  maxWidth: 120,
  contrast: 0.75,
  smoothness: 0.65,
  taper: 0.12,
  usePressure: 1,
};

/** Type-design size presets shared by the panel and the tests. */
export const BRUSH_PRESETS = [
  { label: "Hairline", minWidth: 8, maxWidth: 24 },
  { label: "Text", minWidth: 18, maxWidth: 96 },
  { label: "Display", minWidth: 24, maxWidth: 160 },
  { label: "Poster", minWidth: 32, maxWidth: 260 },
];

/**
 * Combined defaults — every value used by the engine or any tool. The panel
 * seeds itself with this; the tools seed only the slice they own.
 *
 * simplify raised to 0.6 (from 0.5) to honour the "fewer vector points"
 * constraint: more aggressive Douglas-Peucker simplification by default.
 */
export const DEFAULT_BRUSH_SETTINGS = {
  ...DEFAULT_OPTIONS,
  simplify: 0.6,
  autoUnion: 0,
  eraserWidth: 32,
  sculptRadius: 50,
  sculptStrength: 0.5,
};

/** Legacy name retained for one release; the panel and tools use this alias. */
export const BRUSH_SHARED_DEFAULTS = DEFAULT_BRUSH_SETTINGS;

/**
 * Brush mode identifiers — single source of truth. The tools, the panel,
 * and the mode→tool registry all use these; brush-tool-base.js re-exports
 * them for backward compatibility.
 */
export const BRUSH_MODES = {
  CALLIGRAPHIC: "calligraphic",
  STRAIGHT: "straight",
  SCULPT: "sculpt",
  ERASER: "eraser",
};

export const BRUSH_MODE_TO_TOOL_ID = {
  [BRUSH_MODES.CALLIGRAPHIC]: "brush-tool-calligraphic",
  [BRUSH_MODES.STRAIGHT]: "brush-tool-straight",
  [BRUSH_MODES.SCULPT]: "brush-tool-sculpt",
  [BRUSH_MODES.ERASER]: "brush-tool-eraser",
};

/**
 * Settings that are engine-owned vs tool-owned. Used by the panel and tools
 * to know which set of bounds to apply and where to persist.
 */
export const ENGINE_SETTINGS = new Set(Object.keys(DEFAULT_OPTIONS));
export const TOOL_SETTINGS = new Set(Object.keys(BRUSH_TOOL_BOUNDS));

/** Float-typed settings; used by the panel for slider step + value formatting. */
export const FLOAT_SETTINGS = new Set([
  "contrast", "smoothness", "taper", "simplify", "sculptStrength",
]);

/**
 * Clamp a value to its bound. Single source of truth for "is this in range".
 * Returns the default if `value` is not a finite number.
 */
export function clampSetting(field, value, defaults = DEFAULT_BRUSH_SETTINGS) {
  const bound = BRUSH_BOUNDS[field] || BRUSH_TOOL_BOUNDS[field];
  const fallback = defaults[field];
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  if (!bound) return v;
  return Math.min(bound[1], Math.max(bound[0], v));
}

// ─────────────────────────────────────────────────────────────────────────────
// BrushSettingsStore — one canonical settings object per storage prefix.
//
// Replaces the old per-tool makeBrushStorage load/save pairs: values are
// loaded once (primary prefix → fallbacks → legacy prefix → defaults),
// cached in memory, clamped on write, persisted to localStorage, and
// broadcast via a "change" event so tools and the sidebar panel stay in sync
// without duck-typing or polling. Per-mode memory is preserved: each mode
// owns its prefix ("fontra.brush-v2.calligraphic.", …), so switching modes
// still restores that mode's values.
// ─────────────────────────────────────────────────────────────────────────────

/** Legacy v1 prefix — read-only fallback so existing settings keep working. */
export const LEGACY_BRUSH_PREFIX = "fontra.brush.";

function defaultSettingsBackend() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {
    /* storage access blocked — memory only */
  }
  return null;
}

export class BrushSettingsStore extends EventTarget {
  constructor({ prefix, fallbacks = [], defaults = DEFAULT_BRUSH_SETTINGS, backend } = {}) {
    super();
    if (!prefix) throw new Error("BrushSettingsStore requires a storage prefix");
    this.prefix = prefix;
    this._fallbacks = [...fallbacks.filter((p) => p && p !== prefix && p !== LEGACY_BRUSH_PREFIX), LEGACY_BRUSH_PREFIX];
    this._defaults = { ...defaults };
    this._backend = backend === undefined ? defaultSettingsBackend() : backend;
    this._values = {};
    this.reload();
  }

  /** Per-prefix singletons (default backend): tools and panel share one object. */
  static for(prefix, options = {}) {
    BrushSettingsStore._registry ??= new Map();
    const key = prefix;
    let store = BrushSettingsStore._registry.get(key);
    if (!store) {
      store = new BrushSettingsStore({ ...options, prefix });
      BrushSettingsStore._registry.set(key, store);
    }
    return store;
  }

  /** Re-read every known key from the backend (cross-tab storage events). */
  reload() {
    const changed = [];
    for (const key of Object.keys(this._defaults)) {
      const next = this._readKey(key);
      if (!Object.is(this._values[key], next)) {
        this._values[key] = next;
        changed.push(key);
      }
    }
    if (changed.length) this._emit(changed);
    return changed;
  }

  get(key) {
    return key in this._values ? this._values[key] : this._defaults[key];
  }

  /** Snapshot of all known keys (panel render cache, tool seeding). */
  getAll() {
    return { ...this._defaults, ...this._values };
  }

  /**
   * Clamp + persist + broadcast. Unknown keys are ignored (never written).
   * Synchronous: subscribers see the new values before set() returns.
   * Returns the list of keys that actually changed.
   */
  set(patch) {
    const changed = [];
    for (const key of Object.keys(patch)) {
      if (!(key in this._defaults)) continue;
      const next = clampSetting(key, patch[key], this._defaults);
      if (!Object.is(this._values[key], next)) {
        this._values[key] = next;
        try {
          this._backend?.setItem(this.prefix + key, String(next));
        } catch {
          /* quota etc. — in-memory value still wins */
        }
        changed.push(key);
      }
    }
    if (changed.length) this._emit(changed);
    return changed;
  }

  _readKey(key) {
    const fallback = this._defaults[key];
    if (!this._backend) return fallback;
    try {
      for (const p of [this.prefix, ...this._fallbacks]) {
        const raw = this._backend.getItem(p + key);
        if (raw === null || raw === undefined) continue;
        const num = Number(raw);
        if (!Number.isNaN(num)) return clampSetting(key, num, this._defaults);
      }
    } catch {
      /* storage blocked mid-read — fall through to default */
    }
    return fallback;
  }

  _emit(keys) {
    const values = {};
    for (const key of keys) values[key] = this._values[key];
    this.dispatchEvent(new CustomEvent("change", { detail: { keys, values } }));
  }
}

/** Reload every singleton store (call on window "storage" events). */
export function reloadBrushSettingsStores() {
  for (const store of BrushSettingsStore._registry?.values() ?? []) store.reload();
}

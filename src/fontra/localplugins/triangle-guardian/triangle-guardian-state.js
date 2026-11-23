// Shared runtime state for the Triangle Guardian plugin.
//
// The user-facing settings are persisted to localStorage so they survive a
// reload (mirroring what cadence-spacer does with SimpleObservable, but kept
// as a plain object + Proxy so the rest of the plugin can keep using
// `state.x = ...` / `state.x` unchanged).

const STORAGE_KEY = "fontra.triangle-guardian.settings";
const PERSISTED_KEYS = [
  "enabled",
  "educationalMode",
  "showAllSegments",
  "highlightViolations",
  "showSCurveLabels",
  "triangleOpacity",
];

const DEFAULTS = {
  enabled: true,
  educationalMode: false,
  showAllSegments: false,
  highlightViolations: true,
  showSCurveLabels: true,
  triangleOpacity: 0.18,
};

function loadPersisted() {
  const model = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const key of PERSISTED_KEYS) {
        if (key in saved && saved[key] !== undefined) {
          model[key] = saved[key];
        }
      }
    }
  } catch (error) {
    // Storage unavailable or corrupted: fall back to defaults.
  }
  return model;
}

const model = loadPersisted();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const toSave = {};
      for (const key of PERSISTED_KEYS) {
        toSave[key] = model[key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (error) {
      // Storage unavailable (private mode, quota): ignore.
    }
  }, 0);
}

export const state = new Proxy(model, {
  get(target, prop) {
    return target[prop];
  },
  set(target, prop, value) {
    target[prop] = value;
    if (PERSISTED_KEYS.includes(prop)) {
      scheduleSave();
    }
    return true;
  },
});

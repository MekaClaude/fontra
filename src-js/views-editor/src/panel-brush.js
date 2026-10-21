/**
 * panel-brush — right-sidebar Brush Settings panel.
 *
 * Owns mode selection (Calligraphic / Straight / Sculpt / Eraser) and every
 * brush parameter. The panel stays in sync with the currently selected brush
 * tool; if a non-brush tool is active, slider changes are still persisted for
 * the next brush use.
 *
 * v3 changes vs. the original implementation:
 *   - Single source of truth: defaults + bounds + presets come from
 *     brush-settings.js, not from this file.
 *   - Element references are cached in _render() so the slider handlers
 *     don't query the DOM on every input event.
 *   - The old monkey-patch of `sceneController.setSelectedTool` is replaced
 *     by an explicit tool-change listener registered via the editor.
 *   - Settings flow through BrushSettingsStore. The panel subscribes to
 *     the active tool's store (change events re-render from clamped values);
 *     with no brush tool active, writes go to the shared store for the next
 *     activation. No more unclamped shadow copies.
 */
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import Panel from "./panel.js";
import { BRUSH_BOUNDS, BRUSH_PRESETS, DEFAULT_BRUSH_SETTINGS, BrushSettingsStore, reloadBrushSettingsStores } from "@fontra/core/brush-settings.js";
import { BRUSH_TOOL_BOUNDS, BRUSH_MODES, BRUSH_MODE_TO_TOOL_ID } from "./brush-tool-base.js";
import { drawBrushPreview } from "@fontra/core/brush-preview.js";

const DEFAULT_MODE = BRUSH_MODES.CALLIGRAPHIC;

const MODE_LABELS = [
  { id: BRUSH_MODES.CALLIGRAPHIC, key: "sidebar.brush-settings.mode.calligraphic" },
  { id: BRUSH_MODES.STRAIGHT,     key: "sidebar.brush-settings.mode.straight" },
  { id: BRUSH_MODES.SCULPT,       key: "sidebar.brush-settings.mode.sculpt" },
  { id: BRUSH_MODES.ERASER,       key: "sidebar.brush-settings.mode.eraser" },
];

const FLOAT_KEYS = new Set([
  "contrast", "smoothness", "taper", "simplify", "sculptStrength",
]);

const STYLES = `
  .brush-panel { display: flex; flex-direction: column; gap: 0.8em; padding: 0.8em; }
  .brush-panel-header { font-size: 0.9em; font-weight: 600; color: var(--ui-element-foreground-color); margin-bottom: 0.2em; }
  .brush-panel-section { display: flex; flex-direction: column; gap: 0.5em; }
  .brush-panel-label { font-size: 0.8em; color: var(--ui-element-foreground-color); opacity: 0.8; min-width: 60px; user-select: none; }
  .brush-panel-value { font-size: 0.8em; color: var(--ui-element-foreground-color); min-width: 40px; text-align: right; font-feature-settings: "tnum"; }
  .brush-mode-selector { display: flex; gap: 2px; background: var(--segmented-bg, rgba(255, 255, 255, 0.06)); border: 1px solid var(--segmented-border, rgba(255, 255, 255, 0.1)); border-radius: 6px; padding: 2px; }
  .brush-mode-btn { flex: 1; padding: 6px 8px; border: none; border-radius: 4px; background: transparent; color: var(--ui-element-foreground-color); font-family: "fontra-ui-regular", sans-serif; font-size: 0.75em; cursor: pointer; transition: background 150ms, box-shadow 150ms; outline: none; }
  .brush-mode-btn:hover { background: var(--segmented-active-bg, rgba(255, 255, 255, 0.12)); }
  .brush-mode-btn.is-active { background: var(--segmented-active-bg, rgba(255, 255, 255, 0.12)); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06); font-weight: 700; }
  .brush-slider { display: flex; align-items: center; gap: 6px; width: 100%; }
  .brush-slider input[type="range"] { flex: 1; height: 4px; -webkit-appearance: none; appearance: none; background: var(--slider-track-color, #555); border-radius: 2px; outline: none; }
  .brush-slider input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; background: var(--foreground-color, #ddd); border: 2px solid var(--fontra-red-color, #f11759); border-radius: 50%; cursor: grab; }
  .brush-slider input[type="range"]::-webkit-slider-thumb:active { cursor: grabbing; }
  .brush-preview { width: 100%; height: 60px; background: var(--text-input-background-color, #1a1a1a); border-radius: 4px; border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.08)); overflow: hidden; }
  .brush-divider { height: 1px; background: var(--glass-border, rgba(255, 255, 255, 0.08)); margin: 0.2em 0; }
  :host(.light-theme) .brush-mode-selector, .light-theme .brush-mode-selector { background: var(--segmented-bg, rgba(0, 0, 0, 0.04)); border-color: var(--segmented-border, rgba(0, 0, 0, 0.1)); }
  .brush-panel-hint { font-size: 0.7em; color: var(--ui-element-foreground-color); opacity: 0.6; margin-top: 0.2em; font-style: italic; }
`;

export default class BrushPanel extends Panel {
  identifier = "brush-settings";
  iconPath = "/images/brush.svg";
  static styles = STYLES;

  constructor(editorController) {
    super(editorController);
    this.sceneController = this.editorController.sceneController;
    this._currentMode = DEFAULT_MODE;
    this._brushSettings = { ...this._defaults() };
    // Shared-prefix store (same object sculpt + eraser use). Always
    // subscribed; the active tool's own store is subscribed on top while
    // that tool is selected (see _syncFromTool).
    this._sharedStore = BrushSettingsStore.for("fontra.brush-v2.");
    this._toolStore = null;
    this._toolChangeListener = this.editorController.registerToolChangeListener(() => this._syncFromTool());
    this._onStoreChange = (e) => {
      // With no brush tool active the panel copy is the UI truth: fold the
      // clamped write into it (with a tool active _syncFromTool pulls
      // tool.settings instead).
      if (!this._activeBrushTool() && e?.detail?.values) {
        this._brushSettings = { ...this._brushSettings, ...e.detail.values };
      }
      this._syncFromTool();
    };
    this._sharedStore.addEventListener("change", this._onStoreChange);
    this._installStorageListener();
    // Defer the first sync until after super() so any panel base initialization runs first.
    queueMicrotask(() => this._syncFromTool());
  }

  _defaults() {
    // Single source of truth lives in brush-settings.js; no literals here.
    return { ...DEFAULT_BRUSH_SETTINGS };
  }

  // ── Sync plumbing ──────────────────────────────────────────────────────────

  _installStorageListener() {
    this._onStorage = (e) => {
      if (!e.key?.startsWith("fontra.brush")) return;
      // Cross-tab write: pull into the singleton stores first so tool
      // snapshots (and the change events below) see the new values.
      reloadBrushSettingsStores();
      this._syncFromTool();
    };
    window.addEventListener("storage", this._onStorage);
  }

  disconnectedCallback() {
    this._toolChangeListener?.();
    this._sharedStore?.removeEventListener("change", this._onStoreChange);
    this._toolStore?.removeEventListener("change", this._onStoreChange);
    this._toolStore = null;
    window.removeEventListener("storage", this._onStorage);
    super.disconnectedCallback?.();
  }

  /** Duck-typed "is this a brush tool with editable settings?" */
  _activeBrushTool() {
    const t = this.sceneController.selectedTool;
    return t?.brushMode && t.updateSettings ? t : null;
  }

  _syncFromTool() {
    const tool = this._activeBrushTool();
    // Follow the active tool's store so slider moves (which write through
    // the store) re-render the panel from clamped values. The shared store
    // is permanently subscribed (sculpt/eraser use it), so only track
    // non-shared stores here — sharing one registration would break
    // unsubscribe on tool switch (EventTarget dedupes identical listeners).
    const store = tool?._store && tool._store !== this._sharedStore ? tool._store : null;
    if (store !== this._toolStore) {
      this._toolStore?.removeEventListener("change", this._onStoreChange);
      this._toolStore = store;
      this._toolStore?.addEventListener("change", this._onStoreChange);
    }
    if (tool) {
      this._brushSettings = { ...this._brushSettings, ...tool.settings };
      this._currentMode = tool.brushMode || DEFAULT_MODE;
    } else if (this.sceneController.selectedTool?.brushMode) {
      this._currentMode = this.sceneController.selectedTool.brushMode;
    }
    this._render();
  }

  // ── DOM ────────────────────────────────────────────────────────────────────

  getContentElement() {
    // Panel's constructor calls this *before* our own constructor body runs, so
    // the class fields below do not exist yet. Seed them from the same defaults
    // the constructor would use; the constructor then re-assigns identical
    // values, so this is idempotent. Without this the builders below read
    // undefined and the panel renders empty.
    if (!this._currentMode) {
      this._currentMode = DEFAULT_MODE;
    }
    if (!this._brushSettings) {
      this._brushSettings = { ...this._defaults() };
    }
    return html.div({ class: "panel" }, [
      html.div({ class: "panel-section panel-section--flex" }, [
        html.div({ class: "brush-panel" }, [
          html.div({ class: "brush-panel-header" }, [translate("sidebar.brush-settings.title")]),
          this._createModeSelector(),
          html.div({ class: "brush-divider" }),
          this._createSizeSection(),
          html.div({ class: "brush-divider" }),
          this._createAngleSection(),
          html.div({ class: "brush-divider" }),
          this._createAdvancedSection(),
          html.div({ class: "brush-divider" }),
          this._createEraserSection(),
          html.div({ class: "brush-divider" }),
          this._createSculptSection(),
          html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.preview")]),
          html.createDomElement("canvas", { class: "brush-preview", id: "brush-preview-canvas", width: 200, height: 60 }),
        ]),
      ]),
    ]);
  }

  _createModeSelector() {
    const cur = this._currentMode;
    const buttons = MODE_LABELS.map((m) =>
      html.button(
        {
          class: `brush-mode-btn ${m.id === cur ? "is-active" : ""}`,
          "data-mode": m.id,
          onclick: () => this._setMode(m.id),
        },
        [translate(m.key)]
      )
    );
    this._modeContainer = html.div({ class: "brush-mode-selector" }, buttons);
    return this._modeContainer;
  }

  _createSizeSection() {
    return html.div({ class: "brush-panel-section", id: "brush-size-section" }, [
      html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.size")]),
      this._createSlider("maxWidth", translate("sidebar.brush-settings.max-width"),
                         BRUSH_BOUNDS.maxWidth[0], BRUSH_BOUNDS.maxWidth[1], this._brushSettings.maxWidth),
      html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.contrast-range")]),
      this._createSlider("minWidth", translate("sidebar.brush-settings.min-width"),
                         BRUSH_BOUNDS.minWidth[0], BRUSH_BOUNDS.minWidth[1], this._brushSettings.minWidth),
      html.div({ class: "brush-panel-section" }, [
        html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.presets")]),
        this._createPresets(),
      ]),
    ]);
  }

  _createPresets() {
    const buttons = BRUSH_PRESETS.map((preset) =>
      html.button(
        {
          class: "brush-mode-btn",
          onclick: () => {
            this._applySetting("maxWidth", preset.maxWidth);
            this._applySetting("minWidth", preset.minWidth);
            this._render();
          },
        },
        [preset.label]
      )
    );
    return html.div({ class: "brush-mode-selector" }, buttons);
  }

  _createAngleSection() {
    return html.div({ class: "brush-panel-section", id: "brush-angle-section" }, [
      html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.angle")]),
      this._createSlider("brushAngle", translate("sidebar.brush-settings.brush-angle"),
                         BRUSH_BOUNDS.brushAngle[0], BRUSH_BOUNDS.brushAngle[1], this._brushSettings.brushAngle),
    ]);
  }

  _createAdvancedSection() {
    return html.div({ class: "brush-panel-section", id: "brush-advanced-section" }, [
      html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.advanced")]),
      this._createSlider("contrast",   translate("sidebar.brush-settings.contrast"),   BRUSH_BOUNDS.contrast[0],   BRUSH_BOUNDS.contrast[1],   this._brushSettings.contrast),
      this._createSlider("smoothness", translate("sidebar.brush-settings.smoothness"), BRUSH_BOUNDS.smoothness[0], BRUSH_BOUNDS.smoothness[1], this._brushSettings.smoothness),
      this._createSlider("taper",      translate("sidebar.brush-settings.taper"),      BRUSH_BOUNDS.taper[0],      BRUSH_BOUNDS.taper[1],      this._brushSettings.taper),
      this._createSlider("simplify",   translate("sidebar.brush-settings.simplify"),   BRUSH_TOOL_BOUNDS.simplify[0], BRUSH_TOOL_BOUNDS.simplify[1], this._brushSettings.simplify),
      html.div({ class: "brush-divider" }),
      this._createPressureToggle(),
      this._createUnionToggle(),
    ]);
  }

  _createPressureToggle() {
    return this._createToggle("brush-pressure-toggle", "sidebar.brush-settings.pressure", "usePressure", this._brushSettings.usePressure);
  }

  _createUnionToggle() {
    return this._createToggle("brush-union-toggle", "sidebar.brush-settings.union", "autoUnion", this._brushSettings.autoUnion);
  }

  _createEraserSection() {
    return html.div({ class: "brush-panel-section", id: "eraser-section" }, [
      html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.eraser")]),
      this._createSlider("eraserWidth", translate("sidebar.brush-settings.eraser-width"),
                         BRUSH_TOOL_BOUNDS.eraserWidth[0], BRUSH_TOOL_BOUNDS.eraserWidth[1], this._brushSettings.eraserWidth),
    ]);
  }

  _createSculptSection() {
    return html.div({ class: "brush-panel-section", id: "sculpt-section" }, [
      html.div({ class: "brush-panel-label" }, [translate("sidebar.brush-settings.sculpt")]),
      this._createSlider("sculptRadius",   translate("sidebar.brush-settings.sculpt-radius"),
                         BRUSH_TOOL_BOUNDS.sculptRadius[0], BRUSH_TOOL_BOUNDS.sculptRadius[1], this._brushSettings.sculptRadius),
      this._createSlider("sculptStrength", translate("sidebar.brush-settings.sculpt-strength"),
                         BRUSH_TOOL_BOUNDS.sculptStrength[0], BRUSH_TOOL_BOUNDS.sculptStrength[1], this._brushSettings.sculptStrength),
    ]);
  }

  // ── Slider / toggle factory ────────────────────────────────────────────────

  _createSlider(key, label, min, max, value) {
    const id = `brush-slider-${key}`;
    const isFloat = FLOAT_KEYS.has(key);
    const slider = html.createDomElement("input", {
      type: "range", id, min: String(min), max: String(max),
      step: isFloat ? "0.01" : "1", value: String(value),
    });
    const valueDisplay = html.div({ class: "brush-panel-value", id: `${id}-value` },
      [String(isFloat ? value.toFixed(2) : Math.round(value))]);
    slider.addEventListener("input", () => {
      const num = parseFloat(slider.value);
      // Display follows the slider immediately; the canonical value (and the
      // rest of the panel) refreshes via the store's change event below.
      valueDisplay.textContent = isFloat ? num.toFixed(2) : String(Math.round(num));
      this._applySetting(key, num);
    });
    const elements = [html.div({ class: "brush-panel-label" }, [label]), slider, valueDisplay];
    if (key === "smoothness") {
      elements.push(html.div({ class: "brush-panel-hint" }, ["<50 keep corners · ≥50 round curves"]));
    }
    return html.div({ class: "brush-slider" }, elements);
  }

  _createToggle(id, labelKey, settingKey, value) {
    const isOn = value === 1;
    return html.div({ class: "brush-slider" }, [
      html.div({ class: "brush-panel-label" }, [translate(labelKey)]),
      html.button(
        {
          id,
          class: `brush-mode-btn ${isOn ? "is-active" : ""}`,
          onclick: () => {
            const newValue = isOn ? 0 : 1;
            this._applySetting(settingKey, newValue);
            this._render();
          },
        },
        [translate(isOn ? "sidebar.brush-settings.on" : "sidebar.brush-settings.off")]
      ),
    ]);
  }

  // ── Mode + apply ───────────────────────────────────────────────────────────

  _setMode(mode) {
    this._currentMode = mode;
    for (const btn of this._modeContainer?.querySelectorAll(".brush-mode-btn") || []) {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    }
    const targetId = BRUSH_MODE_TO_TOOL_ID[mode];
    if (targetId) this.editorController.setSelectedTool(targetId);
    this._updatePreview();
  }

  _applySetting(key, value) {
    // Apply to the currently active brush tool if any; otherwise persist to
    // the shared store for the next activation. Either way the write goes
    // through a BrushSettingsStore whose change event re-renders this panel
    // from the clamped values — no shadow copies.
    const tool = this._activeBrushTool();
    if (tool?.updateSettings) {
      tool.updateSettings({ [key]: value });
      return;
    }
    this._sharedStore.set({ [key]: value });
  }

  // ── Render + preview ──────────────────────────────────────────────────────

  _render() {
    if (!this.contentElement) return;
    // Mode buttons
    for (const btn of this._modeContainer?.querySelectorAll(".brush-mode-btn") || []) {
      btn.classList.toggle("is-active", btn.dataset.mode === this._currentMode);
    }
    // Sliders + value displays
    for (const [key, value] of Object.entries(this._brushSettings)) {
      const slider = this.contentElement.querySelector(`#brush-slider-${key}`);
      const valueDisplay = this.contentElement.querySelector(`#brush-slider-${key}-value`);
      if (slider) slider.value = String(value);
      if (valueDisplay) {
        valueDisplay.textContent = FLOAT_KEYS.has(key) ? Number(value).toFixed(2) : String(Math.round(value));
      }
    }
    // Toggles
    this._syncToggle("brush-pressure-toggle", "usePressure");
    this._syncToggle("brush-union-toggle", "autoUnion");
    // Section visibility
    const isDraw = this._currentMode === BRUSH_MODES.CALLIGRAPHIC || this._currentMode === BRUSH_MODES.STRAIGHT;
    this._setSectionVisible("brush-size-section", isDraw);
    this._setSectionVisible("brush-angle-section", isDraw);
    this._setSectionVisible("brush-advanced-section", isDraw);
    this._setSectionVisible("eraser-section", this._currentMode === BRUSH_MODES.ERASER);
    this._setSectionVisible("sculpt-section", this._currentMode === BRUSH_MODES.SCULPT);
    this._updatePreview();
  }

  _syncToggle(id, key) {
    const btn = this.contentElement?.querySelector(`#${id}`);
    if (!btn) return;
    const isOn = this._brushSettings[key] === 1;
    btn.textContent = translate(isOn ? "sidebar.brush-settings.on" : "sidebar.brush-settings.off");
    btn.classList.toggle("is-active", isOn);
  }

  _setSectionVisible(id, visible) {
    const el = this.contentElement?.querySelector(`#${id}`);
    if (el) el.style.display = visible ? "block" : "none";
  }

  _updatePreview() {
    const canvas = this.contentElement?.querySelector("#brush-preview-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawBrushPreview(ctx, rect.width, rect.height, this._brushSettings);
  }

  async toggle(on, _focus) {
    if (!on) return;
    this._syncFromTool();
    requestAnimationFrame(() => this._updatePreview());
  }
}

customElements.define("panel-brush-settings", BrushPanel);

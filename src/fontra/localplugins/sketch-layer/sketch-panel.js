// Sidebar panel for the Sketch Layer plugin: drawing-mode toggle, pen
// color/width, and sketch clearing.
//
// Plugins load via a native dynamic import, so `@fontra/...` specifiers
// cannot be resolved. `Panel` (a thin `SimpleElement` subclass) and the tiny
// DOM helpers are inlined here, mirroring the triangle-guardian plugin.

import { el } from "../_shared/dom.js";
import { getPersistError } from "./sketch-store.js";

class SimpleElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._appendStyleLink("/css/shared.css");
    if (this.constructor.styles) {
      this._appendStyle(this.constructor.styles);
    }
  }

  _appendStyle(cssText) {
    const style = document.createElement("style");
    style.textContent = cssText;
    this.shadowRoot.appendChild(style);
  }

  _appendStyleLink(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    this.shadowRoot.appendChild(link);
  }
}

class Panel extends SimpleElement {
  constructor(plugin) {
    super();
    this.plugin = plugin;
    this.editorController = plugin.editor;
    this.fontController = plugin.editor.fontController;
    this.contentElement = this.getContentElement();
    this.shadowRoot.appendChild(this.contentElement);
  }

  getContentElement() {}

  async toggle(on, focus) {}
}

// `el` is imported from ../_shared/dom.js (single source of truth).


const div = (attrs, ...children) => el("div", attrs, children);
const span = (attrs, ...children) => el("span", attrs, children);
const label = (attrs, ...children) => el("label", attrs, children);
const input = (attrs) => el("input", attrs);
const button = (attrs, ...children) => el("button", attrs, children);

export const PEN_COLORS = [
  "#FF5470",
  "#2563EB",
  "#1D9E75",
  "#F5A623",
  "#8B5CF6",
  "#18181B",
];

export default class SketchLayerPanel extends Panel {
  identifier = "sketch-layer-plugin";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M6 30 C10 18 18 10 30 6 C28 14 22 24 12 28 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 30 C9 22 13 16 20 12" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

  static styles = `
    #sketch-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .sk-section { display: flex; flex-direction: column; gap: 6px; }
    .sk-section-title {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ui-element-foreground-color);
      opacity: .55; padding-bottom: 2px;
      border-bottom: 0.5px solid var(--ui-element-background-color);
    }
    .sk-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sk-label { font-size: 12px; color: var(--ui-element-foreground-color); }
    .sk-hint { font-size: 11px; opacity: .55; line-height: 1.5; }
    .sk-swatches { display: flex; gap: 6px; }
    .sk-swatch {
      width: 18px; height: 18px; border-radius: 9px;
      border: 2px solid transparent; cursor: pointer; padding: 0;
      outline: 1px solid rgba(128, 128, 128, 0.35);
    }
    .sk-swatch.selected { border-color: var(--ui-element-foreground-color); }
    .sk-button {
      background-color: var(--ui-element-background-color);
      color: var(--ui-element-foreground-color);
      border: 1px solid var(--border-color, #8888);
      border-radius: 6px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    .sk-button:hover { border-color: var(--ui-element-foreground-color); }
    .sk-status { font-size: 11px; opacity: .6; }
    .sk-status.sk-status-error {
      opacity: 1;
      color: var(--fontra-red-color, #e22);
      font-weight: 600;
    }
    input[type="range"] { flex: 1; }
  `;

  constructor(plugin) {
    super(plugin);
  }

  getContentElement() {
    const state = this.plugin.state;

    this._modeCheckbox = input({
      type: "checkbox",
      checked: state.mode,
    });
    this._modeCheckbox.addEventListener("change", () => {
      this.plugin.setMode(this._modeCheckbox.checked);
    });

    this._widthSlider = input({
      type: "range",
      min: "2",
      max: "80",
      step: "1",
      value: String(state.width),
    });
    this._widthValue = span({ class: "sk-label" }, String(state.width));
    this._widthSlider.addEventListener("input", () => {
      state.width = parseInt(this._widthSlider.value, 10) || 24;
      this._widthValue.textContent = String(state.width);
    });

    this._swatches = PEN_COLORS.map((color) => {
      const swatch = button({
        class: "sk-swatch",
        type: "button",
        title: color,
        style: `background-color: ${color};`,
      });
      swatch.addEventListener("click", () => {
        state.color = color;
        this._updateSwatchSelection();
      });
      return swatch;
    });

    const clearGlyphButton = button(
      { class: "sk-button", type: "button" },
      "Clear glyph"
    );
    clearGlyphButton.addEventListener("click", () => {
      this.plugin.clearGlyph();
      this.refreshStatus();
    });

    const clearAllButton = button(
      { class: "sk-button", type: "button" },
      "Clear all (project)"
    );
    clearAllButton.addEventListener("click", () => {
      // "Clear all" throws away every sketch in the project, and there is no
      // undo for it: ask first.
      if (
        !window.confirm(
          "Clear every sketch in this project?\n\nThis cannot be undone."
        )
      ) {
        return;
      }
      this.plugin.clearAll();
      this.refreshStatus();
    });

    this._status = div({ class: "sk-status" });

    this.editorController.sceneController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this.refreshStatus()
    );

    // The save happens on a timer, so a failed save can only be reported
    // through an event.
    window.addEventListener("fontra-sketch-layer-persist-error", () =>
      this.refreshStatus()
    );

    this._updateSwatchSelection();
    this.refreshStatus();

    return div({ id: "sketch-panel" }, [
      this._buildModeSection(),
      this._buildPenSection(clearGlyphButton, clearAllButton),
      this._buildStatusSection(),
      div(
        { class: "sk-hint" },
        "Draw on the canvas while drawing mode is on. Toggle it with the S key, exit with Esc. Sketches are saved per project in this browser."
      ),
    ]);
  }

  _buildModeSection() {
    return div({ class: "sk-section" }, [
      div({ class: "sk-section-title" }, "Sketch"),
      div({ class: "sk-row" }, [
        label({ class: "sk-label" }, "Drawing mode"),
        this._modeCheckbox,
      ]),
    ]);
  }

  _buildPenSection(clearGlyphButton, clearAllButton) {
    return div({ class: "sk-section" }, [
      div({ class: "sk-section-title" }, "Pen"),
      div({ class: "sk-row" }, [
        label({ class: "sk-label" }, "Color"),
        div({ class: "sk-swatches" }, this._swatches),
      ]),
      div({ class: "sk-row" }, [
        label({ class: "sk-label" }, "Width"),
        this._widthSlider,
        this._widthValue,
      ]),
      div({ class: "sk-row" }, [clearGlyphButton, clearAllButton]),
    ]);
  }

  _buildStatusSection() {
    return div({ class: "sk-section" }, [this._status]);
  }

  _updateSwatchSelection() {
    const color = this.plugin.state.color;
    for (const swatch of this._swatches) {
      swatch.classList.toggle(
        "selected",
        (swatch.title || "").toLowerCase() === color.toLowerCase()
      );
    }
  }

  /** Called by the plugin when the mode changes from elsewhere (action/shortcut). */
  setModeIndicator(onOff) {
    this._modeCheckbox.checked = !!onOff;
  }

  refreshStatus() {
    if (!this._status) {
      return;
    }
    // A failed save comes first: it is the one thing the designer has to
    // know about — the strokes they see are not on disk.
    const persistError = getPersistError();
    if (persistError) {
      this._status.textContent = persistError;
      this._status.classList.add("sk-status-error");
      return;
    }
    this._status.classList.remove("sk-status-error");
    const projectId = this.plugin.state.projectId;
    const glyphName =
      this.editorController.sceneController.sceneSettings.selectedGlyphName;
    let text;
    if (!projectId) {
      text = "";
    } else if (!glyphName) {
      text = "No glyph selected";
    } else {
      const count = this.plugin.strokeCount(projectId, glyphName);
      text =
        count === 1
          ? `1 stroke on ${glyphName}`
          : `${count} strokes on ${glyphName}`;
    }
    this._status.textContent = text;
  }
}

if (!customElements.get("panel-sketch-layer-plugin")) {
  customElements.define("panel-sketch-layer-plugin", SketchLayerPanel);
}

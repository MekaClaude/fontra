import Panel from "./panel.js";
import { div, span, label, input } from "@fontra/core/html-utils.js";
import { ObservableController } from "@fontra/core/observable-object.ts";
import { speedpunkState } from "./visualization-layer-definitions.js";

const SPEEDPUNK_IDENTIFIER = "fontra.speedpunk";

export default class SpeedPunkPanel extends Panel {
  identifier = "speedpunk-panel";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-120a8,8,0,0,1,0,16H112a8,8,0,0,1,0-16Zm0,48H112a8,8,0,0,1,0-16h32A8,8,0,0,1,144,144Z"/></svg>`;

  static styles = `
    .sp-section { margin: 8px 0; padding: 0 4px; }
    .sp-title {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ui-element-foreground-color);
      opacity: .55; padding-bottom: 2px;
      border-bottom: 0.5px solid var(--ui-element-background-color-1);
      margin-bottom: 6px;
    }
    .sp-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .sp-label { flex: 0 0 110px; font-size: 11px; color: var(--ui-element-foreground-color); }
    .sp-slider { flex: 1; }
    .sp-value { width: 30px; text-align: right; font-size: 11px; }
    .sp-btn {
      width: 100%; padding: 6px 0; font-size: 13px; font-weight: 600;
      cursor: pointer; border: 1px solid var(--ui-element-background-color-1);
      border-radius: 4px; color: white;
    }
    .sp-btn-on { background: var(--fontra-green, #1D9E75); }
    .sp-btn-off { background: var(--fontra-red, #E24B4A); }
    .sp-legend {
      margin: 8px 0; padding: 8px; border-radius: 6px;
      background: var(--ui-element-background-color);
    }
    .sp-gradient {
      width: 100%; height: 16px; border-radius: 4px;
      background: linear-gradient(to right, hsl(280, 90%, 60%), hsl(210, 90%, 60%), hsl(140, 90%, 60%), hsl(70, 90%, 60%), hsl(0, 90%, 60%));
    }
    .sp-legend-labels { display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px; color: var(--ui-element-foreground-color); opacity: .6; }
    .sp-info { font-size: 10px; color: var(--ui-element-foreground-color); opacity: .5; line-height: 1.4; margin-top: 4px; }
  `;

  getContentElement() {
    this.controller = new ObservableController({
      enabled: false,
      combLengthScale: 1.0,
      combDensity: 20,
    });

    this.controller.synchronizeWithLocalStorage("speedpunk.");

    const settingsModel = this.editorController.visualizationLayersSettings.model;
    this.controller.model.enabled = !!settingsModel[SPEEDPUNK_IDENTIFIER];

    this.editorController.visualizationLayersSettings.addKeyListener(
      SPEEDPUNK_IDENTIFIER,
      (event) => {
        if (this.controller.model.enabled !== event.newValue) {
          this.controller.model.enabled = event.newValue;
          speedpunkState.enabled = event.newValue;
          this._updateEnableBtn();
          this.editorController.canvasController.requestUpdate();
        }
      }
    );

    this._syncState();

    this.controller.addKeyListener("enabled", (event) => {
      settingsModel[SPEEDPUNK_IDENTIFIER] = event.newValue;
      speedpunkState.enabled = event.newValue;
      this._updateEnableBtn();
      this.editorController.canvasController.requestUpdate();
    });

    this.controller.addKeyListener("combLengthScale", (event) => {
      speedpunkState.combLengthScale = event.newValue;
      this.editorController.canvasController.requestUpdate();
    });

    this.controller.addKeyListener("combDensity", (event) => {
      speedpunkState.combDensity = event.newValue;
      this.editorController.canvasController.requestUpdate();
    });

    this.editorController.sceneController.addCurrentGlyphChangeListener(() => {
      this.editorController.canvasController.requestUpdate();
    });

    this.editorController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this.editorController.canvasController.requestUpdate()
    );

    return div({}, [
      this._buildEnableSection(),
      this._buildControlsSection(),
      this._buildLegendSection(),
    ]);
  }

  _buildEnableSection() {
    const title = div({ class: "sp-title" }, "Activation");
    this._enableBtn = input({
      type: "button",
      class: `sp-btn ${this.controller.model.enabled ? "sp-btn-on" : "sp-btn-off"}`,
      value: this.controller.model.enabled ? "ON" : "OFF",
    });
    this._enableBtn.addEventListener("click", () => {
      this.controller.model.enabled = !this.controller.model.enabled;
    });
    return div({ class: "sp-section" }, [title, this._enableBtn]);
  }

  _updateEnableBtn() {
    if (!this._enableBtn) return;
    const enabled = this.controller.model.enabled;
    this._enableBtn.value = enabled ? "ON" : "OFF";
    this._enableBtn.className = `sp-btn ${enabled ? "sp-btn-on" : "sp-btn-off"}`;
  }

  _buildControlsSection() {
    const title = div({ class: "sp-title" }, "Controls");

    const controls = [
      { key: "combLengthScale", label: "Comb length", min: 0.1, max: 5.0, step: 0.1 },
      { key: "combDensity", label: "Comb density", min: 5, max: 50, step: 1 },
    ];

    const rows = controls.map(({ key, label, min, max, step }) => {
      const valueSpan = span({ class: "sp-value" }, [String(this.controller.model[key])]);
      const slider = input({
        type: "range",
        class: "sp-slider",
        min, max, step,
        value: this.controller.model[key],
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          this.controller.model[key] = v;
          valueSpan.textContent = step < 1 ? v.toFixed(1) : String(v);
        },
      });

      this.controller.addKeyListener(key, (event) => {
        slider.value = event.newValue;
        valueSpan.textContent = step < 1 ? String(Number(event.newValue).toFixed(1)) : String(event.newValue);
      });

      return div({ class: "sp-row" }, [
        span({ class: "sp-label" }, [label]),
        slider,
        valueSpan,
      ]);
    });

    return div({ class: "sp-section" }, [title, ...rows]);
  }

  _buildLegendSection() {
    const title = div({ class: "sp-title" }, "Legend");
    return div({ class: "sp-section" }, [
      title,
      div({ class: "sp-legend" }, [
        div({ class: "sp-gradient" }),
        div({ class: "sp-legend-labels" }, [
          span({}, "Low"),
          span({}, "Curvature"),
          span({}, "High"),
        ]),
        div({ class: "sp-info" }, [
          "Purple/blue = gentle curve, red/orange = sharp turn.",
          " Lines point toward the center of curvature.",
        ]),
      ]),
    ]);
  }

  _syncState() {
    speedpunkState.enabled = this.controller.model.enabled;
    speedpunkState.combLengthScale = this.controller.model.combLengthScale;
    speedpunkState.combDensity = this.controller.model.combDensity;
  }
}

customElements.define("panel-speedpunk", SpeedPunkPanel);

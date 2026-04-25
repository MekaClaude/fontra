import Panel from "./panel.js";
import {
  div,
  label,
  input,
  span,
} from "@fontra/core/html-utils.js";
import { ObservableController } from "@fontra/core/observable-object.js";
import { parseSelection } from "@fontra/core/utils.js";

import {
  computeApex,
  pointInTriangle,
  isDegenerate,
} from "./edit-tools-triangle-guardian.js";

const TRIANGLE_GUARDIAN_IDENTIFIER = "fontra.triangle.guardian";

export default class TriangleGuardianPanel extends Panel {
  identifier = "triangle-guardian-panel";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M160,216a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16h48A8,8,0,0,1,160,216Zm76.8-27.91L232.14,180a8,8,0,0,0-13.86,8l4.65,8.09a7.59,7.59,0,0,1,0,7.72,8.5,8.5,0,0,1-7.48,4.2H192a8,8,0,0,0,0,16h23.45a24.34,24.34,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM64,208H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L37.72,188a8,8,0,1,0-13.86-8l-4.66,8.08a23.51,23.51,0,0,0,0,23.72A24.34,24.34,0,0,0,40.55,224H64a8,8,0,0,0,0-16Zm138.18-56a8,8,0,0,0,6.93-12l-23-40a8,8,0,0,0-13.86,8l23,40A8,8,0,0,0,202.18,152ZM149.35,36.22a24.76,24.76,0,0,0-42.7,0L93,60a8,8,0,1,0,13.86,8l13.7-23.78a8.75,8.75,0,0,1,15,0L149.18,68a8,8,0,0,0,6.94,4,7.91,7.91,0,0,0,4-1.07A8,8,0,0,0,163,60ZM80.85,97.07A8,8,0,0,0,69.93,100l-23,40a8,8,0,0,0,13.87,8l23-40A8,8,0,0,0,80.85,97.07Z"/></svg>`;

  static styles = `
    #tg-panel { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .tg-section { display: flex; flex-direction: column; gap: 6px; }
    .tg-section-title {
      font-size: 11px; font-weight: 500; text-transform: uppercase;
      letter-spacing: .05em; color: var(--ui-element-foreground-color);
      opacity: .55; padding-bottom: 2px;
      border-bottom: 0.5px solid var(--ui-element-background-color-1);
    }
    .tg-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tg-label { font-size: 12px; color: var(--ui-element-foreground-color); }
    .tg-violation-list { min-height: 80px; }
    .tg-empty { font-size: 11px; opacity: .5; padding: 8px 0; text-align: center; }
    .tg-violation-item {
      display: flex; align-items: center; gap: 4px; padding: 3px 0;
      cursor: pointer; font-size: 11px;
      color: var(--ui-element-foreground-color);
    }
    .tg-violation-item:hover { background: var(--ui-element-background-color-1); }
    .tg-violation-issue { color: var(--fontra-red); }
  `;

  constructor(editorController) {
    super(editorController);
    this.tool = null;
  }

  getContentElement() {
    this._controller = new ObservableController({
      enabled: false,
      educationalMode: false,
      showAllSegments: false,
      highlightViolations: true,
      showSCurveLabels: true,
      triangleOpacity: 18,
    });

    // Sync enabled state with the visualization layer setting
    const settingsModel = this.editorController.visualizationLayersSettings.model;
    this._controller.model.enabled = !!settingsModel[TRIANGLE_GUARDIAN_IDENTIFIER];
    settingsModel[TRIANGLE_GUARDIAN_IDENTIFIER] = this._controller.model.enabled;

    // Listen for external changes to the setting (e.g., tool deactivation)
    this.editorController.visualizationLayersSettings.addKeyListener(
      TRIANGLE_GUARDIAN_IDENTIFIER,
      (event) => {
        if (this._controller.model.enabled !== event.newValue) {
          this._controller.setItem("enabled", event.newValue, { senderID: "external" });
        }
      }
    );

    this._controller.addKeyListener("enabled", (event) => {
      const val = this._controller.model.enabled;
      settingsModel[TRIANGLE_GUARDIAN_IDENTIFIER] = val;
      if (this.tool) {
        this.tool._layerEnabled = val;
      }
      this.editorController.canvasController.requestUpdate();
      // When user clicks ON, activate the tool; when OFF, switch to pointer
      if (event.senderID === "panel") {
        if (val) {
          this.editorController.setSelectedTool("triangle-guardian");
        } else {
          this.editorController.setSelectedTool("pointer-tool");
        }
      }
      this._updateEnableButton();
    });

    this._controller.addListener((event) => {
      if (this.tool) {
        const key = event.key;
        const val = event.newValue;
        if (key === "triangleOpacity") {
          this.tool[key] = val / 100;
        } else if (key === "enabled") {
          // handled above
        } else {
          this.tool[key] = val;
        }
        if (key !== "triangleOpacity" && key !== "enabled") this._scheduleViolationScan();
      }
    });

    this.editorController.sceneController.addCurrentGlyphChangeListener(() =>
      this._scheduleViolationScan()
    );

    this.editorController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this._scheduleViolationScan()
    );

    this._violationList = div({ class: "tg-violation-list" });

    this._scheduleViolationScan();

    return div({ id: "tg-panel" }, [
      this._buildEnableSection(),
      this._buildModeSection(),
      this._buildAppearanceSection(),
      this._buildViolationsSection(),
    ]);
  }

  _buildEnableSection() {
    const title = div({ class: "tg-section-title" }, "Activation");
    this._enableBtn = input({
      type: "button",
      value: this._controller.model.enabled ? "ON" : "OFF",
      style: `width: 100%; padding: 6px 0; font-size: 13px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--ui-element-background-color-1); border-radius: 4px;
        background: ${this._controller.model.enabled
          ? "var(--fontra-green, #1D9E75)"
          : "var(--fontra-red, #E24B4A)"};
        color: white;`,
    });
    this._enableBtn.addEventListener("click", () => {
      this._controller.setItem("enabled", !this._controller.model.enabled, { senderID: "panel" });
    });
    return div({ class: "tg-section" }, [title, this._enableBtn]);
  }

  _updateEnableButton() {
    if (!this._enableBtn) return;
    this._enableBtn.value = this._controller.model.enabled ? "ON" : "OFF";
    this._enableBtn.style.background = this._controller.model.enabled
      ? "var(--fontra-green, #1D9E75)"
      : "var(--fontra-red, #E24B4A)";
  }

  _buildModeSection() {
    const title = div({ class: "tg-section-title" }, "Mode");
    const rows = [];

    const toggles = [
      { key: "showAllSegments", label: "Show all segments" },
      { key: "educationalMode", label: "Educational mode" },
      { key: "highlightViolations", label: "Highlight violations" },
      { key: "showSCurveLabels", label: "S-curve labels" },
    ];

    for (const { key, label: lbl } of toggles) {
      const chk = input({ type: "checkbox", checked: this._controller.model[key] });
      chk.addEventListener("change", () => {
        this._controller.setItem(key, chk.checked, { senderID: this });
      });
      rows.push(
        div({ class: "tg-row" }, [
          label({ class: "tg-label" }, lbl),
          chk,
        ])
      );
    }

    return div({ class: "tg-section" }, [title, ...rows]);
  }

  _buildAppearanceSection() {
    const title = div({ class: "tg-section-title" }, "Appearance");
    const slider = input({
      type: "range",
      min: 0,
      max: 100,
      value: this._controller.model.triangleOpacity,
    });
    slider.addEventListener("input", () => {
      this._controller.setItem("triangleOpacity", parseInt(slider.value), {
        senderID: this,
      });
    });

    const valLabel = span(
      { class: "tg-label" },
      `${this._controller.model.triangleOpacity}%`
    );

    this._controller.addKeyListener("triangleOpacity", () => {
      slider.value = this._controller.model.triangleOpacity;
      valLabel.textContent = `${this._controller.model.triangleOpacity}%`;
    });

    return div({ class: "tg-section" }, [
      title,
      div({ class: "tg-row" }, [
        label({ class: "tg-label" }, "Triangle opacity"),
        slider,
        valLabel,
      ]),
    ]);
  }

  _buildViolationsSection() {
    const title = div({ class: "tg-section-title" }, "Violations");
    return div({ class: "tg-section" }, [title, this._violationList]);
  }

  async _scheduleViolationScan() {
    if (this._pending) return;
    this._pending = this._runViolationScan();
    await this._pending;
    delete this._pending;
  }

  async _runViolationScan() {
    const sceneController = this.editorController.sceneController;
    const glyphName = sceneController.sceneSettings.selectedGlyphName;
    if (!glyphName) {
      this._violationList.innerHTML = '<div class="tg-empty">No glyph selected</div>';
      return;
    }

    const instance = await sceneController.sceneModel.getGlyphInstance(glyphName);
    if (!instance || !instance.path) {
      this._violationList.innerHTML = '<div class="tg-empty">No path data</div>';
      return;
    }

    const path = instance.path;
    const violations = [];

    for (let ci = 0; ci < path.numContours; ci++) {
      for (const segment of path.iterContourDecomposedSegments(ci)) {
        if (segment.type !== "cubic" || segment.points.length !== 4) continue;

        const [P0, P1, P2, P3] = segment.points;
        if (isDegenerate(P0, P1, P2, P3)) continue;

        const { apex, isSCurve } = computeApex(P0, P1, P2, P3);
        if (isSCurve) {
          violations.push({ contour: ci, segment: segment.segmentIndex || ci, issue: "S-curve" });
          continue;
        }
        if (!apex) continue;

        const p1Out = !pointInTriangle(P1, P0, P3, apex);
        const p2Out = !pointInTriangle(P2, P0, P3, apex);
        if (p1Out || p2Out) {
          const parts = [];
          if (p1Out) parts.push("handle A");
          if (p2Out) parts.push("handle B");
          violations.push({ contour: ci, segment: segment.segmentIndex || ci, issue: parts.join(", ") });
        }
      }
    }

    if (violations.length === 0) {
      this._violationList.innerHTML = '<div class="tg-empty">No violations</div>';
    } else {
      const items = violations.map((v) =>
        div({ class: "tg-violation-item" }, [
          span({ style: "width: 48px;" }, `c${v.contour}`),
          span({ style: "width: 36px;" }, `s${v.segment}`),
          span({ class: "tg-violation-issue" }, v.issue),
        ])
      );
      this._violationList.replaceChildren(...items);
    }
  }
}

customElements.define("panel-triangle-guardian", TriangleGuardianPanel);

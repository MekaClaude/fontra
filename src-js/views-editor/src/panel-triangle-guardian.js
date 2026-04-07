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
  iconPath = "/images/triangle-guardian.svg";

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
      educationalMode: false,
      showAllSegments: false,
      highlightViolations: true,
      showSCurveLabels: true,
      triangleOpacity: 18,
    });

    this._controller.addListener((event) => {
      if (this.tool) {
        const key = event.key;
        const val = event.newValue;
        if (key === "triangleOpacity") {
          this.tool[key] = val / 100;
        } else {
          this.tool[key] = val;
        }
        this.editorController.canvasController.requestUpdate();
        if (key !== "triangleOpacity") this._scheduleViolationScan();
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
      this._buildModeSection(),
      this._buildAppearanceSection(),
      this._buildViolationsSection(),
    ]);
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

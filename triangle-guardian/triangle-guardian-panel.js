import Panel from "@fontra/editor/panel.js";
import { ObservableController } from "@fontra/core/observable-object.js";
import { div, label, input, span } from "@fontra/core/html-utils.js";
import { state } from "./triangle-guardian-state.js";

export default class TriangleGuardianPanel extends Panel {
  identifier = "triangle-guardian-panel";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M18 6 L6 30 L30 30 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="18" cy="6" r="2" fill="currentColor"/><circle cx="6" cy="30" r="2" fill="currentColor"/><circle cx="30" cy="30" r="2" fill="currentColor"/></svg>`;

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
  `;

  constructor(editorController) {
    super(editorController);
  }

  getContentElement() {
    this._controller = new ObservableController({
      enabled: state.enabled,
      educationalMode: state.educationalMode,
      showAllSegments: state.showAllSegments,
      highlightViolations: state.highlightViolations,
      showSCurveLabels: state.showSCurveLabels,
      triangleOpacity: Math.round(state.triangleOpacity * 100),
    });

    // Sync controller → shared state → canvas update
    const keys = Object.keys(state);
    keys.forEach((key) => {
      this._controller.addKeyListener(key, () => {
        const val = this._controller.model[key];
        if (key === "triangleOpacity") {
          state[key] = val / 100;
        } else {
          state[key] = val;
        }
        this.editorController.canvasController.requestUpdate();
        if (key !== "triangleOpacity") this._scheduleViolationScan();
      });
    });

    // Listen to glyph changes
    this.editorController.sceneController.addCurrentGlyphChangeListener(() =>
      this._scheduleViolationScan()
    );

    this.editorController.sceneController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this._scheduleViolationScan()
    );

    this._violationList = document.createElement("div");
    this._violationList.className = "tg-violation-list";

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
      div({ class: "tg-row" }, [label({ class: "tg-label" }, "Triangle opacity"), slider, valLabel]),
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
    const sceneModel = sceneController.sceneModel;
    const glyphName = sceneController.sceneSettings.selectedGlyphName;
    if (!glyphName) {
      this._violationList.innerHTML = '<div class="tg-empty">No glyph selected</div>';
      return;
    }

    // Use sceneModel.getGlyphInstance which automatically applies the current source location
    const instance = await sceneModel.getGlyphInstance(glyphName);
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
      const items = violations.map(
        (v) =>
          div(
            {
              class: "tg-row",
              style: "cursor: pointer; padding: 2px 0;",
            },
            [
              span({ class: "tg-label", style: "width: 48px;" }, `c${v.contour}`),
              span({ class: "tg-label", style: "width: 36px;" }, `s${v.segment}`),
              span({ class: "tg-label", style: "color: var(--fontra-red);" }, v.issue),
            ]
          )
      );
      this._violationList.replaceChildren(...items);
    }
  }
}

// Inline imports to avoid circular deps in panel
function isDegenerate(P0, P1, P2, P3) {
  if (P0.x === P3.x && P0.y === P3.y) return true;
  if (P0.x === P1.x && P0.y === P1.y) return true;
  if (P3.x === P2.x && P3.y === P2.y) return true;
  return false;
}

function computeApex(P0, P1, P2, P3) {
  const d1x = P1.x - P0.x;
  const d1y = P1.y - P0.y;
  const d2x = P2.x - P3.x;
  const d2y = P2.y - P3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-6) return { apex: null, isSCurve: false };
  const dx = P3.x - P0.x;
  const dy = P3.y - P0.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const s = (dx * d1y - dy * d1x) / denom;
  const isSCurve = t < 0 || s < 0;
  const apex = { x: P0.x + t * d1x, y: P0.y + t * d1y };
  return { apex, isSCurve };
}

function pointInTriangle(pt, A, B, C, eps = 0.5) {
  function sign(ax, ay, bx, by, cx, cy) {
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  }
  const d1 = sign(pt.x, pt.y, A.x, A.y, B.x, B.y);
  const d2 = sign(pt.x, pt.y, B.x, B.y, C.x, C.y);
  const d3 = sign(pt.x, pt.y, C.x, C.y, A.x, A.y);
  const hasNeg = d1 < -eps || d2 < -eps || d3 < -eps;
  const hasPos = d1 > eps || d2 > eps || d3 > eps;
  return !(hasNeg && hasPos);
}

customElements.define("panel-triangle-guardian", TriangleGuardianPanel);

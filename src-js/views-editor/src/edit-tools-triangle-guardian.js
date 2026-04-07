import { parseSelection } from "@fontra/core/utils.js";
import { BaseTool } from "./edit-tools-base.js";
import {
  glyphSelector,
  registerVisualizationLayerDefinition,
} from "./visualization-layer-definitions.js";
// NOTE: TriangleGuardianPanel is lazy-imported to avoid circular dependency
// with panel-triangle-guardian.js which imports geometry functions from this file.

const TRIANGLE_GUARDIAN_IDENTIFIER = "fontra.triangle.guardian";

let activeToolInstance = null;

registerVisualizationLayerDefinition({
  identifier: TRIANGLE_GUARDIAN_IDENTIFIER,
  name: "sidebar.user-settings.glyph.triangleguardian",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 200,
  screenParameters: {
    strokeWidth: 1,
    triangleOpacity: 0.18,
    apexRadius: 3,
    dashLength: 5,
    dashGap: 4,
  },
  colors: {
    okColor: "#1D9E75",
    violationColor: "#E24B4A",
    sCurveColor: "#185FA5",
  },
  colorsDarkMode: {
    okColor: "#3ECF9E",
    violationColor: "#FF6B6B",
    sCurveColor: "#5BA3E6",
  },
  draw: (context, positionedGlyph, parameters, model, controller) =>
    activeToolInstance?.draw(context, positionedGlyph, parameters, model, controller),
});

export function isDegenerate(P0, P1, P2, P3) {
  if (P0.x === P3.x && P0.y === P3.y) return true;
  if (P0.x === P1.x && P0.y === P1.y) return true;
  if (P3.x === P2.x && P3.y === P2.y) return true;
  return false;
}

export function computeApex(P0, P1, P2, P3) {
  const d1x = P1.x - P0.x;
  const d1y = P1.y - P0.y;
  const d2x = P2.x - P3.x;
  const d2y = P2.y - P3.y;
  const denom = d1x * d2y - d1y * d2x;

  if (Math.abs(denom) < 1e-6) {
    // Parallel control point vectors - check if it's an S-curve
    // by examining if control points are on opposite sides of the baseline
    const baselineX = P3.x - P0.x;
    const baselineY = P3.y - P0.y;
    const cross1 = d1x * baselineY - d1y * baselineX;
    const cross2 = d2x * baselineY - d2y * baselineX;
    const isSCurve = cross1 * cross2 < 0;
    return { apex: null, isSCurve };
  }

  const dx = P3.x - P0.x;
  const dy = P3.y - P0.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const s = (dx * d1y - dy * d1x) / denom;

  const isSCurve = t < 0 || s < 0;
  const apex = { x: P0.x + t * d1x, y: P0.y + t * d1y };

  return { apex, isSCurve };
}

export function pointInTriangle(pt, A, B, C, eps = 0.01) {
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

export class TriangleGuardianTool extends BaseTool {
  iconPath = "/images/triangle-guardian.svg";
  identifier = "triangle-guardian";

  constructor(editor) {
    super(editor);
    activeToolInstance = this;
    this.fontController = editor.fontController;
    this.active = editor.visualizationLayersSettings.model[TRIANGLE_GUARDIAN_IDENTIFIER];

    this.educationalMode = false;
    this.showAllSegments = false;
    this.highlightViolations = true;
    this.showSCurveLabels = true;

    editor.visualizationLayersSettings.addKeyListener(
      TRIANGLE_GUARDIAN_IDENTIFIER,
      (event) => {
        this.active = event.newValue;
        this.canvasController.requestUpdate();
      }
    );

    this.sceneController.addCurrentGlyphChangeListener(() => {
      this.canvasController.requestUpdate();
    });

    this.fontController.addEditListener(async (...args) => {
      this.canvasController.requestUpdate();
    });

    // Lazy import to avoid circular dependency with panel-triangle-guardian.js
    import("./panel-triangle-guardian.js").then((mod) => {
      const TriangleGuardianPanel = mod.default;
      const panel = new TriangleGuardianPanel(editor);
      panel.iconPath = "/images/triangle-guardian.svg";
      panel.tool = this;
      editor.addSidebarPanel(panel, "right");
    });
  }

  activate() {
    super.activate();
    if (!this.active) {
      this.editor.visualizationLayersSettings.model[TRIANGLE_GUARDIAN_IDENTIFIER] = true;
      this.active = true;
    }
    this.canvasController.requestUpdate();
  }

  deactivate() {
    super.deactivate();
    this.canvasController.requestUpdate();
  }

  setCursor() {
    this.canvasController.canvas.style.cursor = "crosshair";
  }

  handleHover(event) {
    this.setCursor();
  }

  handleKeyDown(event) {
    if (event.key === "e" || event.key === "E") {
      this.educationalMode = !this.educationalMode;
      this.canvasController.requestUpdate();
    } else if (event.key === "a" || event.key === "A") {
      this.showAllSegments = !this.showAllSegments;
      this.canvasController.requestUpdate();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      this.educationalMode = false;
      this.showAllSegments = false;
      this.canvasController.requestUpdate();
    }
  }

  draw(context, positionedGlyph, parameters, model, controller) {
    if (!this.active) return;

    const glyph = positionedGlyph.glyph;
    if (!glyph || !glyph.path) return;

    const path = glyph.path;
    const educMode = this.educationalMode;
    const showAll = this.showAllSegments;

    const { point: selectedPointIndices } = parseSelection(model.selection);
    const { point: hoveredPointIndices } = parseSelection(model.hoverSelection);
    const selectedSet = new Set(selectedPointIndices);
    const hoveredSet = new Set(hoveredPointIndices);

    for (let ci = 0; ci < path.numContours; ci++) {
      for (const segment of path.iterContourDecomposedSegments(ci)) {
        if (segment.type !== "cubic" || segment.points.length !== 4) continue;

        const [P0, P1, P2, P3] = segment.points;
        const indices = segment.parentPointIndices;

        const isSelected =
          educMode || showAll || this._isSegmentSelected(indices, selectedSet, hoveredSet);
        if (!isSelected) continue;

        if (isDegenerate(P0, P1, P2, P3)) continue;

        const { apex, isSCurve } = computeApex(P0, P1, P2, P3);
        if (!apex && !isSCurve) continue;

        const p1Outside = apex && !pointInTriangle(P1, P0, P3, apex);
        const p2Outside = apex && !pointInTriangle(P2, P0, P3, apex);

        context.save();

        if (isSCurve) {
          this._drawSCurveTriangles(context, P0, P1, P2, P3, parameters);
        } else {
          this._drawSimpleTriangle(
            context,
            P0,
            P1,
            P2,
            P3,
            apex,
            p1Outside,
            p2Outside,
            parameters
          );
        }

        context.restore();
      }
    }
  }

  _isSegmentSelected(indices, selectedSet, hoveredSet) {
    for (const idx of indices) {
      if (selectedSet.has(idx) || hoveredSet.has(idx)) return true;
    }
    return false;
  }



  _drawSimpleTriangle(ctx, P0, P1, P2, P3, apex, p1Outside, p2Outside, p) {
    const anyViolation = p1Outside || p2Outside;
    const fillColor = anyViolation ? p.violationColor : p.okColor;

    ctx.beginPath();
    ctx.moveTo(P0.x, P0.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.lineTo(P3.x, P3.y);
    ctx.closePath();
    ctx.globalAlpha = p.triangleOpacity;
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.setLineDash([p.dashLength, p.dashGap]);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = p.strokeWidth;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(apex.x, apex.y, p.apexRadius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = fillColor;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = p.strokeWidth * 0.7;
    ctx.beginPath();
    ctx.moveTo(P0.x, P0.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(P3.x, P3.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (this.highlightViolations) {
      if (p1Outside) this._drawViolationMarker(ctx, P1, p);
      if (p2Outside) this._drawViolationMarker(ctx, P2, p);
    }
  }

  _drawViolationMarker(ctx, pt, p) {
    const r = p.apexRadius * 1.8;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = p.violationColor;
    ctx.lineWidth = p.strokeWidth * 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pt.x - r * 0.6, pt.y - r * 0.6);
    ctx.lineTo(pt.x + r * 0.6, pt.y + r * 0.6);
    ctx.moveTo(pt.x + r * 0.6, pt.y - r * 0.6);
    ctx.lineTo(pt.x - r * 0.6, pt.y + r * 0.6);
    ctx.strokeStyle = p.violationColor;
    ctx.stroke();
  }

  _drawSCurveTriangles(ctx, P0, P1, P2, P3, p) {
    const M = { x: (P0.x + P3.x) / 2, y: (P0.y + P3.y) / 2 };

    this._drawHalfTriangle(ctx, P0, M, P1, p.sCurveColor, p);
    this._drawHalfTriangle(ctx, P3, M, P2, p.sCurveColor, p);

    if (this.showSCurveLabels) {
      const screenPx = Math.round(9 / ctx.getTransform().a);
      ctx.font = `${screenPx}px sans-serif`;
      ctx.fillStyle = p.sCurveColor;
      ctx.globalAlpha = 0.7;
      ctx.textAlign = "center";
      ctx.fillText("S", M.x, M.y - 6);
      ctx.globalAlpha = 1;
    }
  }

  _drawHalfTriangle(ctx, A, B, C, color, p) {
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(C.x, C.y);
    ctx.closePath();
    ctx.globalAlpha = p.triangleOpacity * 0.7;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.setLineDash([p.dashLength, p.dashGap]);
    ctx.strokeStyle = color;
    ctx.lineWidth = p.strokeWidth;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

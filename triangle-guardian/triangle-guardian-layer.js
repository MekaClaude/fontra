import { registerVisualizationLayerDefinition, glyphSelector } from "@fontra/editor/visualization-layer-definitions.js";
import { parseSelection } from "@fontra/core/utils.js";
import { state } from "./triangle-guardian-state.js";
import { computeApex, pointInTriangle, isDegenerate, drawLine } from "./triangle-guardian-geometry.js";

/**
 * Triangle Guardian visualization layer.
 * Draws Adobe control-point triangle guidelines on cubic Bézier segments.
 * Green = OK, Red = violation, Blue = S-curve.
 */
registerVisualizationLayerDefinition({
  identifier: "com.fontra.plugins.triangle-guardian.overlay",
  name: "Triangle Guardian",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 200,
  screenParameters: {
    strokeWidth: 1,
    triangleOpacity: 0.18,
    violationColor: "#E24B4A",
    okColor: "#1D9E75",
    sCurveColor: "#185FA5",
    apexRadius: 3,
    dashLength: 5,
    dashGap: 4,
  },
  draw(context, positionedGlyph, parameters, model, controller) {
    try {
      if (!state.enabled) return;

      const glyph = positionedGlyph.glyph;
      if (!glyph || !glyph.path) return;

      const path = glyph.path;
      const educMode = state.educationalMode;
      const showAll = state.showAllSegments;

      // Parse selection to get point indices
      const { point: selectedPointIndices } = parseSelection(model.selection);
      const { point: hoveredPointIndices } = parseSelection(model.hoverSelection);
      const selectedSet = new Set(selectedPointIndices);
      const hoveredSet = new Set(hoveredPointIndices);

      for (let ci = 0; ci < path.numContours; ci++) {
        for (const segment of path.iterContourDecomposedSegments(ci)) {
          if (segment.type !== "cubic" || segment.points.length !== 4) continue;

          const [P0, P1, P2, P3] = segment.points;
          const indices = segment.parentPointIndices;

          // Determine visibility
          const isSelected = educMode || showAll || isSegmentSelected(indices, selectedSet, hoveredSet);
          if (!isSelected) continue;

          // Skip degenerate
          if (isDegenerate(P0, P1, P2, P3)) continue;

          // Compute apex
          const { apex, isSCurve } = computeApex(P0, P1, P2, P3);
          if (!apex && !isSCurve) continue;

          // Check violations
          const p1Outside = apex && !pointInTriangle(P1, P0, P3, apex);
          const p2Outside = apex && !pointInTriangle(P2, P0, P3, apex);

          context.save();

          if (isSCurve) {
            drawSCurveTriangles(context, P0, P1, P2, P3, parameters);
          } else {
            drawSimpleTriangle(context, P0, P1, P2, P3, apex, p1Outside, p2Outside, parameters);
          }

          context.restore();
        }
      }
    } catch (error) {
      console.error("[Triangle Guardian] Layer draw error:", error);
    }
  },
});

/**
 * Check if any of the segment's points are in the selection or hover set.
 */
function isSegmentSelected(indices, selectedSet, hoveredSet) {
  for (const idx of indices) {
    if (selectedSet.has(idx) || hoveredSet.has(idx)) return true;
  }
  return false;
}

/**
 * Draw the standard Adobe control-point triangle.
 * Fills green if both handles are inside, red if either is outside.
 */
function drawSimpleTriangle(ctx, P0, P1, P2, P3, apex, p1Outside, p2Outside, p) {
  const anyViolation = p1Outside || p2Outside;
  const fillColor = anyViolation ? p.violationColor : p.okColor;

  // Triangle fill
  ctx.beginPath();
  ctx.moveTo(P0.x, P0.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(P3.x, P3.y);
  ctx.closePath();
  ctx.globalAlpha = p.triangleOpacity;
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Dashed triangle stroke
  ctx.setLineDash([p.dashLength, p.dashGap]);
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = p.strokeWidth;
  ctx.stroke();
  ctx.setLineDash([]);

  // Apex dot
  ctx.beginPath();
  ctx.arc(apex.x, apex.y, p.apexRadius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Handle extension lines (dotted)
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = fillColor;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = p.strokeWidth * 0.7;
  ctx.beginPath();
  drawLine(ctx, P0, apex);
  ctx.stroke();
  ctx.beginPath();
  drawLine(ctx, P3, apex);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Violation markers
  if (state.highlightViolations) {
    if (p1Outside) drawViolationMarker(ctx, P1, p);
    if (p2Outside) drawViolationMarker(ctx, P2, p);
  }
}

/**
 * Draw a red circle with a cross on a violating control point.
 */
function drawViolationMarker(ctx, pt, p) {
  const r = p.apexRadius * 1.8;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = p.violationColor;
  ctx.lineWidth = p.strokeWidth * 1.5;
  ctx.stroke();

  // Cross
  ctx.beginPath();
  ctx.moveTo(pt.x - r * 0.6, pt.y - r * 0.6);
  ctx.lineTo(pt.x + r * 0.6, pt.y + r * 0.6);
  ctx.moveTo(pt.x + r * 0.6, pt.y - r * 0.6);
  ctx.lineTo(pt.x - r * 0.6, pt.y + r * 0.6);
  ctx.strokeStyle = p.violationColor;
  ctx.stroke();
}

/**
 * Draw S-curve split triangles (blue) with midpoint-based subdivision.
 */
function drawSCurveTriangles(ctx, P0, P1, P2, P3, p) {
  const M = { x: (P0.x + P3.x) / 2, y: (P0.y + P3.y) / 2 };

  // Triangle A: P0 — M — P1
  drawHalfTriangle(ctx, P0, M, P1, p.sCurveColor, p);
  // Triangle B: P3 — M — P2
  drawHalfTriangle(ctx, P3, M, P2, p.sCurveColor, p);

  // S-curve label
  if (state.showSCurveLabels) {
    const screenPx = Math.round(9 / ctx.getTransform().a);
    ctx.font = `${screenPx}px sans-serif`;
    ctx.fillStyle = p.sCurveColor;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "center";
    ctx.fillText("S", M.x, M.y - 6);
    ctx.globalAlpha = 1;
  }
}

/**
 * Draw one half of an S-curve triangle.
 */
function drawHalfTriangle(ctx, A, B, C, color, p) {
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

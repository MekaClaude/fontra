import { state } from "./triangle-guardian-state.js";
import { computeApex, pointInTriangle, isDegenerate, drawLine } from "./triangle-guardian-geometry.js";

export const LAYER_IDENTIFIER = "com.fontra.plugins.triangle-guardian.overlay";

// Plugins are loaded by the editor with a *native* dynamic import, so bare
// specifiers such as `@fontra/editor/...` cannot be resolved here (the editor's
// import map only maps `fontra/`). Everything this plugin needs is therefore
// either inlined below or reached through the editor instance handed to
// `registerPlugin()`.
const layerDef = {
  identifier: LAYER_IDENTIFIER,
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
  colors: {
    violationColor: "#E24B4A",
    okColor: "#1D9E75",
    sCurveColor: "#185FA5",
  },
  colorsDarkMode: {
    violationColor: "#FF6B6B",
    okColor: "#3ECF9E",
    sCurveColor: "#5BA3E6",
  },
  draw({ context, positionedGlyph, parameters, model, controller }) {
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
  },
};

// `glyphSelector` selects the glyphs that are in a given selection mode. It is
// tiny, so it is inlined rather than imported from the editor bundle.
function glyphSelector(selectionMode) {
  return (visContext, layer) => {
    const glyphs = visContext.glyphsBySelectionMode[selectionMode] || [];
    return layer.selectionFilter ? glyphs.filter(layer.selectionFilter) : glyphs;
  };
}

// `parseSelection` turns a selection of `"point/3"` style items into
// `{ point: [3], ... }`. Inlined to match @fontra/core/utils.ts.
function parseSelection(selection) {
  const result = {};
  for (const item of selection || []) {
    const [tp, index] = item.split("/");
    if (result[tp] === undefined) {
      result[tp] = [];
    }
    result[tp].push(parseInt(index, 10));
  }
  for (const indices of Object.values(result)) {
    indices.sort((a, b) => a - b);
  }
  return result;
}

/**
 * Register the overlay layer with the running editor.
 *
 * `editor.visualizationLayers.definitions` is the live layer-definition array
 * owned by the editor module, so pushing into it registers the layer. The
 * visibility settings object must be updated too, because the editor takes its
 * snapshot of `defaultOn` layers in its constructor — long before plugins load.
 */
export function registerLayer(editor) {
  const visualizationLayers = editor.visualizationLayers;
  if (!visualizationLayers) {
    console.warn("[Triangle Guardian] editor.visualizationLayers not available");
    return;
  }

  const definitions = visualizationLayers.definitions;
  const existing = definitions.findIndex((def) => def.identifier === LAYER_IDENTIFIER);
  if (existing >= 0) {
    definitions.splice(existing, 1, layerDef);
  } else {
    let index = definitions.length;
    for (let i = 0; i < definitions.length; i++) {
      if (definitions[i].zIndex > layerDef.zIndex) {
        index = i;
        break;
      }
    }
    definitions.splice(index, 0, layerDef);
  }

  const settings = editor.visualizationLayersSettings;
  if (settings) {
    settings.model[LAYER_IDENTIFIER] = true;
  }
  visualizationLayers.toggle(LAYER_IDENTIFIER, true);
  editor.canvasController?.requestUpdate();
}

function isSegmentSelected(indices, selectedSet, hoveredSet) {
  // A segment is selected if any of its four points is in the selection or hover set
  for (const idx of indices) {
    if (selectedSet.has(idx) || hoveredSet.has(idx)) return true;
  }
  return false;
}

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

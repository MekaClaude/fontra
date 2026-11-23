// The Sketch Layer visualization layer: draws the stored sketch strokes on
// top of every positioned glyph, in glyph coordinates. Because the layer
// system translates the context to each glyph's position before calling
// draw(), strokes follow the glyph when it is edited, moved, or reflowed in
// a text line.

import { state, strokesFor } from "./sketch-store.js";

export const LAYER_IDENTIFIER = "com.fontra.plugins.sketch-layer.overlay";

export const layerDef = {
  identifier: LAYER_IDENTIFIER,
  name: "Sketch layer",
  selectionFunc: (visContext) => visContext.glyphsBySelectionMode?.all || [],
  userSwitchable: true,
  defaultOn: true,
  zIndex: 150,
  draw: drawSketches,
};

/**
 * Register the layer with the running editor, mirroring the
 * triangle-guardian plugin: push into the live `definitions` array (sorted
 * by zIndex) and make sure the visibility setting exists and is on — the
 * editor snapshots `defaultOn` layers in its constructor, long before
 * plugins load.
 */
export function registerLayer(editor) {
  const visualizationLayers = editor.visualizationLayers;
  if (!visualizationLayers) {
    console.warn("[Sketch Layer] editor.visualizationLayers not available");
    return;
  }

  const definitions = visualizationLayers.definitions;
  const existing = definitions.findIndex(
    (def) => def.identifier === LAYER_IDENTIFIER
  );
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
  if (settings && settings.model[LAYER_IDENTIFIER] === undefined) {
    settings.model[LAYER_IDENTIFIER] = true;
  }
  const enabled = settings?.model?.[LAYER_IDENTIFIER] !== false;
  visualizationLayers.toggle(LAYER_IDENTIFIER, enabled);
}

export function drawSketches({ context, positionedGlyph }) {
  const projectId = state.projectId;
  if (!projectId) {
    return;
  }
  const glyphName = positionedGlyph.glyphName;
  const strokes = strokesFor(projectId, glyphName);
  for (const stroke of strokes) {
    drawStroke(context, stroke);
  }
  const activeStroke = state.activeStroke;
  if (activeStroke && activeStroke.glyphName === glyphName) {
    drawStroke(context, activeStroke);
  }
}

/**
 * Draw one stroke: a smooth polyline through the midpoints (quadratic
 * segments), scaled with the glyph since widths are in glyph units.
 */
export function drawStroke(context, stroke) {
  const points = stroke.points;
  const count = points.length;
  if (!count) {
    return;
  }
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = Math.max(stroke.width, 0.5);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (count === 1) {
    // A single point is a dot.
    const [x, y] = points[0];
    context.beginPath();
    context.arc(x, y, Math.max(stroke.width / 2.2, 0.5), 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  if (count === 2) {
    context.lineTo(points[1][0], points[1][1]);
  } else {
    for (let index = 1; index < count - 1; index++) {
      const [cx, cy] = points[index];
      const [nx, ny] = points[index + 1];
      context.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    const [lx, ly] = points[count - 1];
    context.lineTo(lx, ly);
  }
  context.stroke();
}

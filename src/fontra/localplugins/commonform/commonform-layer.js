// commonform-layer.js
//
// The canvas layer of the Commonform plugin.
//
// It highlights the *common forms* that the last search found: for every
// glyph on the canvas that matched the query shape, the matching contour is
// drawn in a colour that says how well it matched.
//
//   identical  — the same drawing, node for node
//   same       — the same shape, within the tolerance
//   near       — close enough to be worth a look
//
// Plugins are loaded by the editor with a *native* dynamic import, so bare
// specifiers such as `@fontra/editor/...` cannot be resolved here (the editor's
// import map only maps `fontra/`). Everything this plugin needs is therefore
// either inlined below or reached through the editor instance handed to
// `registerPlugin()`.

import { state } from "./commonform-state.js";

export const LAYER_IDENTIFIER = "com.fontra.plugins.commonform.highlight";

const layerDef = {
  identifier: LAYER_IDENTIFIER,
  name: "Commonform",
  selectionFunc: glyphSelector("all"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 205,
  // screenParameters are multiplied by the canvas scale factor, so they may
  // only contain numbers (see visualization-layers.js:56-77).
  screenParameters: {
    strokeWidth: 1.5,
    dashLength: 5,
    dashGap: 4,
    markerSize: 5,
    glowWidth: 6,
  },
  colors: {
    identicalColor: "#1D9E75",
    sameColor: "#185FA5",
    nearColor: "#B8860B",
    mirroredColor: "#E24B4A",
  },
  colorsDarkMode: {
    identicalColor: "#3ECF9E",
    sameColor: "#8FC7FF",
    nearColor: "#E0B155",
    mirroredColor: "#FF6B6B",
  },

  draw({ context, positionedGlyph, parameters, model, controller }) {
    const glyphName = positionedGlyph.glyphName;
    const matches = state.matches.filter((match) => match.glyphName === glyphName);
    if (!matches.length) {
      return;
    }

    const glyph = positionedGlyph.glyph;
    const path = glyph?.path;
    if (!path) {
      return;
    }

    context.save();
    context.lineWidth = parameters.strokeWidth;

    for (const match of matches) {
      if (!tierEnabled(match)) {
        continue;
      }
      const color = colorFor(match, parameters);
      context.strokeStyle = color;
      context.setLineDash(
        match.tier.startsWith("identical") ? [] : [parameters.dashLength, parameters.dashGap]
      );

      // The matched contour, drawn in the glyph's own space.
      const segments = segmentsOfContour(path, match.contourIndex);
      if (!segments.length) {
        continue;
      }
      context.beginPath();
      for (const segment of segments) {
        const points = segment.points;
        if (segment.type === "line" && points.length >= 2) {
          context.moveTo(points[0].x, points[0].y);
          context.lineTo(points[1].x, points[1].y);
        } else if (segment.type === "quad" && points.length >= 3) {
          context.moveTo(points[0].x, points[0].y);
          context.quadraticCurveTo(points[1].x, points[1].y, points[2].x, points[2].y);
        } else if (segment.type === "cubic" && points.length >= 4) {
          context.moveTo(points[0].x, points[0].y);
          context.bezierCurveTo(
            points[1].x,
            points[1].y,
            points[2].x,
            points[2].y,
            points[3].x,
            points[3].y
          );
        }
      }
      context.stroke();
    }

    context.setLineDash([]);
    context.restore();
  },
};

function tierEnabled(match) {
  if (match.tier.startsWith("identical")) {
    return state.showIdentical;
  }
  if (match.tier.startsWith("same")) {
    return state.showSame;
  }
  return state.showNear;
}

function colorFor(match, parameters) {
  if (match.mirrored) {
    return parameters.mirroredColor;
  }
  if (match.tier.startsWith("identical")) {
    return parameters.identicalColor;
  }
  if (match.tier.startsWith("same")) {
    return parameters.sameColor;
  }
  return parameters.nearColor;
}

function segmentsOfContour(path, contourIndex) {
  if (!path?.iterContourDecomposedSegments) {
    return [];
  }
  const segments = [];
  for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
    segments.push({ type: segment.type, points: segment.points });
  }
  return segments;
}

// `glyphSelector` selects the glyphs that are in a given selection mode. It is
// tiny, so it is inlined rather than imported from the editor bundle
// (visualization-layer-definitions.js:40-45).
function glyphSelector(selectionMode) {
  return (visContext, layer) => {
    const glyphs = visContext.glyphsBySelectionMode[selectionMode] || [];
    return layer.selectionFilter ? glyphs.filter(layer.selectionFilter) : glyphs;
  };
}

/**
 * Register the highlight layer with the running editor.
 *
 * `editor.visualizationLayers.definitions` is the live layer-definition array
 * owned by the editor module, so pushing into it registers the layer. The
 * visibility settings object must be updated too, because the editor takes its
 * snapshot of `defaultOn` layers in its constructor — long before plugins load.
 *
 * (There is no `addDefinition()` method on VisualizationLayers; the complete
 * public surface is definitions / requestUpdate / darkTheme / scaleFactor /
 * visibleLayerIds / toggle / buildLayers / drawVisualizationLayers.)
 */
export function registerLayer(editor) {
  const visualizationLayers = editor.visualizationLayers;
  if (!visualizationLayers) {
    console.warn("[Commonform] editor.visualizationLayers not available");
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

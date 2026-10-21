// cadence-layer.js
//
// The canvas layer of the Cadence Spacer plugin.
//
// It draws, for every glyph on the canvas:
//   * the "m/n-beam" (the horizontal line the stems are measured at),
//   * the stem crossings of that beam,
//   * the current left/right sidebearings (the measured space around the
//     glyph), and
//   * optionally the *desired* sidebearings of the last dry run, so the
//     user can see where the glyph is going to move to.
//
// Plugins are loaded by the editor with a *native* dynamic import, so bare
// specifiers such as `@fontra/editor/...` cannot be resolved here (the editor's
// import map only maps `fontra/`). Everything this plugin needs is therefore
// either inlined below or reached through the editor instance handed to
// `registerPlugin()`.

import { state } from "./cadence-state.js";
import { beamCrossings } from "./cadence-engine.js";

export const LAYER_IDENTIFIER = "com.fontra.plugins.cadence-spacer.overlay";

const layerDef = {
  identifier: LAYER_IDENTIFIER,
  name: "Cadence Spacer",
  selectionFunc: glyphSelector("all"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 210,
  // screenParameters are multiplied by the canvas scale factor, so they may
  // only contain numbers (see visualization-layers.js:56-77).
  screenParameters: {
    strokeWidth: 1,
    tickHeight: 60,
    bandOpacity: 0.16,
    dashLength: 6,
    dashGap: 4,
    markerSize: 4,
  },
  colors: {
    beamColor: "#E24B4A",
    crossingColor: "#1D9E75",
    bandColor: "#00BFFF",
    currentColor: "#185FA5",
    desiredColor: "#E24B4A",
  },
  colorsDarkMode: {
    beamColor: "#FF6B6B",
    crossingColor: "#3ECF9E",
    bandColor: "#5BA3E6",
    currentColor: "#8FC7FF",
    desiredColor: "#FF6B6B",
  },
  draw({ context, positionedGlyph, parameters, model, controller }) {
    if (!state.enabled) {
      return;
    }
    const glyph = positionedGlyph.glyph;
    if (!glyph) {
      return;
    }
    const xAdvance = glyph.xAdvance || 0;
    const bounds = glyph.bounds;
    if (!bounds) {
      return;
    }
    const beamY = state.beamY;
    const plan = state.plans.get(positionedGlyph.glyphName) || null;

    context.save();
    context.lineWidth = parameters.strokeWidth;

    // --- the sidebearing bands (the space the glyph does not occupy) ---
    if (state.showSidebearings) {
      context.globalAlpha = parameters.bandOpacity;
      context.fillStyle = parameters.bandColor;
      const top = bounds.yMax;
      const bottom = bounds.yMin;
      if (bounds.xMin > 0) {
        context.fillRect(0, bottom, bounds.xMin, top - bottom);
      }
      if (xAdvance > bounds.xMax) {
        context.fillRect(bounds.xMax, bottom, xAdvance - bounds.xMax, top - bottom);
      }
      context.globalAlpha = 1;
    }

    // --- the current measured sidebearings -------------------------------
    if (plan) {
      context.strokeStyle = parameters.currentColor;
      context.setLineDash([]);
      drawVerticalLine(context, plan.currentLeft, bounds, parameters);
      drawVerticalLine(context, xAdvance - plan.currentRight, bounds, parameters);
    }

    // --- the desired sidebearings ---------------------------------------
    if (state.showDesired && plan) {
      context.strokeStyle = parameters.desiredColor;
      context.setLineDash([parameters.dashLength, parameters.dashGap]);
      drawVerticalLine(context, plan.desiredLeft, bounds, parameters);
      drawVerticalLine(context, xAdvance - plan.desiredRight, bounds, parameters);
      context.setLineDash([]);
    }

    // --- the beam and its stem crossings --------------------------------
    if (state.showBeam) {
      context.strokeStyle = parameters.beamColor;
      context.setLineDash([parameters.dashLength, parameters.dashGap]);
      context.beginPath();
      context.moveTo(0, beamY);
      context.lineTo(xAdvance, beamY);
      context.stroke();
      context.setLineDash([]);
    }

    if (state.showCrossings) {
      const xs = beamCrossings(glyph, beamY);
      context.strokeStyle = parameters.crossingColor;
      const half = parameters.tickHeight / 2;
      context.beginPath();
      for (const x of xs) {
        context.moveTo(x, beamY - half);
        context.lineTo(x, beamY + half);
      }
      context.stroke();
      context.fillStyle = parameters.crossingColor;
      for (const x of xs) {
        context.beginPath();
        context.arc(x, beamY, parameters.markerSize / 2, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.restore();
  },
};

// `glyphSelector` selects the glyphs that are in a given selection mode. It is
// tiny, so it is inlined rather than imported from the editor bundle
// (visualization-layer-definitions.js:40-45).
function glyphSelector(selectionMode) {
  return (visContext, layer) => {
    const glyphs = visContext.glyphsBySelectionMode[selectionMode] || [];
    return layer.selectionFilter ? glyphs.filter(layer.selectionFilter) : glyphs;
  };
}

function drawVerticalLine(context, x, bounds, parameters) {
  if (!Number.isFinite(x)) {
    return;
  }
  context.beginPath();
  context.moveTo(x, bounds.yMin);
  context.lineTo(x, bounds.yMax);
  context.stroke();
}

/**
 * Register the overlay layer with the running editor.
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
    console.warn("[Cadence Spacer] editor.visualizationLayers not available");
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

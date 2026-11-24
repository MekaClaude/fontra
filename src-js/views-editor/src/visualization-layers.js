import { enumerate, withSavedState } from "@fontra/core/utils.ts";
import { mulScalar } from "@fontra/core/var-funcs.js";
import { equalGlyphSelection } from "./scene-controller.js";

export class VisualizationLayers {
  constructor(definitions, darkTheme) {
    this.definitions = definitions;
    this._darkTheme = darkTheme;
    this._scaleFactor = 1;
    this._visibleLayerIds = new Set(
      this.definitions
        .filter((layer) => !layer.userSwitchable || layer.defaultOn)
        .map((layer) => layer.identifier)
    );
    // Layers that threw while drawing. They are switched off for the rest of
    // the session: a layer that throws would otherwise break the canvas
    // render on every frame.
    this._failedLayerIds = new Set();
    this.requestUpdate = () => {
      delete this.layers;
    };
  }

  get darkTheme() {
    return this._darkTheme;
  }

  set darkTheme(darkTheme) {
    this._darkTheme = darkTheme;
    this.requestUpdate();
  }

  get scaleFactor() {
    return this._scaleFactor;
  }

  set scaleFactor(scaleFactor) {
    this._scaleFactor = scaleFactor;
    this.requestUpdate();
  }

  get visibleLayerIds() {
    return this._visibleLayerIds;
  }

  set visibleLayerIds(visibleLayerIds) {
    this._visibleLayerIds = visibleLayerIds;
    this.requestUpdate();
  }

  toggle(layerID, onOff) {
    if (onOff) {
      this._visibleLayerIds.add(layerID);
    } else {
      this._visibleLayerIds.delete(layerID);
    }
    this.requestUpdate();
  }

  buildLayers() {
    const layers = [];
    for (const layerDef of this.definitions) {
      if (!this.visibleLayerIds.has(layerDef.identifier)) {
        continue;
      }
      const parameters = {
        ...mulScalar(layerDef.screenParameters || {}, this.scaleFactor),
        ...(layerDef.glyphParameters || {}),
        ...(layerDef.colors || {}),
        ...(this.darkTheme && layerDef.colorsDarkMode ? layerDef.colorsDarkMode : {}),
      };
      const layer = {
        identifier: layerDef.identifier,
        selectionFunc: layerDef.selectionFunc,
        selectionFilter: layerDef.selectionFilter,
        parameters: parameters,
        draw: layerDef.draw,
      };
      layers.push(layer);
    }
    this.layers = layers;
  }

  drawVisualizationLayers(visContext) {
    if (!this.layers) {
      this.buildLayers();
    }

    const { model, controller } = visContext;
    const context = controller.context;

    for (const layer of this.layers) {
      if (this._failedLayerIds.has(layer.identifier)) {
        continue;
      }
      const items = this._selectItems(layer, visContext);
      if (items === null) {
        continue;
      }
      for (const item of items) {
        withSavedState(context, () => {
          context.translate(item.x, item.y);
          try {
            layer.draw({
              context,
              positionedGlyph: item,
              parameters: layer.parameters,
              model,
              controller,
            });
          } catch (e) {
            this._disableLayer(layer, "draw", e);
          }
        });
      }
    }
  }

  // Returns the items a layer wants to draw, or null if the layer failed and
  // has been switched off.
  _selectItems(layer, visContext) {
    try {
      return layer.selectionFunc(visContext, layer);
    } catch (e) {
      this._disableLayer(layer, "select its glyphs", e);
      return null;
    }
  }

  // A layer that throws must not take the whole canvas down with it: the
  // error would otherwise repeat on every frame, leaving the editor with a
  // half-drawn canvas. Report it once and switch the layer off.
  _disableLayer(layer, what, error) {
    this._failedLayerIds.add(layer.identifier);
    console.error(
      `Visualization layer "${layer.identifier}" failed to ${what} and has been disabled.`,
      error
    );
  }
}

export class VisualizationContext {
  constructor(model, controller) {
    this.model = model;
    this.controller = controller;
    this.glyphsBySelectionMode = getGlyphsBySelectionMode(model);
  }
}

function getGlyphsBySelectionMode(model) {
  const selectedPositionedGlyph = model.getSelectedPositionedGlyph();
  const allPositionedGlyphs = model.positionedLines.flatMap((line) => line.glyphs);
  return {
    all: allPositionedGlyphs,
    unselected: allPositionedGlyphs.filter(
      (glyph) => glyph !== selectedPositionedGlyph
    ),
    hovered:
      model.hoveredGlyph &&
      !equalGlyphSelection(model.hoveredGlyph, model.selectedGlyph)
        ? hoveredGlyphs(model)
        : [],
    selected:
      model.selectedGlyph && !model.selectedGlyph.isEditing
        ? selectedGlyphs(model)
        : [],
    editing: model.selectedGlyph?.isEditing ? selectedGlyphs(model) : [],
    notediting: allPositionedGlyphs.filter(
      (glyph) => glyph !== selectedPositionedGlyph || !model.selectedGlyph?.isEditing
    ),
  };
}

/**
 * The same glyphs as `getGlyphsBySelectionMode()`, but each one comes with the
 * line and glyph index it has in the scene. This is what a panel needs when
 * it wants to select a glyph, for example when the user clicks a finding.
 */
export function getGlyphEntriesBySelectionMode(model) {
  const glyphsBySelectionMode = getGlyphsBySelectionMode(model);

  const entryByGlyph = new Map();
  for (const [lineIndex, line] of enumerate(model.positionedLines || [])) {
    for (const [glyphIndex, positionedGlyph] of enumerate(line.glyphs || [])) {
      if (!entryByGlyph.has(positionedGlyph)) {
        entryByGlyph.set(positionedGlyph, {
          positionedGlyph,
          lineIndex,
          glyphIndex,
        });
      }
    }
  }

  const result = {};
  for (const [mode, glyphs] of Object.entries(glyphsBySelectionMode)) {
    result[mode] = glyphs
      .map((positionedGlyph) => entryByGlyph.get(positionedGlyph))
      .filter((entry) => entry !== undefined);
  }
  return result;
}

function hoveredGlyphs(model) {
  const glyph = model.getHoveredPositionedGlyph();
  return glyph ? [glyph] : [];
}

function selectedGlyphs(model) {
  const glyph = model.getSelectedPositionedGlyph();
  return glyph ? [glyph] : [];
}

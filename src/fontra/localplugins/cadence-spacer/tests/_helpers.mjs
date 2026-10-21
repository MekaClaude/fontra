// tests/_helpers.mjs
//
// The test doubles for the Cadence Spacer: a fake font, a fake glyph
// controller and a fake editor.
//
// The engine is duck-typed on purpose — it only needs a controller that
// exposes `flattenedPathHitTester`, `bounds`, `xAdvance`, `leftMargin` and
// `rightMargin` — so the fakes below are enough to exercise the whole
// measure/plan/apply cycle without a browser.

/**
 * The mutable part of a glyph: the thing an edit changes.
 *
 * A real `StaticGlyph` moves its path, its components, its anchors and its
 * guidelines; for the purposes of these tests, moving the bounding box is
 * enough — and it is what the margins are derived from.
 */
export class FakeLayerGlyph {
  constructor({ xAdvance = 500, xMin = 50, xMax = 450, yMin = 0, yMax = 700 } = {}) {
    this.xAdvance = xAdvance;
    this.xMin = xMin;
    this.xMax = xMax;
    this.yMin = yMin;
    this.yMax = yMax;
    this.moves = [];
  }

  move(dx, dy) {
    this.xMin += dx;
    this.xMax += dx;
    this.yMin += dy;
    this.yMax += dy;
    this.moves.push([dx, dy]);
  }
}

/**
 * A glyph controller: the object the engine measures.
 *
 * Its `xAdvance`, `bounds` and margins are live views of the layer glyph, so
 * that a measurement taken after an edit sees the new state.
 */
export function makeController(layerGlyph, { crossings = [], layerName = "regular" } = {}) {
  return {
    layerName,
    get xAdvance() {
      return layerGlyph.xAdvance;
    },
    get bounds() {
      return {
        xMin: layerGlyph.xMin,
        yMin: layerGlyph.yMin,
        xMax: layerGlyph.xMax,
        yMax: layerGlyph.yMax,
      };
    },
    get leftMargin() {
      return layerGlyph.xMin;
    },
    get rightMargin() {
      return layerGlyph.xAdvance - layerGlyph.xMax;
    },
    flattenedPathHitTester: {
      rayIntersections(pivot, direction) {
        return crossings.map((x) => ({ x, y: pivot.y }));
      },
    },
  };
}

/**
 * A fake editor with a fake font in it.
 *
 * @param {object} options
 * @param {object} options.glyphs  { glyphName: { xAdvance, xMin, xMax, yMin,
 *                          yMax, crossings, layers, customData } }
 *                          `layers` overrides the layer name; `crossings` is
 *                          where the beam hits the outline.
 * @param {boolean} [options.readOnly]
 * @param {string} [options.editingLayerName]
 */
export function makeFakeEditor({
  glyphs = {},
  readOnly = false,
  editingLayerName = "regular",
} = {}) {
  const layerGlyphs = {};
  const controllers = {};
  const undoLabels = [];

  const layerNameOf = (glyph) => glyph.layers || editingLayerName;

  const buildGlyph = (glyphName) => {
    const glyph = glyphs[glyphName];
    const layerName = layerNameOf(glyph);
    const key = `${glyphName}/${layerName}`;
    if (!layerGlyphs[key]) {
      layerGlyphs[key] = new FakeLayerGlyph(glyph);
    }
    if (!controllers[key]) {
      controllers[key] = makeController(layerGlyphs[key], {
        crossings: glyph.crossings || [],
        layerName,
      });
    }
    return {
      glyph: {
        name: glyphName,
        sources: [{ name: glyphName, location: {}, layerName }],
        layers: {
          [layerName]: {
            glyph: layerGlyphs[key],
            customData: {},
          },
        },
        customData: glyph.customData || {},
      },
    };
  };

  const editor = {
    undoLabels,
    fontController: {
      glyphMap: { ...glyphs },
      readOnly,
      hasGlyph(glyphName) {
        return glyphName in glyphs;
      },
      async getGlyph(glyphName) {
        if (!(glyphName in glyphs)) {
          return null;
        }
        return buildGlyph(glyphName);
      },
    },
    sceneController: {
      editingLayerNames: editingLayerName ? [editingLayerName] : [],
      sceneSettings: { selectedGlyphName: null },
      getEditingLayerFromGlyphLayers(layers) {
        const editing = {};
        for (const name of Object.keys(layers || {})) {
          if (name === editingLayerName) {
            editing[name] = layers[name];
          }
        }
        return editing;
      },
      sceneModel: {
        async getGlyphInstance(glyphName, layerName) {
          if (!(glyphName in glyphs)) {
            return null;
          }
          buildGlyph(glyphName);
          const key = `${glyphName}/${layerName}`;
          if (!controllers[key]) {
            // The requested layer does not exist on this glyph: the real font
            // controller falls back to the interpolated instance, and the
            // engine detects that by comparing the layer name.
            return controllers[`${glyphName}/${editingLayerName}`] || null;
          }
          return controllers[key];
        },
      },
      async editNamedGlyphAndRecordChanges(glyphName, editFunc) {
        if (readOnly) {
          return undefined;
        }
        const varGlyph = buildGlyph(glyphName).glyph;
        const label = editFunc(varGlyph);
        undoLabels.push(label);
        return label;
      },
    },
  };

  /** The live layer glyph of a glyph — for the assertions. */
  editor.layerGlyph = (glyphName, layerName = editingLayerName) =>
    layerGlyphs[`${glyphName}/${layerName}`];
  /** The live controller of a glyph — for the assertions. */
  editor.controller = (glyphName, layerName = editingLayerName) =>
    controllers[`${glyphName}/${layerName}`];
  /** The x positions where the beam hits a glyph. */
  editor.setCrossings = (glyphName, crossings) => {
    const key = `${glyphName}/${editingLayerName}`;
    if (controllers[key]) {
      controllers[key].flattenedPathHitTester.rayIntersections = (pivot) =>
        crossings.map((x) => ({ x, y: pivot.y }));
    }
  };

  // Build every glyph up front, so that a test can look at a controller
  // without having to go through the editor first.
  for (const glyphName of Object.keys(glyphs)) {
    buildGlyph(glyphName);
  }

  return editor;
}

/**
 * A reference glyph: two stems, 250 units apart.
 *
 * The beam crosses it four times, so the stem interval is 250 — the number
 * every measurement in the tests is built on.
 */
export const REFERENCE_CROSSINGS = [50, 120, 300, 370];

// tests/_helpers.mjs
//
// The test doubles: shape builders, a fake path, and a fake editor.
//
// The shapes are plain data — arrays of {x, y, type} — because that is what
// the engine works on. Nothing here imports Fontra.

const ON_CURVE = "oncurve";

// ---------------------------------------------------------------------------
// Shape builders
// ---------------------------------------------------------------------------

/** A circle. */
export function circleContour(cx, r, steps = 32) {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    points.push({ x: cx + r * Math.cos(t), y: r * Math.sin(t), type: ON_CURVE });
  }
  return { points, isClosed: true };
}

/**
 * A bowl: the lower half of a circle, closed by a straight top edge.
 *
 * It is the shape the plugin is really about — the bowl of b/d/p/q — and it is
 * *not* a circle, so the two must never be reported as the same shape.
 */
export function bowlContour(cx, cy, r, steps = 16) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI + (i / steps) * Math.PI;
    points.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), type: ON_CURVE });
  }
  return { points, isClosed: true };
}

/** A rectangle. */
export function rectContour(x, y, w, h) {
  return {
    points: [
      { x, y, type: ON_CURVE },
      { x: x + w, y, type: ON_CURVE },
      { x: x + w, y: y + h, type: ON_CURVE },
      { x, y: y + h, type: ON_CURVE },
    ],
    isClosed: true,
  };
}

/**
 * A closed blob with no symmetry at all.
 *
 * The radii and the angles are both irregular, so the shape has no mirror
 * symmetry and no rotational symmetry either. That is what makes it usable
 * for testing the *orientation* of a match: a mirrored copy of it can only
 * match as "mirrored", a flipped copy only as "flipped".
 */
export function asymmetricContour(cx = 0, cy = 0, scale = 100) {
  const radii = [1.0, 0.72, 0.95, 0.55, 0.88, 0.63, 1.12, 0.48];
  const angles = [0.0, 0.62, 1.31, 1.98, 2.55, 3.31, 4.12, 5.05];
  return {
    points: radii.map((r, i) => ({
      x: cx + r * scale * Math.cos(angles[i]),
      y: cy + r * scale * Math.sin(angles[i]),
      type: ON_CURVE,
    })),
    isClosed: true,
  };
}

/** The same shape, mirrored across the vertical axis. */
export function mirroredContour(contour) {
  return {
    points: contour.points.map((point) => ({ ...point, x: -point.x })),
    isClosed: contour.isClosed,
  };
}

/** The same shape, moved. */
export function translatedContour(contour, dx, dy) {
  return {
    points: contour.points.map((point) => ({ x: point.x + dx, y: point.y + dy, type: point.type })),
    isClosed: contour.isClosed,
  };
}

/**
 * The same shape, with every point nudged by up to `amount` units.
 *
 * The jitter is deterministic — a hash of the point's index — so a failing
 * test always fails the same way.
 */
export function perturbedContour(contour, amount) {
  return {
    points: contour.points.map((point, index) => {
      const h = Math.sin(index * 12.9898) * 43758.5453;
      const jitter = (h - Math.floor(h) - 0.5) * 2 * amount;
      return { x: point.x + jitter, y: point.y - jitter * 0.5, type: point.type };
    }),
    isClosed: contour.isClosed,
  };
}

/**
 * Attach the polyline that `prepareContour` would otherwise derive.
 *
 * The engine can build the polyline from the contour's *segments* on its own
 * (that is what `segmentsToPolyline` is for); this helper is the shortcut
 * for the tests that do not care about that path.
 */
export function withPolyline(contour) {
  return {
    points: contour.points,
    isClosed: contour.isClosed,
    polyline: contour.points.map((point) => ({ x: point.x, y: point.y })),
  };
}

/** A contour as the *segments* the engine's own decomposition produces. */
export function withSegments(contour) {
  const segments = [];
  for (let i = 0; i < contour.points.length; i++) {
    const a = contour.points[i];
    const b = contour.points[(i + 1) % contour.points.length];
    segments.push({ type: "line", points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] });
  }
  return { points: contour.points, isClosed: contour.isClosed, segments };
}

// ---------------------------------------------------------------------------
// A fake path
// ---------------------------------------------------------------------------

/**
 * A stand-in for Fontra's `VarPackedPath`, with the parts the plugin uses:
 * the contour info, the unpacked contours, the absolute point indices, and
 * the decomposed segments.
 */
export function makeFakePath(contours) {
  const starts = [];
  let index = 0;
  for (const contour of contours) {
    starts.push(index);
    index += contour.points.length;
  }
  return {
    contourInfo: contours.map((contour) => ({ isClosed: contour.isClosed })),
    getUnpackedContour(contourIndex) {
      const contour = contours[contourIndex];
      return { points: contour.points, isClosed: contour.isClosed };
    },
    getAbsolutePointIndex(contourIndex, contourPointIndex) {
      return starts[contourIndex] + contourPointIndex;
    },
    getNumPointsOfContour(contourIndex) {
      return contours[contourIndex].points.length;
    },
    iterContourDecomposedSegments(contourIndex) {
      const contour = contours[contourIndex];
      const segments = [];
      for (let i = 0; i < contour.points.length; i++) {
        const a = contour.points[i];
        const b = contour.points[(i + 1) % contour.points.length];
        segments.push({ type: "line", points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] });
      }
      return segments;
    },
  };
}

// ---------------------------------------------------------------------------
// A fake editor
// ---------------------------------------------------------------------------

/**
 * A stand-in for the editor, with just the surface the plugin's font bridge
 * uses: the selection, the current glyph, the glyph map, and the way to get
 * a glyph instance.
 *
 * @param {object} options
 * @param {object} options.glyphs  { glyphName: { contours: [...], layerName } }
 * @param {Set<string>} [options.selection]
 * @param {string} [options.selectedGlyphName]
 */
export function makeFakeEditor({
  glyphs = {},
  selection = new Set(),
  selectedGlyphName = null,
  layerName = null,
} = {}) {
  const instances = {};

  const editor = {
    fontController: {
      glyphMap: { ...glyphs },
      readOnly: false,
      hasGlyph(glyphName) {
        return glyphName in glyphs;
      },
      async getGlyph(glyphName) {
        if (!(glyphName in glyphs)) {
          return null;
        }
        const glyph = glyphs[glyphName];
        return {
          glyph: {
            layers: {
              [glyph.layerName || "regular"]: {
                glyph: {
                  xAdvance: glyph.xAdvance ?? 500,
                  path: makeFakePath(glyph.contours || []),
                },
              },
            },
            customData: glyph.customData || {},
          },
        };
      },
      async getLayerGlyphController(glyphName, wantedLayerName, sourceIndex) {
        const key = `${glyphName}/${wantedLayerName}/${sourceIndex}`;
        if (!instances[key]) {
          const glyph = glyphs[glyphName];
          instances[key] = {
            layerName: wantedLayerName,
            path: makeFakePath(glyph?.contours || []),
            components: [],
          };
        }
        return instances[key];
      },
    },
    sceneController: {
      selection,
      editingLayerNames: layerName ? [layerName] : [],
      sceneSettings: { selectedGlyphName },
      sceneModel: {
        async getGlyphInstance(glyphName, wantedLayerName) {
          const glyph = glyphs[glyphName];
          if (!glyph) {
            return null;
          }
          const key = `${glyphName}/${wantedLayerName}`;
          if (!instances[key]) {
            instances[key] = {
              layerName: wantedLayerName ?? glyph.layerName ?? "regular",
              path: makeFakePath(glyph.contours || []),
              components: (glyph.components || []).map((component) => ({
                name: component.name,
                path: makeFakePath(component.contours || []),
              })),
            };
          }
          return instances[key];
        },
      },
    },
  };
  return editor;
}

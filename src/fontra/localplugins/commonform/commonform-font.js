// commonform-font.js
//
// The Fontra-facing half of the plugin: everything that has to talk to the
// editor.
//
// It is deliberately thin. It converts Fontra's data into the plain data the
// engine works on, and nothing more:
//
//   * the user's selection  ->  a query shape
//   * the font's glyphs     ->  a list of candidate shapes
//
// The geometry itself lives in `commonform-engine.js`, which knows nothing
// about Fontra and can be unit-tested in plain Node.

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Parse Fontra's selection set.
 *
 * The selection is a `Set` of strings like "point/17", "component/2",
 * "anchor/0" (scene-model.js:707-724 builds them that way).
 */
export function parseSelection(selection) {
  const result = { point: [], component: [], anchor: [] };
  if (!selection) {
    return result;
  }
  for (const item of selection) {
    const slash = item.indexOf("/");
    if (slash < 0) {
      continue;
    }
    const type = item.slice(0, slash);
    const index = parseInt(item.slice(slash + 1), 10);
    if (!Number.isFinite(index)) {
      continue;
    }
    if (!result[type]) {
      result[type] = [];
    }
    result[type].push(index);
  }
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a - b);
  }
  return result;
}

/**
 * The contours of a `VarPackedPath`, as plain data.
 *
 * `startIndex` is the absolute index of the contour's first point, so that
 * the absolute point indices of a selection can be mapped back onto it.
 */
export function contoursFromPath(path) {
  const contours = [];
  if (!path || !path.contourInfo) {
    return contours;
  }
  for (let contourIndex = 0; contourIndex < path.contourInfo.length; contourIndex++) {
    const contour = path.getUnpackedContour(contourIndex);
    contours.push({
      points: contour.points.map((point) => ({
        x: point.x,
        y: point.y,
        type: point.type,
      })),
      isClosed: contour.isClosed,
      startIndex: path.getAbsolutePointIndex(contourIndex, 0),
      contourIndex,
    });
  }
  return contours;
}

/**
 * The flattened segments of one contour, as Fontra's own decomposition has
 * them. `path.iterContourDecomposedSegments()` is public API
 * (var-path.js:813-826) and yields {type, points} for every line, quad and
 * cubic of the contour.
 */
export function segmentsForContour(path, contourIndex) {
  const segments = [];
  if (!path || !path.iterContourDecomposedSegments) {
    return segments;
  }
  for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
    segments.push({
      type: segment.type,
      points: segment.points.map((point) => ({ x: point.x, y: point.y })),
    });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Getting a glyph's instance
// ---------------------------------------------------------------------------

/**
 * Get the instance of a glyph at a given layer.
 *
 * The scene model's own `getGlyphInstance(glyphName, layerName)` is
 * scene-aware and is what the editor itself uses. The font controller's
 * `getGlyphInstance(glyphName, sourceLocation, layerName)` needs a source
 * location: it builds its cache key with `locationToString(sourceLocation)`,
 * and `locationToString(undefined)` throws
 * `TypeError: Cannot convert undefined or null to object`
 * (font-controller.js:636-641 -> var-model.js:285-292).
 */
export async function getGlyphInstance(editor, glyphName, layerName) {
  const sceneModel = editor.sceneController?.sceneModel;
  if (sceneModel?.getGlyphInstance) {
    const controller = await sceneModel.getGlyphInstance(glyphName, layerName);
    if (layerName == null) {
      return controller;
    }
    // The font controller silently falls back to the interpolated instance
    // when the requested layer does not exist on this glyph
    // (glyph-controller.js:450-457) — detect that and report "no layer".
    if (!controller || controller.layerName !== layerName) {
      return null;
    }
    return controller;
  }

  const fontController = editor.fontController;
  const varGlyph = await fontController.getGlyph?.(glyphName);
  const sourceIndex = varGlyph?.getSourceIndexForLayerName?.(layerName);
  if (!fontController.getLayerGlyphController) {
    return null;
  }
  return fontController.getLayerGlyphController(glyphName, layerName, sourceIndex);
}

/**
 * The layer that is being edited, or null when the glyph has exactly one
 * layer (in which case there is no ambiguity).
 */
export async function resolveLayerName(editor, glyphName) {
  const editingLayerNames = editor.sceneController?.editingLayerNames || [];
  if (editingLayerNames.length) {
    return editingLayerNames[0];
  }
  const fontController = editor.fontController;
  const varGlyph = await fontController.getGlyph?.(glyphName);
  const layers = varGlyph?.glyph?.layers || {};
  const names = Object.keys(layers).filter((name) => layers[name]?.glyph);
  return names.length === 1 ? names[0] : null;
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * Work out what the user has selected, and turn it into a query shape.
 *
 * Two things can be selected:
 *
 *   * points of the glyph's outline — the shapes are the *whole contours*
 *     those points belong to, because a partial arc is not a shape;
 *   * a component — the shape is the component's own outline, already
 *     transformed into the parent glyph's space (ComponentController.path is
 *     built by `flattenComponent`, glyph-controller.js:954-960).
 *
 * @returns {Promise<{ok: boolean, reason?: string, contours: Array,
 *                    glyphName: string|null, source: string}>}
 */
export async function buildQuery(editor) {
  const sceneController = editor.sceneController;
  const selection = sceneController?.selection;
  const glyphName =
    sceneController?.sceneSettings?.selectedGlyphName ??
    sceneController?.sceneSettings?.substituteGlyphName ??
    null;

  if (!glyphName) {
    return { ok: false, reason: "No glyph is open.", contours: [], glyphName: null, source: "none" };
  }

  const parsed = parseSelection(selection);
  const layerName = await resolveLayerName(editor, glyphName);
  const controller = await getGlyphInstance(editor, glyphName, layerName);
  if (!controller) {
    return {
      ok: false,
      reason: `Could not load the glyph "${glyphName}".`,
      contours: [],
      glyphName,
      source: "none",
    };
  }

  // --- a component was selected -----------------------------------------
  if (parsed.component.length) {
    const contours = [];
    for (const componentIndex of parsed.component) {
      const component = controller.components?.[componentIndex];
      if (!component?.path) {
        continue;
      }
      for (const contour of contoursFromPath(component.path)) {
        contours.push({
          ...contour,
          polyline: [],
          segments: segmentsForContour(component.path, contour.contourIndex),
        });
      }
    }
    if (!contours.length) {
      return {
        ok: false,
        reason: "The selected component has no outline.",
        contours: [],
        glyphName,
        source: "component",
      };
    }
    return {
      ok: true,
      contours,
      glyphName,
      source: "component",
      layerName,
    };
  }

  // --- points were selected ----------------------------------------------
  if (!parsed.point.length) {
    return {
      ok: false,
      reason:
        "Select a shape first: a component, or the points of a contour. " +
        "(Font → select, or drag over the outline.)",
      contours: [],
      glyphName,
      source: "none",
    };
  }

  const path = controller.path;
  const contours = contoursFromPath(path);
  const shapes = [];
  for (const contour of contours) {
    const touched = parsed.point.some(
      (absolute) =>
        absolute >= contour.startIndex &&
        absolute < contour.startIndex + contour.points.length
    );
    if (!touched) {
      continue;
    }
    shapes.push({
      ...contour,
      segments: segmentsForContour(path, contour.contourIndex),
    });
  }

  if (!shapes.length) {
    return {
      ok: false,
      reason: "The selection does not touch any contour of this glyph.",
      contours: [],
      glyphName,
      source: "none",
    };
  }

  const openCount = shapes.filter((shape) => !shape.isClosed).length;
  return {
    ok: true,
    contours: shapes,
    glyphName,
    source: "points",
    layerName,
    openCount,
  };
}

// ---------------------------------------------------------------------------
// The candidates
// ---------------------------------------------------------------------------

/**
 * Walk the font and collect every closed contour as a candidate shape.
 *
 * @param {object} editor
 * @param {object} options
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<Array<{glyphName: string, contourIndex: number, contour: object}>>}
 */
export async function collectCandidates(editor, { onProgress, glyphNames } = {}) {
  const fontController = editor.fontController;
  const names = glyphNames || Object.keys(fontController.glyphMap || {});
  const candidates = [];

  for (let i = 0; i < names.length; i++) {
    const glyphName = names[i];
    let controller = null;
    try {
      controller = await getGlyphInstance(editor, glyphName, null);
    } catch (e) {
      controller = null;
    }
    if (controller?.path) {
      const path = controller.path;
      const contourCount = path.contourInfo?.length || 0;
      for (let contourIndex = 0; contourIndex < contourCount; contourIndex++) {
        const contour = path.getUnpackedContour(contourIndex);
        if (!contour.isClosed || contour.points.length < 3) {
          // Only closed contours are shapes; an open run is an arc.
          continue;
        }
        candidates.push({
          glyphName,
          contourIndex,
          contour: {
            points: contour.points.map((point) => ({
              x: point.x,
              y: point.y,
              type: point.type,
            })),
            isClosed: true,
            segments: segmentsForContour(path, contourIndex),
          },
        });
      }
    }
    if (onProgress) {
      onProgress(i + 1, names.length);
    }
  }
  return candidates;
}

/**
 * Open a glyph and select one of its contours.
 *
 * The selection is a set of "point/N" strings, where N is the *absolute*
 * point index in the path (scene-model.js:707-724), so selecting a contour
 * means listing the absolute indices of all of its points.
 */
export async function selectContour(editor, glyphName, contourIndex) {
  const sceneController = editor.sceneController;
  if (!sceneController) {
    return false;
  }

  const layerName = await resolveLayerName(editor, glyphName);
  const controller = await getGlyphInstance(editor, glyphName, layerName);
  const path = controller?.path;
  if (!path) {
    return false;
  }

  const start = path.getAbsolutePointIndex(contourIndex, 0);
  const count = path.getNumPointsOfContour(contourIndex);
  const selection = new Set();
  for (let i = 0; i < count; i++) {
    selection.add(`point/${start + i}`);
  }

  sceneController.sceneSettings.selectedGlyphName = glyphName;
  sceneController.selection = selection;
  return true;
}

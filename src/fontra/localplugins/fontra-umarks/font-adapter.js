// The bridge between Fontra's asynchronous `fontController` and the pure,
// synchronous `font` object compose.js and suggest.js expect.
//
// compose.js is deliberately synchronous: a composition is arithmetic on
// anchors, and arithmetic should be testable in Node without a font server.
// So the glyphs a job needs are loaded first, then handed over as a snapshot.
// `fontController.getGlyphInstance` has its own cache, so loading the same
// glyph again for the next batch of fifty costs nothing.

import { LEGACY_REFERENCE, isLegacyRule } from "./compose.js";
import { RULES_KEY } from "./rules.js";

/**
 * The font's sources, sorted the way Fontra sorts them, sparse ones left out:
 * a composed glyph gets a layer per real master, not per support master.
 */
export function fontSources(fontController) {
  return fontController
    .getSortedSourceIdentifiers(true)
    .map((identifier) => ({
      identifier,
      name: fontController.sources[identifier].name,
      location: fontController.sources[identifier].location,
    }));
}

/**
 * {xHeight, capHeight, ascender, descender, baseline, italicAngle} of a font
 * source: Fontra keeps each metric as {value, zone}, we want the numbers.
 */
export function sourceMetrics(source) {
  const metrics = { italicAngle: source?.italicAngle || 0 };
  for (const [name, metric] of Object.entries(
    source?.lineMetricsHorizontalLayout || {}
  )) {
    if (typeof metric?.value === "number") {
      metrics[name] = metric.value;
    }
  }
  return metrics;
}

/** Every glyph a rule touches, the composed one included. */
export function glyphsNeededBy(glyphName, rule) {
  if (isLegacyRule(rule)) {
    // its margin is read from `o`
    return [glyphName, rule.legacy, LEGACY_REFERENCE];
  }
  const names = new Set([glyphName, rule.base]);
  for (const mark of rule.marks || []) {
    names.add(mark.glyph);
  }
  for (const appended of rule.append || []) {
    names.add(appended);
  }
  return [...names].filter((name) => name);
}

export function glyphsNeededByRules(entries) {
  const names = new Set();
  for (const [glyphName, rule] of entries) {
    for (const name of glyphsNeededBy(glyphName, rule)) {
      names.add(name);
    }
  }
  return [...names];
}

function instanceKey(glyphName, sourceIdentifier) {
  return `${glyphName}\n${sourceIdentifier}`;
}

// code point -> glyph names, rebuilt when the font gains or loses glyphs, or
// when the panel says the glyph map changed (a rename keeps the count)
const characterIndexCache = new WeakMap();

/** Forget the index by code point: the glyph map changed (5 bis § 4). */
export function invalidateCharacterIndex(fontController) {
  characterIndexCache.delete(fontController);
}

function characterIndex(fontController) {
  const glyphMap = fontController.glyphMap || {};
  const cached = characterIndexCache.get(fontController);
  const size = Object.keys(glyphMap).length;
  if (cached && cached.size === size) {
    return cached.index;
  }
  const index = new Map();
  for (const [glyphName, codePoints] of Object.entries(glyphMap)) {
    for (const codePoint of codePoints || []) {
      if (!index.has(codePoint)) {
        index.set(codePoint, []);
      }
      index.get(codePoint).push(glyphName);
    }
  }
  characterIndexCache.set(fontController, { size, index });
  return index;
}

/**
 * Load what these glyphs need, then hand back the synchronous adapter.
 * A glyph the font does not have simply answers null, which is how
 * compose.js reports `missing-glyph`.
 */
export async function loadFontAdapter(fontController, glyphNames) {
  const sources = fontSources(fontController);
  const instances = new Map();
  // why an instance could not be read, said rather than swallowed (5 bis § 5)
  const errors = new Map();
  // glyphName -> the font sources the glyph has a source of its own at
  const ownSources = new Map();
  // glyphName + source -> the customData of the glyph's layer there
  const layerCustomData = new Map();

  const jobs = [];
  for (const glyphName of new Set(glyphNames)) {
    if (!glyphName || !fontController.hasGlyph(glyphName)) {
      continue;
    }
    for (const source of sources) {
      jobs.push(
        fontController
          .getGlyphInstance(glyphName, source.location)
          .then((instance) =>
            instances.set(instanceKey(glyphName, source.identifier), instance || null)
          )
          .catch((error) => {
            instances.set(instanceKey(glyphName, source.identifier), null);
            errors.set(instanceKey(glyphName, source.identifier), String(error?.message || error));
          })
      );
    }
    if (fontController.getGlyph) {
      jobs.push(
        Promise.resolve(fontController.getGlyph(glyphName))
          .then((variableGlyph) => {
            const glyph = variableGlyph?.glyph ?? variableGlyph;
            if (glyph?.sources) {
              const at = glyph.sources.map((source) => [
                source,
                fontSourceOfGlyphSource(fontController, source),
              ]);
              ownSources.set(
                glyphName,
                new Set(at.map(([, identifier]) => identifier).filter((identifier) => identifier))
              );
              for (const [source, identifier] of at) {
                const customData = glyph.layers?.[source.layerName]?.customData;
                if (identifier && customData) {
                  layerCustomData.set(instanceKey(glyphName, identifier), customData);
                }
              }
            }
          })
          .catch(() => {})
      );
    }
  }
  await Promise.all(jobs);
  const defaultSource = fontController.defaultSourceIdentifier;

  const legacyMargin = fontController.customData?.[RULES_KEY]?.settings?.legacyAccentMargin;
  return {
    sources,
    glyphMap: fontController.glyphMap,
    unitsPerEm: fontController.unitsPerEm,
    // the margin of the legacy accents, when the document sets one (compose.js)
    legacyAccentMargin: typeof legacyMargin === "number" ? legacyMargin : undefined,

    // the source a part must be drawn in to be used at all (5 bis § 5)
    defaultSourceIdentifier: sources.some((source) => source.identifier === defaultSource)
      ? defaultSource
      : sources[0]?.identifier,

    hasGlyph(glyphName) {
      return fontController.hasGlyph(glyphName);
    },

    /** Why the glyph could not be read in that source — Fontra's error — or null. */
    readError(glyphName, sourceIdentifier) {
      return errors.get(instanceKey(glyphName, sourceIdentifier)) ?? null;
    },

    /** The customData of the glyph's own layer at this font source, or null. */
    getLayerCustomData(glyphName, sourceIdentifier) {
      return layerCustomData.get(instanceKey(glyphName, sourceIdentifier)) ?? null;
    },

    /**
     * Does the glyph have a source of its own at this font source, or is what
     * getLayerGlyph gives there interpolated? Undefined when not known.
     */
    hasOwnSource(glyphName, sourceIdentifier) {
      const own = ownSources.get(glyphName);
      return own && own.size ? own.has(sourceIdentifier) : undefined;
    },

    glyphNamesForCodePoint(codePoint) {
      return characterIndex(fontController).get(codePoint) || [];
    },

    getLayerGlyph(glyphName, sourceIdentifier) {
      const controller = instances.get(instanceKey(glyphName, sourceIdentifier));
      if (!controller) {
        return null;
      }
      // A StaticGlyphController wraps each component in a controller of its
      // own ({compo, path, …}), so `components[i].name` is undefined on it.
      // The plain StaticGlyph underneath is what the pure modules read.
      return controller.instance ?? controller;
    },

    /**
     * The glyph as compose.js places it: for a glyph made of components, its
     * own anchors followed by those of its components, transformed — Fontra's
     * `propagatedAnchors`, what its shaper uses. That is how a composed glyph
     * is a base in its turn without any anchor copied onto it.
     */
    getPositioningGlyph(glyphName, sourceIdentifier) {
      const controller = instances.get(instanceKey(glyphName, sourceIdentifier));
      if (!controller) {
        return null;
      }
      const glyph = controller.instance ?? controller;
      if (!glyph.components?.length || !controller.propagatedAnchors) {
        return glyph;
      }
      return { ...glyph, anchors: controller.propagatedAnchors, components: glyph.components };
    },

    getBounds(glyphName, sourceIdentifier) {
      return instances.get(instanceKey(glyphName, sourceIdentifier))?.bounds ?? null;
    },

    /** The line metrics and italic angle of a source, as anchors.js reads them. */
    getSourceMetrics(sourceIdentifier) {
      return sourceMetrics(fontController.sources[sourceIdentifier]);
    },

    /** True when a glyph was asked for but is not in this snapshot. */
    isLoaded(glyphName) {
      return sources.every((source) =>
        instances.has(instanceKey(glyphName, source.identifier))
      );
    },
  };
}

/**
 * The font source a glyph source stands at, or null. A glyph source made in
 * Fontra names it (`locationBase`); one written with a location and no
 * locationBase — a UFO imported before Fontra wrote locationBase, the Glyphs
 * and rcjk backends — stands at the font source that has the same location
 * on the font's axes. Only the font's axes count: fontrahive.com, 9 November,
 * a font without axes whose single source still said `{weight: 400}` and
 * whose glyph sources said `{}` — « 101 with no layer in some source »,
 * Place anchors writing nothing. A sparse source is taken only when no real
 * one stands there.
 */
export function fontSourceOfGlyphSource(fontController, glyphSource) {
  if (!glyphSource) {
    return null;
  }
  if (glyphSource.locationBase) {
    return glyphSource.locationBase;
  }
  const fontSources = fontController?.sources;
  if (!fontSources) {
    return null;
  }
  const axes =
    fontController.fontAxesSourceSpace ||
    fontController.fontSourcesInstancer?.fontAxesSourceSpace ||
    [];
  const key = (location) =>
    JSON.stringify(axes.map((axis) => location?.[axis.name] ?? axis.defaultValue ?? 0));
  const wanted = key(glyphSource.location);
  let sparse = null;
  for (const [identifier, source] of Object.entries(fontSources)) {
    if (key(source.location) !== wanted) {
      continue;
    }
    if (!source.isSparse) {
      return identifier;
    }
    sparse = sparse ?? identifier;
  }
  return sparse;
}

/**
 * The layer of an existing glyph that belongs to a font source. Without the
 * fontController, only glyph sources that name their font source are found.
 */
export function layerNameForSource(variableGlyph, sourceIdentifier, fontController = null) {
  for (const source of variableGlyph.sources || []) {
    if (fontSourceOfGlyphSource(fontController, source) === sourceIdentifier) {
      return source.layerName;
    }
  }
  return null;
}

// Composition: where a mark lands on a base, and what the composed glyph looks
// like. Pure — no Fontra import, no DOM — so it runs under `node --test`
// (tests/test_compose.mjs). See docs/brief.md § 4.7 and § 6.3.
//
// Behaviour follows Fontra's own shaper (`shaper.js`,
// `applyMarkToBasePositioning`): base anchors are the ones without a leading
// underscore, mark anchors are the ones with it, the names must match exactly
// once the `_` is removed, and the offset is `baseAnchor − markAnchor`.
// One deliberate difference, from docs/brief.md § 4.1: when a base carries both
// `top` and `top.cap` and a mark carries both `_top` and `_top.cap`, we take the
// most specific pair, where the shaper takes the mark's first anchor.
//
// A "layer glyph" here is a plain StaticGlyph: {xAdvance, anchors, components,
// path}. The `font` argument is the small adapter the callers provide:
//
//   font = {
//     sources: [{identifier, name}],              // the font's sources, in order
//     hasGlyph(glyphName) -> boolean,
//     getLayerGlyph(glyphName, sourceIdentifier) -> StaticGlyph | null,
//     getBounds?(glyphName, sourceIdentifier) -> {xMin, yMin, xMax, yMax} | null,
//   }
//
// tests/helpers/test-font.mjs builds one over the test font; the panel builds one
// over `fontController`. Keeping it this thin is what makes the rest testable.

/** A component is "désynchronisé" beyond this, in font units (brief § 5). */
export const STALE_TOLERANCE = 0.5;

const DECOMPOSED_IDENTITY = {
  translateX: 0,
  translateY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  tCenterX: 0,
  tCenterY: 0,
};

/** First one wins, like the shaper's `collectAnchors`. */
function anchorsByName(staticGlyph) {
  const anchors = new Map();
  for (const anchor of staticGlyph?.anchors || []) {
    if (!anchors.has(anchor.name)) {
      anchors.set(anchor.name, anchor);
    }
  }
  return anchors;
}

/** `name.suffix` if the glyph has it, else `name`. */
export function findAnchor(staticGlyph, name, suffix = null) {
  const anchors = anchorsByName(staticGlyph);
  if (suffix && anchors.has(`${name}.${suffix}`)) {
    return anchors.get(`${name}.${suffix}`);
  }
  return anchors.get(name) || null;
}

/**
 * The anchor pair a mark would attach by, for the rule's anchor name.
 * Variants win over the plain name: with `top` asked for, a base `top.cap` and a
 * mark `_top.cap` are preferred over `top`/`_top`.
 */
export function resolveAnchorPair(baseGlyph, markGlyph, anchorName) {
  const baseAnchors = anchorsByName(baseGlyph);
  const markAnchors = anchorsByName(markGlyph);

  const candidates = [...baseAnchors.keys()].filter(
    (name) => name === anchorName || name.startsWith(`${anchorName}.`)
  );
  // most specific first; the plain name, being the shortest, comes last
  candidates.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

  for (const name of candidates) {
    const markAnchor = markAnchors.get(`_${name}`);
    if (markAnchor) {
      return { name, baseAnchor: baseAnchors.get(name), markAnchor };
    }
  }
  return null;
}

/**
 * Which side lacks the anchor, when a mark cannot be placed (5 bis § 7):
 * `base` (no `top` nor `top.*`), `mark` (no `_top` nor `_top.*`), `both`, or
 * `pair` — both have one, of variants that do not pair.
 */
export function whichLacks(baseGlyph, markGlyph, anchorName) {
  const has = (glyph, name) =>
    [...anchorsByName(glyph).keys()].some((key) => key === name || key.startsWith(`${name}.`));
  const base = has(baseGlyph, anchorName);
  const mark = has(markGlyph, `_${anchorName}`);
  return !base && !mark ? "both" : !base ? "base" : !mark ? "mark" : "pair";
}

/**
 * The translation that puts `markGlyph`'s `_<anchorName>` onto `baseGlyph`'s
 * `<anchorName>`, or null when either anchor is missing.
 */
export function placeMark(baseGlyph, markGlyph, anchorName) {
  const pair = resolveAnchorPair(baseGlyph, markGlyph, anchorName);
  if (!pair) {
    return null;
  }
  return {
    dx: pair.baseAnchor.x - pair.markAnchor.x,
    dy: pair.baseAnchor.y - pair.markAnchor.y,
    anchor: pair.name,
    // where the two anchors were, for « has the anchor moved since? » (5 bis § 6)
    baseAnchor: { x: pair.baseAnchor.x, y: pair.baseAnchor.y },
    markAnchor: { x: pair.markAnchor.x, y: pair.markAnchor.y },
  };
}

/**
 * The key, in the customData of a layer Make wrote, of where the anchors were
 * then: {markGlyph: {anchor, on, base: {x, y}, mark: {x, y}}}. It is what tells
 * ⑥ that the base's anchor moved since the last Make (5 bis § 6).
 */
export const MADE_KEY = "umarks.made";

function makeComponent(glyphName, dx, dy) {
  return {
    name: glyphName,
    transformation: { ...DECOMPOSED_IDENTITY, translateX: dx, translateY: dy },
  };
}

function pathBounds(staticGlyph) {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  const add = (x, y) => {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  };
  for (const contour of staticGlyph?.path?.contours || []) {
    for (const point of contour.points) {
      add(point.x, point.y);
    }
  }
  // Fontra's packed path: [x0, y0, x1, y1, …]
  const coordinates = staticGlyph?.path?.coordinates || [];
  for (let i = 0; i + 1 < coordinates.length; i += 2) {
    add(coordinates[i], coordinates[i + 1]);
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

// --- legacy (spacing) accents (brief § 4.5, step 5)
//
// `acute` is not drawn: it is one component of `acutecomb`, in every source,
// with an advance of its own — the width of the component's box plus two
// equal margins. The margin is `settings.legacyAccentMargin` when the document
// sets one, else the left side bearing of `o` in that source, else UPM / 20.
// The component is moved so that both margins are equal. No anchor is copied
// (decision of 8 nov.): the rule is `{legacy: "acutecomb"}`, nothing more.

/** The glyph whose left side bearing is a legacy accent's margin. */
export const LEGACY_REFERENCE = "o";

export function isLegacyRule(rule) {
  return typeof rule?.legacy === "string" && rule.legacy.length > 0;
}

/** The margin of a legacy accent in one source, in units, rounded. */
export function legacyAccentMargin(getLayerGlyph, { getBounds, legacyMargin, unitsPerEm } = {}) {
  if (typeof legacyMargin === "number" && Number.isFinite(legacyMargin)) {
    return Math.round(legacyMargin);
  }
  const reference = getLayerGlyph(LEGACY_REFERENCE);
  const bounds = reference
    ? (getBounds ? getBounds(LEGACY_REFERENCE) : null) ?? pathBounds(reference)
    : null;
  if (bounds) {
    return Math.round(bounds.xMin);
  }
  return Math.round((unitsPerEm || 1000) / 20);
}

function composeLegacyLayer(rule, getLayerGlyph, options = {}) {
  const warnings = [];
  const comb = getLayerGlyph(rule.legacy);
  if (!comb) {
    return {
      glyph: null,
      problems: [{ code: "missing-glyph", role: "mark", glyph: rule.legacy }],
      warnings,
    };
  }
  const bounds = (options.getBounds ? options.getBounds(rule.legacy) : null) ?? pathBounds(comb);
  if (!bounds) {
    return { glyph: null, problems: [{ code: "no-outline", glyph: rule.legacy }], warnings };
  }
  const margin = legacyAccentMargin(getLayerGlyph, options);
  const dx = Math.round(margin - bounds.xMin);
  const xAdvance = Math.round(bounds.xMax - bounds.xMin + 2 * margin);
  return {
    glyph: { xAdvance, components: [makeComponent(rule.legacy, dx, 0)], anchors: [] },
    problems: [],
    warnings,
  };
}

/**
 * The composed layer for one source: components only, the base at the origin,
 * each mark translated by `baseAnchor − markAnchor`, the advance of the base,
 * and no anchors of its own. A composed glyph that serves as a base in its turn
 * gets its anchors from its components, the way Fontra itself reads it
 * (`propagatedAnchors`, see font-adapter.js) — copying them would only leave
 * stale copies behind when an anchor of the base moves.
 *
 * Returns {glyph, problems, warnings}; `glyph` is null as soon as there is a
 * problem, and every problem says what is missing and where.
 */
export function composeLayer(rule, getLayerGlyph, options = {}) {
  if (isLegacyRule(rule)) {
    return composeLegacyLayer(rule, getLayerGlyph, options);
  }
  const problems = [];
  const warnings = [];
  const getBounds = options.getBounds;

  const base = getLayerGlyph(rule.base);
  if (!base) {
    return {
      glyph: null,
      problems: [{ code: "missing-glyph", role: "base", glyph: rule.base }],
      warnings,
    };
  }

  const components = [makeComponent(rule.base, 0, 0)];
  let xAdvance = base.xAdvance || 0;

  // ligature parts: laid end to end after the base, no anchor involved
  for (const glyphName of rule.append || []) {
    const appended = getLayerGlyph(glyphName);
    if (!appended) {
      problems.push({ code: "missing-glyph", role: "append", glyph: glyphName });
      continue;
    }
    components.push(makeComponent(glyphName, xAdvance, 0));
    xAdvance += appended.xAdvance || 0;
  }

  const placed = new Map();

  for (const mark of rule.marks || []) {
    const markGlyph = getLayerGlyph(mark.glyph);
    if (!markGlyph) {
      problems.push({ code: "missing-glyph", role: "mark", glyph: mark.glyph });
      continue;
    }

    // on a previous mark (mark-to-mark), or on the base
    let target = base;
    let targetDx = 0;
    let targetDy = 0;
    if (mark.on) {
      const previous = placed.get(mark.on);
      if (!previous) {
        problems.push({ code: "unknown-stack", glyph: mark.glyph, on: mark.on });
        continue;
      }
      target = previous.glyph;
      targetDx = previous.dx;
      targetDy = previous.dy;
    }

    const placement = placeMark(target, markGlyph, mark.anchor);
    if (!placement) {
      problems.push({
        code: "missing-anchor",
        glyph: mark.glyph,
        anchor: mark.anchor,
        on: mark.on || rule.base,
        lacks: whichLacks(target, markGlyph, mark.anchor),
      });
      continue;
    }

    const dx = placement.dx + targetDx;
    const dy = placement.dy + targetDy;
    components.push(makeComponent(mark.glyph, dx, dy));
    placed.set(mark.glyph, {
      glyph: markGlyph,
      dx,
      dy,
      anchor: placement.anchor,
      on: mark.on || rule.base,
      baseAnchor: placement.baseAnchor,
      markAnchor: placement.markAnchor,
    });
  }

  if (problems.length) {
    return { glyph: null, problems, warnings };
  }

  // the advance stays the base's (brief § 4.7): warn, never widen
  for (const [glyphName, { dx, dy }] of placed) {
    const bounds = getBounds
      ? getBounds(glyphName)
      : pathBounds(getLayerGlyph(glyphName));
    if (!bounds) {
      continue;
    }
    if (bounds.xMin + dx < 0 || bounds.xMax + dx > xAdvance) {
      warnings.push({
        code: "mark-outside-advance",
        glyph: glyphName,
        left: Math.round(bounds.xMin + dx),
        right: Math.round(bounds.xMax + dx),
        xAdvance,
      });
    }
  }

  const made = {};
  for (const [glyphName, entry] of placed) {
    made[glyphName] = { anchor: entry.anchor, on: entry.on, base: entry.baseAnchor, mark: entry.markAnchor };
  }
  return {
    glyph: { xAdvance, components, anchors: [] },
    made,
    problems,
    warnings,
  };
}

/**
 * The whole VariableGlyph: one source and one layer per font source, named the
 * way Fontra names them for a new glyph (layer = source identifier, empty source
 * name, `locationBase` pointing at the font source).
 *
 * A source whose base or mark lacks an anchor makes the rule impossible: the
 * glyph comes back null and the problems carry the source's name.
 */
/** Has the glyph a drawing in that source: outlines, or components? */
export function hasDrawingIn(font, glyphName, sourceIdentifier) {
  const layerGlyph = font.getLayerGlyph(glyphName, sourceIdentifier);
  return (
    !!layerGlyph?.path?.contours?.length ||
    !!layerGlyph?.path?.coordinates?.length ||
    !!layerGlyph?.components?.length
  );
}

/** The glyphs a rule is composed of. */
function partsOf(rule) {
  if (isLegacyRule(rule)) {
    return [rule.legacy];
  }
  return [...new Set([rule.base, ...(rule.append || []), ...(rule.marks || []).map((mark) => mark.glyph)])].filter(
    (name) => name
  );
}

/**
 * The sources the composed glyph is left without (5 bis § 5): those where a
 * part is in the font but not usable — no drawing there, or not readable —
 * while every part is drawn in the default source. [{source, glyphs}].
 * A part missing from the font, or not drawn in the default source, leaves
 * nothing out: the rule waits for it.
 */
export function skippedSources(rule, font) {
  const defaultId = font.defaultSourceIdentifier ?? font.sources[0]?.identifier;
  const parts = partsOf(rule);
  if (!parts.every((name) => font.hasGlyph(name) && hasDrawingIn(font, name, defaultId))) {
    return [];
  }
  const skipped = [];
  for (const source of font.sources) {
    if (source.identifier === defaultId) {
      continue;
    }
    const glyphs = parts.filter((name) => !hasDrawingIn(font, name, source.identifier));
    if (glyphs.length) {
      skipped.push({ source: source.name || source.identifier, identifier: source.identifier, glyphs });
    }
  }
  return skipped;
}

export function composeVariableGlyph(glyphName, rule, font) {
  const problems = [];
  const warnings = [];
  const sources = [];
  const layers = {};
  // a part drawn in the default source but failing elsewhere is still usable:
  // those sources are left out, and said (5 bis § 5)
  const skipped = skippedSources(rule, font);
  const skippedIds = new Set(skipped.map((entry) => entry.identifier));
  for (const entry of skipped) {
    warnings.push({ code: "source-skipped", source: entry.source, glyphs: entry.glyphs });
  }

  for (const source of font.sources) {
    if (skippedIds.has(source.identifier)) {
      continue;
    }
    const sourceLabel = source.name || source.identifier;
    // the anchors a part is placed by: for a composed part, those its
    // components give it (font.getPositioningGlyph), as Fontra's shaper reads them
    const getGlyph = font.getPositioningGlyph
      ? (name) => font.getPositioningGlyph(name, source.identifier)
      : (name) => font.getLayerGlyph(name, source.identifier);
    const result = composeLayer(rule, getGlyph, {
      getBounds: font.getBounds
        ? (name) => font.getBounds(name, source.identifier)
        : undefined,
      legacyMargin: font.legacyAccentMargin,
      unitsPerEm: font.unitsPerEm,
    });

    for (const problem of result.problems) {
      problems.push({ ...problem, source: sourceLabel });
    }
    for (const warning of result.warnings) {
      warnings.push({ ...warning, source: sourceLabel });
    }
    if (!result.glyph) {
      continue;
    }

    layers[source.identifier] = result.made
      ? { glyph: result.glyph, customData: { [MADE_KEY]: result.made } }
      : { glyph: result.glyph };
    sources.push({
      name: "",
      location: {},
      layerName: source.identifier,
      locationBase: source.identifier,
    });
  }

  return {
    glyph: problems.length ? null : { name: glyphName, sources, layers },
    problems,
    warnings,
    skipped,
  };
}

function translationOf(component) {
  return {
    dx: component?.transformation?.translateX || 0,
    dy: component?.transformation?.translateY || 0,
  };
}

/**
 * Why a composed glyph is out of date, per source. `state` is the value the
 * panel colours its dot with; `differences` says what moved, for the tooltip.
 */
export function syncDetails(glyphName, rule, font) {
  const composed = composeVariableGlyph(glyphName, rule, font);
  if (composed.problems.length) {
    return { state: "impossible", problems: composed.problems, differences: [], sourceCount: font.sources.length };
  }
  if (!font.hasGlyph(glyphName)) {
    return { state: "missing", problems: [], differences: [], skipped: composed.skipped };
  }

  const differences = [];
  for (const source of font.sources) {
    const sourceLabel = source.name || source.identifier;
    if (!composed.glyph.layers[source.identifier]) {
      // left out: a part is not drawn there (5 bis § 5)
      continue;
    }
    const existing = font.getLayerGlyph(glyphName, source.identifier);
    // what the font gives where the glyph has no source of its own is
    // interpolated: there is nothing there to compare
    if (!existing || font.hasOwnSource?.(glyphName, source.identifier) === false) {
      differences.push({ code: "missing-source", source: sourceLabel });
      continue;
    }
    // outlines of its own: the test font's contours, or Fontra's packed path
    if (existing.path?.contours?.length || existing.path?.coordinates?.length) {
      differences.push({ code: "has-contours", source: sourceLabel });
    }

    const expected = composed.glyph.layers[source.identifier].glyph;
    // a legacy accent's advance is computed, not the base's: it is followed too
    if (
      isLegacyRule(rule) &&
      Math.abs((existing.xAdvance ?? 0) - expected.xAdvance) > STALE_TOLERANCE
    ) {
      differences.push({
        code: "advance",
        source: sourceLabel,
        expected: expected.xAdvance,
        found: existing.xAdvance ?? 0,
      });
    }
    const existingComponents = existing.components || [];
    if (existingComponents.length !== expected.components.length) {
      differences.push({
        code: "component-count",
        source: sourceLabel,
        expected: expected.components.length,
        found: existingComponents.length,
      });
      continue;
    }

    for (const [index, expectedComponent] of expected.components.entries()) {
      const found = existingComponents[index];
      if (found.name !== expectedComponent.name) {
        differences.push({
          code: "component-name",
          source: sourceLabel,
          index,
          expected: expectedComponent.name,
          found: found.name,
        });
        continue;
      }
      const wanted = translationOf(expectedComponent);
      const got = translationOf(found);
      if (
        Math.abs(wanted.dx - got.dx) > STALE_TOLERANCE ||
        Math.abs(wanted.dy - got.dy) > STALE_TOLERANCE
      ) {
        const difference = {
          code: "component-translation",
          source: sourceLabel,
          index,
          glyph: found.name,
          expected: wanted,
          found: got,
        };
        // the base's anchor as Make found it, against where it is now
        const then = font.getLayerCustomData?.(glyphName, source.identifier)?.[MADE_KEY]?.[found.name];
        const now = composed.glyph.layers[source.identifier].customData?.[MADE_KEY]?.[found.name];
        if (then?.base && now?.base && then.anchor === now.anchor) {
          const moved = { dx: now.base.x - then.base.x, dy: now.base.y - then.base.y };
          if (Math.abs(moved.dx) > STALE_TOLERANCE || Math.abs(moved.dy) > STALE_TOLERANCE) {
            difference.anchorMoved = { anchor: now.anchor, on: now.on, ...moved };
          }
        }
        differences.push(difference);
      }
    }
  }

  return {
    state: differences.length ? "stale" : "ok",
    problems: [],
    differences,
    skipped: composed.skipped,
    sourceCount: font.sources.length,
  };
}

/** `ok` | `stale` | `missing` | `impossible` (brief § 6.3). */
export function syncState(glyphName, rule, font) {
  return syncDetails(glyphName, rule, font).state;
}

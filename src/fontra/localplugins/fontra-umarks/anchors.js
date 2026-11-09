// Anchors: placing them from presets, nudging them in batch, checking them,
// and deriving accent variants. Pure — no Fontra import, no DOM — so it runs
// under `node --test` (tests/test_anchors.mjs). See docs/brief.md § 4.2, § 4.6
// and § 5.
//
// Every planner returns a *plan*, a list of
//
//   {glyph, source, name, x, y, existing: {x, y} | null, index?}
//
// and writes nothing: make.js applies a plan, the panel shows its size first.
// `source` is a font source identifier; `index` is the place of the anchor in
// the layer's `anchors` array when it exists already.
//
// The `font` argument is compose.js's adapter plus two things:
//
//   font.getSourceMetrics(sourceIdentifier) -> {xHeight, capHeight, ascender,
//       descender, baseline, italicAngle}       (font-adapter.js reads them
//       from `source.lineMetricsHorizontalLayout`)
//   font.getBounds?(glyphName, sourceIdentifier) -> {xMin, yMin, xMax, yMax} | null
//       (without it, the bounds of the layer's own outlines)
//
// Nothing here guesses a position: a preset that cannot be worked out — no
// outline, no such metric, a `reference:` glyph without the anchor — gives
// `null`, and the planner leaves that anchor out and says so in `skipped`.

import { splitGlyphName } from "./glyph-data.js";
import { isSoftDotted } from "./suggest.js";

// --- paths -----------------------------------------------------------------
//
// A layer's path is a packed path in the editor ({coordinates, pointTypes,
// contourInfo}) and a list of contours in the test font on disk ({contours}).
// The helpers below read and rewrite both, and give back the format they got.

function forEachPoint(path, callback) {
  if (path?.contours) {
    for (const contour of path.contours) {
      for (const point of contour.points) {
        callback(point.x, point.y);
      }
    }
  } else if (path?.coordinates) {
    for (let i = 0; i + 1 < path.coordinates.length; i += 2) {
      callback(path.coordinates[i], path.coordinates[i + 1]);
    }
  }
}

export function pathBounds(path) {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  forEachPoint(path, (x, y) => {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  });
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

/** A plain copy of a path with every point moved by `move(x, y) -> [x, y]`. */
export function transformPath(path, move) {
  if (path?.contours) {
    return {
      contours: path.contours.map((contour) => ({
        ...contour,
        points: contour.points.map((point) => {
          const [x, y] = move(point.x, point.y);
          return { ...point, x, y };
        }),
      })),
    };
  }
  if (path?.coordinates) {
    const coordinates = [];
    for (let i = 0; i + 1 < path.coordinates.length; i += 2) {
      coordinates.push(...move(path.coordinates[i], path.coordinates[i + 1]));
    }
    const copy = {
      coordinates,
      pointTypes: [...(path.pointTypes || [])],
      contourInfo: (path.contourInfo || []).map((info) => ({ ...info })),
    };
    if (path.pointAttributes) {
      copy.pointAttributes = path.pointAttributes.map((attrs) =>
        attrs ? { ...attrs } : attrs
      );
    }
    return copy;
  }
  return { coordinates: [], pointTypes: [], contourInfo: [] };
}

/** Same drawing, same signature: how an undo knows a glyph was left alone. */
export function pathSignature(path) {
  const numbers = [];
  forEachPoint(path, (x, y) => numbers.push(x, y));
  return numbers.join(",");
}

// --- small helpers ---------------------------------------------------------

function round(value) {
  return Math.round(value) + 0; // + 0 turns -0 into 0
}

function unique(names) {
  return [...new Set(names)];
}

/** `_top.cap` -> `top`, `top.cap` -> `top`: the anchor a name is a variant of. */
export function anchorStem(anchorName) {
  const name = anchorName.startsWith("_") ? anchorName.slice(1) : anchorName;
  return splitGlyphName(name).base;
}

function exactAnchor(layerGlyph, name) {
  const anchors = layerGlyph?.anchors || [];
  const index = anchors.findIndex((anchor) => anchor.name === name);
  return index < 0 ? null : { anchor: anchors[index], index };
}

function layerBounds(font, glyphName, sourceIdentifier, layerGlyph) {
  const bounds = font.getBounds
    ? font.getBounds(glyphName, sourceIdentifier)
    : pathBounds(layerGlyph?.path);
  return bounds || null;
}

/** An italic angle turned into a horizontal shift at height `y`. A right-leaning
 *  master has a negative angle in UFO and Fontra, and a point at height y moves
 *  to the right by y·tan(−angle). (The brief writes y·tan(angle) and means this.) */
export function slantShift(y, italicAngle) {
  return italicAngle ? -y * Math.tan((italicAngle * Math.PI) / 180) : 0;
}

// --- case ------------------------------------------------------------------

/**
 * "upper" | "lower" | "smallcaps" | any other category with a `baseSuffix`.
 * The character of the code point decides upper and lower; a suffix named in
 * `settings.categories` decides the rest. A glyph with neither is lower
 * (brief § 9, decision 4) — which includes `E.alt`, whose suffix says nothing.
 */
export function glyphCase(glyphName, { glyphMap = {}, settings = {} } = {}) {
  const { extension } = splitGlyphName(glyphName);
  if (extension) {
    for (const [category, definition] of Object.entries(settings.categories || {})) {
      if (definition?.baseSuffix === extension) {
        return category;
      }
    }
  }
  const codePoint = glyphMap[glyphName]?.[0];
  if (typeof codePoint === "number") {
    const character = String.fromCodePoint(codePoint);
    if (character !== character.toLowerCase() && character === character.toUpperCase()) {
      return "upper";
    }
  }
  return "lower";
}

// --- one preset, one position ---------------------------------------------

export const X_SPECS = ["bounds-center", "bounds-left", "bounds-right", "advance-center"];
export const Y_SPECS = [
  "baseline",
  "x-height",
  "cap-height",
  "case-height",
  "ascender",
  "descender",
  "bounds-top",
  "bounds-bottom",
];

function referenceAnchor(spec, ctx) {
  const glyphName = spec.slice("reference:".length);
  const reference = ctx.getReference?.(glyphName);
  return reference ? exactAnchor(reference, ctx.anchorName)?.anchor ?? null : null;
}

/** The x a spec stands for, before dx, or null. */
export function resolveX(spec, ctx) {
  const { bounds, layerGlyph } = ctx;
  switch (spec) {
    case "bounds-center":
      return bounds ? (bounds.xMin + bounds.xMax) / 2 : null;
    case "bounds-left":
      return bounds ? bounds.xMin : null;
    case "bounds-right":
      return bounds ? bounds.xMax : null;
    case "advance-center":
      return typeof layerGlyph?.xAdvance === "number" ? layerGlyph.xAdvance / 2 : null;
    default:
      return typeof spec === "string" && spec.startsWith("reference:")
        ? referenceAnchor(spec, ctx)?.x ?? null
        : null;
  }
}

/** The y a spec stands for, before dy, or null. */
export function resolveY(spec, ctx) {
  const { bounds, metrics = {}, caseKind = "lower" } = ctx;
  const metric = (value) => (typeof value === "number" ? value : null);
  switch (spec) {
    case "baseline":
      return metric(metrics.baseline) ?? 0;
    case "x-height":
      return metric(metrics.xHeight);
    case "cap-height":
      return metric(metrics.capHeight);
    case "case-height":
      return metric(caseKind === "lower" ? metrics.xHeight : metrics.capHeight);
    case "ascender":
      return metric(metrics.ascender);
    case "descender":
      return metric(metrics.descender);
    case "bounds-top":
      return bounds ? bounds.yMax : null;
    case "bounds-bottom":
      return bounds ? bounds.yMin : null;
    default:
      return typeof spec === "string" && spec.startsWith("reference:")
        ? referenceAnchor(spec, ctx)?.y ?? null
        : null;
  }
}

/**
 * Where a preset puts its anchor on this glyph: {x, y}, or null when the preset
 * cannot be worked out here.
 *
 * `options`: {italicAngle, followItalicAngle (the document's setting; a preset
 * of an older document may still say `italic`), anchorName (for `reference:`),
 * bounds, glyphCase, getReference(glyphName) -> StaticGlyph | null}.
 */
export function presetPosition(staticGlyph, metrics, preset, options = {}) {
  const ctx = {
    layerGlyph: staticGlyph,
    metrics,
    bounds: options.bounds !== undefined ? options.bounds : pathBounds(staticGlyph?.path),
    caseKind: options.glyphCase || "lower",
    anchorName: options.anchorName,
    getReference: options.getReference,
  };
  const x = resolveX(preset.x, ctx);
  const y = resolveY(preset.y, ctx);
  if (x === null || y === null) {
    return null;
  }
  const finalY = y + (preset.dy || 0);
  let finalX = x + (preset.dx || 0);
  if (preset.italic || options.followItalicAngle) {
    finalX += slantShift(finalY, options.italicAngle ?? metrics?.italicAngle);
  }
  return { x: round(finalX), y: round(finalY) };
}

/** The glyph names a set of presets looks at (`reference:o`), to be loaded first. */
export function referencedGlyphs(presets) {
  const names = new Set();
  for (const preset of Object.values(presets || {})) {
    for (const spec of [preset.x, preset.y]) {
      if (typeof spec === "string" && spec.startsWith("reference:") && spec.length > 10) {
        names.add(spec.slice("reference:".length));
      }
    }
  }
  return [...names];
}

// --- who gets what ---------------------------------------------------------

/** A glyph that carries `_` anchors is a mark, whatever its name says. */
function defaultRole(font, glyphName) {
  const takes = new Set();
  for (const source of font.sources) {
    for (const anchor of font.getLayerGlyph(glyphName, source.identifier)?.anchors || []) {
      if (anchor.name.startsWith("_")) {
        takes.add(anchorStem(anchor.name));
      }
    }
  }
  return takes.size ? { kind: "mark", takes } : { kind: "base", takes: null };
}

function roleFor(roles, font, glyphName) {
  const role =
    roles instanceof Map ? roles.get(glyphName) : roles ? roles(glyphName) : undefined;
  return role || defaultRole(font, glyphName);
}

/**
 * The part each glyph of a glyph set plays, for `planAnchors` and
 * `checkAnchors`: Map glyphName -> {kind: "base" | "mark" | null, takes}.
 *
 *   mark   `takes` is the set of anchor stems it attaches by (`top`, `bottom`…)
 *   base   gets the presets on bases — but `top` on a soft-dotted letter
 *          (`i`, `j`: `refuses`), which takes a mark above on its dotless
 *          twin (step 5 bis § 3)
 *   null   gets nothing: a composed glyph (it has a rule, Make copies the
 *          anchors of its base) or something that is not a letter. A glyph
 *          with a rule but outlines of its own — drawn by hand — is a base
 *          like any drawn letter: `i` drawn is still what `iogonek` sits on
 *
 * A mark is recognised, in this order, by: a rule that uses it; `_` anchors on
 * it; Fontra's glyph data (category Mark); and, for a glyph the table has never
 * heard of (`commaaccent`), by its drawing alone — entirely above the x-height
 * or entirely below the baseline. Which anchor a mark takes comes from the same
 * evidence, in the same order, and the drawing says `bottom` for what lies below
 * the baseline and `top` otherwise.
 */
export function glyphRoles(glyphNames, { font, glyphData = null, data = null }) {
  const rules = data?.rules || {};
  const composed = new Set(Object.keys(rules));
  const ruleTakes = new Map();
  for (const rule of Object.values(rules)) {
    for (const mark of rule.marks || []) {
      if (!ruleTakes.has(mark.glyph)) {
        ruleTakes.set(mark.glyph, new Set());
      }
      ruleTakes.get(mark.glyph).add(anchorStem(mark.anchor || "top"));
    }
  }

  const roles = new Map();
  for (const glyphName of unique(glyphNames)) {
    if (!font.hasGlyph(glyphName)) {
      continue;
    }
    if (composed.has(glyphName) && !hasOwnOutlines(font, glyphName)) {
      roles.set(glyphName, { kind: null, takes: null });
      continue;
    }

    const fromFont = defaultRole(font, glyphName);
    const takes = new Set(fromFont.kind === "mark" ? fromFont.takes : []);
    let isMark = fromFont.kind === "mark";

    if (ruleTakes.has(glyphName)) {
      isMark = true;
      for (const stem of ruleTakes.get(glyphName)) {
        takes.add(stem);
      }
    }

    const entry = glyphData?.entryForName(glyphName) ?? null;
    if (!isMark && entry?.category === "Mark") {
      isMark = true;
    }

    if (!isMark && !entry && glyphData) {
      // not in the table: the drawing is the only evidence there is
      const source = font.sources[0];
      const layerGlyph = source && font.getLayerGlyph(glyphName, source.identifier);
      const bounds = source && layerBounds(font, glyphName, source.identifier, layerGlyph);
      const metrics = (source && font.getSourceMetrics?.(source.identifier)) || {};
      if (bounds && !(font.glyphMap?.[glyphName] || []).length) {
        const above = typeof metrics.xHeight === "number" && bounds.yMin >= metrics.xHeight;
        const below = bounds.yMax <= (metrics.baseline ?? 0);
        isMark = above || below;
      }
    }

    if (isMark) {
      if (!takes.size) {
        if (entry) {
          takes.add(glyphData.defaultAnchorForMark(glyphName));
        } else {
          const source = font.sources[0];
          const layerGlyph = source && font.getLayerGlyph(glyphName, source.identifier);
          const bounds = source && layerBounds(font, glyphName, source.identifier, layerGlyph);
          const baseline = (source && font.getSourceMetrics?.(source.identifier)?.baseline) ?? 0;
          takes.add(bounds && bounds.yMax <= baseline ? "bottom" : "top");
        }
      }
      roles.set(glyphName, { kind: "mark", takes });
    } else if (entry && entry.category !== "Letter") {
      roles.set(glyphName, { kind: null, takes: null });
    } else if (isSoftDotted(glyphName, { font, glyphData })) {
      roles.set(glyphName, { kind: "base", takes: null, refuses: new Set(["top"]) });
    } else {
      roles.set(glyphName, { kind: "base", takes: null });
    }
  }
  return roles;
}

/** Outlines of its own in some source: drawn by hand, whatever its rule says. */
function hasOwnOutlines(font, glyphName) {
  return font.sources.some((source) => {
    const path = font.getLayerGlyph(glyphName, source.identifier)?.path;
    return !!path?.contours?.length || !!path?.coordinates?.length;
  });
}

function presetApplies(name, preset, role, caseKind) {
  if (preset.on === "marks") {
    if (role.kind !== "mark") {
      return false;
    }
    if (role.takes && !role.takes.has(anchorStem(name))) {
      return false;
    }
  } else if (role.kind !== "base") {
    return false;
  } else if (role.refuses?.has(anchorStem(name))) {
    // no `top` on a dotted i: a mark above goes on idotless
    return false;
  }
  return !preset.case || preset.case === caseKind;
}

/**
 * Every (glyph, source, preset) a plan or a check has to look at, with the
 * position the preset gives. Shared by `planAnchors` and `checkAnchors`.
 */
function* expectations(font, glyphNames, presets, { roles = null, settings = {}, sources = null }) {
  for (const glyphName of unique(glyphNames)) {
    if (!font.hasGlyph(glyphName)) {
      continue;
    }
    const role = roleFor(roles, font, glyphName);
    if (!role.kind) {
      continue;
    }
    const caseKind = glyphCase(glyphName, { glyphMap: font.glyphMap, settings });
    for (const source of font.sources) {
      if (sources && !sources.includes(source.identifier)) {
        continue;
      }
      // A source the glyph has no layer of its own at — MutatorSans's italic,
      // drawn for a handful of glyphs — is not expected to carry anchors: what
      // getLayerGlyph gives there is an interpolation, nowhere to write
      // (fontrahive.com, 9 November: « 101 with no layer in some source »,
      // nothing placed).
      if (font.hasOwnSource?.(glyphName, source.identifier) === false) {
        continue;
      }
      const layerGlyph = font.getLayerGlyph(glyphName, source.identifier);
      if (!layerGlyph) {
        continue;
      }
      const metrics = font.getSourceMetrics?.(source.identifier) || {};
      const bounds = layerBounds(font, glyphName, source.identifier, layerGlyph);
      for (const [name, preset] of Object.entries(presets)) {
        if (!presetApplies(name, preset, role, caseKind)) {
          continue;
        }
        const found = exactAnchor(layerGlyph, name);
        const position = presetPosition(layerGlyph, metrics, preset, {
          anchorName: name,
          bounds,
          glyphCase: caseKind,
          italicAngle: metrics.italicAngle,
          followItalicAngle: !!settings.followItalicAngle,
          getReference: (referenceName) =>
            font.getLayerGlyph(referenceName, source.identifier),
        });
        yield { glyphName, source, name, found, position };
      }
    }
  }
}

// --- plans -----------------------------------------------------------------

function item(glyph, source, name, x, y, found) {
  const entry = {
    glyph,
    source,
    name,
    x,
    y,
    existing: found ? { x: found.anchor.x, y: found.anchor.y } : null,
  };
  if (found) {
    entry.index = found.index;
  }
  return entry;
}

/**
 * The anchors to create (or, with `replace`, to move) so that every glyph of
 * the list carries what the presets say. Anchors already there are left alone
 * unless `replace`.
 *
 * `roles` is a Map or a function glyphName -> {kind, takes} (see `glyphRoles`);
 * without it a glyph is a mark when it carries `_` anchors and a base otherwise.
 * `skipped`, if given, collects {glyph, source, name, reason} for the anchors
 * that could not be placed; `kept`, if given, collects {glyph, source, name}
 * for those already there and left alone, so that Place can say so.
 */
export function planAnchors(
  font,
  glyphNames,
  presets,
  { replace = false, roles = null, settings = {}, sources = null, skipped = null, kept = null } = {}
) {
  const plan = [];
  for (const { glyphName, source, name, found, position } of expectations(
    font,
    glyphNames,
    presets,
    { roles, settings, sources }
  )) {
    if (found && !replace) {
      kept?.push({ glyph: glyphName, source: source.identifier, name });
      continue;
    }
    if (!position) {
      skipped?.push({ glyph: glyphName, source: source.identifier, name, reason: "no-position" });
      continue;
    }
    if (found && found.anchor.x === position.x && found.anchor.y === position.y) {
      continue;
    }
    plan.push(item(glyphName, source.identifier, name, position.x, position.y, found));
  }
  return plan;
}

function eachAnchorNamed(font, glyphNames, name, sources, callback) {
  for (const glyphName of unique(glyphNames)) {
    if (!font.hasGlyph(glyphName)) {
      continue;
    }
    for (const source of font.sources) {
      if (sources && !sources.includes(source.identifier)) {
        continue;
      }
      const layerGlyph = font.getLayerGlyph(glyphName, source.identifier);
      (layerGlyph?.anchors || []).forEach((anchor, index) => {
        if (anchor.name === name) {
          callback(glyphName, source, layerGlyph, anchor, index);
        }
      });
    }
  }
}

/** Move every anchor called `name` by (dx, dy). */
export function shiftAnchors(font, glyphNames, name, dx, dy, { sources = null } = {}) {
  const plan = [];
  if (!dx && !dy) {
    return plan;
  }
  eachAnchorNamed(font, glyphNames, name, sources, (glyphName, source, _layer, anchor, index) => {
    plan.push(
      item(glyphName, source.identifier, name, round(anchor.x + (dx || 0)), round(anchor.y + (dy || 0)), {
        anchor,
        index,
      })
    );
  });
  return plan;
}

/**
 * Put one coordinate (or both) of the anchors called `name` back on a rule:
 * `{y: "x-height", dy: 10}`, `{x: "bounds-center"}`, `{x: "reference:o"}`, or
 * `{x: "base-anchor"}` — the x of the same anchor on the glyph `baseOf(glyph)`
 * names, which is how a composed glyph is lined up with its base. Only the axes
 * the rule mentions move.
 */
export function alignAnchors(
  font,
  glyphNames,
  name,
  rule,
  { sources = null, baseOf = null, skipped = null } = {}
) {
  const plan = [];
  eachAnchorNamed(font, glyphNames, name, sources, (glyphName, source, layerGlyph, anchor, index) => {
    const metrics = font.getSourceMetrics?.(source.identifier) || {};
    const ctx = {
      layerGlyph,
      metrics,
      bounds: layerBounds(font, glyphName, source.identifier, layerGlyph),
      caseKind: glyphCase(glyphName, { glyphMap: font.glyphMap }),
      anchorName: name,
      getReference: (referenceName) => font.getLayerGlyph(referenceName, source.identifier),
    };
    let x = anchor.x;
    let y = anchor.y;
    let ok = true;

    if (rule.x) {
      let spec = rule.x;
      if (spec === "base-anchor") {
        const baseName = baseOf?.(glyphName);
        spec = baseName ? `reference:${baseName}` : null;
      }
      const value = spec ? resolveX(spec, ctx) : null;
      if (value === null) {
        ok = false;
      } else {
        x = value + (rule.dx || 0);
      }
    }
    if (rule.y) {
      const value = resolveY(rule.y, ctx);
      if (value === null) {
        ok = false;
      } else {
        y = value + (rule.dy || 0);
      }
    }
    if (!ok) {
      skipped?.push({ glyph: glyphName, source: source.identifier, name, reason: "no-position" });
      return;
    }
    x = round(x);
    y = round(y);
    if (x !== anchor.x || y !== anchor.y) {
      plan.push(item(glyphName, source.identifier, name, x, y, { anchor, index }));
    }
  });
  return plan;
}

/**
 * Take anchors from a reference glyph — `{fromGlyph}`, source by source — or
 * from one source to the others — `{fromSource, toSources}`. `names` limits
 * which anchors; `replace` lets a copy overwrite an anchor of the same name.
 */
export function copyAnchors(
  font,
  glyphNames,
  from,
  { names = null, replace = false } = {}
) {
  const plan = [];
  const wanted = (anchor) => !names || names.includes(anchor.name);

  const copy = (glyphName, sourceIdentifier, fromLayer) => {
    const toLayer = font.getLayerGlyph(glyphName, sourceIdentifier);
    if (!toLayer || !fromLayer) {
      return;
    }
    const seen = new Set();
    for (const anchor of fromLayer.anchors || []) {
      if (!wanted(anchor) || seen.has(anchor.name)) {
        continue;
      }
      seen.add(anchor.name);
      const found = exactAnchor(toLayer, anchor.name);
      if (found && (!replace || (found.anchor.x === anchor.x && found.anchor.y === anchor.y))) {
        continue;
      }
      plan.push(item(glyphName, sourceIdentifier, anchor.name, anchor.x, anchor.y, found));
    }
  };

  for (const glyphName of unique(glyphNames)) {
    if (!font.hasGlyph(glyphName)) {
      continue;
    }
    if (from.fromGlyph) {
      if (glyphName === from.fromGlyph) {
        continue;
      }
      for (const source of font.sources) {
        copy(glyphName, source.identifier, font.getLayerGlyph(from.fromGlyph, source.identifier));
      }
    } else if (from.fromSource) {
      const fromLayer = font.getLayerGlyph(glyphName, from.fromSource);
      for (const target of from.toSources || []) {
        if (target !== from.fromSource) {
          copy(glyphName, target, fromLayer);
        }
      }
    }
  }
  return plan;
}

/**
 * Shear the x of the anchors called `name` by the italic angle, at their own
 * height: how an upright master's anchors become an italic one's. Without an
 * `italicAngle` each source uses its own. `sources` picks the sources to shear.
 */
export function mirrorAnchors(
  font,
  glyphNames,
  name,
  italicAngle = null,
  { sources = null } = {}
) {
  const plan = [];
  eachAnchorNamed(font, glyphNames, name, sources, (glyphName, source, _layer, anchor, index) => {
    const angle = italicAngle ?? font.getSourceMetrics?.(source.identifier)?.italicAngle;
    if (!angle) {
      return;
    }
    const x = round(anchor.x + slantShift(anchor.y, angle));
    if (x !== anchor.x) {
      plan.push(item(glyphName, source.identifier, name, x, anchor.y, { anchor, index }));
    }
  });
  return plan;
}

/**
 * What a glyph set lacks and what looks wrong, against the presets:
 *   missing     [{glyph, source, name}]            the anchor is not there
 *   suspicious  [{glyph, source, name, distance}]  it is further than `tolerance`
 *                                                  units from where its preset puts it
 * Only the sources named in `sources` are looked at, when given.
 */
export function checkAnchors(
  font,
  glyphNames,
  presets,
  { tolerance = 100, roles = null, settings = {}, sources = null } = {}
) {
  const missing = [];
  const suspicious = [];
  for (const { glyphName, source, name, found, position } of expectations(
    font,
    glyphNames,
    presets,
    { roles, settings, sources }
  )) {
    if (!found) {
      missing.push({ glyph: glyphName, source: source.identifier, name });
    } else if (position) {
      const distance = Math.hypot(found.anchor.x - position.x, found.anchor.y - position.y);
      if (distance > tolerance) {
        suspicious.push({
          glyph: glyphName,
          source: source.identifier,
          name,
          distance: Math.round(distance),
        });
      }
    }
  }
  return { missing, suspicious };
}

// --- what Place put, and where it is now (6b § 1) ---------------------------

/**
 * The key, in the customData of a glyph's layer, where Place notes what it
 * put and where: {anchorName: [x, y]}. Re-place reads it to tell an anchor
 * that is out of date (still where Place put it, its position moved since)
 * from one moved by hand (somewhere else).
 */
export const PLACED_KEY = "umarks.placed";

const SAME = 0.5; // u: closer than this, two positions are the same

function samePoint(a, b) {
  return !!a && !!b && Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME;
}

/**
 * Every anchor of the list the presets have a position for, classed (6b § 1):
 *
 *   outOfDate    still where Place put it (`umarks.placed`), but the position
 *                worked out now is elsewhere — Re-place puts it back on it
 *   movedByHand  elsewhere than where Place put it, or put without Place, and
 *                not on its position — Re-place leaves it unless ticked
 *
 * An anchor on its position is neither. Each entry is a plan item (glyph,
 * source, name, x, y: the position; existing, index) with `placed`, what the
 * note says, or null. Returns {outOfDate, movedByHand}.
 */
export function placedStates(font, glyphNames, presets, { roles = null, settings = {}, sources = null } = {}) {
  const outOfDate = [];
  const movedByHand = [];
  for (const { glyphName, source, name, found, position } of expectations(font, glyphNames, presets, {
    roles,
    settings,
    sources,
  })) {
    if (!found || !position || samePoint(found.anchor, position)) {
      continue;
    }
    const note = font.getLayerCustomData?.(glyphName, source.identifier)?.[PLACED_KEY]?.[name];
    const placed = Array.isArray(note) && note.length === 2 ? { x: note[0], y: note[1] } : null;
    const entry = { ...item(glyphName, source.identifier, name, position.x, position.y, found), placed };
    if (placed && samePoint(found.anchor, placed)) {
      outOfDate.push(entry);
    } else {
      movedByHand.push(entry);
    }
  }
  return { outOfDate, movedByHand };
}

// --- variants --------------------------------------------------------------

/**
 * The variants of accents a category asks for (brief § 4.6): for every mark of
 * the list that has no `<mark><suffix>` yet, a VariableGlyph with the outlines of
 * each source copied, scaled about the mark's own attachment point (the height of
 * its first `_` anchor, else the foot of the drawing) and the middle of the
 * drawing horizontally, then moved up by `dy`; its anchors go through the same
 * move. Advance widths are left as they are.
 *
 * A mark made of components is left out — decompose it first — and so is any
 * mark the font has no layer for in some source. `skipped` collects why.
 *
 * Returns [{glyph, from, category, variableGlyph}].
 */
export function planVariants(
  font,
  markNames,
  category,
  { suffix, scale = 1, dy = 0, settings = {}, skipped = null } = {}
) {
  const variantSuffix = suffix ?? settings.markVariants?.[category];
  if (!variantSuffix) {
    skipped?.push({ glyph: null, reason: "no-suffix", category });
    return [];
  }

  const plans = [];
  for (const markName of unique(markNames)) {
    const { base, extension } = splitGlyphName(markName);
    const variantName = base + variantSuffix;
    if (extension) {
      skipped?.push({ glyph: markName, reason: "is-variant" });
      continue;
    }
    if (font.hasGlyph(variantName)) {
      skipped?.push({ glyph: variantName, reason: "exists" });
      continue;
    }

    const layers = {};
    const sources = [];
    let reason = null;
    for (const source of font.sources) {
      const layerGlyph = font.getLayerGlyph(markName, source.identifier);
      if (!layerGlyph) {
        reason = "missing-source";
        break;
      }
      if ((layerGlyph.components || []).length) {
        reason = "has-components";
        break;
      }
      const bounds = pathBounds(layerGlyph.path);
      const originX = bounds ? (bounds.xMin + bounds.xMax) / 2 : 0;
      const attached = (layerGlyph.anchors || []).find((anchor) => anchor.name.startsWith("_"));
      const originY = attached ? attached.y : bounds ? bounds.yMin : 0;
      const move = (x, y) => [
        round(originX + (x - originX) * scale),
        round(originY + (y - originY) * scale + dy),
      ];
      layers[source.identifier] = {
        glyph: {
          path: transformPath(layerGlyph.path, move),
          components: [],
          anchors: (layerGlyph.anchors || []).map((anchor) => {
            const [x, y] = move(anchor.x, anchor.y);
            return { name: anchor.name, x, y };
          }),
          xAdvance: layerGlyph.xAdvance,
        },
      };
      sources.push({
        name: "",
        location: {},
        layerName: source.identifier,
        locationBase: source.identifier,
      });
    }
    if (reason) {
      skipped?.push({ glyph: markName, reason });
      continue;
    }
    plans.push({
      glyph: variantName,
      from: markName,
      category,
      variableGlyph: { name: variantName, sources, layers },
    });
  }
  return plans;
}

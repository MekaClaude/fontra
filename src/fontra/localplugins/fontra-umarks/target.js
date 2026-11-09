// The target: the glyph set the designer wants to end up with, and where the
// work stands on it, step by step (step 4 quater). Pure — no Fontra, no DOM —
// so it runs under `node --test` (tests/test_target.mjs).
//
// A target is a glyph set of Fontra (a preset, a project glyph set) or nothing
// at all, plus a list of our own — `add` and `remove`, glyph names or typed
// characters — stored in the document (rules.js, version 2). Its glyphs fall
// into the six steps of the panel:
//
//   ① target     how many glyphs, how many done
//   ② draw       what is to add to the font, and what is there but still to draw
//   ③ anchors    drawn glyphs that Place anchors would still give anchors to
//   ④ check      anchors out of place, and anchors moved by hand (6b § 1)
//   ⑤ compose    composed glyphs ready to make, waiting for a part, can't be built yet
//   ⑥ update     composed glyphs made earlier that have moved off their anchors
//
// No step is a gate: a glyph whose part is not drawn yet is *waiting*, and
// everything that is ready can be done meanwhile. « Can't be built yet » is
// kept for what will not happen without changing a rule or an anchor. The
// words are the designer's (claude/umarks-vocabulaire.md); the names in the
// code (`impossible`, `stale`, `legacy`) are not renamed.

import { anchorStem } from "./anchors.js";
import { isLegacyRule, placeMark } from "./compose.js";
import { fontNameForCodePoint, nameInFont, splitGlyphName } from "./glyph-data.js";
import { canonicalJSON, isManual, normalizeRule } from "./rules.js";
import { categoryOfBase, dottedLetterRule, markAnchorName, suggestRule } from "./suggest.js";

// --- what the target is made of --------------------------------------------

/**
 * The items typed in the Edit… dialog: glyph names, or characters. A run of
 * non-ASCII characters typed without spaces (`ơưƠƯ`) is that many characters.
 */
export function parseTargetItems(text) {
  const items = [];
  for (const token of String(text || "").split(/[\s,]+/)) {
    if (!token) {
      continue;
    }
    // eslint-disable-next-line no-control-regex
    if (/[^\u0000-\u007f]/.test(token) && [...token].length > 1) {
      items.push(...token);
    } else {
      items.push(token);
    }
  }
  return [...new Set(items)];
}

/** A single character stands for the glyph of its code point, anything else is a glyph name. */
export function isCharacterItem(item) {
  return typeof item === "string" && [...item].length === 1;
}

function fallbackName(codePoint) {
  const hex = codePoint.toString(16).toUpperCase();
  return codePoint > 0xffff ? `u${hex}` : `uni${hex.padStart(4, "0")}`;
}

/**
 * The glyph an item stands for: {glyphName, codePoints}. A character is the
 * font's glyph for its code point, else the name Fontra's table gives it.
 * `font` needs `glyphMap` and `glyphNamesForCodePoint`; `glyphData` is glyph-data.js's.
 */
export function itemGlyph(item, { font = null, glyphData = null } = {}) {
  if (isCharacterItem(item)) {
    const codePoint = item.codePointAt(0);
    const glyphName =
      font?.glyphNamesForCodePoint?.(codePoint)?.[0] ??
      glyphData?.glyphNameForCodePoint(codePoint) ??
      fallbackName(codePoint);
    return { glyphName, codePoints: [codePoint] };
  }
  return entryInFont({ glyphName: item, codePoints: font?.glyphMap?.[item] || [] }, { font, glyphData });
}

/**
 * The font's own glyph for an entry (6a, decision 2: by code point before the
 * name): `idotless` U+0131 of a glyph set is `dotlessi` in a font that names
 * it so, and counts once. An entry the font has under its name, or whose code
 * point the font does not have, stays as it is.
 */
export function entryInFont(entry, { font = null, glyphData = null } = {}) {
  const codePoints = entry.codePoints?.length
    ? [...entry.codePoints]
    : [glyphData?.codePointForGlyphName(entry.glyphName)].filter((codePoint) => typeof codePoint === "number");
  const names = codePoints.length ? font?.glyphNamesForCodePoint?.(codePoints[0]) || [] : [];
  if (names.length && !names.includes(entry.glyphName)) {
    return { glyphName: fontNameForCodePoint(codePoints[0], { font }), codePoints };
  }
  if (!codePoints.length && font && !font.hasGlyph(entry.glyphName)) {
    return { glyphName: nameInFont(entry.glyphName, { font, glyphData }), codePoints };
  }
  return { glyphName: entry.glyphName, codePoints };
}

/**
 * The glyphs of a target, in order, each once: the glyph set's entries
 * (`baseEntries`, [{glyphName, codePoints}]), less `remove`, plus `add`.
 */
export function targetEntries(baseEntries, target, context = {}) {
  const removedNames = new Set();
  const removedCodePoints = new Set();
  for (const item of target?.remove || []) {
    const { glyphName, codePoints } = itemGlyph(item, context);
    removedNames.add(glyphName);
    if (isCharacterItem(item)) {
      codePoints.forEach((codePoint) => removedCodePoints.add(codePoint));
    }
  }
  const isRemoved = (entry) =>
    removedNames.has(entry.glyphName) ||
    (entry.codePoints || []).some((codePoint) => removedCodePoints.has(codePoint));

  const entries = [];
  const seen = new Set();
  const push = (entry) => {
    if (!entry?.glyphName || seen.has(entry.glyphName) || isRemoved(entry)) {
      return;
    }
    seen.add(entry.glyphName);
    entries.push({ glyphName: entry.glyphName, codePoints: [...(entry.codePoints || [])] });
  };
  for (const entry of baseEntries || []) {
    push(entryInFont(entry, context));
  }
  for (const item of target?.add || []) {
    push(itemGlyph(item, context));
  }
  return entries;
}

/** The values of ①'s menu: one per glyph set of the menu, and Add a glyph set…. */
export const GLYPH_SET_MENU = {
  target: (key) => `target:${key}`,
  addGlyphSet: "add-glyph-set",
};

/**
 * ①'s menu (6c, decision 2): `{groups, value}`, groups of
 * [{label?, options: [{value, label, placeholder?}]}]. Only the glyph sets
 * chosen for this font — the active one is `value` — and, last, Add a glyph
 * set…. A new font has no other entry; the closed menu then reads a
 * `placeholder`, which is not in the list that opens.
 */
export function glyphSetMenu(data) {
  const groups = [];
  const targets = Object.entries(data?.targets || {});
  if (!data?.activeTarget) {
    groups.push({
      options: [{ value: "", label: targets.length ? "Choose a glyph set…" : "No glyph set yet", placeholder: true }],
    });
  }
  if (targets.length) {
    groups.push({
      options: targets.map(([key, target]) => ({
        value: GLYPH_SET_MENU.target(key),
        label: [target.name, listLabel(target)].filter((text) => text).join(" "),
      })),
    });
  }
  groups.push({ options: [{ value: GLYPH_SET_MENU.addGlyphSet, label: "Add a glyph set…" }] });
  return { groups, value: data?.activeTarget ? GLYPH_SET_MENU.target(data.activeTarget) : "" };
}

/** The glyph set's own list as it reads next to the menu: `+ 3 − 1`, or "". */
export function listLabel(target) {
  const parts = [];
  if (target?.add?.length) {
    parts.push(`+ ${target.add.length}`);
  }
  if (target?.remove?.length) {
    parts.push(`− ${target.remove.length}`);
  }
  return parts.join(" ");
}

// --- rules, proposed for the target -----------------------------------------

/** Every glyph a rule is made of: the base, the appended parts, the marks. */
export function ruleParts(rule) {
  if (isLegacyRule(rule)) {
    return [rule.legacy];
  }
  return [
    ...new Set([
      rule.base,
      ...(rule.append || []),
      ...(rule.marks || []).map((mark) => mark.glyph),
    ]),
  ];
}

/**
 * The parts a rule asks to be drawn (5 bis § 2): its base, its accents, the
 * `…comb` of a legacy accent. Not the glyphs it appends (`Ldot` = `L` +
 * `periodcentered.loclCAT.case`): those are not marks, and stay out of R2a.
 */
export function demandedParts(rule) {
  if (isLegacyRule(rule)) {
    return [rule.legacy];
  }
  return [...new Set([rule.base, ...(rule.marks || []).map((mark) => mark.glyph)].filter((name) => name))];
}

/**
 * The glyphs the target asks for without naming them: the base and the
 * combining accents of the Unicode decomposition of its glyphs, as Fontra's
 * table names them. Suggestions may use them before the font has them, so
 * that step ② can say what is left to draw.
 */
export function plannedGlyphs(entries, glyphData, font = null) {
  const planned = new Set();
  for (const entry of entries) {
    planned.add(entry.glyphName);
    const codePoint = entry.codePoints?.[0] ?? glyphData?.codePointForGlyphName(entry.glyphName);
    if (!codePoint || !glyphData) {
      continue;
    }
    const decomposed = [...String.fromCodePoint(codePoint).normalize("NFD")];
    if (decomposed.length < 2) {
      continue;
    }
    for (const character of decomposed) {
      // the font's name first: its `uni0301` is the acute it plans (6a § 2)
      const name = fontNameForCodePoint(character.codePointAt(0), { font, glyphData });
      if (name) {
        planned.add(name);
      }
    }
  }
  return planned;
}

/** The font as Suggest sees it, plus the glyphs the target plans to have. */
function withPlanned(font, planned) {
  return {
    ...font,
    sources: font.sources,
    glyphMap: font.glyphMap,
    hasGlyph: (glyphName) => font.hasGlyph(glyphName) || planned.has(glyphName),
    glyphNamesForCodePoint: (codePoint) => font.glyphNamesForCodePoint(codePoint),
    getLayerGlyph: (glyphName, sourceIdentifier) =>
      font.hasGlyph(glyphName) ? font.getLayerGlyph(glyphName, sourceIdentifier) : null,
  };
}

/**
 * Two rules the same once read as the document reads them (normalized), the
 * order of their keys and their provenance aside (6b § 0): a rule that comes
 * back from the document normalized is not « changed » the next time round.
 */
function sameRule(a, b) {
  const strip = (rule) => {
    const { source, ...rest } = rule || {};
    return canonicalJSON(rest);
  };
  return strip(a) === strip(b);
}

/**
 * The `…comb` a legacy (spacing) accent is made of, or null (brief § 4.5,
 * step 5): an accent whose compatibility decomposition is a space and a
 * combining mark (`acute` U+00B4 → U+0020 U+0301 → `acutecomb`), or whose name
 * is that of a `…comb` without the suffix (`grave`, `caron`, `acute.cap` →
 * `acutecomb.cap`). Only a `…comb` the font has, or the target asks for: a
 * font that has only spacing accents keeps its rules on them.
 */
export function legacyCombFor(glyphName, { codePoint, glyphData, available, font = null }) {
  const [stem, ...suffixes] = glyphName.split(".");
  if (!stem || stem.endsWith("comb")) {
    return null;
  }
  const candidates = [];
  if (typeof codePoint === "number") {
    const parts = [...String.fromCodePoint(codePoint).normalize("NFKD")];
    if (parts.length === 2 && parts[0] === " " && /\p{Mn}/u.test(parts[1])) {
      // the font's glyph for the combining code point first (6a § 2)
      for (const name of [
        fontNameForCodePoint(parts[1].codePointAt(0), { font }),
        glyphData?.glyphNameForCodePoint(parts[1].codePointAt(0)),
      ]) {
        if (name) {
          candidates.push([name, ...suffixes].join("."));
        }
      }
    }
  }
  candidates.push([`${stem}comb`, ...suffixes].join("."));
  return candidates.find((name) => name !== glyphName && available(name)) ?? null;
}

// --- the rule a composed glyph of the font shows (step 6a, decision 1) -------

/** The stems of the `_` anchors a glyph carries in some source (`_top.cap` → `top`). */
function markStems(font, glyphName) {
  const stems = [];
  for (const source of font.sources) {
    for (const anchor of font.getLayerGlyph(glyphName, source.identifier)?.anchors || []) {
      if (anchor.name.startsWith("_")) {
        const stem = splitGlyphName(anchor.name.slice(1)).base;
        if (!stems.includes(stem)) {
          stems.push(stem);
        }
      }
    }
  }
  return stems;
}

/**
 * The names of the components a glyph is made of, the same in every source
 * that has components — or null: no component anywhere, or not the same ones
 * in every source (that is not a composition one rule can say).
 */
export function componentNames(font, glyphName) {
  if (!font.hasGlyph(glyphName)) {
    return null;
  }
  let names = null;
  for (const source of font.sources) {
    const components = font.getLayerGlyph(glyphName, source.identifier)?.components || [];
    if (!components.length) {
      continue;
    }
    const these = components.map((component) => component.name);
    if (names && names.join(" ") !== these.join(" ")) {
      return null;
    }
    names = these;
  }
  return names;
}

/** Every glyph the given glyphs are made of, for the caller to load their anchors. */
export function componentsOf(font, glyphNames) {
  const found = new Set();
  for (const name of glyphNames) {
    for (const component of componentNames(font, name) || []) {
      found.add(component);
    }
  }
  return [...found];
}

/**
 * The anchor a component of a composed glyph sits by: the mark's only `_x`,
 * or — when it has several — the one that puts it where it is on the base.
 */
function anchorOfComponent(font, glyphName, index, baseName, stems) {
  if (stems.length === 1) {
    return stems[0];
  }
  for (const source of font.sources) {
    const component = font.getLayerGlyph(glyphName, source.identifier)?.components?.[index];
    const base = font.getPositioningGlyph?.(baseName, source.identifier) ?? font.getLayerGlyph(baseName, source.identifier);
    const mark = font.getLayerGlyph(component?.name, source.identifier);
    if (!component || !base || !mark) {
      continue;
    }
    const at = component.transformation || {};
    for (const stem of stems) {
      const placed = placeMark(base, mark, stem);
      if (placed && Math.abs(placed.dx - (at.translateX || 0)) <= 1 && Math.abs(placed.dy - (at.translateY || 0)) <= 1) {
        return stem;
      }
    }
  }
  return stems[0];
}

/**
 * The accents a glyph's name says it is, or null: `acute` → [acute],
 * `circumflexacute.cap` → [circumflex, acute] (a stacked accent drawn as one
 * glyph, Vietnamese), `revcommaaccent` → null (`rev` is no accent).
 */
export function accentsOfName(glyphName, glyphData) {
  if (!glyphData) {
    return null;
  }
  if (glyphData.isMark(glyphName)) {
    return [glyphName];
  }
  const { base: stem } = splitGlyphName(glyphName);
  const split = (rest) => {
    if (!rest) {
      return [];
    }
    for (let length = rest.length; length >= 2; length--) {
      const head = rest.slice(0, length);
      if (glyphData.isMark(head) || glyphData.isMark(`${head}comb`)) {
        const tail = split(rest.slice(length));
        if (tail) {
          return [head, ...tail];
        }
      }
    }
    return null;
  };
  const parts = split(stem);
  return parts && parts.length > 1 ? parts : null;
}

/**
 * The rule a composed glyph of the font shows (6a, decision 1): a glyph
 * without outlines of its own, made of a base of the font followed by one or
 * more marks of the font — glyphs that carry an `_x` anchor, variant suffix or
 * not (`acute.cap`, `caron.alt`), or that Fontra's table calls marks by their
 * name (a spacing `acute` without anchors yet) — reads as `base + mark @ x`, the anchor
 * deduced from the mark's `_x`, a second mark on the same anchor stacked on
 * the first. `Aacute` = `A` + `acute.cap` is `A + acute.cap @ top`. Null for
 * anything else: outlines, a single component, a first component that is a
 * mark, a component that is not a mark (`e` + `x`), components that differ
 * between sources, a part not loaded.
 */
export function ruleFromComponents(glyphName, { font, glyphData = null, settings = {} }) {
  if (!font.hasGlyph(glyphName) || hasOwnOutlines(font, glyphName)) {
    return null;
  }
  const names = componentNames(font, glyphName);
  if (!names || names.length < 2) {
    return null;
  }
  const [base, ...markNames] = names;
  const loaded = (name) => font.hasGlyph(name) && font.sources.some((source) => font.getLayerGlyph(name, source.identifier));
  if (!loaded(base) || markStems(font, base).length || glyphData?.isMark(base)) {
    return null;
  }
  const marks = [];
  const used = new Map();
  for (const [offset, glyph] of markNames.entries()) {
    if (!loaded(glyph)) {
      return null;
    }
    let stems = markStems(font, glyph);
    const byName = stems.length ? null : accentsOfName(glyph, glyphData);
    if (byName) {
      // an accent by its name that has no `_` anchor yet — a spacing `acute`
      // drawn before anchors, a stacked `circumflexacute.cap`, as on a family of 18 sources:
      // the anchor Unicode's description gives it; ③ puts the `_top`, ⑤
      // says the rule waits for it
      stems = [glyphData.defaultAnchorForMark(byName[0])];
    }
    if (!stems.length) {
      return null;
    }
    const anchor = used.size ? stems.find((stem) => used.has(stem)) ?? stems[0] : anchorOfComponent(font, glyphName, offset + 1, base, stems);
    const entry = { glyph, anchor };
    if (used.has(anchor)) {
      entry.on = used.get(anchor);
    }
    used.set(anchor, glyph);
    marks.push(entry);
  }
  const rule = { base, marks };
  const category = glyphData ? categoryOfBase(base, glyphData, settings || {}) : null;
  if (category && category !== "lower") {
    rule.category = category;
  }
  return rule;
}

/**
 * The rules the target's glyphs get without anyone typing them (decision B):
 * for every glyph that has no manual rule, the rule its components show when
 * the font has it composed of a base and marks (6a, decision 1), else the
 * suggestion from the font as it is (suggest.js: Unicode first, then the
 * name; the combining accent as soon
 * as the font or the target has it, 5 bis § 8), else — when only a part is
 * missing — the same suggestion with the parts the target plans to have, so
 * that `egrave` is `e` + `gravecomb` even before `gravecomb` is drawn.
 *
 * Returns {rules, changed}: `rules` the whole rules object to write (only
 * suggested rules move; a manual one never does), `changed` the names whose
 * rule is new or different.
 */
export function proposeTargetRules(entries, { font, glyphData, data }) {
  const planned = plannedGlyphs(entries, glyphData, font);
  const plannedFont = withPlanned(font, planned);
  const settings = data.settings;
  const rules = { ...data.rules };
  const changed = [];
  const targetNames = new Set(entries.map((entry) => entry.glyphName));
  const available = (name) => font.hasGlyph(name) || targetNames.has(name);
  // a proposal as the document will keep it (normalized); one the document
  // would drop is not proposed, or it would be written again at every refresh
  const propose = (glyphName, raw) => {
    const rule = normalizeRule(glyphName, raw).rule;
    if (rule && (!rules[glyphName] || !sameRule(rules[glyphName], rule))) {
      rules[glyphName] = rule;
      changed.push(glyphName);
    }
  };

  for (const { glyphName, codePoints } of entries) {
    if (isManual(rules[glyphName])) {
      continue;
    }
    // a legacy accent first: it is one component of its `…comb`
    const comb = legacyCombFor(glyphName, {
      codePoint: codePoints?.[0] ?? font.glyphMap?.[glyphName]?.[0] ?? glyphData?.codePointForGlyphName(glyphName),
      glyphData,
      available,
      font,
    });
    if (comb) {
      propose(glyphName, { legacy: comb, source: "suggested" });
      continue;
    }
    // a composed glyph of the font says its rule (6a, decision 1): `Aacute` =
    // `A` + `acute.cap` is that, not « drawn by hand » under a rule on
    // `acutecomb` — the font is right about a suggestion, never about a
    // manual rule
    const read = ruleFromComponents(glyphName, { font, glyphData, settings });
    if (read) {
      propose(glyphName, { ...read, source: "suggested" });
      continue;
    }
    // the combining accent as soon as the font or the target has it, drawn or
    // not; the spacing one only when there is no combining one anywhere
    // (5 bis § 8)
    const inTarget = (name) => targetNames.has(name);
    // `i` = `idotless` + `dotaccentcomb`, `j` likewise, when the pieces are in
    // the font or the target (5 bis § 3); drawn by hand, it stays as drawn
    const dotted = dottedLetterRule(glyphName, { font, glyphData, available: inTarget });
    if (dotted) {
      propose(glyphName, { ...dotted, source: "suggested" });
      continue;
    }
    let suggestion = suggestRule(glyphName, { font, glyphData, settings, available: inTarget });
    if (!suggestion.rule && ["no-base", "no-mark"].includes(suggestion.reason)) {
      suggestion = suggestRule(glyphName, { font: plannedFont, glyphData, settings, available: inTarget });
    }
    if (!suggestion.rule) {
      continue;
    }
    propose(glyphName, { ...suggestion.rule, source: "suggested" });
  }
  return { rules, changed };
}

// --- where the target stands -------------------------------------------------

function hasDrawing(layerGlyph) {
  return (
    !!layerGlyph?.path?.contours?.length ||
    !!layerGlyph?.path?.coordinates?.length ||
    !!layerGlyph?.components?.length
  );
}

/** Outlines of its own in some source — drawn by hand, whatever its rule says. */
export function hasOwnOutlines(font, glyphName) {
  if (!font.hasGlyph(glyphName)) {
    return false;
  }
  return font.sources.some((source) => {
    const path = font.getLayerGlyph(glyphName, source.identifier)?.path;
    return !!path?.contours?.length || !!path?.coordinates?.length;
  });
}

/** A glyph is drawn when every source has outlines or components for it. */
export function isDrawn(font, glyphName) {
  if (!font.hasGlyph(glyphName)) {
    return false;
  }
  return font.sources.every((source) => hasDrawing(font.getLayerGlyph(glyphName, source.identifier)));
}

/** Drawn in the default source: usable as a part, whatever the others say (5 bis § 5). */
export function drawnInDefault(font, glyphName) {
  if (!font.hasGlyph(glyphName)) {
    return false;
  }
  const defaultId = font.defaultSourceIdentifier ?? font.sources[0]?.identifier;
  return hasDrawing(font.getLayerGlyph(glyphName, defaultId));
}

const INCOMPATIBLE = /compatib|interpolat|not.*match|mismatch/i;

/**
 * Why a glyph of the font is not drawn, source by source (5 bis § 5):
 * [{code, source, message}], code `no-drawing` (the layer is empty),
 * `incompatible` (Fontra could not interpolate it: its sources do not match)
 * or `unreadable` (Fontra's error, said as it is).
 */
export function emptyReasons(font, glyphName) {
  const reasons = [];
  for (const source of font.sources) {
    const label = source.name || source.identifier;
    const layerGlyph = font.getLayerGlyph(glyphName, source.identifier);
    if (!layerGlyph && font.hasOwnSource?.(glyphName, source.identifier) === false) {
      reasons.push({ code: "no-drawing", source: label, message: "no layer" });
    } else if (!layerGlyph) {
      const message = font.readError?.(glyphName, source.identifier) ?? null;
      reasons.push({
        code: message && INCOMPATIBLE.test(message) ? "incompatible" : "unreadable",
        source: label,
        message,
      });
    } else if (!hasDrawing(layerGlyph)) {
      reasons.push({ code: "no-drawing", source: label, message: null });
    }
  }
  return reasons;
}

function sourcesText(sources, total) {
  if (sources.length === total && total > 1) {
    return "any source";
  }
  return sources.length > 3 ? `${sources.slice(0, 2).join(", ")} +${sources.length - 2}` : sources.join(", ");
}

/**
 * The reasons in words, shortest first: « no drawing in ExtraLight Condensed
 * Italic », « sources do not interpolate », « cannot be read in Bold: … ».
 */
export function emptyText(reasons, total = reasons.length) {
  const lines = [];
  if (reasons.some((reason) => reason.code === "incompatible")) {
    lines.push("sources do not interpolate");
  }
  const blank = reasons.filter((reason) => reason.code === "no-drawing").map((reason) => reason.source);
  if (blank.length) {
    lines.push(`no drawing in ${sourcesText(blank, total)}`);
  }
  const unreadable = reasons.filter((reason) => reason.code === "unreadable");
  if (unreadable.length) {
    const message = unreadable.find((reason) => reason.message)?.message;
    lines.push(
      `cannot be read in ${sourcesText(unreadable.map((reason) => reason.source), total)}${message ? `: ${message}` : ""}`
    );
  }
  return lines;
}

function plural(count, word, words = `${word}s`) {
  return `${count} ${count === 1 ? word : words}`;
}


/**
 * « 57 u below and 69 u right of », where a component sits against where the
 * anchor puts it — « of » only after right or left: « 20 u below top of e ».
 */
function sitsText(delta) {
  const parts = [];
  const dy = Math.round(delta.dy);
  const dx = Math.round(delta.dx);
  if (dy) {
    parts.push(`${Math.abs(dy)} u ${dy > 0 ? "above" : "below"}`);
  }
  if (dx) {
    parts.push(`${Math.abs(dx)} u ${dx > 0 ? "right" : "left"} of`);
  }
  return parts.join(" and ");
}

/**
 * « (Regular) », « (in Regular, Italic) », « (in all 18 sources) » — always in
 * brackets, so that « since it was made (in both sources) » cannot be read as
 * « made in both sources ».
 */
function inSources(sources, total) {
  if (total === 2 && sources.length === 2) {
    return "(in both sources)";
  }
  if (total > 1 && sources.length === total) {
    return `(in all ${total} sources)`;
  }
  if (sources.length === 1) {
    return `(${sources[0]})`;
  }
  const shown = sources.length > 4 ? [...sources.slice(0, 3), `+${sources.length - 3}`] : sources;
  return `(in ${shown.join(", ")})`;
}

/**
 * Why a made glyph no longer matches its rule, one line per reason, the way
 * ⑥ says it (5 bis § 6): « gravecomb sits 57 u below and 69 u right of top of
 * A (Regular) » — true whether the component or the anchor moved, so it does
 * not guess which —, « in all 18 sources » when it is the same everywhere,
 * « in Regular, Italic » otherwise. When the base's anchor itself moved since
 * the last Make (what Make remembered, compose.js MADE_KEY), that is said too.
 */
export function staleReasons(rule, details) {
  const lines = [];
  const legacy = isLegacyRule(rule);
  for (const difference of details?.differences || []) {
    const where = difference.source;
    switch (difference.code) {
      case "component-translation": {
        if (legacy) {
          // the component moves with the margin: say it as the margin
          const delta = Math.round(difference.expected.dx - difference.found.dx);
          lines.push({ text: `margins ${Math.abs(delta)} u ${delta > 0 ? "wider" : "narrower"}`, where });
          break;
        }
        const mark = (rule.marks || []).find((candidate) => candidate.glyph === difference.glyph);
        const sits = {
          dx: difference.found.dx - difference.expected.dx,
          dy: difference.found.dy - difference.expected.dy,
        };
        const anchorName = difference.anchorMoved?.anchor || mark?.anchor;
        const what = mark ? `${anchorName} of ${mark.on || rule.base}` : "where its rule puts it";
        lines.push({ text: `${difference.glyph} sits ${sitsText(sits)} ${what}`, where });
        if (difference.anchorMoved) {
          const moved = difference.anchorMoved;
          const steps = [];
          if (Math.round(moved.dy)) {
            steps.push(`${Math.abs(Math.round(moved.dy))} u ${moved.dy > 0 ? "up" : "down"}`);
          }
          if (Math.round(moved.dx)) {
            steps.push(`${Math.abs(Math.round(moved.dx))} u ${moved.dx > 0 ? "right" : "left"}`);
          }
          lines.push({ text: `${moved.anchor} of ${moved.on} moved ${steps.join(", ")} since it was made`, where });
        }
        break;
      }
      case "component-name":
        lines.push({ text: `uses ${difference.found}, the rule says ${difference.expected}`, where });
        break;
      case "advance":
        // said once with the margins when they moved too; alone, the `…comb` changed width
        if (
          !(details.differences || []).some(
            (other) => other.code === "component-translation" && other.source === difference.source
          )
        ) {
          lines.push({ text: `advance ${Math.round(difference.found)} → ${Math.round(difference.expected)}`, where });
        }
        break;
      case "component-count":
        lines.push({
          text: `${difference.found} components, the rule makes ${difference.expected}`,
          where,
        });
        break;
      case "missing-source":
        lines.push({ text: "no layer", where });
        break;
      default:
        lines.push({ text: difference.code, where });
    }
  }
  const total = details?.sourceCount ?? new Set(lines.map((line) => line.where).filter((where) => where)).size;
  const byText = new Map();
  for (const line of lines) {
    if (!byText.has(line.text)) {
      byText.set(line.text, []);
    }
    if (line.where && !byText.get(line.text).includes(line.where)) {
      byText.get(line.text).push(line.where);
    }
  }
  return [...byText].map(([text, where]) => (where.length ? `${text} ${inSources(where, total)}` : text));
}

const SINCE_MAKE = / since it was made( |$)/;

/**
 * The orange block of an open base, condensed (6d § 1): the cause once, then
 * the glyphs it puts out of date, the detail per glyph behind a ▸. `entries`:
 * [{glyph, reasons}], the reasons as staleReasons words them. A reason
 * « top of a moved 175 u right since the last Make (Regular) » is a cause the
 * glyphs share; « gravecomb sits 175 u left of top of a (Regular) » is the
 * detail of one. A glyph with no such cause (a component moved by hand) is
 * grouped by its offset, the accent's name taken out: « a component sits … ».
 * [{cause, glyphs, details: [{glyph, text}]}], the largest group first.
 */
export function staleGroups(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    const reasons = entry.reasons || [];
    const moved = reasons.filter((reason) => SINCE_MAKE.test(reason));
    const rest = reasons.filter((reason) => !SINCE_MAKE.test(reason));
    const cause = moved.length
      ? moved.join("; ")
      : rest.map((reason) => reason.replace(/^\S+ sits /, "a component sits ")).join("; ") || "moved off its anchors";
    if (!groups.has(cause)) {
      groups.set(cause, { cause, glyphs: [], details: [] });
    }
    const group = groups.get(cause);
    group.glyphs.push(entry.glyph);
    group.details.push({ glyph: entry.glyph, text: (rest.length ? rest : reasons).join("; ") });
  }
  return [...groups.values()].sort((a, b) => b.glyphs.length - a.glyphs.length);
}

/** « 8 glyphs have moved off their anchors », « 1 glyph has moved off its anchors » — ⑥'s count. */
export function movedOffText(count) {
  return count === 1 ? "1 glyph has moved off its anchors" : `${count} glyphs have moved off their anchors`;
}

/**
 * « 8 glyphs have moved off their anchors: agrave, aacute, acircumflex + 5
 * more » — the line under a cause. The list
 * cuts between two names, never inside one (decided 9 Nov.): as many whole
 * names as fit in `budget` characters, at least one, then « + k more ». The
 * rest is behind the ▸.
 */
export function staleListText(glyphs, budget = 56) {
  const shown = [];
  let length = 0;
  for (const name of glyphs) {
    const next = length + name.length + (shown.length ? 2 : 0);
    if (shown.length && next > budget) {
      break;
    }
    shown.push(name);
    length = next;
  }
  const more = glyphs.length - shown.length;
  return `${movedOffText(glyphs.length)}: ${shown.join(", ")}${more ? ` + ${more} more` : ""}`;
}

/** The names of the glyphs a rule puts in a composed glyph, sorted. */
export function ruleComponentNames(rule) {
  if (isLegacyRule(rule)) {
    return [rule.legacy];
  }
  return [rule.base, ...(rule.append || []), ...(rule.marks || []).map((mark) => mark.glyph)]
    .filter((name) => name)
    .sort();
}

/**
 * The components of the glyph, in some source, are other glyphs than its
 * rule's (`ecaron` = `e` + `caron.alt` under a rule `e` + `caroncomb`): it was
 * put together by hand (5 bis § 1). The same glyphs placed elsewhere, or in
 * another order, are not: that is an offset, for ⑥. A source without
 * components says nothing.
 */
export function componentsOtherThanRule(font, glyphName, rule) {
  if (!font.hasGlyph(glyphName)) {
    return false;
  }
  const expected = ruleComponentNames(rule).join(" ");
  return font.sources.some((source) => {
    const components = font.getLayerGlyph(glyphName, source.identifier)?.components || [];
    if (!components.length) {
      return false;
    }
    return components.map((component) => component.name).sort().join(" ") !== expected;
  });
}

/**
 * The glyph was drawn by hand: outlines of its own, whatever else it holds, or
 * components that are other glyphs than its rule's (5 bis § 1). Make does not
 * touch it unless the designer ticks it in the « Overwrite ? » sheet (step 5).
 * From syncDetails alone; classifyTarget also reads the font, so that a glyph
 * whose rule still waits for a part is « drawn by hand » all the same.
 */
export function drawnByHand(details) {
  if (details?.state !== "stale") {
    return false;
  }
  if (details.differences.some((difference) => difference.code === "has-contours")) {
    return true;
  }
  if (details.differences.some((difference) => difference.code === "component-count")) {
    return true;
  }
  // component-name, index by index: other glyphs, or the same ones reordered?
  const bySource = new Map();
  for (const difference of details.differences) {
    if (difference.code !== "component-name") {
      continue;
    }
    if (!bySource.has(difference.source)) {
      bySource.set(difference.source, { expected: [], found: [] });
    }
    bySource.get(difference.source).expected.push(difference.expected);
    bySource.get(difference.source).found.push(difference.found);
  }
  return [...bySource.values()].some(
    ({ expected, found }) => [...expected].sort().join(" ") !== [...found].sort().join(" ")
  );
}

/** Drawn by hand: outlines of its own (`contours`), or other glyphs (`components`). */
export function drawnByHandKind(font, glyphName, rule) {
  if (hasOwnOutlines(font, glyphName)) {
    return "contours";
  }
  return componentsOtherThanRule(font, glyphName, rule) ? "components" : null;
}

/** Can Recompute fix it by moving components, or does it take a Make? */
export function needsMake(details) {
  return (details?.differences || []).some(
    (difference) => difference.code !== "component-translation" && difference.code !== "advance"
  );
}

/** « without Bold Italic (no drawing of i there) », for a glyph Make leaves sources out of. */
export function withoutText(skipped = []) {
  if (!skipped.length) {
    return "";
  }
  const sources = skipped.map((entry) => entry.source);
  const glyphs = [...new Set(skipped.flatMap((entry) => entry.glyphs))];
  const where = sources.length > 3 ? `${sources.slice(0, 2).join(", ")} +${sources.length - 2}` : sources.join(", ");
  return `without ${where} (${glyphs.join(", ")} not drawn there)`;
}

/**
 * The cause of one problem of an impossible rule, in words, without its source
 * — the true one when compose.js knows which side lacks the anchor (5 bis § 7).
 */
export function problemCause(problem) {
  switch (problem.code) {
    case "missing-glyph":
      return `no ${problem.glyph}`;
    case "missing-anchor":
      switch (problem.lacks) {
        case "base":
          return `needs ${problem.anchor} on ${problem.on}`;
        case "mark":
          return `needs _${problem.anchor} on ${problem.glyph}`;
        case "both":
          return `needs ${problem.anchor} on ${problem.on} and _${problem.anchor} on ${problem.glyph}`;
        case "pair":
          return `${problem.on}'s ${problem.anchor} and ${problem.glyph}'s _${problem.anchor} are of variants that do not pair`;
        default:
          return `needs ${problem.anchor} on ${problem.on}, or _${problem.anchor} on ${problem.glyph}`;
      }
    case "unknown-stack":
      return `${problem.glyph} sits on ${problem.on}, which the rule does not place`;
    case "not-loaded":
      return `${problem.glyph} was not loaded`;
    case "no-outline":
      return `${problem.glyph} has no outline yet`;
    default:
      return problem.code;
  }
}

/** One problem of an impossible rule, in words, with its source. */
export function problemText(problem) {
  return `${problemCause(problem)}${problem.source ? ` (${problem.source})` : ""}`;
}

/**
 * The problems of an impossible rule, condensed (5 bis § 7): one line per
 * cause, its sources grouped — « acute has no _top in all 18 sources »,
 * « a has no top in Regular, Bold » — rather than the same sentence per source.
 */
export function problemLines(problems = [], total = undefined) {
  const byCause = new Map();
  for (const problem of problems) {
    const cause = problemCause(problem);
    if (!byCause.has(cause)) {
      byCause.set(cause, []);
    }
    if (problem.source && !byCause.get(cause).includes(problem.source)) {
      byCause.get(cause).push(problem.source);
    }
  }
  return [...byCause].map(([cause, sources]) =>
    sources.length ? `${cause} ${inSources(sources, total ?? 0)}` : cause
  );
}

/**
 * A row of the list: one short line, the cause; the detail on hover only
 * when there are several causes. {detail, title}.
 */
export function impossibleRow(why = []) {
  if (why.length <= 1) {
    return { detail: why[0] || "", title: "" };
  }
  return { detail: `${why[0]} · +${why.length - 1} more`, title: why.join("\n") };
}

/**
 * ④'s line for an anchor (6b § 1), as ⑥ says a component: « top of e sits
 * 12 u below its position (Italic) », the sources it is so in named.
 * `entries`: the placedStates entries of one anchor of one glyph; `sourceName`
 * id -> name; `total` the number of sources of the font.
 */
export function placedTexts(entries, sourceName = (id) => id, total = 0) {
  const bySits = new Map();
  for (const entry of entries) {
    const sits = sitsText({ dx: entry.existing.x - entry.x, dy: entry.existing.y - entry.y });
    if (!bySits.has(sits)) {
      bySits.set(sits, []);
    }
    bySits.get(sits).push(sourceName(entry.source));
  }
  const { glyph, name } = entries[0];
  return [...bySits].map(([sits, sources]) => `${name} of ${glyph} sits ${sits} its position ${inSources(sources, total)}`);
}

/**
 * ④'s rows (6b § 1): one per glyph, out of date first, then moved by hand;
 * each says its anchors as `placedTexts` does. [{glyph, detail, title, state}].
 */
export function placedRows(entries, state, sourceName, total) {
  const byGlyph = new Map();
  for (const entry of entries) {
    const key = entry.glyph;
    if (!byGlyph.has(key)) {
      byGlyph.set(key, new Map());
    }
    const anchors = byGlyph.get(key);
    if (!anchors.has(entry.name)) {
      anchors.set(entry.name, []);
    }
    anchors.get(entry.name).push(entry);
  }
  return [...byGlyph].map(([glyph, anchors]) => {
    const lines = [...anchors.values()].flatMap((list) => placedTexts(list, sourceName, total));
    return {
      glyph,
      detail: lines.length > 1 ? `${lines[0]} · +${lines.length - 1} more` : lines[0],
      title: lines.join("\n"),
      state,
    };
  });
}

/**
 * What Re-place takes (6b § 1): every anchor out of date, and the anchors
 * moved by hand of the ticked glyphs; ticks narrow it to those glyphs.
 */
export function replaceEntries(check, ticked = []) {
  if (!ticked.length) {
    return [...check.outOfDate];
  }
  const chosen = new Set(ticked);
  return [...check.outOfDate, ...check.movedByHand].filter((entry) => chosen.has(entry.glyph));
}

/**
 * Where every glyph of the target stands. Everything is passed in, worked
 * out by the caller from the font:
 *
 *   names           the target's glyph names, in order
 *   rules           the document's rules
 *   font            compose.js's adapter (hasGlyph, sources, getLayerGlyph)
 *   states          Map glyphName -> compose.js's syncDetails, for the target's
 *                   composed glyphs (a missing entry is still being checked)
 *   pendingAnchors  Set of the glyphs Place anchors would add anchors to
 *   placed          anchors.js placedStates: {outOfDate, movedByHand}
 *   isMark          glyphName -> bool, for a glyph no rule uses as an accent
 *
 * Returns {glyphs, done, draw, anchors, check, compose, update, byGlyph}.
 */
export function classifyTarget({
  names,
  rules = {},
  font,
  states = new Map(),
  pendingAnchors = new Set(),
  placed = { outOfDate: [], movedByHand: [] },
  isMark = () => false,
}) {
  const composed = names.filter((name) => rules[name]);

  const usedAsMark = new Set();
  const usedAsBase = new Set();
  const parts = [];
  for (const name of composed) {
    const rule = rules[name];
    if (isLegacyRule(rule)) {
      usedAsMark.add(rule.legacy);
    } else {
      usedAsBase.add(rule.base);
    }
    for (const mark of rule.marks || []) {
      usedAsMark.add(mark.glyph);
    }
    parts.push(...demandedParts(rule));
  }
  // ② and ③ look only at what the rules of the target ask for — bases and
  // accents; the rest of the target is not the plug-in's (5 bis § 2)
  const toDraw = [...new Set(parts)].filter((name) => !rules[name] || !names.includes(name));
  const kindOf = (name) =>
    usedAsMark.has(name) || isMark(name) ? "accent" : usedAsBase.has(name) ? "base" : "glyph";

  const byGlyph = new Map();
  // `incomplete`: drawn in the default source, not in some other — usable,
  // said with where and why (5 bis § 5)
  const draw = { absent: [], empty: [], incomplete: [] };
  const drawn = new Set();
  const total = font.sources.length;
  for (const name of toDraw) {
    if (!font.hasGlyph(name)) {
      draw.absent.push({ glyph: name, kind: kindOf(name), inTarget: names.includes(name) });
      byGlyph.set(name, { step: "draw", status: "absent" });
    } else if (!isDrawn(font, name)) {
      const why = emptyText(emptyReasons(font, name), total);
      const entry = { glyph: name, kind: kindOf(name), inTarget: names.includes(name), why };
      if (drawnInDefault(font, name)) {
        draw.incomplete.push(entry);
        byGlyph.set(name, { step: "draw", status: "incomplete", why });
        drawn.add(name);
      } else {
        draw.empty.push(entry);
        byGlyph.set(name, { step: "draw", status: "empty", why });
      }
    } else {
      drawn.add(name);
    }
  }

  // a part with a rule of its own that was drawn by hand (`i`, under
  // `iogonek`) is a drawn base all the same: it gets its anchors, and they
  // are checked (5 bis § 3)
  const handDrawnParts = [...new Set(parts)].filter(
    (name) => rules[name] && names.includes(name) && hasOwnOutlines(font, name)
  );
  const anchors = {
    glyphs: [
      ...toDraw.filter((name) => drawn.has(name) && pendingAnchors.has(name)),
      ...handDrawnParts.filter((name) => pendingAnchors.has(name)),
    ],
  };
  for (const name of anchors.glyphs) {
    byGlyph.set(name, { step: "anchors", status: "no-anchors" });
  }
  for (const name of drawn) {
    if (!byGlyph.has(name)) {
      byGlyph.set(name, { step: "done", status: "drawn" });
    }
  }

  const inScope = new Set([...toDraw, ...handDrawnParts]);
  // ④ (6b § 1): out of date, Re-place puts them back; moved by hand, only ticked
  const check = {
    outOfDate: (placed.outOfDate || []).filter((entry) => inScope.has(entry.glyph)),
    movedByHand: (placed.movedByHand || []).filter((entry) => inScope.has(entry.glyph)),
  };
  check.glyphs = [...new Set([...check.outOfDate, ...check.movedByHand].map((entry) => entry.glyph))];

  // `legacy`: the ready ones that are legacy accents, for the line to say so
  // `drawnByHand`: a rule, but a drawing of its own — done, and kept apart
  // `partial`: the ready ones that leave sources out, [{glyph, without}] (5 bis § 5)
  const compose = { ready: [], legacy: [], partial: [], drawnByHand: [], waiting: [], impossible: [], checking: [] };
  const update = { stale: [] };
  let doneComposed = 0;

  // a part drawn in the default source is usable: Make leaves out the sources
  // it is missing from, and says so (5 bis § 5)
  const notReady = (name) => !font.hasGlyph(name) || !(isDrawn(font, name) || drawnInDefault(font, name));
  for (const name of composed) {
    const rule = rules[name];
    const details = states.get(name);
    // outlines of its own, or other glyphs than its rule's: drawn by hand,
    // done — even while a part of its rule is still to draw (`i` before
    // `dotaccentcomb`, 5 bis § 3; `ecaron` = `e` + `caron.alt`, § 1)
    const handKind = drawnByHandKind(font, name, rule);
    if (handKind) {
      doneComposed++;
      compose.drawnByHand.push(name);
      byGlyph.set(name, { step: "compose", status: "drawn-by-hand", kind: handKind });
      continue;
    }
    const missingParts = ruleParts(rule).filter(notReady);
    if (missingParts.length) {
      compose.waiting.push({ glyph: name, parts: missingParts });
      byGlyph.set(name, { step: "compose", status: "waiting", parts: missingParts });
      continue;
    }
    if (!details) {
      compose.checking.push(name);
      byGlyph.set(name, { step: "compose", status: "checking" });
      continue;
    }
    switch (details.state) {
      case "missing":
        compose.ready.push(name);
        if (isLegacyRule(rule)) {
          compose.legacy.push(name);
        }
        if (details.skipped?.length) {
          compose.partial.push({ glyph: name, without: details.skipped });
        }
        byGlyph.set(name, { step: "compose", status: "ready", without: details.skipped || [] });
        break;
      case "ok":
        doneComposed++;
        byGlyph.set(name, { step: "done", status: "made" });
        break;
      case "stale":
        if (drawnByHand(details)) {
          doneComposed++;
          compose.drawnByHand.push(name);
          byGlyph.set(name, { step: "compose", status: "drawn-by-hand", kind: "components" });
        } else {
          const reasons = staleReasons(rule, details);
          update.stale.push({ glyph: name, reasons, make: needsMake(details) });
          byGlyph.set(name, { step: "update", status: "stale", reasons });
        }
        break;
      case "impossible": {
        // an anchor that Place anchors will put is something to wait for
        const anchorParts = [];
        const unsolved = [];
        for (const problem of details.problems || []) {
          if (
            problem.code === "missing-anchor" &&
            (pendingAnchors.has(problem.on) || pendingAnchors.has(problem.glyph))
          ) {
            anchorParts.push(pendingAnchors.has(problem.on) ? problem.on : problem.glyph);
          } else {
            unsolved.push(problem);
          }
        }
        if (!unsolved.length && anchorParts.length) {
          const waitingFor = [...new Set(anchorParts)];
          compose.waiting.push({ glyph: name, parts: [], anchorsOn: waitingFor });
          byGlyph.set(name, { step: "compose", status: "waiting", parts: [], anchorsOn: waitingFor });
        } else {
          // one line per cause, the sources grouped (5 bis § 7)
          const text = problemLines(unsolved, font.sources.length);
          compose.impossible.push({ glyph: name, why: text });
          byGlyph.set(name, { step: "compose", status: "impossible", why: text });
        }
        break;
      }
      default:
        compose.checking.push(name);
    }
  }

  const doneCount = doneComposed + toDraw.filter((name) => drawn.has(name)).length;
  return {
    glyphs: names.length,
    // what of the target concerns U+Marks: the glyphs to compose, the parts
    forPlugin: { compose: composed.length, parts: toDraw.length },
    done: doneCount,
    draw,
    anchors,
    check,
    compose,
    update,
    byGlyph,
  };
}

// --- the sentences of the six lines -----------------------------------------

/**
 * What a glyph waits for, in words: « gravecomb to be drawn », « anchors on e
 * to be placed », both with « and ». `parts` are drawn, `anchorsOn` placed.
 */
export function waitingClause(parts = [], anchorsOn = []) {
  return [
    parts.length ? `${parts.join(", ")} to be drawn` : null,
    anchorsOn.length ? `anchors on ${anchorsOn.join(", ")} to be placed` : null,
  ]
    .filter((text) => text)
    .join(" and ");
}

/** What waits, for what: « 26 waiting for acutecomb, caroncomb to be drawn ». */
export function waitingText(waiting) {
  if (!waiting.length) {
    return "";
  }
  const parts = new Set();
  let anchorsToo = false;
  for (const entry of waiting) {
    entry.parts.forEach((part) => parts.add(part));
    if (entry.anchorsOn?.length) {
      anchorsToo = true;
    }
  }
  const names = [...parts];
  const listed = names.length > 4 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  const what = [listed ? `${listed} to be drawn` : null, anchorsToo ? "anchors to be placed" : null]
    .filter((text) => text)
    .join(" and ");
  return `${waiting.length} waiting for ${what}`;
}

/**
 * The count of each line, {text, done}: `done` lines read « done » in green and
 * stay folded. `status` is classifyTarget's result.
 */
export function stepCounts(status, { sources = 1 } = {}) {
  const draw = status.draw;
  const drawParts = [];
  if (draw.absent.length) {
    drawParts.push(`${plural(draw.absent.length, "glyph")} to add`);
  }
  if (draw.empty.length) {
    const bases = draw.empty.filter((entry) => entry.kind !== "accent").length;
    const accents = draw.empty.length - bases;
    const split = [bases ? plural(bases, "base") : null, accents ? plural(accents, "accent") : null]
      .filter((text) => text)
      .join(", ");
    drawParts.push(`${draw.empty.length} still to draw (${split})`);
  }
  if (draw.incomplete?.length) {
    drawParts.push(`${draw.incomplete.length} missing in some sources`);
  }
  const compose = status.compose;
  const composeParts = [];
  if (compose.ready.length) {
    const ready = compose.ready.length;
    const legacy = compose.legacy?.length || 0;
    let text = `${ready} ready`;
    if (legacy && legacy === ready) {
      text += ready === 1 ? ", a spacing accent" : ", all spacing accents";
    } else if (legacy) {
      text += legacy === 1 ? ", 1 of them a spacing accent" : `, ${legacy} of them spacing accents`;
    }
    composeParts.push(text);
  }
  if (compose.waiting.length) {
    composeParts.push(waitingText(compose.waiting));
  }
  if (compose.impossible.length) {
    composeParts.push(`${compose.impossible.length} can't be built yet`);
  }
  if (compose.checking.length) {
    composeParts.push(`checking ${compose.checking.length}…`);
  }
  // an empty target has nothing done: its lines say so rather than « done »
  const empty = status.glyphs === 0;
  const line = (parts, aside = []) =>
    empty
      ? { text: "—", done: false }
      : { text: [...(parts.length ? parts : ["done"]), ...aside].join(" · "), done: !parts.length };
  // drawn by hand is done: said on the line, but it does not keep it open
  const drawn = compose.drawnByHand?.length || 0;
  return {
    target: empty ? { text: "This glyph set is empty — add glyphs with Edit….", done: false } : targetLine(status),
    draw: line(drawParts),
    anchors: line(
      status.anchors.glyphs.length
        ? [
            status.anchors.glyphs.length === 1
              ? "1 drawn glyph has no anchors yet"
              : `${status.anchors.glyphs.length} drawn glyphs have no anchors yet`,
          ]
        : []
    ),
    // moved by hand is the designer's: said on the line, it does not keep it open
    check: line(
      status.check.outOfDate.length ? [`${plural(status.check.outOfDate.length, "anchor")} out of place`] : [],
      status.check.movedByHand.length ? [`${status.check.movedByHand.length} moved by hand`] : []
    ),
    compose: line(composeParts, drawn ? [`${drawn} drawn by hand`] : []),
    update: line(status.update.stale.length ? [movedOffText(status.update.stale.length)] : []),
  };
}

/**
 * ①: « 239 glyphs · 132 accented glyphs, built from 21 parts · 81 done » —
 * what of the glyph set is the plug-in's (5 bis § 2), and how much of that is
 * done. Done when all of it is.
 */
function targetLine(status) {
  const { compose = 0, parts = 0 } = status.forPlugin || {};
  const ours = compose + parts;
  const text = ours
    ? `${plural(status.glyphs, "glyph")} · ${plural(compose, "accented glyph")}, built from ${plural(parts, "part")} · ${status.done} done`
    : `${plural(status.glyphs, "glyph")} · no accented glyphs`;
  return { text, done: ours > 0 && status.done === ours };
}

/**
 * The label of a line's button: the whole of it, or the ticked part — « Make
 * 5 », « Add 8 missing glyphs » (`noun`: « missing glyph », plural by the count).
 */
export function actionLabel(verb, all, selected = [], noun = "") {
  const ticked = selected.filter((name) => all.includes(name));
  const count = ticked.length || all.length;
  if (!noun) {
    return count ? `${verb} ${count}` : verb;
  }
  return count ? `${verb} ${plural(count, noun)}` : `${verb} ${noun}s`;
}

/** The names a line's action works on: the ticked ones, else all of them. */
export function actionNames(all, selected = []) {
  const ticked = all.filter((name) => selected.includes(name));
  return ticked.length ? ticked : all;
}

// --- what a base can compose (need 3) ----------------------------------------

// the blocks where Unicode keeps its precomposed letters
const DECOMPOSABLE_RANGES = [
  [0x00c0, 0x024f],
  [0x0340, 0x04ff],
  [0x1e00, 0x1fff],
  [0x2100, 0x214f],
  [0xa720, 0xa7ff],
  [0xab30, 0xab6f],
];

let decompositionIndex = null;

/** base code point -> [code points that decompose into it plus marks]. */
function decompositions() {
  if (!decompositionIndex) {
    decompositionIndex = new Map();
    for (const [first, last] of DECOMPOSABLE_RANGES) {
      for (let codePoint = first; codePoint <= last; codePoint++) {
        const decomposed = [...String.fromCodePoint(codePoint).normalize("NFD")].map((character) =>
          character.codePointAt(0)
        );
        if (decomposed.length < 2) {
          continue;
        }
        if (!decompositionIndex.has(decomposed[0])) {
          decompositionIndex.set(decomposed[0], []);
        }
        decompositionIndex.get(decomposed[0]).push({ codePoint, marks: decomposed.slice(1) });
      }
    }
  }
  return decompositionIndex;
}

function anchorStemsOf(font, glyphName) {
  const stems = new Set();
  const source = font.sources[0];
  for (const anchor of (source && font.getLayerGlyph(glyphName, source.identifier)?.anchors) || []) {
    if (!anchor.name.startsWith("_")) {
      stems.add(anchorStem(anchor.name));
    }
  }
  return stems;
}

/**
 * The characters this base composes (need 3): those whose canonical
 * decomposition is the base plus marks its anchors can take and whose accent
 * the font has (or the target asks for), and every rule of the document that
 * has it for base. Each one is
 *
 *   {glyph, character, status: "made" | "to-make" | "possible", inTarget, rule}
 *
 * `made` the font has it; `to-make` the target wants it and it is not made;
 * `possible` the target does not have it. `rule` is the document's rule, or
 * the one Suggest would write.
 */
export function composablesFor(baseName, { font, glyphData, rules = {}, targetNames = [] }) {
  const inTarget = new Set(targetNames);
  const available = (name) => !!name && (font.hasGlyph(name) || inTarget.has(name));
  const found = new Map();

  const add = (glyphName, character, rule) => {
    if (found.has(glyphName)) {
      return;
    }
    const status = font.hasGlyph(glyphName)
      ? "made"
      : inTarget.has(glyphName)
        ? "to-make"
        : "possible";
    found.set(glyphName, { glyph: glyphName, character, status, inTarget: inTarget.has(glyphName), rule });
  };

  const { base: stem, extension } = splitGlyphName(baseName);
  const baseCodePoint =
    font.glyphMap?.[baseName]?.[0] ?? (extension ? null : glyphData?.codePointForGlyphName(stem));
  const stems = anchorStemsOf(font, baseName);

  if (baseCodePoint && glyphData) {
    for (const { codePoint, marks } of decompositions().get(baseCodePoint) || []) {
      const glyphName =
        font.glyphNamesForCodePoint?.(codePoint)?.[0] ??
        glyphData.glyphNameForCodePoint(codePoint) ??
        fallbackName(codePoint);
      const character = String.fromCodePoint(codePoint);
      if (rules[glyphName]) {
        add(glyphName, character, rules[glyphName]);
        continue;
      }
      // the rule Suggest would write, with what the font has
      const ruleMarks = [];
      const used = new Map();
      let ok = true;
      for (const markCodePoint of marks) {
        const combining = glyphData.glyphNameForCodePoint(markCodePoint);
        const spacing = combining ? glyphData.spacingTwin(combining) : null;
        // by code point first (6a § 2): the font's own name for each
        const markGlyph = [
          fontNameForCodePoint(markCodePoint, { font }),
          combining,
          nameInFont(spacing, { font, glyphData }),
          spacing,
        ].find(available);
        if (!markGlyph) {
          ok = false;
          break;
        }
        const anchor = font.hasGlyph(markGlyph)
          ? markAnchorName(markGlyph, font, glyphData)
          : glyphData.defaultAnchorForMark(markGlyph);
        const entry = { glyph: markGlyph, anchor };
        if (used.has(anchor)) {
          entry.on = used.get(anchor);
        } else if (!stems.has(anchor)) {
          ok = false;
          break;
        }
        used.set(anchor, markGlyph);
        ruleMarks.push(entry);
      }
      if (ok || inTarget.has(glyphName) || font.hasGlyph(glyphName)) {
        add(glyphName, character, ok ? { base: baseName, marks: ruleMarks } : null);
      }
    }
  }

  for (const [glyphName, rule] of Object.entries(rules)) {
    if (rule.base === baseName) {
      const codePoint = font.glyphMap?.[glyphName]?.[0] ?? glyphData?.codePointForGlyphName(glyphName);
      add(glyphName, codePoint ? String.fromCodePoint(codePoint) : glyphName, rule);
    }
  }

  // the characters in code point order, then the glyphs without one (a rule
  // written from the anchors, `e_caron.alt`) by name
  const named = (entry) => [...entry.character].length > 1;
  const order = (entry) => (named(entry) ? Infinity : entry.character.codePointAt(0));
  return [...found.values()].sort(
    (a, b) => (order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1) || (a.glyph < b.glyph ? -1 : 1)
  );
}

// --- rules from the anchors (step 6a, decisions 5 to 7) ----------------------
//
// Unicode does not say everything a font composes: `e` + `caron.alt`, a
// stylistic accent, a base of its own. A base that has `top` and a mark that
// has `_top` can be composed, Unicode or not. The plug-in never proposes such
// a rule on its own (decision 7: every base × every mark makes no sense), it
// makes it easy to write: one click on the open base, or the matrix of Edit….

/** The pattern a rule from the anchors is named by, as it reads by default. */
export const DEFAULT_NAME_PATTERN = "base_mark";

/**
 * The name of the glyph `base` + `mark` makes, by the document's pattern
 * (`settings.namePattern`): `base_mark` by default — the Glyphs convention of
 * ligatures, `e_caron.alt` —, or any text with `{base}` and `{mark}` in it
 * (`{base}{mark}`, `{base}.{mark}`). A pattern without braces reads its first
 * `base` and its first `mark` as them.
 */
export function ruleNameFor(pattern, base, mark) {
  let text = String(pattern || "").trim() || DEFAULT_NAME_PATTERN;
  if (!/\{(base|mark)\}/.test(text)) {
    text = text.replace("base", "{base}").replace("mark", "{mark}");
  }
  return text.replaceAll("{base}", base).replaceAll("{mark}", mark);
}

/** A name a glyph can take: no space, no slash, not empty. */
export function isUsableGlyphName(name) {
  return typeof name === "string" && /^[^\s/\\]+$/.test(name) && !name.startsWith(".");
}

/** The stems of the anchors a base offers (`top`, `bottom`; `top.cap` is `top`). */
export function baseAnchorStems(font, glyphName) {
  return [...anchorStemsOf(font, glyphName)];
}

/** The stems of the `_` anchors a mark carries: what it attaches by. */
export function markAnchorStems(font, glyphName) {
  return font.hasGlyph(glyphName) ? markStems(font, glyphName) : [];
}

/**
 * A mark worth composing with: it carries an `_x` anchor, and it is not a
 * spacing accent whose combining one the font has (`acute` beside
 * `acutecomb`: the combining one is what composes, brief § 4.5).
 */
export function composingMark(font, glyphName, glyphData) {
  if (!markAnchorStems(font, glyphName).length) {
    return false;
  }
  const combining = glyphData?.combiningTwin(glyphName);
  return !(combining && font.hasGlyph(nameInFont(combining, { font, glyphData })));
}

/**
 * What a base composes from its anchors alone (6a, decision 5), after what
 * Unicode gives it: for each anchor `x` of the base, the marks of `markNames`
 * that have `_x`. Each one is
 *
 *   {anchor, mark, glyph, status, inTarget, rule}
 *
 * `glyph` the name the pattern gives it, `status` « made », « to-make » (the
 * target has it), « possible »; `rule` = `base + mark @ x`. Left out: a mark
 * some rule of this base already puts on that anchor (`eacute` has
 * `acutecomb` @ top), and the spacing twin of a combining accent the font has.
 * Grouped by anchor: [{anchor, entries}].
 */
export function anchorComposablesFor(
  baseName,
  { font, glyphData = null, markNames = [], rules = {}, targetNames = [], settings = {}, used = [] }
) {
  if (markAnchorStems(font, baseName).length) {
    return []; // a mark is not a base here, though it may carry a `top`
  }
  const inTarget = new Set(targetNames);
  // the same accent is taken on that anchor: spacing or combining, and its
  // variant for a category (`acute.cap` when `Aacute` = `A` + `acutecomb`) —
  // a stylistic one (`caron.alt`) is another accent
  const variantSuffixes = new Set(Object.values(settings?.markVariants || {}));
  const accentKey = (name) => splitGlyphName(name).base.replace(/(?<=.)comb$/, "");
  const key = (entry) => {
    const [mark, anchor] = entry.split("@");
    const { extension } = splitGlyphName(mark);
    return `${accentKey(mark)}${variantSuffixes.has(extension) ? "" : extension}@${anchor}`;
  };
  const taken = new Set(used.map(key));
  for (const rule of Object.values(rules)) {
    if (rule?.base === baseName && rule.marks?.length === 1) {
      taken.add(key(`${rule.marks[0].glyph}@${rule.marks[0].anchor}`));
    }
  }
  // a variant drawn for another category (`acute.cap` beside `o`) is not one
  // to compose with this base
  const category = glyphData ? categoryOfBase(baseName, glyphData, settings || {}) : null;
  const otherVariants = new Set(
    Object.entries(settings?.markVariants || {})
      .filter(([forCategory]) => forCategory !== category)
      .map(([, suffix]) => suffix)
  );
  const groups = [];
  for (const anchor of baseAnchorStems(font, baseName)) {
    const entries = [];
    for (const mark of [...new Set(markNames)].sort()) {
      if (
        mark === baseName ||
        taken.has(key(`${mark}@${anchor}`)) ||
        otherVariants.has(splitGlyphName(mark).extension) ||
        !composingMark(font, mark, glyphData)
      ) {
        continue;
      }
      if (!markAnchorStems(font, mark).includes(anchor)) {
        continue;
      }
      const glyph = ruleNameFor(settings.namePattern, baseName, mark);
      entries.push({
        anchor,
        mark,
        glyph,
        status: font.hasGlyph(glyph) ? "made" : inTarget.has(glyph) ? "to-make" : "possible",
        inTarget: inTarget.has(glyph),
        rule: { base: baseName, marks: [{ glyph: mark, anchor }] },
      });
    }
    if (entries.length) {
      groups.push({ anchor, entries });
    }
  }
  return groups;
}

// --- the matrix of Edit… (6a, decision 6) ------------------------------------

/**
 * The anchors every ticked base offers and every ticked mark attaches by —
 * what the matrix's menu proposes. In the order the first base has them.
 */
export function commonAnchors(font, bases, marks) {
  if (!bases.length || !marks.length) {
    return [];
  }
  let anchors = baseAnchorStems(font, bases[0]);
  for (const base of bases.slice(1)) {
    const these = new Set(baseAnchorStems(font, base));
    anchors = anchors.filter((anchor) => these.has(anchor));
  }
  for (const mark of marks) {
    const these = new Set(markAnchorStems(font, mark));
    anchors = anchors.filter((anchor) => these.has(anchor));
  }
  return anchors;
}

/**
 * « Compose these bases with these marks »: every base × every mark on the
 * anchor, named by the pattern. Returns
 *
 *   {add: [{glyph, rule}], already: [glyph], invalid: [glyph], duplicates: [glyph]}
 *
 * `add` the rules to write (manual), `already` the names a rule or a glyph
 * of the font has already — not written over —, `invalid` the names no glyph
 * can take, `duplicates` a name the pattern gives twice (`{base}` alone).
 */
export function matrixRules({ bases = [], marks = [], anchor, pattern, rules = {}, font = null }) {
  const add = [];
  const already = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();
  if (!anchor) {
    return { add, already, invalid, duplicates };
  }
  for (const base of bases) {
    for (const mark of marks) {
      const glyph = ruleNameFor(pattern, base, mark);
      if (seen.has(glyph)) {
        duplicates.push(glyph);
        continue;
      }
      seen.add(glyph);
      if (!isUsableGlyphName(glyph)) {
        invalid.push(glyph);
      } else if (rules[glyph] || font?.hasGlyph(glyph)) {
        already.push(glyph);
      } else {
        add.push({ glyph, rule: { base, marks: [{ glyph: mark, anchor }], source: "manual" } });
      }
    }
  }
  return { add, already, invalid, duplicates };
}

/** The matrix's count, before Add: « 24 rules, 3 already there ». */
export function matrixPreview(result, { anchor = null, ticked = true } = {}) {
  if (!ticked) {
    return "Tick bases and marks.";
  }
  if (!anchor) {
    return "No anchor these bases and marks share.";
  }
  const parts = [plural(result.add.length, "rule")];
  if (result.already.length) {
    parts.push(`${result.already.length} already there`);
  }
  if (result.invalid.length) {
    parts.push(`${result.invalid.length} not a glyph name (${result.invalid.slice(0, 2).join(", ")})`);
  }
  if (result.duplicates.length) {
    parts.push(`${result.duplicates.length} named twice: the pattern needs {base} and {mark}`);
  }
  return parts.join(", ");
}

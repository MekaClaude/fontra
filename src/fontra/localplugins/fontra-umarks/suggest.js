// Suggest: fill a glyph set's rules from the Unicode decomposition of each
// glyph, the glyph names Fontra knows, and what the font actually has.
// Pure (tests/test_suggest.mjs). See docs/brief.md § 4.5 and § 4.6.
//
// Two decisions drive everything here:
//   - combining accents first: `eacute` is `e` + `acutecomb` when the font has
//     the combining one or the target asks for it (`available`, step 5 bis
//     § 8) — drawn or not yet —, `e` + `acute` only when there is no
//     `acutecomb` anywhere;
//   - a rule the designer made by hand (`source: "manual"`) is never touched.
//
// The `font` adapter is compose.js's, plus the glyph map:
//   font.glyphNamesForCodePoint(codePoint) -> [glyphName]
//   font.glyphMap -> {glyphName: [codePoint]}

import { isManual } from "./rules.js";
import { fontNameForCodePoint, nameInFont, splitGlyphName } from "./glyph-data.js";

/** The anchor a mark attaches by, as the font itself shows it. */
export function markAnchorName(markGlyphName, font, glyphData) {
  for (const source of font.sources) {
    const layerGlyph = font.getLayerGlyph(markGlyphName, source.identifier);
    for (const anchor of layerGlyph?.anchors || []) {
      if (anchor.name.startsWith("_")) {
        // `_top.cap` means the plain anchor is `top`: the variant is picked at
        // composition time, by compose.js
        return splitGlyphName(anchor.name.slice(1)).base;
      }
    }
  }
  return glyphData.defaultAnchorForMark(markGlyphName);
}

/** Does the font treat this glyph as a mark (it carries an `_` anchor)? */
function fontSeesAsMark(glyphName, font) {
  for (const source of font.sources) {
    const layerGlyph = font.getLayerGlyph(glyphName, source.identifier);
    if ((layerGlyph?.anchors || []).some((anchor) => anchor.name.startsWith("_"))) {
      return true;
    }
  }
  return false;
}

/** The glyph the font uses for a code point, preferring one with our suffix. */
function fontGlyphForCodePoint(codePoint, extension, font) {
  const names = font.glyphNamesForCodePoint(codePoint);
  if (extension) {
    const suffixed = names.find((name) => name.endsWith(extension));
    if (suffixed) {
      return suffixed;
    }
    for (const name of names) {
      if (font.hasGlyph(name + extension)) {
        return name + extension;
      }
    }
  }
  return names[0] ?? null;
}

/** The first of these names the font has, or that `available` says will be there. */
function firstPresent(candidates, font, available = null) {
  for (const name of candidates) {
    if (name && (font.hasGlyph(name) || !!available?.(name))) {
      return name;
    }
  }
  return null;
}

// --- soft-dotted letters (step 5 bis § 3)
//
// Unicode's Soft_Dotted letters (PropList.txt) lose their dot under a mark
// above: `í` is a dotless i with an acute, not an i with an acute over its dot.
// Only i and j have a dotless twin of their own — ı U+0131, ȷ U+0237 — which is
// what a font draws for them; ı itself is not soft-dotted.

/** The code points of PropList.txt's Soft_Dotted, outside the mathematical alphabets. */
export const SOFT_DOTTED = new Set([
  0x0069, 0x006a, 0x012f, 0x0249, 0x0268, 0x029d, 0x02b2, 0x03f3, 0x0456, 0x0458,
  0x1d62, 0x1d96, 0x1da4, 0x1da8, 0x1e2d, 0x1ecb, 0x2071, 0x2148, 0x2149, 0x2c7c,
  0x1df1a, 0x1e04c, 0x1e04d, 0x1e068,
]);

const DOTLESS_TWINS = {
  i: { codePoint: 0x0131, names: ["idotless", "dotlessi"] },
  j: { codePoint: 0x0237, names: ["jdotless", "dotlessj"] },
};

const DOT_ABOVE = 0x0307;

/** Is this glyph a soft-dotted letter — by its code point, or by its name (`i`, `j.ss01`)? */
export function isSoftDotted(glyphName, { font = null, glyphData = null } = {}) {
  const { base, extension } = splitGlyphName(glyphName);
  if (base in DOTLESS_TWINS) {
    return true;
  }
  const codePoint =
    font?.glyphMap?.[glyphName]?.[0] ??
    glyphData?.codePointForGlyphName(glyphName) ??
    (extension ? glyphData?.codePointForGlyphName(base) : null);
  return typeof codePoint === "number" && SOFT_DOTTED.has(codePoint);
}

/** True for a mark that sits above: on `top`, or a variant of it (`top.cap`). */
export function isAboveAnchor(anchorName) {
  return splitGlyphName(anchorName || "top").base === "top";
}

/**
 * The dotless twin of `i` or `j` (keeping a suffix: `i.ss01` → `idotless.ss01`):
 * the name the font gives it, else the one the target has, else — without a
 * suffix — Fontra's name for it, planned. Null for any other glyph, or a
 * suffixed one whose twin is nowhere.
 */
export function dotlessTwin(baseName, { font, glyphData = null, available = null } = {}) {
  const { base, extension } = splitGlyphName(baseName);
  const twin = DOTLESS_TWINS[base];
  if (!twin) {
    return null;
  }
  const names = [
    ...(font?.glyphNamesForCodePoint?.(twin.codePoint) || []).map((name) => splitGlyphName(name).base),
    glyphData?.glyphNameForCodePoint(twin.codePoint),
    ...twin.names,
  ].filter((name) => name);
  const present = (name) => !!font?.hasGlyph(name) || !!available?.(name);
  const found = names.map((name) => name + extension).find(present);
  if (found) {
    return found;
  }
  return extension ? null : names[0];
}

/**
 * The rule of a dotted `i` or `j` itself, as Glyphs makes it: the dotless twin
 * and `dotaccentcomb` on `top` — proposed only when both pieces are in the font
 * or the target. Null otherwise.
 */
export function dottedLetterRule(glyphName, { font, glyphData = null, available = null }) {
  const { base, extension } = splitGlyphName(glyphName);
  if (extension || !(base in DOTLESS_TWINS)) {
    return null;
  }
  const present = (name) => !!name && (font.hasGlyph(name) || !!available?.(name));
  const dotless = dotlessTwin(glyphName, { font, glyphData, available });
  const dot = [fontNameForCodePoint(DOT_ABOVE, { font }), glyphData?.glyphNameForCodePoint(DOT_ABOVE), "dotaccentcomb"].find(present);
  if (!present(dotless) || !dot) {
    return null;
  }
  return { base: dotless, marks: [{ glyph: dot, anchor: "top" }] };
}

/** upper | smallcaps | lower | null, from the Unicode case then the suffix. */
export function categoryOfBase(baseGlyphName, glyphData, settings) {
  const { extension } = splitGlyphName(baseGlyphName);
  for (const [category, definition] of Object.entries(settings.categories || {})) {
    if (definition?.baseSuffix && extension === definition.baseSuffix) {
      return category;
    }
  }
  return glyphData.caseOfName(baseGlyphName);
}

/** The mark drawing this category asks for, when the font has it (§ 4.6). */
function variantForCategory(markGlyphName, category, settings, font, available = null) {
  const suffix = settings.markVariants?.[category];
  if (!suffix) {
    return null;
  }
  const { base, extension } = splitGlyphName(markGlyphName);
  const variant = base + suffix;
  return !extension && (font.hasGlyph(variant) || !!available?.(variant)) ? variant : null;
}

function decomposeByCodePoint(codePoint) {
  const decomposed = [...String.fromCodePoint(codePoint).normalize("NFD")].map((char) =>
    char.codePointAt(0)
  );
  return decomposed.length > 1
    ? { baseCodePoint: decomposed[0], markCodePoints: decomposed.slice(1) }
    : null;
}

/**
 * Split a glyph name into a base the font has and a run of mark names:
 * `Scommaaccent` -> S + commaaccent. For the glyphs Unicode cannot help with,
 * which is most of the suffixed ones.
 */
function decomposeByName(stem, extension, font, glyphData) {
  const isMarkName = (name) =>
    glyphData.isMark(name) || (font.hasGlyph(name) && fontSeesAsMark(name, font));

  const splitMarks = (tail) => {
    const marks = [];
    let rest = tail;
    while (rest) {
      let matched = null;
      for (let length = rest.length; length >= 2; length--) {
        const head = rest.slice(0, length);
        if (isMarkName(head) || isMarkName(head + "comb")) {
          matched = head;
          break;
        }
      }
      if (!matched) {
        return null;
      }
      marks.push(matched);
      rest = rest.slice(matched.length);
    }
    return marks.length ? marks : null;
  };

  for (let cut = stem.length - 1; cut >= 1; cut--) {
    const head = stem.slice(0, cut);
    const baseName = firstPresent([head + extension, head], font);
    if (!baseName) {
      continue;
    }
    const markNames = splitMarks(stem.slice(cut));
    if (markNames) {
      return { baseName, markNames };
    }
  }
  return null;
}

/**
 * One rule, or why there is none.
 * Returns {rule} or {reason, detail}.
 *
 * `available(glyphName)`, when given, names the accents that count as present
 * though the font does not have them yet — the target's (step 5 bis § 8): a
 * combining accent the target asks for wins over a spacing one the font has.
 */
export function suggestRule(glyphName, { font, glyphData, settings, available = null }) {
  const { base: stem, extension } = splitGlyphName(glyphName);

  const codePoint =
    font.glyphMap?.[glyphName]?.[0] ??
    glyphData.codePointForGlyphName(glyphName) ??
    (extension ? glyphData.codePointForGlyphName(stem) : null);

  // Two ways in, tried in this order. Unicode first, because it is the one
  // that knows what `eacute` is made of; the name second, because Unicode says
  // `ncommaaccent` carries a cedilla while every font draws a comma, and
  // because suffixed glyphs have no code point at all.
  const attempts = [];

  const decomposed = codePoint ? decomposeByCodePoint(codePoint) : null;
  if (decomposed) {
    const baseName = firstPresent(
      [
        fontGlyphForCodePoint(decomposed.baseCodePoint, extension, font),
        glyphData.glyphNameForCodePoint(decomposed.baseCodePoint) + extension,
        glyphData.glyphNameForCodePoint(decomposed.baseCodePoint),
      ],
      font
    );
    attempts.push({
      baseName,
      noBase: `U+${decomposed.baseCodePoint.toString(16).toUpperCase()}`,
      marks: decomposed.markCodePoints.map((markCodePoint) => ({
        codePoint: markCodePoint,
        combining: glyphData.glyphNameForCodePoint(markCodePoint),
      })),
    });
  }

  const byName = decomposeByName(stem, extension, font, glyphData);
  if (byName) {
    attempts.push({
      baseName: byName.baseName,
      marks: byName.markNames.map((name) => ({
        codePoint: null,
        combining: glyphData.isMark(name + "comb") ? name + "comb" : name,
      })),
    });
  }

  if (!attempts.length) {
    return { reason: "not-composed" };
  }

  let firstFailure = null;
  for (const attempt of attempts) {
    const result = buildRule(attempt, { font, glyphData, settings, available });
    if (result.rule) {
      return result;
    }
    firstFailure = firstFailure || result;
  }
  return firstFailure;
}

/** Turn one decomposition into a rule, or say what the font is missing. */
function buildRule({ baseName, noBase, marks: markNames }, { font, glyphData, settings, available }) {
  if (!baseName) {
    return { reason: "no-base", detail: noBase };
  }

  const category = categoryOfBase(baseName, glyphData, settings);
  const marks = [];
  const anchorsUsed = new Map();

  for (const mark of markNames) {
    const combining = mark.combining;
    const spacing = combining ? glyphData.spacingTwin(combining) : null;

    // combining first (brief § 4.5), and a category variant before either;
    // a combining accent the target asks for counts as there (5 bis § 8);
    // each by code point before its name — the font's `uni0301` is the
    // acute (6a § 2)
    const combiningCodePoint = mark.codePoint ?? (combining ? glyphData.codePointForGlyphName(combining) : null);
    const candidates = [];
    for (const candidate of [
      fontNameForCodePoint(combiningCodePoint, { font }),
      combining,
      nameInFont(spacing, { font, glyphData }),
      spacing,
    ]) {
      if (candidates.includes(candidate)) {
        continue;
      }
      if (!candidate) {
        continue;
      }
      const variant = variantForCategory(candidate, category, settings, font, available);
      if (variant) {
        candidates.push(variant);
      }
      candidates.push(candidate);
    }

    const markGlyph = firstPresent(candidates, font, available);
    if (!markGlyph) {
      return {
        reason: "no-mark",
        detail:
          combining ||
          (mark.codePoint
            ? `U+${mark.codePoint.toString(16).toUpperCase()}`
            : "unknown mark"),
      };
    }

    const anchor = markAnchorName(markGlyph, font, glyphData);
    const entry = { glyph: markGlyph, anchor };

    // a second mark on the same anchor stacks on the first (mark-to-mark)
    const previous = anchorsUsed.get(anchor);
    if (previous) {
      entry.on = previous;
    }
    anchorsUsed.set(anchor, markGlyph);

    marks.push(entry);
  }

  // a soft-dotted base loses its dot under a mark above: í is ı + ´ (5 bis § 3)
  let base = baseName;
  if (marks.some((mark) => isAboveAnchor(mark.anchor))) {
    base = dotlessTwin(baseName, { font, glyphData, available }) ?? baseName;
  }

  const rule = { base, marks };
  if (category && category !== "lower") {
    rule.category = category;
  }
  return { rule };
}

/**
 * The accents Suggest may end up naming, worked out from the target names
 * alone — no glyph has to be opened to find out.
 *
 * The caller needs this because of a chicken and egg: the anchor of an accent
 * is read from the font (`markAnchorName`), but which accents are involved is
 * only known once the names are decomposed. Without it, an accent the font
 * alone knows about — `commaaccent`, with no code point and no row in Fontra's
 * table — is never loaded, and its anchor is guessed as `top` instead of being
 * read as `bottom`.
 */
export function markCandidatesFor(glyphNames, font, glyphData, settings = {}) {
  const candidates = new Set();
  const fontGlyphNames = Object.keys(font.glyphMap || {});

  const addVariants = (name) => {
    if (!name) {
      return;
    }
    candidates.add(name);
    for (const suffix of Object.values(settings.markVariants || {})) {
      candidates.add(splitGlyphName(name).base + suffix);
    }
  };

  for (const glyphName of glyphNames) {
    const { base: stem, extension } = splitGlyphName(glyphName);

    // by code point: the combining accents of the decomposition, and their
    // spacing twins
    const codePoint =
      font.glyphMap?.[glyphName]?.[0] ??
      glyphData.codePointForGlyphName(glyphName) ??
      (extension ? glyphData.codePointForGlyphName(stem) : null);
    if (codePoint) {
      for (const character of String.fromCodePoint(codePoint).normalize("NFD")) {
        const combining = glyphData.glyphNameForCodePoint(character.codePointAt(0));
        // the font's own names for them too (6a § 2)
        addVariants(fontNameForCodePoint(character.codePointAt(0), { font }));
        addVariants(combining);
        addVariants(combining ? glyphData.spacingTwin(combining) : null);
        addVariants(combining ? nameInFont(glyphData.spacingTwin(combining), { font, glyphData }) : null);
      }
    }

    // by name: every tail of the name that this font has as a glyph of its own
    for (let cut = 1; cut < stem.length; cut++) {
      const tail = stem.slice(cut);
      if (tail.length >= 2 && fontGlyphNames.includes(tail)) {
        addVariants(tail);
      }
      if (tail.length >= 2 && fontGlyphNames.includes(tail + "comb")) {
        addVariants(tail + "comb");
      }
    }
  }

  return [...candidates].filter((name) => font.hasGlyph(name));
}

/**
 * Rules for a whole glyph set. Manual rules are left alone; a glyph the font
 * cannot make is reported in `skipped` rather than guessed at.
 */
export function suggestRules(glyphNames, { font, glyphData, data }) {
  const rules = {};
  const skipped = [];

  for (const glyphName of glyphNames) {
    if (isManual(data.rules[glyphName])) {
      skipped.push({ glyph: glyphName, reason: "manual" });
      continue;
    }
    const suggestion = suggestRule(glyphName, {
      font,
      glyphData,
      settings: data.settings,
    });
    if (suggestion.rule) {
      rules[glyphName] = suggestion.rule;
    } else {
      skipped.push({ glyph: glyphName, ...suggestion });
    }
  }

  return { rules, skipped };
}

/** A copy of the document with the suggestions merged in. */
export function withSuggestions(data, suggestions) {
  return { ...data, rules: { ...data.rules, ...suggestions } };
}

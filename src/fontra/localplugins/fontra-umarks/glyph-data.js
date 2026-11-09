// Fontra already serves the GlyphData table it builds from glyphsLib, as
// /data/glyph-data.csv (see fontra/scripts/rebuild_glyph_data_csv.py and
// fontra-core/src/glyph-data.js). The plug-in reads that one rather than
// shipping a copy: same names as Fontra suggests, same provenance, nothing to
// keep in sync. Columns:
//
//   unicode;name;category;subCategory;case;direction;script;description;production
//
// Pure: the text comes in, the tables come out (tests/test_glyph_data.mjs).

export const GLYPH_DATA_URL = "/data/glyph-data.csv";

/** Tables keyed by code point and by glyph name. */
export function parseGlyphData(csvText) {
  const byCodePoint = new Map();
  const byName = new Map();
  const byProduction = new Map();

  let columns = null;
  for (const line of csvText.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const cells = line.split(";");
    if (!columns) {
      columns = cells.map((cell) => cell.trim());
      continue;
    }
    const entry = {};
    for (const [index, column] of columns.entries()) {
      entry[column] = cells[index] ?? "";
    }
    if (!entry.name) {
      continue;
    }
    entry.codePoint = entry.unicode ? parseInt(entry.unicode, 16) : null;
    delete entry.unicode;

    if (!byName.has(entry.name)) {
      byName.set(entry.name, entry);
    }
    if (entry.codePoint !== null && !byCodePoint.has(entry.codePoint)) {
      byCodePoint.set(entry.codePoint, entry);
    }
    // the production name is the other name the same glyph goes by — the AGL
    // one, often (`idotless` is produced as `dotlessi`)
    const production = (entry.production || "").trim();
    if (production && production !== entry.name && !byProduction.has(production)) {
      byProduction.set(production, entry);
    }
  }

  return new GlyphData(byCodePoint, byName, byProduction);
}

/**
 * Names fonts give to a glyph that neither Fontra's name nor its production
 * name is (6a, decision 2): the AGL-style `dotlessj`, whose production name
 * is `uni0237`. Only true aliases — the same code point.
 */
export const NAME_ALIASES = {
  dotlessi: 0x0131,
  dotlessj: 0x0237,
};

/** `uni0301` → 0x0301, `u1F600` → 0x1F600, anything else → null. */
export function codePointOfUniName(glyphName) {
  const match = /^uni([0-9A-F]{4})$/.exec(glyphName) || /^u([0-9A-F]{4,6})$/.exec(glyphName);
  return match ? parseInt(match[1], 16) : null;
}

/**
 * The glyph a font uses for a code point (6a, decision 2: by code point
 * before the name): its own name when it has one for it — the unsuffixed one
 * first —, else Fontra's name for it, else null.
 */
export function fontNameForCodePoint(codePoint, { font = null, glyphData = null } = {}) {
  if (typeof codePoint !== "number") {
    return null;
  }
  const names = font?.glyphNamesForCodePoint?.(codePoint) || [];
  return names.find((name) => !splitGlyphName(name).extension) ?? names[0] ?? glyphData?.glyphNameForCodePoint(codePoint) ?? null;
}

/**
 * The name this font gives the glyph a name stands for: the name itself when
 * the font has it, else the font's glyph of the same code point (`idotless`
 * in a font that says `dotlessi`), else the name as it is. A suffix carries
 * over: `idotless.sc` → `dotlessi.sc` when the font has that.
 */
export function nameInFont(glyphName, { font = null, glyphData = null } = {}) {
  if (!glyphName || !font || font.hasGlyph(glyphName)) {
    return glyphName;
  }
  const { base, extension } = splitGlyphName(glyphName);
  const codePoint = glyphData?.codePointForGlyphName(base) ?? NAME_ALIASES[base] ?? codePointOfUniName(base);
  if (typeof codePoint !== "number") {
    return glyphName;
  }
  const names = font.glyphNamesForCodePoint?.(codePoint) || [];
  for (const name of names) {
    const candidate = splitGlyphName(name).base + extension;
    if (font.hasGlyph(candidate)) {
      return candidate;
    }
  }
  return glyphName;
}

/** Fetch and parse Fontra's table. `fetchFn` is injectable for tests. */
export async function loadGlyphData(fetchFn = fetch, url = GLYPH_DATA_URL) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`could not load ${url}: ${response.status}`);
  }
  return parseGlyphData(await response.text());
}

/** `acute.cap` -> {base: "acute", extension: ".cap"}; `o` -> {base: "o"}. */
export function splitGlyphName(glyphName) {
  const dot = glyphName.indexOf(".", 1);
  return dot < 0
    ? { base: glyphName, extension: "" }
    : { base: glyphName.slice(0, dot), extension: glyphName.slice(dot) };
}

export class GlyphData {
  constructor(byCodePoint, byName, byProduction = new Map()) {
    this.byCodePoint = byCodePoint;
    this.byName = byName;
    this.byProduction = byProduction;
  }

  /**
   * The entry a name stands for, aliases tolerated (6a, decision 2): Fontra's
   * name, its production name (`dotlessi`), a known alias (`dotlessj`), a
   * `uniXXXX` name.
   */
  entryForExactName(glyphName) {
    const entry = this.byName.get(glyphName) || this.byProduction.get(glyphName);
    if (entry) {
      return entry;
    }
    const codePoint = NAME_ALIASES[glyphName] ?? codePointOfUniName(glyphName);
    return codePoint !== null && codePoint !== undefined ? this.byCodePoint.get(codePoint) || null : null;
  }

  get size() {
    return this.byName.size;
  }

  /** The entry for a glyph name, ignoring a suffix like `.sc` or `.cap`. */
  entryForName(glyphName) {
    return this.entryForExactName(glyphName) || this.entryForExactName(splitGlyphName(glyphName).base) || null;
  }

  entryForCodePoint(codePoint) {
    return this.byCodePoint.get(codePoint) || null;
  }

  glyphNameForCodePoint(codePoint) {
    return this.byCodePoint.get(codePoint)?.name ?? null;
  }

  codePointForGlyphName(glyphName) {
    const entry = this.entryForExactName(glyphName);
    if (entry) {
      return entry.codePoint;
    }
    return NAME_ALIASES[glyphName] ?? codePointOfUniName(glyphName);
  }

  isMark(glyphName) {
    return this.entryForName(glyphName)?.category === "Mark";
  }

  isCombiningMark(glyphName) {
    const entry = this.entryForName(glyphName);
    return entry?.category === "Mark" && entry?.subCategory === "Nonspacing";
  }

  /** "upper" | "lower" | "smallcaps" | null, from the Unicode case. */
  caseOfName(glyphName) {
    const letterCase = this.entryForName(glyphName)?.case;
    switch (letterCase) {
      case "upper":
        return "upper";
      case "lower":
        return "lower";
      case "smallCaps":
        return "smallcaps";
      default:
        return null;
    }
  }

  /**
   * The spacing twin of a combining mark, by the Glyphs naming convention
   * (`acutecomb` -> `acute`). Only a name: whether the font has it is the
   * caller's business.
   */
  spacingTwin(glyphName) {
    const { base, extension } = splitGlyphName(glyphName);
    return base.endsWith("comb") && base.length > 4
      ? base.slice(0, -4) + extension
      : null;
  }

  /** The combining twin of a spacing mark (`acute` -> `acutecomb`). */
  combiningTwin(glyphName) {
    const { base, extension } = splitGlyphName(glyphName);
    if (base.endsWith("comb")) {
      return null;
    }
    const combining = base + "comb";
    return this.byName.has(combining) ? combining + extension : null;
  }

  /**
   * Where a mark attaches when the font gives no clue: `bottom` for the marks
   * Unicode describes as BELOW, `ogonek` for the ogonek, `top` otherwise.
   * The font's own `_anchors` always win over this (see suggest.js).
   */
  defaultAnchorForMark(glyphName) {
    const entry = this.entryForName(glyphName);
    const description = entry?.description || "";
    if (/\bOGONEK\b/.test(description)) {
      return "ogonek";
    }
    // "COMBINING CEDILLA" is the one attached-below mark Unicode does not
    // describe as BELOW
    if (/\bBELOW\b/.test(description) || /\bCEDILLA\b/.test(description)) {
      return "bottom";
    }
    return "top";
  }
}

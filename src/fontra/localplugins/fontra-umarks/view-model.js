// What the panel shows, worked out without touching the DOM: the label of a
// rule, the choices the menus of a rule offer — and, further down, everything
// the anchor tools of ③ and ④ decide. Pure, so the panel's logic is tested in
// Node and the DOM code stays dumb (tests/test_view_model.mjs). Where the
// target stands, step by step, is target.js's.
// See docs/brief.md § 4.2, § 4.4 and § 4.6.

import { anchorStem } from "./anchors.js";
import { splitGlyphName } from "./glyph-data.js";
import { ANCHOR_X_VALUES, ANCHOR_Y_VALUES, CATEGORIES } from "./rules.js";

/** `e + acutecomb@top`, with the stacking and the ligature parts spelled out. */
export function ruleSummary(rule) {
  const parts = [rule.base];
  for (const appended of rule.append || []) {
    parts.push(appended);
  }
  for (const mark of rule.marks || []) {
    parts.push(`${mark.glyph}@${mark.on ? mark.on : mark.anchor}`);
  }
  return parts.join(" + ");
}

/** The category a rule belongs to for the filter; lowercase is the default. */
export function categoryOf(rule) {
  return rule.category || "lower";
}

/**
 * The anchors the anchor menu may offer for one mark: those of the base that
 * the mark can actually reach, plus the one the rule already names even when
 * the font cannot honour it — hiding it would silently rewrite the rule.
 */
export function anchorChoices(baseGlyph, markGlyph, currentAnchor) {
  const choices = new Set();
  const markAnchors = new Set(
    (markGlyph?.anchors || [])
      .filter((anchor) => anchor.name.startsWith("_"))
      .map((anchor) => splitGlyphName(anchor.name.slice(1)).base)
  );
  for (const anchor of baseGlyph?.anchors || []) {
    if (anchor.name.startsWith("_")) {
      continue;
    }
    const stem = splitGlyphName(anchor.name).base;
    if (markAnchors.has(stem)) {
      choices.add(stem);
    }
  }
  if (currentAnchor) {
    choices.add(currentAnchor);
  }
  return [...choices].sort();
}

/**
 * The drawings of one accent the font has: the plain one and its variants
 * (`acute`, `acute.cap`, `acute.sc`), so the designer can switch (§ 4.6).
 */
export function variantChoices(markGlyphName, glyphMap) {
  const { base } = splitGlyphName(markGlyphName);
  const choices = Object.keys(glyphMap || {}).filter(
    (name) => name === base || name.startsWith(`${base}.`)
  );
  if (!choices.includes(markGlyphName)) {
    choices.push(markGlyphName);
  }
  return choices.sort();
}

/**
 * The variant this category asks for but the font does not have, if any:
 * the « uses `acute`, no `acute.cap` » of § 4.6.
 */
export function missingVariantNote(rule, settings, glyphMap) {
  const suffix = settings?.markVariants?.[categoryOf(rule)];
  if (!suffix) {
    return null;
  }
  for (const mark of rule.marks || []) {
    const { base, extension } = splitGlyphName(mark.glyph);
    if (extension) {
      continue;
    }
    if (!(base + suffix in (glyphMap || {}))) {
      return `uses ${mark.glyph}, no ${base + suffix}`;
    }
  }
  return null;
}

export function plural(count, word, words = `${word}s`) {
  return `${count} ${count === 1 ? word : words}`;
}

// ---------------------------------------------------------------------------
// The anchor tools (brief § 4.2, § 4.6, § 9; step 4 ter, placed in ③ and ④
// by step 4 quater): what they decide, without the DOM.

/** The words a position reads in, and the menus that pick one. */
export const X_CHOICES = [
  { value: "bounds-center", label: "center" },
  { value: "bounds-left", label: "left" },
  { value: "bounds-right", label: "right" },
  { value: "advance-center", label: "advance center" },
  { value: "reference", label: "as on a glyph" },
];
export const Y_CHOICES = [
  { value: "baseline", label: "baseline" },
  { value: "x-height", label: "x-height" },
  { value: "cap-height", label: "cap height" },
  { value: "case-height", label: "x-height, caps: cap height" },
  { value: "ascender", label: "ascender" },
  { value: "descender", label: "descender" },
  { value: "bounds-top", label: "top" },
  { value: "bounds-bottom", label: "bottom" },
  { value: "reference", label: "as on a glyph" },
];
export const CASE_CHOICES = [
  { value: "", label: "any case" },
  { value: "upper", label: "capitals" },
  { value: "lower", label: "lowercase" },
  { value: "smallcaps", label: "small caps" },
];

function choiceLabel(choices, value) {
  if (typeof value === "string" && value.startsWith("reference:")) {
    return `as on ${value.slice("reference:".length)}`;
  }
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

function offset(words, delta) {
  return delta ? `${words} ${delta > 0 ? "+" : "−"} ${Math.abs(delta)}` : words;
}

/** The menu value a spec shows as (`reference:o` is the `reference` entry). */
export function choiceValue(spec) {
  return typeof spec === "string" && spec.startsWith("reference:") ? "reference" : spec;
}

/**
 * A preset as it reads in its row: `center · x-height + 10 · caps: cap height + 10`.
 * The case is said only when it is not « any ».
 */
export function describePreset(preset) {
  const parts = [offset(choiceLabel(X_CHOICES, preset.x), preset.dx)];
  if (preset.y === "case-height") {
    parts.push(offset("x-height", preset.dy), `caps: ${offset("cap height", preset.dy)}`);
  } else {
    parts.push(offset(choiceLabel(Y_CHOICES, preset.y), preset.dy));
  }
  if (preset.case) {
    parts.push(`${choiceLabel(CASE_CHOICES, preset.case)} only`);
  }
  return parts.join(" · ");
}

/** The operations of the Adjust section, one at a time, in the menu's order. */
export const OPERATIONS = [
  { value: "check", label: "Check" },
  { value: "move", label: "Move" },
  { value: "align", label: "Align" },
  { value: "copy", label: "Copy from" },
  { value: "mirror", label: "Mirror" },
  { value: "derive", label: "Derive variants" },
];

function namesText(names) {
  return names.length > 5 ? `${names.slice(0, 4).join(", ")} +${names.length - 4}` : names.join(", ");
}

function reach(entries) {
  return {
    glyphs: new Set(entries.map((entry) => entry.glyph)).size,
    sources: new Set(entries.map((entry) => entry.source)).size,
  };
}

/**
 * The sentence above « Place anchors », which says what the button will do on
 * the scope: {text, ready}. `ready` is false when there is nothing to place.
 * `plan`, `kept` and `skipped` are what anchors.js's planAnchors returned and
 * collected; `presetNames` the ticked presets.
 */
export function placeSentence({ presetNames = [], plan = [], kept = [], skipped = [], glyphCount = null }) {
  if (glyphCount === 0) {
    return { text: "No glyph to work on: no drawn glyph of the glyph set lacks these anchors.", ready: false };
  }
  if (!presetNames.length) {
    return { text: "Tick the anchors to place.", ready: false };
  }
  const names = namesText(presetNames);
  if (!plan.length) {
    if (kept.length) {
      const { glyphs } = reach(kept);
      return {
        text: `Nothing to place: the ${plural(kept.length, "anchor")} (${names}) are already there in ${plural(glyphs, "glyph")}.`,
        ready: false,
      };
    }
    return {
      text: skipped.length
        ? `Nothing to place: ${plural(skipped.length, "anchor")} (${names}) cannot be worked out (no outline, or no reference).`
        : `Nothing to place: no glyph of this scope takes ${names}.`,
      ready: false,
    };
  }
  const { glyphs, sources } = reach(plan);
  let text = `Place ${plural(plan.length, "anchor")} (${names}) in ${plural(glyphs, "glyph")}, ${plural(sources, "source")}`;
  if (kept.length) {
    text += ` — ${kept.length} already there, kept`;
  }
  if (skipped.length) {
    text += ` — ${skipped.length} cannot be worked out`;
  }
  return { text: `${text}.`, ready: true };
}

/**
 * The preview sentence of an Adjust operation: exactly what Apply will write.
 * `label` names the operation and its values (`Move top by 0, 20`).
 */
export function previewSentence(label, plan) {
  if (!plan.length) {
    return `${label} — nothing to do.`;
  }
  const { glyphs, sources } = reach(plan);
  const added = plan.filter((entry) => !entry.existing).length;
  const moved = plan.length - added;
  let detail = "";
  if (added && moved) {
    detail = ` (${added} new, ${moved} moved)`;
  } else if (added) {
    detail = ", all new";
  }
  return `${label} — ${plural(plan.length, "anchor")} in ${plural(glyphs, "glyph")}, ${plural(sources, "source")}${detail}.`;
}

/** `Move top by 0, 20`. */
export function moveLabel({ name, dx, dy }) {
  return `Move ${name} by ${dx || 0}, ${dy || 0}`;
}

/** `Align top: y on x-height + 10`. */
export function alignLabel({ name, x, y, dx, dy }) {
  const parts = [];
  if (x) {
    parts.push(`x on ${x === "base-anchor" ? "the base's anchor" : offset(choiceLabel(X_CHOICES, x), dx)}`);
  }
  if (y) {
    parts.push(`y on ${offset(choiceLabel(Y_CHOICES, y), dy)}`);
  }
  return `Align ${name}: ${parts.join(", ")}`;
}

/** `Copy anchors from o (only top), overwriting`. */
export function copyLabel({ mode, glyph, fromName, toName, names = [], replace = false }) {
  let text =
    mode === "source" ? `Copy anchors from ${fromName} to ${toName}` : `Copy anchors from ${glyph}`;
  if (names.length) {
    text += ` (only ${names.join(", ")})`;
  }
  return replace ? `${text}, overwriting` : text;
}

/** `Mirror top by -12° in all sources`. */
export function mirrorLabel({ name, angle, sourceName }) {
  const by = angle === null || angle === undefined ? "by the source's italic angle" : `by ${angle}°`;
  return `Mirror ${name} ${by} in ${sourceName}`;
}

/** The sentence of Derive variants: {text, ready}. */
export function deriveSentence({ suffix, scale = 1, dy = 0, plans = [], marks = 0, existing = 0, problems = [] }) {
  const how = [scale !== 1 ? `${Math.round(scale * 100)} %` : null, dy ? `dy ${dy}` : null]
    .filter((part) => part)
    .join(", ");
  const label = `Derive ${suffix} variants${how ? ` (${how})` : ""}`;
  if (!marks) {
    return { text: `${label} — no accent in this scope.`, ready: false };
  }
  const notes = [
    existing ? `${existing} already in the font` : null,
    problems.length ? `${problems.length} left out (${problems.join(", ")})` : null,
  ].filter((part) => part);
  const tail = notes.length ? ` — ${notes.join(", ")}` : "";
  if (!plans.length) {
    return { text: `${label} — nothing to create${tail}.`, ready: false };
  }
  return {
    text: `${label} — ${plural(plans.length, "glyph")} to create: ${plans.map((plan) => plan.glyph).join(", ")}${tail}.`,
    ready: true,
  };
}

/** The sentence of Check, which writes nothing. */
export function checkSentence({ presetNames, glyphs, sources }) {
  if (!presetNames.length) {
    return { text: "Check: tick the anchors to check, above.", ready: false };
  }
  if (!glyphs) {
    return { text: "Check: no glyph in this scope.", ready: false };
  }
  return {
    text: `Check ${namesText(presetNames)} in ${plural(glyphs, "glyph")}, ${plural(sources, "source")} against their positions — writes nothing.`,
    ready: true,
  };
}

/**
 * Which presets « Place anchors » ticks to begin with: those whose anchor the
 * glyph set's rules use (`top`, `_top`), or all of them when the set has no rule
 * yet. A variant of an anchor (`top.cap`) is the designer's to ask for.
 */
export function defaultPlaceSelection(presets, ruleEntries) {
  const used = new Set();
  for (const [, rule] of ruleEntries) {
    for (const mark of rule.marks || []) {
      used.add(anchorStem(mark.anchor || "top"));
    }
  }
  const checked = new Set();
  for (const name of Object.keys(presets)) {
    const isVariant = name.replace(/^_/, "").includes(".");
    if (isVariant) {
      continue;
    }
    if (!used.size || used.has(anchorStem(name))) {
      checked.add(name);
    }
  }
  return checked;
}

/** The presets that are ticked, in the document's order. */
export function selectedPresets(presets, checked) {
  return Object.fromEntries(Object.entries(presets).filter(([name]) => checked.has(name)));
}

export const PRESET_FIELDS = ["x", "y", "dx", "dy", "case"];

/**
 * A text typed in one field of a preset row, checked: {ok, value} where `value`
 * is what goes into the preset (undefined: remove the key), or {ok: false, message}.
 */
export function parsePresetField(field, text) {
  const trimmed = String(text ?? "").trim();
  switch (field) {
    case "x":
    case "y": {
      const allowed = field === "x" ? ANCHOR_X_VALUES : ANCHOR_Y_VALUES;
      if (allowed.includes(trimmed)) {
        return { ok: true, value: trimmed };
      }
      if (trimmed.startsWith("reference:") && trimmed.length > "reference:".length) {
        return { ok: true, value: trimmed };
      }
      return {
        ok: false,
        message: `${field} is one of ${allowed.join(", ")}, or reference:<glyph>`,
      };
    }
    case "dx":
    case "dy": {
      if (!trimmed) {
        return { ok: true, value: undefined };
      }
      const number = Number(trimmed);
      return Number.isFinite(number)
        ? { ok: true, value: number || undefined }
        : { ok: false, message: `${field} is a number of units` };
    }
    case "case":
      if (!trimmed) {
        return { ok: true, value: undefined };
      }
      return CATEGORIES.includes(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, message: `case is one of ${CATEGORIES.join(", ")}, or empty` };
    default:
      return { ok: false, message: `no field ${field}` };
  }
}

/** A copy of the presets with one field of one preset changed (undefined removes it). */
export function withPresetField(presets, name, field, value) {
  const next = structuredClone(presets);
  if (!next[name]) {
    return next;
  }
  if (value === undefined) {
    delete next[name][field];
  } else {
    next[name][field] = value;
  }
  return next;
}

/** A new preset: a name starting with `_` is for marks, any other for bases. */
export function newPreset(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return { ok: false, message: "an anchor name has no spaces" };
  }
  return {
    ok: true,
    name: trimmed,
    preset: {
      on: trimmed.startsWith("_") ? "marks" : "bases",
      x: "bounds-center",
      y: "baseline",
    },
  };
}

/** The lines of a Check report, the first `limit` of them. */
export function checkReportLines(report, sourceNames = {}, { limit = 12 } = {}) {
  const where = (entry) => `${entry.glyph} (${sourceNames[entry.source] || entry.source})`;
  const lines = [
    ...report.missing.map((entry) => `${where(entry)}: ${entry.name} is missing`),
    ...report.suspicious.map(
      (entry) => `${where(entry)}: ${entry.name} is ${entry.distance} u from its position`
    ),
  ];
  const head = lines.length
    ? `Check: ${report.missing.length} missing, ${report.suspicious.length} out of place.`
    : "Check: nothing to report.";
  const shown = lines.slice(0, limit);
  if (lines.length > limit) {
    shown.push(`… and ${lines.length - limit} more`);
  }
  return [head, ...shown];
}

/** The categories Derive variants offers, with the suffix each asks for. */
export function variantCategories(settings) {
  return Object.entries(settings?.markVariants || {}).map(([category, suffix]) => ({
    category,
    suffix,
  }));
}

/**
 * ②'s line in the foot: « Added 15 glyphs (a, b, …). » — what the designer did,
 * where `batchResultText` says what a batch wrote.
 */
export function addedText(result) {
  const created = result.created || [];
  const parts = [`Added ${plural(created.length, "glyph")}${created.length ? ` (${created.join(", ")})` : ""}`];
  if (result.skipped?.length) {
    parts.push(`${result.skipped.length} already there`);
  }
  return `${parts.join("; ")}.`;
}

/** One line for what a finished batch did. */
export function batchResultText(label, result) {
  const parts = [];
  if (result.created) {
    parts.push(
      `${result.created.length} glyphs created${
        result.created.length ? ` (${result.created.join(", ")})` : ""
      }`
    );
    if (result.skipped?.length) {
      parts.push(`${result.skipped.length} already there`);
    }
  } else {
    parts.push(`${result.anchors} anchors written on ${result.glyphs} glyphs`);
  }
  if (result.untouched?.length) {
    parts.push(`${result.untouched.length} glyphs Fontra would not edit (${result.untouched.join(", ")})`);
  }
  if (result.noLayer?.length) {
    parts.push(`${result.noLayer.length} with no layer in some source`);
  }
  if (result.changedSince?.length) {
    parts.push(`${result.changedSince.length} moved since the plan was made, left alone`);
  }
  return `${label}: ${parts.join("; ")}.`;
}

export function undoResultText(result) {
  if (!result.ok) {
    return "Nothing to undo.";
  }
  const parts = [];
  if (result.restored || !(result.restoredGlyphs?.length || result.removedGlyphs?.length || result.removedRules?.length)) {
    parts.push(`${result.restored} anchors put back`);
  }
  if (result.removedRules?.length) {
    const names = result.removedRules;
    const shown = names.length > 6 ? `${names.slice(0, 5).join(", ")} +${names.length - 5}` : names.join(", ");
    parts.push(`${names.length} rule${names.length === 1 ? "" : "s"} taken out (${shown})`);
  }
  if (result.restoredGlyphs?.length) {
    parts.push(
      `${result.restoredGlyphs.length} glyphs put back as they were (${result.restoredGlyphs.join(", ")})`
    );
  }
  if (result.removedGlyphs?.length) {
    parts.push(`${result.removedGlyphs.length} glyphs deleted (${result.removedGlyphs.join(", ")})`);
  }
  if (result.leftAlone?.length) {
    parts.push(`left alone, changed since: ${result.leftAlone.join(", ")}`);
  }
  return `Undo ${result.label}: ${parts.join("; ")}.`;
}

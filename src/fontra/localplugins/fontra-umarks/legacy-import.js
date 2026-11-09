// Read the JSON files of `MakeAccents.py` (RoboFont, Python 2), so the rule
// sets built over the years are not retyped. Pure (tests/test_legacy_import.mjs).
// See docs/brief.md § 3 and § 4.8.
//
// What those files look like:
//
//   { "Latin basic": [ { "eacute": { "bases": ["e"],
//                                    "accents": ["acute"],
//                                    "shift": 0 } },
//                      { "ffl":    { "bases": ["f", "f", "l"],
//                                    "accents": [] } } ] }
//
// What becomes of it:
//   - the first base is the base, the others are `append` (the ligature case);
//   - each accent becomes a mark, and its anchor is read from the font rather
//     than guessed from a list of names: `ogonek` carries `_ogonek`,
//     `commaaccent` carries `_bottom`, and that settles it;
//   - `shift` is dropped. It was there to raise an accent over a capital; the
//     anchors do that now, and § 4.6 does the rest. Each one dropped is
//     reported, so nothing disappears quietly;
//   - the groups come back on the side: a rule belongs to a glyph, and a glyph
//     belongs to its glyph sets (§ 5), so they are the caller's business;
//   - every imported rule is marked `manual`: the designer made it by hand
//     once, Suggest must not undo that.

import { markAnchorName } from "./suggest.js";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The {glyphName: definition} pairs of one group, however it was nested. */
function entriesOfGroup(group) {
  const entries = [];
  const collect = (item) => {
    if (!isObject(item)) {
      return;
    }
    for (const [glyphName, definition] of Object.entries(item)) {
      entries.push([glyphName, definition]);
    }
  };
  if (Array.isArray(group)) {
    group.forEach(collect);
  } else {
    collect(group);
  }
  return entries;
}

/**
 * Returns {rules, groups, notes, skipped}:
 *   rules    {glyphName: rule}, ready for withSuggestions / withRule
 *   groups   {groupName: [glyphName]}, for whoever wants to make glyph sets
 *   notes    what was dropped on the way (a `shift`, a duplicate)
 *   skipped  {glyph, reason} for what could not be read
 */
export function importLegacyRules(raw, { font, glyphData }) {
  const rules = {};
  const groups = {};
  const notes = [];
  const skipped = [];

  if (!isObject(raw)) {
    return { rules, groups, notes, skipped: [{ glyph: null, reason: "not-an-object" }] };
  }

  for (const [groupName, group] of Object.entries(raw)) {
    const glyphNames = [];

    for (const [glyphName, definition] of entriesOfGroup(group)) {
      if (!isObject(definition)) {
        skipped.push({ glyph: glyphName, reason: "unreadable" });
        continue;
      }

      const bases = (definition.bases || []).filter(
        (name) => typeof name === "string" && name
      );
      if (!bases.length) {
        skipped.push({ glyph: glyphName, reason: "no-base" });
        continue;
      }

      const accents = (definition.accents || []).filter(
        (name) => typeof name === "string" && name
      );

      const marks = [];
      const anchorsUsed = new Map();
      for (const accent of accents) {
        const anchor = markAnchorName(accent, font, glyphData);
        const mark = { glyph: accent, anchor };
        const previous = anchorsUsed.get(anchor);
        if (previous) {
          mark.on = previous;
        }
        anchorsUsed.set(anchor, accent);
        marks.push(mark);
      }

      if (!marks.length && bases.length < 2) {
        skipped.push({ glyph: glyphName, reason: "nothing-to-compose" });
        continue;
      }

      const rule = { base: bases[0], marks, source: "manual" };
      if (bases.length > 1) {
        rule.append = bases.slice(1);
      }

      if (definition.shift) {
        notes.push({
          glyph: glyphName,
          note: `shift ${definition.shift} dropped: the anchors carry that now`,
        });
      }
      if (rules[glyphName]) {
        notes.push({ glyph: glyphName, note: `defined twice, the last one wins` });
      }

      rules[glyphName] = rule;
      glyphNames.push(glyphName);
    }

    if (glyphNames.length) {
      groups[groupName] = glyphNames;
    }
  }

  return { rules, groups, notes, skipped };
}

export function importLegacyRulesJSON(text, context) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      rules: {},
      groups: {},
      notes: [],
      skipped: [{ glyph: null, reason: `not valid JSON: ${error.message}` }],
    };
  }
  return importLegacyRules(raw, context);
}

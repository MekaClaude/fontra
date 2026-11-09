// The report of a batch (step 5): one line in the foot of the panel
// (« Last: Make 38: 36 created, 2 rewritten ▸ »), and, unfolded, the glyphs
// themselves — created, rewritten, updated, left alone and why, can't be built
// yet and why. Pure (tests/test_report.mjs); marks-panel.js draws it, and a
// double-click on a glyph opens it.

import { problemLines, withoutText } from "./target.js";

// in the order the details list them
const KINDS = [
  { kind: "created", title: "Created", says: "created" },
  { kind: "rewritten", title: "Rewritten", says: "rewritten" },
  { kind: "recomputed", title: "Updated", says: "updated" },
  { kind: "unchanged", title: "Already in place", says: "already in place" },
  { kind: "left", title: "Left alone", says: "left alone" },
  { kind: "impossible", title: "Can't be built yet", says: "can't be built yet" },
];

/**
 * What one glyph of a Make or an Update came to, from what make.js answered:
 * {glyph, kind, why}.
 */
export function outcomeOf(glyph, result) {
  if (!result) {
    return { glyph, kind: "impossible", why: "no rule" };
  }
  if (result.left) {
    return { glyph, kind: "left", why: result.left };
  }
  if (result.ok) {
    // the sources left out, named (5 bis § 5)
    const without = withoutText(
      (result.warnings || [])
        .filter((warning) => warning.code === "source-skipped")
        .map((warning) => ({ source: warning.source, glyphs: warning.glyphs }))
    );
    if (result.created) {
      return { glyph, kind: "created", why: without };
    }
    if ("moved" in result) {
      return result.moved
        ? { glyph, kind: "recomputed", why: "" }
        : { glyph, kind: "unchanged", why: "" };
    }
    return {
      glyph,
      kind: "rewritten",
      why: [result.overwritten ? "its drawing replaced" : "", without].filter((text) => text).join("; "),
    };
  }
  if (result.needsOverwrite) {
    return { glyph, kind: "left", why: "drawn by hand" };
  }
  if (result.mismatches?.length) {
    return { glyph, kind: "impossible", why: "its components are not the rule's: Make it" };
  }
  // condensed: one line per cause, its sources grouped (5 bis § 7)
  const why = problemLines(result.problems || [], result.sourceCount).join("; ");
  return { glyph, kind: "impossible", why: why || "no rule" };
}

/**
 * {summary, groups: [{title, rows: [{glyph, detail}]}]} of a batch labelled
 * `label` (« Make 38 », « Update 3 »).
 */
export function batchReport(label, outcomes) {
  const groups = [];
  const counts = [];
  for (const { kind, title, says } of KINDS) {
    const rows = outcomes
      .filter((outcome) => outcome.kind === kind)
      .map((outcome) => ({ glyph: outcome.glyph, detail: outcome.why || "" }));
    if (!rows.length) {
      continue;
    }
    groups.push({ title, kind, rows });
    counts.push(`${rows.length} ${says}`);
  }
  const written = outcomes.some((outcome) => ["created", "rewritten", "recomputed"].includes(outcome.kind));
  // an Update that only updated reads as what the designer did: « Updated 8 glyphs. »
  const updated = outcomes.length > 0 && outcomes.every((outcome) => outcome.kind === "recomputed");
  const undo = written ? " Undo last batch takes it back." : "";
  const summary = updated
    ? `Updated ${outcomes.length} ${outcomes.length === 1 ? "glyph" : "glyphs"}.${undo}`
    : counts.length
      ? `${label}: ${counts.join(", ")}.${undo}`
      : `${label}: nothing to do.`;
  return { summary, groups };
}

/** Past this many glyphs, a group of the report says each detail once (6d § 1). */
export const CONDENSE_FROM = 7;

/**
 * The rows of a group of the report, by detail (6d § 1): [{detail, glyphs}],
 * in the order the details first come — « 31 glyphs: agrave, aacute, … »
 * under a detail they share rather than the same detail 31 times.
 */
export function condensedRows(rows = []) {
  const byDetail = new Map();
  for (const row of rows) {
    const detail = row.detail || "";
    if (!byDetail.has(detail)) {
      byDetail.set(detail, []);
    }
    byDetail.get(detail).push(row.glyph);
  }
  return [...byDetail].map(([detail, glyphs]) => ({ detail, glyphs }));
}

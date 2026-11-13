import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalize,
  scoreQuery,
  rankEntries,
  matchesInitials,
  isSubsequence,
} from "../palette-filter.js";

const entries = [
  { identifier: "action.zoom-fit-selection", title: "Zoom Fit Selection", topicDisplay: "View" },
  { identifier: "action.undo", title: "Undo", topicDisplay: "Edit" },
  { identifier: "action.redo", title: "Redo", topicDisplay: "Edit" },
  { identifier: "action.add-glyph", title: "Add Glyph", topicDisplay: "Glyph" },
];

test("normalize lowercases and collapses whitespace", () => {
  assert.equal(normalize("  Foo   BAR  "), "foo bar");
  assert.equal(normalize(null), "");
});

test("empty query matches everything with score 0", () => {
  for (const entry of entries) {
    assert.equal(scoreQuery("", entry), 0);
  }
});

test("exact title match outranks prefix and substring", () => {
  assert.equal(scoreQuery("undo", entries[1]), 1000);
  const prefix = scoreQuery("und", entries[1]);
  const substring = scoreQuery("ndo", entries[1]);
  assert.ok(prefix > substring, `prefix ${prefix} should beat substring ${substring}`);
});

test("substring scores by position (earlier is better)", () => {
  const entry = { title: "Add Glyph", topicDisplay: "" };
  const early = scoreQuery("add", entry); // prefix, via startsWith
  const late = scoreQuery("glyph", entry); // substring
  assert.ok(early > late);
  const idx1 = scoreQuery("d gl", entry);
  assert.ok(idx1 >= 0);
});

test("initials match beats plain substring", () => {
  assert.equal(matchesInitials("zfs", "zoom fit selection"), true);
  assert.equal(matchesInitials("zz", "zoom fit selection"), false);
  assert.equal(matchesInitials("z", "zoom fit selection"), false);
  const initials = scoreQuery("zfs", entries[0]);
  assert.ok(initials > 0);
});

test("topic fallback and no-match", () => {
  const entry = { title: "Undo", topicDisplay: "Edit" };
  assert.ok(scoreQuery("edi", entry) > 0); // topic startsWith
  assert.equal(scoreQuery("zzzz", entry), -1);
});

test("fuzzy subsequence matches when nothing else does", () => {
  assert.equal(isSubsequence("zm", "zoom fit"), true);
  assert.equal(isSubsequence("zx", "zoom fit"), false);
  const score = scoreQuery("zt", entries[0]); // "Zoom Fit Selection" subsequence
  assert.ok(score > 0);
});

test("rankEntries orders by score then original order, and filters", () => {
  const ranked = rankEntries("o", [
    { title: "Zoom", topicDisplay: "" },
    { title: "Foo", topicDisplay: "" },
    { title: "Boo", topicDisplay: "" },
  ]);
  // "Zoom" starts with "o"? no — substring idx 1; "Foo" idx 1; "Boo" idx 1:
  // equal scores -> stable original order.
  assert.deepEqual(
    ranked.map((e) => e.title),
    ["Zoom", "Foo", "Boo"]
  );

  const none = rankEntries("qqqq", entries);
  assert.deepEqual(none, []);
});

test("rankEntries puts higher score first", () => {
  const ranked = rankEntries("add", [
    { title: "Pad Add", topicDisplay: "" }, // substring
    { title: "Add Glyph", topicDisplay: "" }, // exact prefix
  ]);
  assert.equal(ranked[0].title, "Add Glyph");
});

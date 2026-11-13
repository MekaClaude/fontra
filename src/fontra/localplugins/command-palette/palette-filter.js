// Pure filtering/scoring logic for the Command Palette. No DOM, no imports:
// this module is unit-tested directly by tests/palette-filter.test.mjs.

/**
 * Normalize a string for matching: lowercase and collapse whitespace.
 */
export function normalize(text) {
  return (text || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Score a single entry against the query. Returns a score >= 0 for a match
 * (higher is better) or -1 for no match. An empty query matches everything
 * with score 0.
 */
export function scoreQuery(query, entry) {
  const q = normalize(query);
  if (!q) {
    return 0;
  }
  const title = normalize(entry.title);
  const topic = normalize(entry.topicDisplay);

  if (title === q) {
    return 1000;
  }
  if (title.startsWith(q)) {
    return 900 - Math.min(title.length, 100);
  }
  const index = title.indexOf(q);
  if (index >= 0) {
    return 700 - index;
  }
  if (matchesInitials(q, title)) {
    return 500;
  }
  if (title && topic && `${title} ${topic}`.includes(q)) {
    return 400;
  }
  if (topic && topic.startsWith(q)) {
    return 350;
  }
  if (isSubsequence(q, title)) {
    return 200;
  }
  return -1;
}

/**
 * Rank entries against the query. Matching entries are returned sorted by
 * descending score, ties broken by original order (stable). Non-matching
 * entries are omitted.
 */
export function rankEntries(query, entries) {
  const scored = [];
  for (let index = 0; index < entries.length; index++) {
    const score = scoreQuery(query, entries[index]);
    if (score >= 0) {
      scored.push({ entry: entries[index], score, index });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((item) => item.entry);
}

/**
 * True if every word-initial of the title lines up with the query characters,
 * in order. "gf" matches "Glyph Fit", "zfs" matches "Zoom Fit Selection".
 */
export function matchesInitials(query, title) {
  if (!title) {
    return false;
  }
  const words = title.split(" ").filter((word) => word.length > 0);
  if (words.length < 2 || query.length < 2 || query.length > words.length) {
    return false;
  }
  let wordIndex = 0;
  for (const char of query) {
    if (char === " ") {
      continue;
    }
    while (wordIndex < words.length && !words[wordIndex].startsWith(char)) {
      wordIndex++;
    }
    if (wordIndex >= words.length) {
      return false;
    }
    // Consume this word: the next query char must match a later word.
    wordIndex++;
  }
  return true;
}

/**
 * True if the query characters appear in the text in order (fuzzy
 * subsequence match).
 */
export function isSubsequence(query, text) {
  if (!text) {
    return false;
  }
  let position = 0;
  for (const char of query) {
    position = text.indexOf(char, position);
    if (position < 0) {
      return false;
    }
    position++;
  }
  return true;
}

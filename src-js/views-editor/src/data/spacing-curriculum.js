export const SPACING_CURRICULUM = [
  {
    id: "references",
    label: "1. References — n, o, H, O",
    glyphs: ["n", "o", "H", "O"],
    tip: `The <b>n</b> and <b>o</b> are the anchors of lowercase spacing.
          LSB(n) = RSB(n) = counter(n) × 0.25
          LSB(o) = RSB(o) = counter(H) × 0.20
          All of typography derives from these four glyphs.`,
    proofString: "nnnHnnn · noHonHo · nono",
  },
  {
    id: "straight_lc",
    label: "2. Straight stems — l i u m h",
    glyphs: ["l", "i", "u", "m", "h"],
    tip: `These letters share the same stem structure as <b>n</b>.
          Starting point: their sidebearings ≈ sidebearings of n.
          Adjust by eye with the proof string.`,
    proofString: "nnnlnnninnnunnunhnmnrnnn",
  },
  {
    id: "round_lc",
    label: "3. Rounds — c e d b p q",
    glyphs: ["c", "e", "d", "b", "p", "q"],
    tip: `Mirror principle:
          d = LSB(o) + RSB(n) — curved side + stem side
          b = LSB(n) + RSB(o) — mirror of d
          p, q follow the same logic in descending.
          Link sidebearings via the linking system.`,
    proofString: "nonononb · nonond · nonop · nononq · nonoc · nonone",
  },
  {
    id: "diagonal_lc",
    label: "4. Diagonals — v w y x k z",
    glyphs: ["v", "w", "y", "x", "k", "z"],
    tip: `Diagonals are the hardest to space.
          The acute angle creates an optical illusion of extra space.
          Tighten more than intuition suggests.
          Use the "three at a time" technique systematically.`,
    proofString: "nvnwn · nynxnknzn",
  },
  {
    id: "exception_lc",
    label: "5. Exceptions — a g s f r t j",
    glyphs: ["a", "g", "s", "f", "r", "t", "j"],
    tip: `Each letter is unique — don't link, space by hand.
          s: often 1–2 units tighter than o on each side.
          f, t: RSB tighter due to arm/head.
          a, g: complex shapes — trust your eye only.`,
    proofString: "nfn · ntn · njn · nan · ngn · nsn",
  },
  {
    id: "uppercase",
    label: "6. Capitals — same approach",
    glyphs: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    tip: `Same method as lowercase.
          H and O are the capital anchors.
          Capital counters are wider →
          sidebearings generally more generous than lowercase.`,
    proofString: "HHHOHHH · HOHOH · HHHAHHH",
  },
  {
    id: "numerals",
    label: "7. Numerals",
    glyphs: "0123456789".split(""),
    tip: `Tabular figures: advance width identical for all.
          Proportional figures: variable advance.
          Test: H0H1H2H3 · n0n1n2n3`,
    proofString: "0123456789 · H0H1H2H3 · n0n1n2n3",
  },
  {
    id: "kerning",
    label: "8. Kerning — only now",
    glyphs: [],
    tip: `Good spacing drastically reduces the number of kerning pairs needed.
          If spacing is correct, only truly problematic combinations
          (AV, Av, VA, Ta, To…) need kerning.
          Don't kern what spacing can fix.`,
    proofString: "Hagndo sphinx of black quartz judge my vow",
  },
];

export const GLYPH_HINTS = {
  n: "Lowercase anchor (straight stem). LSB = RSB = counter × 0.25. Everything starts here.",
  o: "Lowercase anchor (round). LSB = RSB = H counter × 0.20. Tighter than n.",
  H: "Capital anchor (straight stem). Same rule as n: 25% of counter.",
  O: "Capital anchor (round). 20% of H counter.",
  d: "LSB = LSB(o), RSB = RSB(n). Link both. Mirror of b.",
  b: "LSB = LSB(n), RSB = RSB(o). Mirror of d. p, q follow.",
  p: "LSB = LSB(n), RSB = RSB(o). b below baseline.",
  q: "LSB = LSB(o), RSB = RSB(n). d below baseline.",
  c: "LSB and RSB slightly more open than o — open shape.",
  e: "LSB ≈ LSB(o). RSB slightly more open due to eye.",
  m: "Two interior spaces. LSB = RSB = LSB(n). Advance wider.",
  h: "Stem + ascender. Sidebearings = n.",
  u: "n upside down. Sidebearings = n.",
  l: "Sidebearings = n. Simple.",
  i: "Sidebearings = l. The dot doesn't count.",
  r: "Short arm → RSB often tighter than n. Test nrn.",
  v: "Sharp top creates space illusion. Tighten both sides. Test nvn.",
  w: "Same logic as v. Interior counters smaller → even tighter.",
  y: "Treat like v for main body.",
  k: "Arm and leg create two different optical zones. RSB delicate.",
  a: "Double bowl — space by hand, don't link.",
  g: "Double bowl — the hardest. Total trust in eye.",
  s: "1–2 units tighter than o. No clear counter.",
  f: "RSB very tight (arm creates false impression of openness).",
  t: "Asymmetric crossbar. RSB (right of arm) generally tight.",
  j: "LSB open, RSB tighter.",
};

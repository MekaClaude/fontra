# Type Design School

A course in type design, in the Fontra editor's right sidebar.

Ten phases that take a beginner from *what even is a typeface* to a finished,
spaced, proofed family:

1. **Learning to See** — reading a letter as a shape, naming its parts, and
   placing it on the right lines.
2. **Finding the Idea** — one concept, a reference library, the parameters a
   typeface is built from, and the scope of the family.
3. **Sketching** — exploring the design space quickly and cheaply.
4. **Drawing the Lowercase** — n and o, the bowl letters, the arch family.
5. **Spacing** — the rhythm of white, sidebearings, kerning.
6. **Capitals, Figures and Punctuation** — building capitals from references.
7. **Proofing** — making proofs that find problems.
8. **Drawing on the Screen** — Béziers, extrema, tracing the stroke.
9. **The Family** — weights, axes, interpolation, optical sizes.
10. **Shipping** — production, quality assurance, release, and the business.

There is also a **glossary** and a **letter audit**: a short list of
relational checks for each of the twenty-six capitals.

## How it works

Every lesson has the same shape:

- **the idea** — the principles, in prose
- **do this** — the practice, as steps
- **before you move on** — the checklist that decides whether the lesson is
  finished
- **watch out for** — the mistakes the lesson is trying to prevent
- **in Fontra** — where to look in the editor

A lesson is finished when its checklist is ticked, not when it has been read.
The panel remembers where you got to, in the browser's local storage, and the
whole course can be reset from the front page.

When a lesson names a glyph, the panel shows what Fontra's own type design
knowledge base says about that glyph, with a link to the Glyph Advisor panel.

## The corpus

The teaching material is in `data/course.json`: an original body of type
design knowledge written for this plug-in. It is data, not code, so it can
grow without touching the panel.

Nothing in it is copied from any book. The books that informed it were used
the way a designer uses references — for the principles, not for the words.
Where a specific fact matters (a size range, an axis name, a price), it is
stated with its context and can be checked against the source.

## Files

| File | What it is |
|---|---|
| `plugin.json` | the manifest Fontra loads |
| `init.js` | registers the panel in the right sidebar |
| `panel.js` | the panel: views, progress, the glossary and the letter audit |
| `course.js` | the data layer: validation, walking the course, progress |
| `data/course.json` | the corpus: the phases, lessons, glossary, letter audit |
| `tests/course.test.mjs` | tests for the data layer and the corpus |

## Tests

```bash
node --test "src/fontra/localplugins/type-design-course/tests/*.test.mjs"
```

or, with the rest of the plug-ins:

```bash
npm run test:plugins
```

## Requirements

None. The plug-in is plain JavaScript loaded by Fontra at runtime, and it
imports nothing from Fontra itself: it only uses the editor object it is
given, plus the shared `el()` helper in `../_shared/dom.js`.

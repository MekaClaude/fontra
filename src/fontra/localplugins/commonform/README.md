# Commonform

A Fontra plugin for finding the **common forms** of a typeface — the shapes it
reuses from one glyph to the next.

In type design, a *common form* is a shape that appears in more than one
glyph: the bowl of **b**/**d**/**p**/**q**, the arm of **R** and **k**, the
shoulder of **n** and **m**. A typeface built from common forms is a typeface
whose parts agree with each other. One that only *looks* like it has shapes
that were re-drawn by hand and have drifted apart — by 6 units here, 11 there,
and the rhythm of the page suffers.

Commonform finds the copies of the shape you have selected, and tells you how
far the worst copy has drifted.

## Installing

The plugin folder is static content, so it has to sit where Fontra serves it:

```
<fontra-checkout>/src/fontra/localplugins/commonform/
```

If you use a **Fontra Pak** instead of a source checkout, drop the same folder
into the pak's `localplugins` directory.

**Restart the server** afterwards: the plugin folder is static content, and the
server builds its route table at start-up, so a browser reload is not enough.

Then enable it. Fontra keeps the list of enabled plugins in `localStorage`,
under the key `fontra.pluginsplugins`:

```js
(() => {
  const k = "fontra.pluginsplugins";
  const p = "/localplugins/commonform/";
  const a = JSON.parse(localStorage.getItem(k) || "[]");
  if (!a.some((x) => (x.address || "").includes("commonform"))) {
    a.push({ address: p });
    localStorage.setItem(k, JSON.stringify(a));
    location.reload();
  }
})();
```

The same one-liner is in `register-dev.js`, for pasting into the console.

The plugin then appears as a tab in the **right sidebar**, and its overlay is
switched on automatically.

## Using it

1. Open a glyph.
2. **Select a shape** — either a component, or the points of a contour. The
   shape is always the *whole contour* the selection touches: a partial arc is
   not a shape, and comparing one would be meaningless.
3. Press **Find in font**. The plugin walks every glyph in the font and
   compares every closed contour with the query.
4. The results table lists the matches, best first. Click a glyph name to
   jump to that glyph with the matching contour selected.

The glyph the shape was taken from is **not** in the list: a shape is not a
copy of itself. That is why the table and the summary always agree on the
number of copies.

The canvas overlay highlights the matches that are on screen, in a colour that
says how well they matched.

## The three tiers

| Tier | What it means |
|---|---|
| **identical** | the same drawing, node for node |
| **same** | the same shape, within the tolerance |
| **near** | close enough to be worth a look |

The **tolerance** is `max(2 units, 0.2 % of the shape's size)`: below two
units, two drawings are the same drawing; the relative part lets the slack grow
with the glyph, so the same two units are a big deal in a 300-unit text cut
and no deal at all in a 2000-unit display cut. Both halves are adjustable in
the panel.

The number that is reported is the **worst** difference between the two
outlines, in font units: *"this is the same bowl, except that one node is 11
units off"*. That is the number a type designer wants — the overall (RMS)
difference would only tell them the average.

## Orientations

A typeface reuses shapes in all four orientations, and the plugin looks for
all of them:

* **as drawn** — the bowl of b against the bowl of b
* **mirrored** — the bowl of b against the bowl of d
* **flipped** — the bowl of b against the bowl of p
* **rotated** — the bowl of b against the bowl of q

A quarter turn is deliberately *not* included: the horizontal arm of an **H**
is not the same shape as the vertical stem of an **l**, and a type designer
never means it. The result table says which way a copy had to be turned to
match.

## Settings

| Control | What it does |
|---|---|
| **Tolerance floor (units)** | the absolute part of the tolerance (2 by default) |
| **Tolerance (% of size)** | the relative part of the tolerance (0.2 % by default) |
| **Ignore size** | "the same shape, drawn bigger" counts as the same shape |
| **Allow mirrored** | look for turned and mirrored copies too |
| **Compare directions** | how many directions the shape is measured in (64 by default) |

The settings are remembered between sessions: they are stored in
`localStorage`, under the key `fontra.commonform.settings`.

## Running the tests

```
cd src/fontra/localplugins/commonform
node --test
```

No arguments, no dependencies, no `package.json`, no browser: the suite uses
Node's built-in test runner, and the engine is deliberately free of the DOM
and of Fontra imports, so it runs in plain Node.

From the root of the Fontra checkout, both plugins' suites run at once:

```
npm run test:plugins
```

### The real-font check

The test suite is self-contained — it builds its own shapes. To run the
engines over a *real* typeface instead:

```
node tests/real-font-check.mjs [path/to/font.fontra]
```

It defaults to the `MutatorSans` font in Fontra's own test suite, and it
reports which shapes the typeface reuses and how far the copies have drifted.
In MutatorSans it finds that the bowl of **P** and the bowl of **R** are the
same drawing — 0.00 units of drift — which is exactly the kind of thing this
plugin is for.

## The files

| File | What it is |
|---|---|
| `plugin.json` | the manifest the editor reads |
| `start.js` | the entry point the editor imports |
| `commonform-engine.js` | the geometry: the signature, the tolerances, the tiers |
| `commonform-font.js` | the Fontra-facing half: the selection, the walk over the font |
| `commonform-state.js` | the small store the panel and the layer share, and the settings that are remembered between sessions |
| `commonform-layer.js` | the canvas overlay |
| `commonform-panel.js` | the sidebar panel |
| `register-dev.js` | a console one-liner that enables the plugin |
| `tests/` | the unit suite, and the real-font check |

## License

MIT.

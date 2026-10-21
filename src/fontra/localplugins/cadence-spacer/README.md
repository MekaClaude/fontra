# Cadence Spacer

A Fontra plugin for **cadence** — a.k.a. *auto-spacing*.

It applies a spacing table to a font's sidebearings, measured against the stem
rhythm of a reference lowercase at a chosen beam height. The method comes from
Frank Blokland's *LS Cadencer* / *Cadenculator*: a type designer picks a
reference glyph, measures the distance between its stems, divides that into
grid steps, and then states — per glyph — how many steps each sidebearing
should be.

**It is not a spacing optimiser.** It does not search for the best spacing; it
applies the spacing you tell it to, and shows you what that would do before it
does it.

## Installing

The plugin folder is static content, so it has to sit where Fontra serves it:

```
<fontra-checkout>/src/fontra/localplugins/cadence-spacer/
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
  const p = "/localplugins/cadence-spacer/";
  const a = JSON.parse(localStorage.getItem(k) || "[]");
  if (!a.some((x) => (x.address || "").includes("cadence-spacer"))) {
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

1. Open a font in the Fontra glyph editor.
2. Open a lowercase **n** (or **m**) — the reference glyph. The plugin
   measures the distance between its stems at the beam height.
3. In the panel, set the **beam height** so that it cuts the stems and nothing
   else. The readout tells you how many crossings it found.
4. Choose a spacing table (a built-in one, or load your own), and press
   **Preview** to see, per glyph, what the current and the desired
   sidebearings are.
5. Press **Apply**. The changes go into the normal undo history.

The canvas overlay draws the beam, the stem crossings, the current sidebearings
and — after a preview — the desired ones, so you can see where a glyph is
going to move to.

## The spacing table (CUST)

A **CUST** — *Cadence Unit Spacing Table* — is a plain text file. One directive
or one entry per line, close to the original LS Cadencer CSV syntax:

```
# Renaissance Roman — starter table
nBeam=200
H=SS,14,14,Beam
O=XX,7,7,Beam
R-alt=SX,14,3,Beam
```

### Entries

```
GlyphName=SIDEDEF,left,right,beam
```

* `SIDEDEF` is two characters. `X` means "measure the side at the extreme — the
  outline's own edge"; `S` means "measure it at the stem, at the beam height".
  So `SS` is a flat-sided glyph (H, I, M, N), `SX` is round on the left and
  flat on the right, and so on.
* `left` and `right` are the desired sidebearings **in cadence units** — the
  grid steps, not font units.
* `beam` is the word `Beam` (use the table's beam height) or a number (use
  that height instead, for this glyph only).

`H=SS,14,14,Beam` means: for the glyph `H`, measure the left and the right
sidebearing at the stem, and make each of them 14 cadence units wide.

### Directives

| Directive | Meaning |
|---|---|
| `nBeam=200` | the beam height (also `mBeam=`, `fBeam=`, `gBeam=`) |
| `tabular=zero,one,two` | the glyphs to give a fixed width |
| `tabularWidth=600` | the fixed width, in font units |

Lines that are empty or start with `#` are comments.

### Alternates

A key of the form `GlyphName-alt` gives an *alternate* value set for that
glyph — useful for a "round" and a "straight" variant of the same letter, or a
glyph that needs different spacing in a different context. The table editor
shows the entries with their suffix.

## The built-in tables are placeholders, not research data

**This matters.** The three tables that ship with the plugin are structurally
plausible *starting points* — the side definitions and the rhythm are
reasonable, but the numbers have not been digitised from the research the
method is based on. Use them to see how the plugin behaves, and to get a feel
for the units. For real work, write your own table.

The engine is also deliberately limited:

* only the **editing layer** of a variable font is re-spaced by default (the
  way Fontra's own Selection Info panel works); "all layers" is an explicit
  opt-in, because silently re-spacing every master of a variable font is
  rarely what you want;
* a glyph that is **locked** is skipped;
* a **read-only** font is never written to;
* the advance width is clamped so that it can never go negative.

## Running the tests

```
cd src/fontra/localplugins/cadence-spacer
node --test
```

No arguments, no dependencies, no `package.json`, no browser: the suite uses
Node's built-in test runner, and the engine is deliberately free of the DOM
and of Fontra imports, so it runs in plain Node.

There is also a **real-font check**, which runs both plugins' engines over a
real typeface and reports what they find:

```
node ../commonform/tests/real-font-check.mjs [path/to/font.fontra]
```

## The files

| File | What it is |
|---|---|
| `plugin.json` | the manifest the editor reads |
| `start.js` | the entry point the editor imports |
| `cadence-engine.js` | all the maths: parsing, measuring, planning, applying |
| `cadence-state.js` | the small store the panel and the layer share |
| `cadence-presets.js` | the three built-in spacing tables |
| `cadence-layer.js` | the canvas overlay |
| `cadence-panel.js` | the sidebar panel |
| `register-dev.js` | a console one-liner that enables the plugin |

## License

MIT.

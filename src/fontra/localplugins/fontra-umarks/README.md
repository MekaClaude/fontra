# U+Marks

**U+Marks** is a free [Fontra](https://fontra.xyz) plug-in by [U+Type](https://uplustype.com) that builds the accented glyphs of a font from its anchors.

- You draw the bases and the accents once; U+Marks composes é, Ǻ, ệ… as components, each accent placed anchor to anchor, in every source.
- It works from a glyph set — the one you want to end up with — and shows, line by line, what is left to draw, to anchor, to make.
- The rules come from Unicode, from the glyphs your font already has, and from your anchors; you can change any of them, and they travel with the font.
- On the canvas, a base shows the accents its anchors will receive while you move them.
- After a Make, it keeps watching: when an anchor moves, it says which glyphs to recompute, and by how much.

## Install

- **Fontra Pak, or your own Fontra server**: Settings › Plugins, add the address
  `Uplus-Type/fontra-umarks`. Fontra loads the latest release from this repository through
  jsDelivr; nothing to install.
- **Fontra Hive**: it is already there.
- **From a copy of this repository**: serve its folder with a static server that sends
  `Access-Control-Allow-Origin: *` — the editor imports the modules from another origin, as it does
  from jsDelivr; `python3 -m http.server` does not send it — and add `http://localhost:8000/` in
  Settings › Plugins.

The panel is the ◌ tab of the right sidebar.

## The path

1. **Glyph set** — the glyph set you want to end up with: one of your project's, one of yours, a Fontra preset, or from scratch.
2. **Draw** — the letters and accents the accented glyphs need and the font does not have yet. *Add N missing glyphs*.
3. **Anchors** — the drawn glyphs that have no anchors yet, and where each anchor goes. *Place anchors*.
4. **Check** — anchors that are out of place since Place put them, and anchors moved by hand. *Re-place N*.
5. **Compose** — the accented glyphs that are ready, those waiting for a part to be drawn, those that can't be built yet, and why. *Make N*.
6. **Update** — the glyphs that have moved off their anchors. *Update N*.

## Guide

The guide is part of the plug-in: the **?** at the end of ① opens it in a new tab
([guide/index.html](guide/index.html)).

## Anchor conventions

- A base carries `top`, `bottom`, `ogonek`…; a mark carries the same names with `_`: `_top`, `_bottom`, `_ogonek`.
- A mark lands on the anchor of the same name once its `_` is taken off, exactly: `_top.cap` lands on
  `top.cap`, never on `top`. The offset is the base's anchor minus the mark's, as in Fontra's own shaper.
- A second mark on the same anchor stacks on the first (ǘ = u + diaeresis + acute): the first mark carries
  `top` as well as `_top`. One level of stacking.
- Variants by category: a capital takes `acute.cap` when the font has it, a small capital `acute.sc`.
- Where Place puts each anchor is the list of positions in ③ (`center · x-height + 10`…), stored in the font.

## Keys

- In a number field: ↑/↓ add or take 1, with ⇧ 10; a key held down keeps counting.
- Enter adds the position typed under ③ (+ anchor), or renames the rule of the open glyph.
- A double-click on a glyph of a list opens it.
- *Undo last batch* takes back the last batch whole; Fontra's ⌘Z undoes one glyph at a time.

## Development

Everything is plain ES modules, served as they are: no bundler, no build step, nothing imported
from Fontra — everything comes from the `editorController` Fontra hands to `init`. To work on it,
serve this folder as above and reload the editor after a change (with the cache disabled).

## License

GPLv3, like Fontra. © U+Type / Jérémie Hornus.

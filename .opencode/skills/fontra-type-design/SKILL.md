---
name: fontra-type-design
description: Type-design knowledge for working with Fontra — design fundamentals, bezier curves (quadratic-first-class), PackedPath data model, components, variable fonts/designspace, kerning, anchors, metrics, optical corrections, and how to use the fontra MCP tools + CLI. Use when designing, analyzing or reviewing glyphs and fonts, or when the fontra MCP server is connected.
---

# Fontra Type Design Skill

Use this skill to design, analyze, and review type in Fontra like a
professional type designer — and to drive the Fontra MCP server
(`fontra-mcp/`) when it's connected.

## Fontra architecture (what you have)

- **Client + server**: JS editor in the browser, Python server (`src/fontra/`).
- **Server core**: `FontHandler` (`src/fontra/core/fonthandler.py`) wraps a
  storage **backend** (`src/fontra/backends/`) and exposes read/write methods
  over WebSocket JSON (`@remoteMethod`). The MCP server and CLI reuse the
  same layer, so agent reads == editor reads.
- **Backends** (entry points `fontra.filesystem.backends`): `designspace`,
  `ufo`, `ttf`, `otf`, `ttx`, `woff`, `woff2`, `fontra`, `yaml`.
- **Data model** (`src/fontra/core/classes.py`):
  - `VariableGlyph` — `sources[]`, `layers{}` (dict), `axes[]`.
  - `GlyphSource` — `name`, `layerName`, `location` (designspace position).
  - `StaticGlyph` — `path` (PackedPath|Path), `components[]`, `xAdvance`,
    `anchors[]`, `guidelines[]`, `backgroundImage`.
  - `Component` — `name`, `transformation` (DecomposedTransform),
    `location` (variable location).
  - `Anchor` — `name`, `x`, `y`.
  - `FontInfo` — family/version/designer metadata.
  - `Axes` — `axes[]` (FontAxis/DiscreteFontAxis) + cross-axis `mappings`.
  - `Kerning` — `groupsSide1/2`, nested `values`.
- **Paths** (`src/fontra/core/path.py`):
  - `PackedPath`: flat `coordinates[x,y,x,y,...]`, `pointTypes`,
    `contourInfo[endPoint,isClosed]` (+ `pointAttributes` when present).
  - `PointType`: `ON_CURVE=0`, `OFF_CURVE_QUAD=1`, `OFF_CURVE_CUBIC=2`,
    `ON_CURVE_SMOOTH=8` — **Fontra is quadratic-first-class**.
  - `Path` (unpacked): `contours: [{points: [{x,y,type,smooth,attrs}]}]`.

## Type-design fundamentals

1. **Build structure before details**: Skeleton → stress/bone → refine the
   outline → counters → terminals → spacing/kerning → optical polish.
2. **Stems are the system**: one stem width family per font; measure them
   (`analyze_glyph` reports stem widths). Inconsistent stems = inconsistent look.
3. **Overshoot**: rounded shapes (o, c, e, s, n) extend ~1–2% past cap-height
   and baseline so they *look* aligned. Flat shapes (h, i, E) sit on the lines.
4. **Counters are shapes, not leftovers**: a counter's shape echoes the outer
   shape; balance inner vs outer to keep stroke contrast.
5. **Calligraphic logic**: downstrokes thick, upstrokes thin (Latin);
   apex/crossbar/bowl choices are personality decisions.
6. **Stress**: diagonal stress in bowls vs vertical stress — pick one and
   stay consistent across the family.
7. **Optical size**: smaller sizes need wider spacing, bigger counters,
   stronger strokes; never merely scale down a display face.
8. **Spacing**: sidebearings are optical, not arithmetic. Reference strings
   ("Hamburgefonstiv", "Rags") reveal rhythm. Over-margin vs under-margin
   habits must be consistent.
9. **Kerning**: default pairs first via groups (`@left/@right`), then
   exceptional pairs; never start with exception pairs.
10. **Anchors** drive diacritics and marks: top/bottom anchor on every base
    glyph that may take a mark; mark classes consistent.

## Bezier curves in Fontra

- Quadratic-first-class: prefer quad segments; cubic only where the control
  polygon really needs it (Fontra converts on export).
- One axis of symmetry per curve segment; use smooth points
  (`ON_CURVE_SMOOTH`) at curve masters.
- Keep off-curve points at ~1/3–1/2 the segment length; a pair of
  equidistant off-curve points reads as a symmetric arc.
- Direction: counter-clockwise for outers, clockwise for counters (the
  editor has a reverse-contour action — keep contours consistently wound).
- Fewer points, placed at extrema: top/bottom/left/right of the curve are
  where you want on-curve points.
- `PackedPath.getControlBounds()` returns the control-point bounding box
  (not the curve's tight bounds) — that's what the editor shows as the
  glyph bounding box.

## Component workflow

- Reuse beats redrawing: duplicate components instead of redrawing the
  same shape (guarantees identical weight).
- Components come with scale/rotate/translate transforms; variable
  components can also carry per-axis locations.
- Build a component catalog per glyph class (`get_component_catalog`):
  stems, bowls, bars, terminals, serifs.
- `find_glyphs_using` lists every glyph that uses a component — change a
  master and review all dependents.
- Linked sources keep variable fonts coherent: change a source layer, all
  instances update.

## Variable fonts / designspace

- Montage instances: `sources` are designspace positions; `axes` are the
  design axes (FontAxis: name/tag/min/default/max); `mappings` include
  cross-axis (avar-2-style) curves.
- Think master → instance: design at masters, check interpolation at
  instance points (live interpolation in the text view).
- `get_axes` shows axis ranges; design far from default values first to
  find autohint/interpolation problems.

## Kerning workflow

1. Spacing (sidebearings) before pairs.
2. Group kerning (`@left/@right` = `groupsSide1/2`) for the bulk.
3. `get_kerning` (bounded) inspects pairs; sanity-check famous pairs
   (AV, LT, Vo, To, -1 ...).
4. Optical-spacing heuristics beat ML kerning models: nearest-edge
   distances under current sidebearings, human-accepted.

## Analyzing and reviewing with the tools

- `analyze_glyph` → stems/curves/overshoot; compare stem widths across
  glyphs for consistency.
- `get_glyph_tips` / `get_pro_advice` / `get_optical_corrections` /
  `get_common_mistakes` / `get_design_phase` → the fontra-coach knowledge
  base (`src/fontra/core/design_guide.py`) — the fork's built-in coach.
- `get_related_glyphs` → which glyphs to compare against.
- `get_term_definition` → terminology on demand (overshoot, counter,
  terminal, stress, aperture...).
- `audit_font` prompt — run it across a representative set.

## MCP + CLI usage

- Server: `fontra-mcp/` (`python -m fontra_mcp.server`), stdio transport,
  registered in `.opencode/opencode.jsonc` under `mcp.servers.fontra`.
- CLI: `fontra-cli` — same operations, JSON out. Tests:
  `venv/Scripts/python.exe -m pytest fontra-mcp/tests -q`.
- Writes: v2 — enabled with `FONTRA_MCP_ALLOW_WRITES=1`. `set_glyph`
  writes whole glyphs through Fontra's backend write path
  (`putGlyph`, same as the editor server) and keeps the FontHandler
  caches coherent. It defaults to `dry_run=True` (validate + summarize,
  no file writes); pass `dry_run=False` to persist. Reads always work,
  including `analyze_glyph` right after a write.

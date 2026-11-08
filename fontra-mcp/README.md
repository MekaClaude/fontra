# Fontra MCP

Bridges **Fontra** (the browser-based font editor) to AI agents over
the [Model Context Protocol](https://modelcontextprotocol.io/).
Agents can inspect fonts, glyphs, kerning and axes, run Fontra's geometric
glyph analysis, read the type-design knowledge base — and, when writes are
enabled, *design* fonts: build a glyph, place components, set anchors, add
masters, interpolate and kern.

This is the "your own AI agent over the font" idea, built on Fontra's own
backend layer: the server opens font files *in-process* through
`fontra.backends.getFileSystemBackend` + `FontHandler`, so agents see
exactly the data the editor sees (UFO, `.designspace`, `.fontra`, TTF/OTF,
TTX, WOFF/WOFF2, workflow YAML).

See [`AUDIT.md`](AUDIT.md) for the review of the previous version and what
was fixed.

## What you get

- **MCP server** (stdio) with 44 tools, 7 resources and 3 prompts.
- **CLI** (`fontra-cli`) over the same service layer — same operations,
  JSON on stdout, scriptable.
- **A component workflow planner** that turns a set of starting glyphs
  (`n`, `o`, `H`, `O`, `I`, …) into an ordered, evidence-based build plan.
- **Sandboxed** to one or more root directories (path-traversal guarded).
- **Bounded outputs**: glyph summaries and kerning are capped so responses
  stay small; `get_glyph_full` is opt-in for raw outlines.
- **Gated writes**: off by default, dry-run by default even when on.

## Install

Use the repo venv (where `fontra` is already installed editable):

```bash
venv/Scripts/python.exe -m pip install -e ./fontra-mcp
```

## Register with OpenCode (this repo)

`.opencode/opencode.jsonc` already points at the venv interpreter:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "fontra": {
        "type": "local",
        "command": [
          "D:/DEVWEB/MINIMAX AGENT/fontra/fontra/venv/Scripts/python.exe",
          "-m", "fontra_mcp.server"
        ],
        "cwd": ".",
        "environment": {
          "FONTRA_MCP_ROOT": ".;D:/DESIGN",
          "FONTRA_MCP_ALLOW_WRITES": "1"
        }
      }
    }
  }
}
```

Then run `opencode mcp list` — it should show `fontra connected`.
Tools appear as `fontra_<tool>` (Code Mode) or as native tools with
`"codemode": false`.

## The component workflow

This is the workflow the server is built around: start from a small set of
foundation glyphs, build them properly, then derive everything else by
re-using their parts.

```
plan_workflow("n,o,H,O,I")
  → 1. o   [primary_foundation]  components: bowl, counter, overshoot
  → 2. n   [primary_foundation]  components: arch, counter, stem
  → 3. H   [capital_foundation]  components: arch, counter, crossbar, stem
  → 4. O   [capital_foundation]  components: bowl, counter, overshoot
  → 5. I   [secondary]           components: ascender, stem, tittle
```

The plan also reports, per glyph, what it is **built from** and what it
**unlocks** (`n → h, m, u, r`), plus the next glyphs to tackle.

The build loop for each glyph:

```
copy_glyph(n → m)            # start from the closest relative
add_component(m, n, {...})   # place the reused arch + stem
set_glyph_layer(m, "default", …)   # adjust the result
set_anchors(m, [...])        # anchor the new junctions
find_glyphs_using(n)         # prove the component is shared
analyze_glyph(m)             # check stem width and overshoot
```

## Usage

```bash
# MCP server over stdio (OpenCode launches this)
venv/Scripts/python.exe -m fontra_mcp.server --root .

# CLI equivalents
fontra-cli --root test-common fonts
fontra-cli --root test-common font open MutatorSans.fontra
fontra-cli --root test-common glyph get MutatorSans.fontra A
fontra-cli --root test-common glyph analyze MutatorSans.fontra A
fontra-cli workflow plan n,o,H,O,I
fontra-cli guide dna n
fontra-cli serve          # start the MCP server
```

### Tools

**Fonts** — `list_fonts`, `open_font`, `list_glyphs`, `get_font_info`,
`get_axes`, `get_units_per_em`, `get_glyph_infos`, `get_sources`,
`get_kerning`

**Glyphs** — `get_glyph`, `get_glyph_full`, `find_glyphs_using`,
`get_component_graph`, `analyze_glyph`

**Writes** (need `FONTRA_MCP_ALLOW_WRITES=1`, dry-run by default) —
`set_glyph`, `set_glyph_layer`, `copy_glyph`, `add_component`,
`remove_component`, `set_anchors`, `decompose_glyph`, `interpolate_glyph`,
`add_source`, `set_kerning`

**Design knowledge** — `get_glyph_tips`, `get_design_phase`,
`get_design_phases`, `get_pro_advice`, `get_optical_corrections`,
`get_common_mistakes`, `get_spacing_principles`, `get_term_definition`,
`get_all_terms`, `get_component_catalog`, `get_all_components`,
`get_components`, `get_suggestions`, `get_info_cards`, `get_cards`,
`get_acceleration_tips`, `get_card_layout`, `get_related_glyphs`

**Workflow** — `plan_workflow`, `get_glyph_dna`

Resources: `fontra://fonts`, `fontra://fonts/{font}/open`,
`fontra://fonts/{font}/glyphs/{glyph_name}`,
`fontra://fonts/{font}/components`, `fontra://fonts/{font}/sources`,
`fontra://guide/glyphs/{glyph_name}/tips`,
`fontra://guide/workflow/{glyphs}`.

Prompts: `design_glyph`, `audit_font`, `component_workflow`.

## Glyph payload format

`get_glyph_full` returns — and `set_glyph` accepts — a `VariableGlyph`:

```json
{
  "name": "n",
  "axes": [],
  "sources": [{ "name": "", "layerName": "default", "location": {} }],
  "layers": {
    "default": {
      "glyph": {
        "path": {
          "contours": [
            { "points": [{ "x": 24, "y": 0 }, { "x": 186, "y": 456, "type": "quad" }],
              "isClosed": true }
          ]
        },
        "xAdvance": 350,
        "components": [],
        "anchors": [],
        "guidelines": []
      }
    }
  },
  "customData": {}
}
```

Outlines use the **unpacked** form (`contours`), which is what Fontra
stores on disk and what a write puts back — a read/write round-trip is
stable. The compact packed form (`coordinates` / `pointTypes` /
`contourInfo`) is also accepted on write, and `get_glyph_full(packed=True)`
returns it.

`set_glyph` has two modes:

* `mode="replace"` (default) replaces the whole glyph. The result reports
  `droppedLayers` when masters were removed.
* `mode="merge"` merges the payload into the existing glyph and keeps the
  other masters.

`set_glyph_layer` writes exactly one layer and never touches the others.

## Security model

- Writes are gated: the server starts read-only. Set
  `FONTRA_MCP_ALLOW_WRITES=1` in the MCP server environment (or
  `FontService(root, writesAllowed=True)`) to enable the write tools. Even
  when enabled, every write tool defaults to `dry_run=True`, which
  validates and summarizes without writing.
- Filesystem sandbox: every font path must resolve inside one of the
  configured roots (same guard style as the server's
  `staticContentHandler`); `..` escapes and null-byte inputs are rejected.
  `FONTRA_MCP_ROOT` may hold several roots separated by the OS path
  separator (`;` on Windows). Windows paths (`D:\DESIGN\My Font.fontra`)
  work.
- Stdio transport only (local processes); no network listener.

```bash
# MCP server over stdio (OpenCode launches this)
venv/Scripts/python.exe -m fontra_mcp.server --root ".;D:/DESIGN"
```

## CLI

```bash
fontra-cli --root "D:/DESIGN" fonts
fontra-cli --root "D:/DESIGN" font open experiment.fontra
fontra-cli --root "D:/DESIGN" glyph get experiment.fontra n
fontra-cli --root "D:/DESIGN" glyph full experiment.fontra n
fontra-cli --root "D:/DESIGN" glyph set experiment.fontra n --from-file n.json
FONTRA_MCP_ALLOW_WRITES=1 fontra-cli --root "D:/DESIGN" glyph set experiment.fontra n --from-file n.json --write
fontra-cli --root "D:/DESIGN" workflow plan n,o,H,O,I
fontra-cli --root "D:/DESIGN" guide dna n
fontra-cli serve          # start the MCP server
```

## Tests

```bash
$env:PYTHONPATH="fontra-mcp\src"
venv/Scripts/python.exe -m pytest fontra-mcp/tests -q
```

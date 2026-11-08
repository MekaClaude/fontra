# Fontra MCP

Bridges **Fontra** (the browser-based font editor) to AI agents over
the [Model Context Protocol](https://modelcontextprotocol.io/).
Read-only v1: agents can inspect fonts, glyphs, kerning, axes, run Fontra's
geometric glyph analysis, and read the type-design knowledge base — but
cannot mutate font data.

This is the "your own AI agent over the font" idea, built on Fontra's own
backend layer: the server opens font files *in-process* through
`fontra.backends.getFileSystemBackend` + `FontHandler`, so agents see
exactly what the editor sees (UFO, `.designspace`, `.fontra`, TTF/OTF,
TTX, WOFF/WOFF2, workflow YAML).

## What you get

- **MCP server** (stdio) with 20 tools, 4 resources, and 2 prompts
  (`design_glyph`, `audit_font`).
- **CLI** (`fontra-cli`) over the same service layer — same operations,
  JSON on stdout, scriptable.
- **Sandboxed** to a root directory (path-traversal guarded).
- **Bounded outputs**: glyph summaries and kerning are capped so responses
  stay small; `get_glyph_full` is opt-in for raw outlines.

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
        "environment": { "FONTRA_MCP_ROOT": "." }
      }
    }
  }
}
```

Then run `opencode mcp list` — it should show `fontra connected`.
Tools appear as `fontra_<tool>` (Code Mode) or as native tools with
`"codemode": false`.

## Usage

```bash
# MCP server over stdio (OpenCode launches this)
venv/Scripts/python.exe -m fontra_mcp.server --root .

# CLI equivalents
fontra-cli --root test-common fonts
fontra-cli --root test-common font open MutatorSans.fontra
fontra-cli --root test-common glyph get MutatorSans.fontra A
fontra-cli --root test-common glyph analyze MutatorSans.fontra A
fontra-cli guide show A
fontra-cli serve          # start the MCP server
```

### Tools

| Tool | Description |
|---|---|
| `list_fonts` | Font projects under the configured roots (multiple roots supported) |
| `open_font` | Family, unitsPerEm, glyph count, axes |
| `list_glyphs` | Glyph names + codepoints (bounded) |
| `get_glyph` | Summary: bounds, xAdvance, components, anchors, layer stats |
| `get_glyph_full` | Full structured glyph (all contour data) |
| `get_font_info` / `get_axes` / `get_units_per_em` / `get_glyph_infos` | Font-level reads |
| `get_kerning` | Bounded kerning pairs |
| `find_glyphs_using` | Component usages (when the backend supports it) |
| `analyze_glyph` | Stems, curve segments, overshoot (glyph_analysis) |
| `set_glyph` | Create/replace a whole glyph — writes gated by `FONTRA_MCP_ALLOW_WRITES=1`, `dry_run` defaults to a validated preview that writes nothing |
| `get_glyph_tips` / `get_design_phase(s)` / `get_pro_advice` / `get_optical_corrections` / `get_common_mistakes` / `get_spacing_principles` / `get_term_definition` / `get_component_catalog` / `get_related_glyphs` | Design knowledge base (design_guide) |

Resources: `fontra://fonts`, `fontra://fonts/{font}/open`,
`fontra://fonts/{font}/glyphs/{glyph_name}`,
`fontra://guide/glyphs/{glyph_name}/tips`.

Prompts: `design_glyph`, `audit_font`.

## Security model

- Writes are gated: the server starts read-only. Set
  `FONTRA_MCP_ALLOW_WRITES=1` in the MCP server environment (or
  `FontService(root, writesAllowed=True)`) to enable `set_glyph`. Even
  when enabled, `set_glyph` defaults to `dry_run=True`, which validates
  and summarizes without writing.
- Filesystem sandbox: every font path must resolve inside one of the
  configured roots (same guard style as the server's
  `staticContentHandler`); `.`/`..`/backslash/null-byte inputs are
  rejected. `FONTRA_MCP_ROOT` may hold several roots separated by the
  OS path separator (`;` on Windows).
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
fontra-cli --root "D:/DESIGN" glyph set experiment.fontra n --from-file n.json
FONTRA_MCP_ALLOW_WRITES=1 fontra-cli --root "D:/DESIGN" glyph set experiment.fontra n --from-file n.json --write
fontra-cli guide show A
fontra-cli serve          # start the MCP server
```

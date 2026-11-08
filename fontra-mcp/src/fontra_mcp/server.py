"""Fontra MCP server (stdio transport).

Exposes Fontra's read-only backend layer to MCP clients (OpenCode,
Claude Code, Cursor, ...). The server runs over stdio; OpenCode launches
it with `type: local` in `.opencode/opencode.jsonc`.

Read-only v1: agents inspect fonts/glyphs/kerning/axes, run the fork's
glyph-analysis and design-guide modules, but cannot mutate font data.
Writes will arrive in a later version behind explicit opt-in.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from mcp.server.fastmcp import FastMCP

from .service import FontService, FontServiceError

INSTRUCTIONS = """
You are connected to a Fontra font project through the Fontra MCP server.
Tools are read-only unless the server was started with
FONTRA_MCP_ALLOW_WRITES=1, in which case `set_glyph` is also available
(create or replace whole glyphs through Fontra's backend write path).

Recommended workflow
1. list_fonts  — discover fonts under the configured roots.
2. open_font   — open one (every other tool needs the font path/id).
3. list_glyphs — see the glyph set.
4. get_glyph   — summary of a glyph (bounds, components, anchors, advances).
5. analyze_glyph — stems / overshoot / bowls for design feedback.
6. get_design_guide tools (get_glyph_tips, get_design_phase,
   get_pro_advice, get_optical_corrections, get_common_mistakes) —
   fontra-coach knowledge base for how to design this glyph well.
7. get_kerning — inspect kerning pairs (bounded output).
8. set_glyph (writes only) — design a glyph as structured VariableGlyph
   JSON (same shape get_glyph_full returns); call with dry_run=True first
   to preview, then dry_run=False to write and verify with get_glyph.

Font IDs: pass the absolute path or the root-relative id returned by
list_fonts / open_font. Outputs are intentionally compact; use
get_glyph_full only when you truly need every contour point.
"""


def buildServer(service: FontService) -> FastMCP:
    mcp = FastMCP("fontra", instructions=INSTRUCTIONS)

    # ------------------------------------------------------------------
    # Fonts
    # ------------------------------------------------------------------

    @mcp.tool()
    def list_fonts(subdir: str | None = None) -> dict:
        """List font projects (UFO / .designspace / .fontra / TTF / OTF / ...) under the MCP root."""
        return service.listFonts(subdir=subdir)

    @mcp.tool()
    async def open_font(font: str) -> dict:
        """Open a font and return a summary (family, unitsPerEm, glyph count, axes).

        `font` is an absolute path or the root-relative id from list_fonts.
        """
        return await service.openFont(font)

    @mcp.tool()
    async def list_glyphs(font: str, max_glyphs: int = 500) -> dict:
        """List glyph names + Unicode codepoints (bounded)."""
        return await service.listGlyphs(font, maxGlyphs=max_glyphs)

    @mcp.tool()
    async def get_font_info(font: str) -> dict:
        """Font-level metadata (family, version, designer, ...)."""
        return await service.getFontInfo(font)

    @mcp.tool()
    async def get_axes(font: str) -> dict:
        """Variable font axes (name, min, default, max) and cross-axis mappings."""
        return await service.getAxes(font)

    @mcp.tool()
    async def get_units_per_em(font: str) -> dict:
        """Units per em for the font."""
        return await service.getUnitsPerEm(font)

    @mcp.tool()
    async def get_glyph_infos(font: str) -> dict:
        """Raw glyph infos dictionary exposed by the backend."""
        return await service.getGlyphInfos(font)

    # ------------------------------------------------------------------
    # Glyphs
    # ------------------------------------------------------------------

    @mcp.tool()
    async def get_glyph(font: str, glyph_name: str) -> dict:
        """Compact glyph summary: bounds, xAdvance, components, anchors, per-layer contour/point counts."""
        return await service.getGlyph(font, glyph_name)

    @mcp.tool()
    async def get_glyph_full(font: str, glyph_name: str) -> dict:
        """Full structured glyph: every contour coordinate, point type, component transform, anchor.

        Large output — only call when you need the raw outline data.
        """
        return await service.getGlyphFull(font, glyph_name)

    @mcp.tool()
    async def find_glyphs_using(font: str, glyph_name: str) -> dict:
        """Find glyphs that use the given glyph as a component (if the backend supports it)."""
        return await service.findGlyphsUsing(font, glyph_name)

    @mcp.tool()
    async def set_glyph(
        font: str,
        glyph_name: str,
        glyph_data: dict,
        codepoints: list[int] | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Create or replace a whole glyph (gated write).

        Enabled only when the server was started with FONTRA_MCP_ALLOW_WRITES=1.
        `glyph_data` is structured VariableGlyph JSON — the same shape
        `get_glyph_full` returns (use it as a template: fetch an existing
        glyph, edit its coordinates, send it back). `codepoints` defaults
        to the existing glyphMap entry ([] for a brand-new unencoded glyph;
        e.g. [110] for "n"). With `dry_run=True` (default) the payload is
        validated and summarized but nothing is written.
        """
        return await service.setGlyph(
            font, glyph_name, glyph_data, codepoints=codepoints, dryRun=dry_run
        )

    @mcp.tool()
    async def set_glyph(
        font: str,
        glyph_name: str,
        glyph_data: dict,
        codepoints: list[int] | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Create or replace a glyph (writes through Fontra's backend).

        Requires the server to be started with FONTRA_MCP_ALLOW_WRITES=1.
        `glyph_data` is structured VariableGlyph JSON — the same shape
        `get_glyph_full` returns. `codepoints` defaults to the existing
        glyphMap entry, or [] for a new unencoded glyph. With
        `dry_run=True` (default) the glyph is validated and summarized
        without writing; pass `dry_run=False` to persist it.
        """
        return await service.setGlyph(
            font, glyph_name, glyph_data, codepoints=codepoints, dryRun=dry_run
        )

    @mcp.tool()
    async def get_kerning(font: str, max_pairs: int = 200) -> dict:
        """Kerning pairs for the font (bounded output)."""
        return await service.getKerning(font, maxPairs=max_pairs)

    # ------------------------------------------------------------------
    # Analysis (fork modules: glyph_analysis + design_guide)
    # ------------------------------------------------------------------

    @mcp.tool()
    async def analyze_glyph(
        font: str, glyph_name: str, metric_lines: dict | None = None
    ) -> dict:
        """Geometric analysis: detected stems, curve segments, overshoot vs metric lines.

        `metric_lines` maps line names to y values, e.g. {"baseline": 0, "x-height": 700}.
        """
        return await service.analyzeGlyph(font, glyph_name, metricLines=metric_lines)

    @mcp.tool()
    def get_glyph_tips(glyph_name: str) -> dict:
        """Design tips for one glyph from the fontra-coach knowledge base."""
        return service.getGlyphTips(glyph_name)

    @mcp.tool()
    def get_design_phase(glyph_name: str) -> dict:
        """Which phase of the design process this glyph belongs to."""
        return service.getDesignPhase(glyph_name)

    @mcp.tool()
    def get_design_phases() -> dict:
        """All design phases in the type-design workflow."""
        return service.getDesignPhases()

    @mcp.tool()
    def get_pro_advice(glyph_name: str) -> dict:
        """Pro tips for this glyph."""
        return service.getProAdvice(glyph_name)

    @mcp.tool()
    def get_optical_corrections(glyph_name: str) -> dict:
        """Known optical corrections for this glyph class (overshoot, joins, ...)."""
        return service.getOpticalCorrections(glyph_name)

    @mcp.tool()
    def get_common_mistakes(glyph_name: str) -> dict:
        """Common mistakes when designing this glyph."""
        return service.getCommonMistakes(glyph_name)

    @mcp.tool()
    def get_spacing_principles() -> dict:
        """Fontra-coach spacing fundamentals and reference strings."""
        return service.getSpacingPrinciples()

    @mcp.tool()
    def get_term_definition(term: str) -> dict:
        """Type-design terminology definition (e.g. 'overshoot', 'counter', 'terminal')."""
        return service.getTermDefinition(term)

    @mcp.tool()
    def get_component_catalog() -> dict:
        """Catalog of recommended building-block components per glyph."""
        return service.getComponentCatalog()

    @mcp.tool()
    def get_related_glyphs(glyph_name: str) -> dict:
        """Glyphs to compare with when designing this one."""
        return service.getRelatedGlyphs(glyph_name)

    # ------------------------------------------------------------------
    # Resources: addressable context for the agent
    # ------------------------------------------------------------------

    @mcp.resource("fontra://fonts")
    def fontsResource() -> str:
        return json.dumps(service.listFonts(), indent=2)

    @mcp.resource("fontra://fonts/{font}/open")
    async def fontOpenResource(font: str) -> str:
        return json.dumps(await service.openFont(font), indent=2)

    @mcp.resource("fontra://fonts/{font}/glyphs/{glyph_name}")
    async def glyphResource(font: str, glyph_name: str) -> str:
        return json.dumps(await service.getGlyph(font, glyph_name), indent=2)

    @mcp.resource("fontra://guide/glyphs/{glyph_name}/tips")
    def glyphTipsResource(glyph_name: str) -> str:
        return json.dumps(service.getGlyphTips(glyph_name), indent=2)

    # ------------------------------------------------------------------
    # Prompts
    # ------------------------------------------------------------------

    @mcp.prompt()
    def design_glyph(glyph_name: str, goal: str = "design it consistently with the font") -> str:
        """Guided workflow for designing one glyph well."""
        return (
            f"Design the glyph '{glyph_name}' ({goal}).\n"
            f"1. Call get_glyph_tips with glyph_name='{glyph_name}' and read the tips.\n"
            "2. Call get_optical_corrections and get_common_mistakes for this glyph class.\n"
            "3. Call get_related_glyphs to find reference glyphs in the font.\n"
            "4. Summarize the key constraints (stems, overshoot, terminals, spacing)\n"
            "   before proposing any shape. Remember: this MCP server is read-only —\n"
            "   you describe the design; the human applies it in the editor.\n"
            "5. End with a checklist the designer can verify in Fontra."
        )

    @mcp.prompt()
    def audit_font(font: str) -> str:
        """Audit a font for consistency issues using the geometric analyzer."""
        return (
            f"Audit the font at '{font}'.\n"
            "1. Call open_font, then list_glyphs to see the glyph set.\n"
            "2. For a representative set (a, e, o, n, h, O, S, R, n, period, space),\n"
            "   call analyze_glyph and compare stem widths and overshoot.\n"
            "3. Call get_kerning to check pair coverage.\n"
            "4. Report: inconsistent stems, overshoot anomalies, missing kerning,\n"
            "   and which glyphs to fix first (highest impact first)."
        )

    return mcp


def _parseArgs(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="fontra-mcp", description="Fontra MCP server (stdio)")
    parser.add_argument(
        "--root",
        default=os.environ.get("FONTRA_MCP_ROOT") or os.getcwd(),
        help="Sandbox root for font files (default: %(default)s)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parseArgs(argv)
    service = FontService(root=args.root)
    mcp = buildServer(service)
    try:
        mcp.run(transport="stdio")
    finally:
        # Best-effort cleanup of backend handles.
        try:
            import asyncio

            asyncio.run(service.aclose())
        except RuntimeError:
            pass


if __name__ == "__main__":
    main(sys.argv[1:])

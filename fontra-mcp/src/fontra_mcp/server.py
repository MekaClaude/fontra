"""Fontra MCP server (stdio transport).

Exposes Fontra's backend layer to MCP clients (OpenCode, Claude Code,
Cursor, ...). The server runs over stdio; OpenCode launches it with
`type: local` in `.opencode/opencode.jsonc`.

Reads always work. Writes are gated: the server only exposes the write
tools when it was started with `FONTRA_MCP_ALLOW_WRITES=1`, and even then
every write tool defaults to `dry_run=True`.

The server is built around a *component workflow*: start from a small set
of foundation glyphs (o, n, H, O, ...), build them properly, then derive
the rest of the family by re-using their components.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from mcp.server.fastmcp import FastMCP

from .service import FontService, FontServiceError
from .workflow import DEFAULT_START_GLYPHS, WorkflowPlanner

INSTRUCTIONS = """
You are connected to a Fontra font project through the Fontra MCP server.

Tools are read-only unless the server was started with
FONTRA_MCP_ALLOW_WRITES=1, in which case the write tools (set_glyph,
add_component, set_anchors, copy_glyph, decompose_glyph,
interpolate_glyph, add_source, set_kerning) are also available. Every
write tool defaults to dry_run=True: call it with dry_run=True first to
preview the payload, then dry_run=False to write.

Component workflow (recommended order)
1. plan_workflow — given a starting set (e.g. "n,o,H,O,I"), get the ordered
   build plan: which glyph first, which components each one needs, and
   what it unlocks.
2. list_fonts / open_font — find and open the font project.
3. get_glyph_dna — the DNA of one glyph: its role, the components it is
   built from, the glyphs it feeds.
4. get_glyph_tips, get_optical_corrections, get_common_mistakes,
   get_pro_advice — the fontra-coach knowledge base.
5. set_glyph — write the foundation glyph (structured VariableGlyph JSON,
   the same shape get_glyph_full returns). Use mode="merge" to update a
   single master without dropping the others, or set_glyph_layer to edit
   exactly one layer.
6. Build the next glyph from the previous one: copy_glyph, then
   add_component to place a reused part, then set_anchors so the parts
   line up.
7. find_glyphs_using / get_component_graph — verify components are
   really shared.
8. analyze_glyph — check stems, overshoot and bowls.
9. get_kerning / set_kerning — spacing pairs.

Font IDs: pass the absolute path or the root-relative id returned by
list_fonts / open_font. Outputs are intentionally compact; use
get_glyph_full only when you truly need every contour point.
"""


def buildServer(service: FontService) -> FastMCP:
    mcp = FastMCP("fontra", instructions=INSTRUCTIONS)
    planner = WorkflowPlanner()

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

    @mcp.tool()
    async def get_sources(font: str) -> dict:
        """Font-level sources (masters) with their axis locations."""
        return await service.getSources(font)

    # ------------------------------------------------------------------
    # Glyphs
    # ------------------------------------------------------------------

    @mcp.tool()
    async def get_glyph(font: str, glyph_name: str) -> dict:
        """Compact glyph summary: bounds, xAdvance, components, anchors, per-layer contour/point counts."""
        return await service.getGlyph(font, glyph_name)

    @mcp.tool()
    async def get_glyph_full(font: str, glyph_name: str, packed: bool = False) -> dict:
        """Full structured glyph: every contour coordinate, point type, component transform, anchor.

        By default the outlines use the unpacked form (`{"contours": [...]}`),
        which is what Fontra stores on disk and what set_glyph writes back.
        Pass `packed=True` for the compact `coordinates/pointTypes` form.
        """
        return await service.getGlyphFull(font, glyph_name, packed=packed)

    @mcp.tool()
    async def find_glyphs_using(font: str, glyph_name: str) -> dict:
        """Find glyphs that use the given glyph as a component (if the backend supports it)."""
        return await service.findGlyphsUsing(font, glyph_name)

    @mcp.tool()
    async def get_component_graph(font: str) -> dict:
        """Which glyph uses which component — the map of a component-based font."""
        return await service.getComponentGraph(font)

    # ------------------------------------------------------------------
    # Writes (only usable when the server runs with FONTRA_MCP_ALLOW_WRITES=1)
    # ------------------------------------------------------------------

    @mcp.tool()
    async def set_glyph(
        font: str,
        glyph_name: str,
        glyph_data: dict,
        codepoints: list[int] | None = None,
        dry_run: bool = True,
        mode: str = "replace",
    ) -> dict:
        """Create or replace a whole glyph (gated write).

        Enabled only when the server was started with FONTRA_MCP_ALLOW_WRITES=1.
        `glyph_data` is structured VariableGlyph JSON — the same shape
        `get_glyph_full` returns (use it as a template: fetch an existing
        glyph, edit its coordinates, send it back). `codepoints` defaults
        to the existing glyphMap entry ([] for a brand-new unencoded glyph;
        e.g. [110] for "n").

        `mode="replace"` (default) replaces the whole glyph — layers that
        are not in `glyph_data` are dropped, and the result reports
        `droppedLayers`. Use `mode="merge"` to update only the layers and
        sources you send and keep the other masters.

        With `dry_run=True` (default) the payload is validated and
        summarized but nothing is written.
        """
        return await service.setGlyph(
            font,
            glyph_name,
            glyph_data,
            codepoints=codepoints,
            dryRun=dry_run,
            mode=mode,
        )

    @mcp.tool()
    async def set_glyph_layer(
        font: str,
        glyph_name: str,
        layer_name: str,
        glyph_data: dict,
        dry_run: bool = True,
    ) -> dict:
        """Replace one layer (master) of a glyph, leaving the other masters intact.

        `glyph_data` is a StaticGlyph object: `{"path": {...}, "xAdvance": 350,
        "components": [...], "anchors": [...]}`.
        """
        return await service.setGlyphLayer(
            font, glyph_name, layer_name, glyph_data, dryRun=dry_run
        )

    @mcp.tool()
    async def copy_glyph(
        font: str,
        source_name: str,
        new_name: str,
        codepoints: list[int] | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Copy a glyph (all layers, components, anchors) to a new name.

        The classic component-workflow move: copy a finished glyph, then
        edit the copy and re-use its parts.
        """
        return await service.copyGlyph(
            font, source_name, new_name, codepoints=codepoints, dryRun=dry_run
        )

    @mcp.tool()
    async def add_component(
        font: str,
        glyph_name: str,
        component_name: str,
        transformation: dict | None = None,
        layer_name: str | None = None,
        location: dict | None = None,
        codepoints: list[int] | None = None,
        create: bool = True,
        dry_run: bool = True,
    ) -> dict:
        """Add a component to a glyph — the core of the component workflow.

        The component glyph must exist in the font. `transformation` is a
        DecomposedTransform object, e.g. `{"translateX": 100, "scaleX": 0.8}`;
        omitted fields default to identity. `location` selects a master of
        a variable component glyph.
        """
        return await service.addComponent(
            font,
            glyph_name,
            component_name,
            transformation=transformation,
            layerName=layer_name,
            location=location,
            codepoints=codepoints,
            create=create,
            dryRun=dry_run,
        )

    @mcp.tool()
    async def remove_component(
        font: str,
        glyph_name: str,
        component_name: str,
        layer_name: str | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Remove every component named `component_name` from a glyph layer."""
        return await service.removeComponent(
            font, glyph_name, component_name, layerName=layer_name, dryRun=dry_run
        )

    @mcp.tool()
    async def set_anchors(
        font: str,
        glyph_name: str,
        anchors: list[dict],
        layer_name: str | None = None,
        replace: bool = True,
        dry_run: bool = True,
    ) -> dict:
        """Set (or merge) the anchors of a glyph layer.

        `anchors` is a list of `{"name": "top", "x": 100, "y": 700}`.
        Anchors are how components stay aligned when they are re-used.
        """
        return await service.setAnchors(
            font,
            glyph_name,
            anchors,
            layerName=layer_name,
            replaceExisting=replace,
            dryRun=dry_run,
        )

    @mcp.tool()
    async def decompose_glyph(
        font: str,
        glyph_name: str,
        layer_name: str | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Flatten the components of a glyph into outlines.

        Useful to inspect what a component actually looks like once placed,
        or to bake a composite glyph down to plain contours.
        """
        return await service.decomposeGlyph(
            font, glyph_name, layerName=layer_name, dryRun=dry_run
        )

    @mcp.tool()
    async def interpolate_glyph(
        font: str,
        glyph_name: str,
        layer_a: str,
        layer_b: str,
        factor: float,
        new_layer_name: str | None = None,
        location: dict | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Create an interpolated master between two layers.

        `factor` is 0.0 (layer_a) .. 1.0 (layer_b). Both layers must have
        the same point count, point types and component count.
        """
        return await service.interpolateGlyph(
            font,
            glyph_name,
            layer_a,
            layer_b,
            factor,
            newLayerName=new_layer_name,
            location=location,
            dryRun=dry_run,
        )

    @mcp.tool()
    async def add_source(
        font: str,
        glyph_name: str,
        source_name: str,
        location: dict | None = None,
        layer_name: str | None = None,
        base_layer: str | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Add a new master (source + layer) to a glyph.

        A font-level source is created when the font does not have one with
        that name yet, and the axis location is validated against the
        font's axes.
        """
        return await service.addSource(
            font,
            glyph_name,
            source_name,
            location=location,
            layerName=layer_name,
            baseLayer=base_layer,
            dryRun=dry_run,
        )

    @mcp.tool()
    async def set_kerning(
        font: str,
        pairs: dict | list,
        source_identifier: str | None = None,
        dry_run: bool = True,
    ) -> dict:
        """Set kerning pairs (gated write).

        `pairs` is either `{"A / V": -75}` or a list of
        `{"left": "A", "right": "V", "value": -75}`. Existing pairs are kept.
        """
        return await service.setKerning(
            font, pairs, sourceIdentifier=source_identifier, dryRun=dry_run
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
    def get_all_terms() -> dict:
        """Every type-design term in the knowledge base."""
        return service.getAllTerms()

    @mcp.tool()
    def get_component_catalog() -> dict:
        """Catalog of recommended building-block components per glyph."""
        return service.getComponentCatalog()

    @mcp.tool()
    def get_all_components() -> dict:
        """Every component in the knowledge base, with its description."""
        return service.getAllComponents()

    @mcp.tool()
    def get_components(glyph_name: str) -> dict:
        """The reusable components one glyph is built from."""
        return service.getComponents(glyph_name)

    @mcp.tool()
    def get_suggestions(glyph_name: str) -> dict:
        """Design suggestions for one glyph."""
        return service.getSuggestions(glyph_name)

    @mcp.tool()
    def get_info_cards(glyph_name: str) -> dict:
        """Knowledge-base info cards for one glyph."""
        return service.getInfoCards(glyph_name)

    @mcp.tool()
    def get_cards(glyph_name: str) -> dict:
        """Design cards for one glyph."""
        return service.getCards(glyph_name)

    @mcp.tool()
    def get_acceleration_tips(glyph_name: str) -> dict:
        """Speed-up tips for one glyph (how to avoid rework)."""
        return service.getAccelerationTips(glyph_name)

    @mcp.tool()
    def get_card_layout() -> dict:
        """Layout of the knowledge-base cards."""
        return service.getCardLayout()

    @mcp.tool()
    def get_related_glyphs(glyph_name: str) -> dict:
        """Glyphs to compare with when designing this one."""
        return service.getRelatedGlyphs(glyph_name)

    # ------------------------------------------------------------------
    # Workflow planning (component workflow)
    # ------------------------------------------------------------------

    @mcp.tool()
    def plan_workflow(glyphs: str | None = None) -> dict:
        """Plan an efficient, component-based build order for a set of starting glyphs.

        `glyphs` is a comma-separated list, e.g. "n,o,H,O,I" (default:
        "o,n,H,O"). The plan gives, for every glyph: its role (foundation
        or derived), the components it is built from, the glyphs it is
        built from and the glyphs it unlocks — plus the next glyphs to
        tackle.
        """
        names = (
            [g.strip() for g in glyphs.split(",") if g.strip()]
            if glyphs
            else list(DEFAULT_START_GLYPHS)
        )
        return planner.plan(names)

    @mcp.tool()
    def get_glyph_dna(glyph_name: str) -> dict:
        """The DNA of one glyph: role, components, what it is built from, what it unlocks."""
        return planner.glyphDNA(glyph_name)

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

    @mcp.resource("fontra://fonts/{font}/components")
    async def fontComponentsResource(font: str) -> str:
        return json.dumps(await service.getComponentGraph(font), indent=2)

    @mcp.resource("fontra://fonts/{font}/sources")
    async def fontSourcesResource(font: str) -> str:
        return json.dumps(await service.getSources(font), indent=2)

    @mcp.resource("fontra://guide/glyphs/{glyph_name}/tips")
    def glyphTipsResource(glyph_name: str) -> str:
        return json.dumps(service.getGlyphTips(glyph_name), indent=2)

    @mcp.resource("fontra://guide/workflow/{glyphs}")
    def workflowResource(glyphs: str) -> str:
        names = [g.strip() for g in glyphs.split(",") if g.strip()]
        return json.dumps(planner.plan(names or list(DEFAULT_START_GLYPHS)), indent=2)

    # ------------------------------------------------------------------
    # Prompts
    # ------------------------------------------------------------------

    @mcp.prompt()
    def design_glyph(glyph_name: str, goal: str = "design it consistently with the font") -> str:
        """Guided workflow for designing one glyph well."""
        return (
            f"Design the glyph '{glyph_name}' ({goal}).\n"
            f"1. Call get_glyph_dna with glyph_name='{glyph_name}' and read the role,\n"
            "   the components and the glyphs it feeds into.\n"
            "2. Call get_glyph_tips, get_optical_corrections and get_common_mistakes\n"
            "   for this glyph class.\n"
            "3. Call get_related_glyphs to find reference glyphs in the font, and\n"
            "   analyze_glyph on those to measure stem width and overshoot.\n"
            "4. Summarize the key constraints (stems, overshoot, terminals, spacing)\n"
            "   before proposing any shape.\n"
            "5. If the server allows writes: write the glyph with set_glyph\n"
            "   (dry_run=True first), and use add_component + set_anchors when the\n"
            "   glyph should re-use an existing part.\n"
            "6. End with a checklist the designer can verify in Fontra."
        )

    @mcp.prompt()
    def audit_font(font: str) -> str:
        """Audit a font for consistency issues using the geometric analyzer."""
        return (
            f"Audit the font at '{font}'.\n"
            "1. Call open_font, then list_glyphs to see the glyph set.\n"
            "2. Call get_component_graph to see which glyphs share components.\n"
            "3. For a representative set (a, e, o, n, h, O, S, R, period, space),\n"
            "   call analyze_glyph and compare stem widths and overshoot.\n"
            "4. Call get_kerning to check pair coverage.\n"
            "5. Report: inconsistent stems, overshoot anomalies, missing kerning,\n"
            "   components that are duplicated instead of shared, and which glyphs\n"
            "   to fix first (highest impact first)."
        )

    @mcp.prompt()
    def component_workflow(
        font: str, glyphs: str = "n,o,H,O,I"
    ) -> str:
        """Start a component-based build from a set of foundation glyphs."""
        return (
            f"Start a component-based design in '{font}' from the glyphs {glyphs}.\n"
            "1. Call plan_workflow with those glyphs to get the ordered plan.\n"
            "2. For the first glyph: read its DNA and tips, design it, and write it\n"
            "   with set_glyph (dry_run=True, then dry_run=False). Give it anchors\n"
            "   with set_anchors so later glyphs can align to it.\n"
            "3. For every following glyph: copy_glyph from the closest relative,\n"
            "   add_component to place the re-used parts, adjust with set_glyph_layer,\n"
            "   and set_anchors for the new junctions.\n"
            "4. After each glyph: analyze_glyph for stem width and overshoot, and\n"
            "   compare against the foundation glyphs.\n"
            "5. Use find_glyphs_using / get_component_graph to prove the components\n"
            "   are shared, not redrawn.\n"
            "6. Report the plan status, the shared components, and what is still open."
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

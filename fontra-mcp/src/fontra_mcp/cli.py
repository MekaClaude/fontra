"""fontra-cli: command-line frontend over the same FontService as the MCP server.

Examples:
    fontra-cli --root test-common fonts list
    fontra-cli --root test-common glyph get MutatorSans.fontra A
    fontra-cli --root test-common glyph analyze MutatorSans.fontra A
    fontra-cli guide show A
    fontra-cli workflow plan n,o,H,O,I
    fontra-cli serve            # start the MCP server over stdio

All output is JSON on stdout (pretty-printed, or compact with --compact).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

from .service import FontService, FontServiceError
from .workflow import DEFAULT_START_GLYPHS, WorkflowPlanner


def _printJson(data, compact: bool) -> None:
    print(json.dumps(data, indent=None if compact else 2, ensure_ascii=False, default=str))


def _addFontArgs(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("font", help="Font path (absolute or relative to --root)")


def _loadGlyphPayload(args) -> dict:
    """Read a glyph payload from --data or --from-file, with a clear error."""
    if getattr(args, "data", None):
        try:
            return json.loads(args.data)
        except json.JSONDecodeError as e:
            raise FontServiceError(f"--data is not valid JSON: {e}") from e
    if getattr(args, "from_file", None):
        try:
            with open(args.from_file, encoding="utf-8") as f:
                return json.load(f)
        except OSError as e:
            raise FontServiceError(f"Cannot read --from-file {args.from_file!r}: {e}") from e
        except json.JSONDecodeError as e:
            raise FontServiceError(
                f"--from-file {args.from_file!r} is not valid JSON: {e}"
            ) from e
    raise FontServiceError(
        "glyph set needs a payload: pass --data '<json>' or --from-file <path>."
    )


def _parseTransform(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        raise FontServiceError(f"--transform is not valid JSON: {e}") from e


def _parseJsonObject(value: str | None, what: str) -> dict | None:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        raise FontServiceError(f"{what} is not valid JSON: {e}") from e


async def _run(args: argparse.Namespace) -> int:
    service = FontService(root=args.root)
    planner = WorkflowPlanner()
    try:
        if args.command == "fonts":
            result = service.listFonts(subdir=args.subdir, maxDepth=args.max_depth)
            _printJson(result, args.compact)
            return 0

        if args.command == "font":
            if args.subcommand == "open":
                _printJson(await service.openFont(args.font), args.compact)
            elif args.subcommand == "info":
                _printJson(await service.getFontInfo(args.font), args.compact)
            elif args.subcommand == "axes":
                _printJson(await service.getAxes(args.font), args.compact)
            elif args.subcommand == "upem":
                _printJson(await service.getUnitsPerEm(args.font), args.compact)
            elif args.subcommand == "glyphs":
                _printJson(await service.listGlyphs(args.font, maxGlyphs=args.max_glyphs), args.compact)
            elif args.subcommand == "kern":
                _printJson(await service.getKerning(args.font, maxPairs=args.max_pairs), args.compact)
            elif args.subcommand == "using":
                _printJson(await service.findGlyphsUsing(args.font, args.glyph), args.compact)
            elif args.subcommand == "sources":
                _printJson(await service.getSources(args.font), args.compact)
            elif args.subcommand == "components":
                _printJson(await service.getComponentGraph(args.font), args.compact)
            return 0

        if args.command == "glyph":
            if args.subcommand == "get":
                _printJson(await service.getGlyph(args.font, args.glyph), args.compact)
            elif args.subcommand == "full":
                _printJson(
                    await service.getGlyphFull(args.font, args.glyph, packed=args.packed),
                    args.compact,
                )
            elif args.subcommand == "analyze":
                metricLines = json.loads(args.metric_lines) if args.metric_lines else None
                _printJson(await service.analyzeGlyph(args.font, args.glyph, metricLines), args.compact)
            elif args.subcommand == "set":
                glyphData = _loadGlyphPayload(args)
                codepoints = (
                    [int(c) for c in args.codepoints.split(",") if c.strip()]
                    if args.codepoints
                    else None
                )
                _printJson(
                    await service.setGlyph(
                        args.font, args.glyph, glyphData,
                        codepoints=codepoints, dryRun=not args.write, mode=args.mode,
                    ),
                    args.compact,
                )
            elif args.subcommand == "layer":
                glyphData = _loadGlyphPayload(args)
                _printJson(
                    await service.setGlyphLayer(
                        args.font, args.glyph, args.layer, glyphData, dryRun=not args.write
                    ),
                    args.compact,
                )
            elif args.subcommand == "copy":
                codepoints = (
                    [int(c) for c in args.codepoints.split(",") if c.strip()]
                    if args.codepoints
                    else None
                )
                _printJson(
                    await service.copyGlyph(
                        args.font, args.source, args.glyph,
                        codepoints=codepoints, dryRun=not args.write,
                    ),
                    args.compact,
                )
            elif args.subcommand == "anchors":
                anchors = _loadGlyphPayload(args)
                if not isinstance(anchors, list):
                    raise FontServiceError("anchors must be a JSON list of anchor objects.")
                _printJson(
                    await service.setAnchors(
                        args.font, args.glyph, anchors,
                        layerName=args.layer, replaceExisting=not args.merge,
                        dryRun=not args.write,
                    ),
                    args.compact,
                )
            elif args.subcommand == "add-component":
                _printJson(
                    await service.addComponent(
                        args.font, args.glyph, args.component,
                        transformation=_parseTransform(args.transform),
                        layerName=args.layer,
                        location=_parseJsonObject(args.location, "--location"),
                        dryRun=not args.write,
                    ),
                    args.compact,
                )
            elif args.subcommand == "remove-component":
                _printJson(
                    await service.removeComponent(
                        args.font, args.glyph, args.component,
                        layerName=args.layer, dryRun=not args.write,
                    ),
                    args.compact,
                )
            elif args.subcommand == "decompose":
                _printJson(
                    await service.decomposeGlyph(
                        args.font, args.glyph, layerName=args.layer, dryRun=not args.write
                    ),
                    args.compact,
                )
            elif args.subcommand == "interpolate":
                _printJson(
                    await service.interpolateGlyph(
                        args.font, args.glyph, args.layer_a, args.layer_b, args.factor,
                        newLayerName=args.new_layer,
                        location=_parseJsonObject(args.location, "--location"),
                        dryRun=not args.write,
                    ),
                    args.compact,
                )
            elif args.subcommand == "add-source":
                _printJson(
                    await service.addSource(
                        args.font, args.glyph, args.source,
                        location=_parseJsonObject(args.location, "--location"),
                        layerName=args.layer, baseLayer=args.base_layer,
                        dryRun=not args.write,
                    ),
                    args.compact,
                )
            return 0

        if args.command == "kern":
            pairs = _loadGlyphPayload(args)
            _printJson(
                await service.setKerning(
                    args.font, pairs,
                    sourceIdentifier=args.source_identifier,
                    dryRun=not args.write,
                ),
                args.compact,
            )
            return 0

        if args.command == "guide":
            if args.subcommand == "show":
                _printJson(service.getGlyphTips(args.glyph), args.compact)
            elif args.subcommand == "phase":
                _printJson(service.getDesignPhase(args.glyph), args.compact)
            elif args.subcommand == "phases":
                _printJson(service.getDesignPhases(), args.compact)
            elif args.subcommand == "advice":
                _printJson(service.getProAdvice(args.glyph), args.compact)
            elif args.subcommand == "corrections":
                _printJson(service.getOpticalCorrections(args.glyph), args.compact)
            elif args.subcommand == "mistakes":
                _printJson(service.getCommonMistakes(args.glyph), args.compact)
            elif args.subcommand == "spacing":
                _printJson(service.getSpacingPrinciples(), args.compact)
            elif args.subcommand == "term":
                _printJson(service.getTermDefinition(args.term), args.compact)
            elif args.subcommand == "terms":
                _printJson(service.getAllTerms(), args.compact)
            elif args.subcommand == "components":
                _printJson(service.getComponentCatalog(), args.compact)
            elif args.subcommand == "all-components":
                _printJson(service.getAllComponents(), args.compact)
            elif args.subcommand == "glyph-components":
                _printJson(service.getComponents(args.glyph), args.compact)
            elif args.subcommand == "suggestions":
                _printJson(service.getSuggestions(args.glyph), args.compact)
            elif args.subcommand == "cards":
                _printJson(service.getCards(args.glyph), args.compact)
            elif args.subcommand == "info-cards":
                _printJson(service.getInfoCards(args.glyph), args.compact)
            elif args.subcommand == "acceleration":
                _printJson(service.getAccelerationTips(args.glyph), args.compact)
            elif args.subcommand == "related":
                _printJson(service.getRelatedGlyphs(args.glyph), args.compact)
            elif args.subcommand == "dna":
                _printJson(planner.glyphDNA(args.glyph), args.compact)
            return 0

        if args.command == "workflow":
            if args.subcommand == "plan":
                names = (
                    [g.strip() for g in args.glyphs.split(",") if g.strip()]
                    if args.glyphs
                    else list(DEFAULT_START_GLYPHS)
                )
                _printJson(planner.plan(names), args.compact)
            return 0

        if args.command == "serve":
            from .server import buildServer

            buildServer(service).run(transport="stdio")
            return 0
    finally:
        await service.aclose()

    raise FontServiceError(f"Unknown command: {args.command}")


def buildParser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fontra-cli", description="Fontra MCP CLI")
    parser.add_argument(
        "--root",
        default=os.environ.get("FONTRA_MCP_ROOT") or os.getcwd(),
        help="Sandbox root for font files (default: %(default)s)",
    )
    parser.add_argument("--compact", action="store_true", help="Compact JSON output")
    sub = parser.add_subparsers(dest="command", required=True)

    pFonts = sub.add_parser("fonts", help="List font projects under the root")
    pFonts.add_argument("--subdir", default=None, help="Limit listing to a subdirectory")
    pFonts.add_argument("--max-depth", type=int, default=3)

    pFont = sub.add_parser("font", help="Font-level queries")
    fsub = pFont.add_subparsers(dest="subcommand", required=True)
    for name in ("open", "info", "axes", "upem"):
        p = fsub.add_parser(name)
        _addFontArgs(p)
    p = fsub.add_parser("glyphs")
    _addFontArgs(p)
    p.add_argument("--max-glyphs", type=int, default=500)
    p = fsub.add_parser("kern")
    _addFontArgs(p)
    p.add_argument("--max-pairs", type=int, default=200)
    p = fsub.add_parser("using")
    _addFontArgs(p)
    p.add_argument("glyph")
    p = fsub.add_parser("sources")
    _addFontArgs(p)
    p = fsub.add_parser("components")
    _addFontArgs(p)

    pGlyph = sub.add_parser("glyph", help="Glyph queries")
    gsub = pGlyph.add_subparsers(dest="subcommand", required=True)
    for name in ("get", "full"):
        p = gsub.add_parser(name)
        _addFontArgs(p)
        p.add_argument("glyph")
    p = gsub.choices["full"]
    p.add_argument("--packed", action="store_true", help="Return the packed point representation")
    p = gsub.add_parser("analyze")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument(
        "--metric-lines",
        default=None,
        help='JSON dict of metric line name -> y, e.g. \'{"baseline": 0, "x-height": 700}\'',
    )

    p = gsub.add_parser("set", help="Create or replace a whole glyph")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("--data", default=None, help="Glyph as inline JSON (VariableGlyph shape)")
    p.add_argument("--from-file", default=None, help="Glyph JSON file path")
    p.add_argument("--codepoints", default=None, help="Comma-separated codepoints, e.g. '110'")
    p.add_argument(
        "--mode",
        default="replace",
        choices=("replace", "merge"),
        help="'replace' rewrites the whole glyph, 'merge' keeps the other masters",
    )
    p.add_argument(
        "--write",
        action="store_true",
        help="Actually write (default is dry-run) — also requires FONTRA_MCP_ALLOW_WRITES=1",
    )

    p = gsub.add_parser("layer", help="Replace one layer (master) of a glyph")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("layer")
    p.add_argument("--data", default=None, help="StaticGlyph as inline JSON")
    p.add_argument("--from-file", default=None, help="StaticGlyph JSON file path")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("copy", help="Copy a glyph to a new name")
    _addFontArgs(p)
    p.add_argument("source")
    p.add_argument("glyph")
    p.add_argument("--codepoints", default=None, help="Comma-separated codepoints")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("anchors", help="Set or merge the anchors of a layer")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("--data", default=None, help="JSON list of anchors")
    p.add_argument("--from-file", default=None, help="JSON file with a list of anchors")
    p.add_argument("--layer", default=None, help="Layer name (default: the default layer)")
    p.add_argument("--merge", action="store_true", help="Merge instead of replacing")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("add-component", help="Add a component to a glyph")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("component")
    p.add_argument("--transform", default=None, help='DecomposedTransform JSON, e.g. \'{"translateX": 100}\'')
    p.add_argument("--layer", default=None, help="Layer name (default: the default layer)")
    p.add_argument("--location", default=None, help='Axis location JSON for a variable component')
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("remove-component", help="Remove a component from a glyph")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("component")
    p.add_argument("--layer", default=None, help="Layer name (default: the default layer)")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("decompose", help="Flatten the components of a glyph into outlines")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("--layer", default=None, help="Layer name (default: the default layer)")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("interpolate", help="Create an interpolated master between two layers")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("layer_a")
    p.add_argument("layer_b")
    p.add_argument("factor", type=float, help="0.0 = layer_a, 1.0 = layer_b")
    p.add_argument("--new-layer", default=None, help="Name of the new layer")
    p.add_argument("--location", default=None, help="Axis location JSON for the new master")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    p = gsub.add_parser("add-source", help="Add a new master (source + layer) to a glyph")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("source")
    p.add_argument("--location", default=None, help="Axis location JSON, e.g. '{\"wght\": 700}'")
    p.add_argument("--layer", default=None, help="Name of the new layer")
    p.add_argument("--base-layer", default=None, help="Layer to copy the new master from")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    pKern = sub.add_parser("kern", help="Set kerning pairs")
    _addFontArgs(pKern)
    pKern.add_argument("--data", default=None, help='Kerning pairs JSON: {"A / V": -75} or a list')
    pKern.add_argument("--from-file", default=None, help="Kerning pairs JSON file")
    pKern.add_argument("--source-identifier", default=None, help="Master the values belong to")
    pKern.add_argument("--write", action="store_true", help="Actually write (default is dry-run)")

    pGuide = sub.add_parser("guide", help="Design-guide queries (font-independent)")
    ksub = pGuide.add_subparsers(dest="subcommand", required=True)
    for name in (
        "show",
        "phase",
        "advice",
        "corrections",
        "mistakes",
        "related",
        "suggestions",
        "cards",
        "info-cards",
        "acceleration",
        "glyph-components",
        "dna",
    ):
        p = ksub.add_parser(name)
        p.add_argument("glyph")
    ksub.add_parser("phases")
    ksub.add_parser("spacing")
    ksub.add_parser("terms")
    ksub.add_parser("components")
    ksub.add_parser("all-components")
    p = ksub.add_parser("term")
    p.add_argument("term")

    pWorkflow = sub.add_parser("workflow", help="Component-workflow planning")
    wsub = pWorkflow.add_subparsers(dest="subcommand", required=True)
    p = wsub.add_parser("plan")
    p.add_argument(
        "glyphs",
        nargs="?",
        default=None,
        help="Comma-separated starting glyphs (default: %s)" % ",".join(DEFAULT_START_GLYPHS),
    )

    sub.add_parser("serve", help="Run the MCP server over stdio")
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = buildParser()
    args = parser.parse_args(argv)
    try:
        code = asyncio.run(_run(args))
    except FontServiceError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main(sys.argv[1:])

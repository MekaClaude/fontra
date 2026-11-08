"""fontra-cli: command-line frontend over the same FontService as the MCP server.

Examples:
    fontra-cli --root test-common fonts list
    fontra-cli --root test-common glyph get MutatorSans.fontra A
    fontra-cli --root test-common glyph analyze MutatorSans.fontra A
    fontra-cli guide show A
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


def _printJson(data: dict, compact: bool) -> None:
    print(json.dumps(data, indent=None if compact else 2, ensure_ascii=False, default=str))


def _addFontArgs(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("font", help="Font path (absolute or relative to --root)")


async def _run(args: argparse.Namespace) -> int:
    service = FontService(root=args.root)
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
            return 0

        if args.command == "glyph":
            if args.subcommand == "get":
                _printJson(await service.getGlyph(args.font, args.glyph), args.compact)
            elif args.subcommand == "full":
                _printJson(await service.getGlyphFull(args.font, args.glyph), args.compact)
            elif args.subcommand == "analyze":
                metricLines = json.loads(args.metric_lines) if args.metric_lines else None
                _printJson(await service.analyzeGlyph(args.font, args.glyph, metricLines), args.compact)
            elif args.subcommand == "set":
                glyphData = json.loads(args.data) if args.data else json.loads(args.from_file and open(args.from_file, encoding="utf-8").read())
                codepoints = [int(c) for c in args.codepoints.split(",") if c.strip()] if args.codepoints else None
                _printJson(
                    await service.setGlyph(
                        args.font, args.glyph, glyphData,
                        codepoints=codepoints, dryRun=not args.write,
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
            elif args.subcommand == "components":
                _printJson(service.getComponentCatalog(), args.compact)
            elif args.subcommand == "related":
                _printJson(service.getRelatedGlyphs(args.glyph), args.compact)
            return 0

        if args.command == "serve":
            from .server import buildServer

            buildServer(service).run(transport="stdio")
            return 0
    finally:
        await service.aclose()

    raise FontServiceError(f"Unknown command: {args.command}")


def buildParser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fontra-cli", description="Fontra MCP CLI (read-only)")
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

    pGlyph = sub.add_parser("glyph", help="Glyph queries")
    gsub = pGlyph.add_subparsers(dest="subcommand", required=True)
    for name in ("get", "full"):
        p = gsub.add_parser(name)
        _addFontArgs(p)
        p.add_argument("glyph")
    p = gsub.add_parser("analyze")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument(
        "--metric-lines",
        default=None,
        help='JSON dict of metric line name -> y, e.g. \'{"baseline": 0, "x-height": 700}\'',
    )
    p = gsub.add_parser("set")
    _addFontArgs(p)
    p.add_argument("glyph")
    p.add_argument("--data", default=None, help="Glyph as inline JSON (VariableGlyph shape)")
    p.add_argument("--from-file", default=None, help="Glyph JSON file path")
    p.add_argument("--codepoints", default=None, help="Comma-separated codepoints, e.g. '110'")
    p.add_argument("--write", action="store_true", help="Actually write (default is dry-run)" +
              " — also requires FONTRA_MCP_ALLOW_WRITES=1")

    pGuide = sub.add_parser("guide", help="Design-guide queries (font-independent)")
    ksub = pGuide.add_subparsers(dest="subcommand", required=True)
    for name in ("show", "phase", "advice", "corrections", "mistakes", "related"):
        p = ksub.add_parser(name)
        p.add_argument("glyph")
    ksub.add_parser("phases")
    ksub.add_parser("spacing")
    p = ksub.add_parser("term")
    p.add_argument("term")
    ksub.add_parser("components")

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

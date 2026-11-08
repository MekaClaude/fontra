"""Shared service layer for the Fontra MCP server and CLI.

This module opens fonts *in-process* through Fontra's own backend layer
(`fontra.backends.getFileSystemBackend`) and the same `FontHandler` the
Fontra server uses, so agents see exactly the data the editor sees
(UFO, .designspace, .fontra, TTF/OTF, TTX, WOFF/WOFF2, workflow YAML).

All operations are read-only unless writes are explicitly enabled with
FONTRA_MCP_ALLOW_WRITES=1 (then `set_glyph` is available).

Font paths are sandboxed to configured roots (path-traversal guarded).
FONTRA_MCP_ROOT (or --root) may hold multiple roots separated by the OS
path separator (';' on Windows): relative paths resolve against the
first root that contains them; absolute paths must be under one root.

Output is summarized by default so responses stay small enough for an
LLM context window; full glyph outlines are opt-in via `get_glyph_full`.
"""

from __future__ import annotations

import os
import pathlib
from dataclasses import asdict
from typing import Any

from fontra.backends import getFileSystemBackend
from fontra.core import design_guide, glyph_analysis
from fontra.core.classes import VariableGlyph, structure, unstructure
from fontra.core.fonthandler import FontHandler
from fontra.core.protocols import WritableFontBackend

# Mirror of the extensions registered via the `fontra.filesystem.backends`
# entry points in the root pyproject.toml.
SUPPORTED_EXTENSIONS = {
    ".designspace",
    ".ufo",
    ".ttf",
    ".otf",
    ".ttx",
    ".woff",
    ".woff2",
    ".fontra",
    ".yaml",
}

DEFAULT_MAX_GLYPHS = 500
DEFAULT_MAX_KERN_PAIRS = 200
DEFAULT_MAX_DEPTH = 3


class FontServiceError(RuntimeError):
    """Raised for any service-level error (bad path, unknown font, ...)."""


class _MetaStub:
    """Minimal MetaInfoProvider placeholder (unused for read-only ops)."""

    async def getMetaInfo(self, projectIdentifier: str, analysisToken: str) -> dict:
        return {
            "projectName": projectIdentifier.split("/")[-1],
            "projectIdentifier": projectIdentifier,
        }

    async def putMetaInfo(self, projectIdentifier: str, metaInfo: Any, analysisToken: str) -> None:
        raise FontServiceError("Fontra MCP server is read-only.")


def _iterFonts(folderPath: pathlib.Path, maxDepth: int):
    if maxDepth <= 0:
        return
    try:
        children = sorted(folderPath.iterdir())
    except (PermissionError, OSError):
        return
    for childPath in children:
        if childPath.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield childPath
        elif childPath.is_dir():
            yield from _iterFonts(childPath, maxDepth - 1)


def _summarizeKerning(kerning: dict, maxPairs: int) -> dict:
    """Bound the size of a kerning structure for LLM contexts."""
    out: dict[str, Any] = {}
    pairCount = 0
    for sourceIdentifier, kern in (kerning or {}).items():
        values: dict[str, Any] = {}
        for left, rightMap in ((kern.values or {}).items()):
            for right, value in (rightMap or {}).items():
                if pairCount >= maxPairs:
                    break
                values[f"{left} / {right}"] = value
                pairCount += 1
            if pairCount >= maxPairs:
                break
        out[sourceIdentifier] = {
            "groupsSide1": kern.groupsSide1,
            "groupsSide2": kern.groupsSide2,
            "values": values,
        }
        if pairCount >= maxPairs:
            break
    return {"pairsShown": pairCount, "truncated": pairCount >= maxPairs, "sources": out}


def _summarizeGlyph(variableGlyph) -> dict:
    """Compact summary of a VariableGlyph (no full contour data)."""
    layersSummary = {}
    for layerName, layer in variableGlyph.layers.items():
        sg = layer.glyph
        path = sg.path
        bounds = path.getControlBounds() if hasattr(path, "getControlBounds") else None
        layersSummary[layerName] = {
            "xAdvance": sg.xAdvance,
            "yAdvance": sg.yAdvance,
            "anchors": [a.name for a in (sg.anchors or [])],
            "guidelines": len(sg.guidelines or []),
            "components": [c.name for c in (sg.components or [])],
            "numContours": len(getattr(path, "contourInfo", []) or []),
            "numPoints": len(getattr(path, "pointTypes", []) or []),
            "bounds": list(bounds) if bounds else None,
        }
    return {
        "name": variableGlyph.name,
        "axes": [
            {"name": a.name, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue}
            for a in (variableGlyph.axes or [])
        ],
        "sources": [
            {"name": s.name, "layerName": s.layerName, "location": s.location, "inactive": s.inactive}
            for s in (variableGlyph.sources or [])
        ],
        "layers": layersSummary,
        "customData": variableGlyph.customData or {},
    }


class FontService:
    """Async access to font files through Fontra's backends.

    Reads always work. Writes (set_glyph) are gated by the
    FONTRA_MCP_ALLOW_WRITES=1 environment variable so an MCP server can
    be configured read-only by default and opt into writes per config.
    """

    def __init__(self, root: str | pathlib.Path | None = None, writesAllowed: bool | None = None):
        envRoot = os.environ.get("FONTRA_MCP_ROOT")
        projectRoot = root or envRoot or os.getcwd()
        # Multiple roots, separated by the OS path separator (';' on Windows).
        entries = [e for e in str(projectRoot).split(os.pathsep) if e.strip()]
        self.roots = [pathlib.Path(e).expanduser().resolve() for e in entries] or [pathlib.Path(os.getcwd()).resolve()]
        for r in self.roots:
            if not r.is_dir():
                raise FontServiceError(f"Fontra MCP root does not exist: {r}")
        self.root = self.roots[0]
        self.writesAllowed = (
            writesAllowed if writesAllowed is not None
            else os.environ.get("FONTRA_MCP_ALLOW_WRITES") == "1"
        )
        self._handlers: dict[str, FontHandler] = {}

    # ------------------------------------------------------------------
    # Paths / sandboxing
    # ------------------------------------------------------------------

    @staticmethod
    def _isUnder(path: pathlib.Path, root: pathlib.Path) -> bool:
        return root == path or root in path.parents

    def _containingRoot(self, path: pathlib.Path) -> pathlib.Path | None:
        for r in self.roots:
            if self._isUnder(path, r):
                return r
        return None

    def _resolveFontPath(self, font: str) -> pathlib.Path:
        """Resolve `font` (absolute or root-relative) to a real font file.

        Rejects paths that escape the configured roots, mirroring the
        path-traversal guard in `fontra.core.server.staticContentHandler`.
        Relative paths resolve against the first root that contains the file.
        """
        if not font:
            raise FontServiceError("No font path given.")
        candidate = pathlib.Path(font)
        if "\\" in font or "\x00" in font:
            raise FontServiceError(f"Invalid font path: {font!r}")
        resolved: pathlib.Path | None = None
        if candidate.is_absolute():
            resolved = pathlib.Path(os.path.normpath(candidate)).resolve()
            if self._containingRoot(resolved) is None:
                raise FontServiceError(f"Font path escapes the MCP roots: {font!r}")
        else:
            for r in self.roots:
                c = pathlib.Path(os.path.normpath(r / candidate))
                if self._isUnder(c, r) and c.exists():
                    resolved = c.resolve()
                    break
            if resolved is None:
                # Re-run the containment check for the standard error message.
                first = pathlib.Path(os.path.normpath(self.roots[0] / candidate))
                if not self._isUnder(first, self.roots[0]):
                    raise FontServiceError(f"Invalid relative font path: {font!r}")
                resolved = first.resolve()
        if resolved.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise FontServiceError(
                f"Unsupported font file type '{resolved.suffix}'; "
                f"expected one of {sorted(SUPPORTED_EXTENSIONS)}"
            )
        if not resolved.exists():
            raise FontServiceError(f"Font not found: {resolved}")
        return resolved

    def _fontId(self, fontPath: pathlib.Path) -> str:
        for r in self.roots:
            if self._isUnder(fontPath, r):
                return fontPath.relative_to(r).as_posix()
        return fontPath.as_posix()

    def _getHandler(self, font: str) -> FontHandler:
        fontPath = self._resolveFontPath(font)
        handler = self._handlers.get(str(fontPath))
        if handler is None:
            backend = getFileSystemBackend(fontPath)
            handler = FontHandler(
                backend=backend,
                projectIdentifier=str(fontPath),
                metaInfoProvider=_MetaStub(),
                readOnly=not self.writesAllowed,
            )
            self._handlers[str(fontPath)] = handler
        return handler

    async def aclose(self) -> None:
        for handler in self._handlers.values():
            try:
                await handler.aclose()
            except Exception:
                pass
        self._handlers.clear()

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def listFonts(self, subdir: str | None = None, maxDepth: int = DEFAULT_MAX_DEPTH) -> dict:
        if not subdir:
            bases = self.roots
        else:
            bases = [self._resolveDir(subdir)]
        fonts = []
        for base in bases:
            for fontPath in _iterFonts(base, maxDepth):
                fonts.append(
                    {
                        "id": self._fontId(fontPath),
                        "path": str(fontPath),
                        "suffix": fontPath.suffix.lower(),
                        "name": fontPath.stem,
                    }
                )
        fonts.sort(key=lambda f: f["id"])
        return {"roots": [str(r) for r in self.roots], "count": len(fonts), "fonts": fonts}

    def _resolveDir(self, subdir: str) -> pathlib.Path:
        if "\\" in subdir or "\x00" in subdir:
            raise FontServiceError(f"Invalid directory: {subdir!r}")
        candidate = pathlib.Path(subdir)
        if candidate.is_absolute():
            resolved = candidate.resolve()
            if self._containingRoot(resolved) is None:
                raise FontServiceError(f"Directory escapes the MCP roots: {subdir!r}")
        else:
            resolved = None
            for r in self.roots:
                c = (r / candidate).resolve()
                if r == c or r in c.parents:
                    if c.is_dir():
                        resolved = c
                        break
                else:
                    raise FontServiceError(f"Invalid relative directory: {subdir!r}")
            if resolved is None:
                raise FontServiceError(f"Directory not found under the MCP roots: {subdir!r}")
        if not resolved.is_dir():
            raise FontServiceError(f"Not a directory: {resolved}")
        return resolved

    # ------------------------------------------------------------------
    # Font-level reads
    # ------------------------------------------------------------------

    async def openFont(self, font: str) -> dict:
        handler = self._getHandler(font)
        glyphMap = await handler.getGlyphMap()
        fontInfo = await handler.getFontInfo()
        axes = await handler.getAxes()
        return {
            "id": self._fontId(handler.backend and self._resolveFontPath(font)),
            "familyName": fontInfo.familyName,
            "unitsPerEm": await handler.getUnitsPerEm(),
            "glyphCount": len(glyphMap),
            "axes": [
                {"name": a.name, "tag": getattr(a, "tag", None)}
                for a in (axes.axes or [])
            ],
            "readOnly": True,
        }

    async def listGlyphs(self, font: str, maxGlyphs: int = DEFAULT_MAX_GLYPHS) -> dict:
        handler = self._getHandler(font)
        glyphMap = await handler.getGlyphMap()
        names = sorted(glyphMap.keys())
        shown = names[:maxGlyphs]
        return {
            "font": font,
            "codepoints": {name: glyphMap[name] for name in shown},
            "count": len(names),
            "truncated": len(names) > len(shown),
        }

    async def getGlyph(self, font: str, glyphName: str) -> dict:
        handler = self._getHandler(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        return _summarizeGlyph(glyph)

    async def getGlyphFull(self, font: str, glyphName: str) -> dict:
        """Full structured glyph (all contour coordinates, components, ...)."""
        handler = self._getHandler(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        return unstructure(glyph)

    async def getFontInfo(self, font: str) -> dict:
        return unstructure(await self._getHandler(font).getFontInfo())

    async def getAxes(self, font: str) -> dict:
        axes = await self._getHandler(font).getAxes()
        return {
            "axes": [
                {
                    "name": a.name,
                    "tag": getattr(a, "tag", None),
                    "minValue": getattr(a, "minValue", None),
                    "defaultValue": getattr(a, "defaultValue", None),
                    "maxValue": getattr(a, "maxValue", None),
                }
                for a in (axes.axes or [])
            ],
            "mappings": chainDicts(axes.mappings or []),
            "elidedFallBackname": axes.elidedFallBackname,
        }

    async def getUnitsPerEm(self, font: str) -> dict:
        return {"unitsPerEm": await self._getHandler(font).getUnitsPerEm()}

    async def getGlyphInfos(self, font: str) -> dict:
        infos = await self._getHandler(font).getGlyphInfos()
        return infos if isinstance(infos, dict) else {"glyphInfos": infos}

    async def getKerning(self, font: str, maxPairs: int = DEFAULT_MAX_KERN_PAIRS) -> dict:
        kerning = await self._getHandler(font).getKerning()
        return {"font": font, **_summarizeKerning(kerning, maxPairs)}

    async def findGlyphsUsing(self, font: str, glyphName: str) -> dict:
        handler = self._getHandler(font)
        if not hasattr(handler.backend, "findGlyphsThatUseGlyph"):
            return {"font": font, "glyph": glyphName, "supported": False, "glyphs": []}
        return {
            "font": font,
            "glyph": glyphName,
            "supported": True,
            "glyphs": sorted(await handler.findGlyphsThatUseGlyph(glyphName)),
        }

    # ------------------------------------------------------------------
    # Writes (gated by FONTRA_MCP_ALLOW_WRITES=1)
    # ------------------------------------------------------------------

    async def setGlyph(
        self,
        font: str,
        glyphName: str,
        glyphData: dict,
        codepoints: list[int] | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Create or replace a whole glyph (entire VariableGlyph payload).

        Writes go through Fontra's own backend `putGlyph` — the exact
        path the editor server uses. The FontHandler caches are refreshed
        afterwards so subsequent reads in this session see the new data.

        Gated by the FONTRA_MCP_ALLOW_WRITES=1 environment variable.
        With `dryRun=True` (default) the payload is validated and
        summarized without touching the file.
        """
        if not self.writesAllowed:
            raise FontServiceError(
                "Writes are disabled. Restart the Fontra MCP server with "
                "FONTRA_MCP_ALLOW_WRITES=1 to enable set_glyph."
            )
        if not glyphData or not isinstance(glyphData, dict):
            raise FontServiceError("glyphData must be a structured VariableGlyph object.")
        glyph = structure(glyphData, VariableGlyph)
        glyph.name = glyphName

        fontPath = self._resolveFontPath(font)
        handler = self._getHandler(font)
        backend = handler.writableBackend
        if backend is None:
            raise FontServiceError(f"Backend for {fontPath!s} does not support writing.")

        glyphMap = await handler.getGlyphMap()
        codepoints = list(codepoints) if codepoints is not None else list(glyphMap.get(glyphName, []))

        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "codepoints": codepoints,
            "layers": list((glyph.layers or {}).keys()) or list((glyphData.get("layers") or {}).keys()),
            "summary": _summarizeGlyph(glyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result

        await backend.putGlyph(glyphName, glyph, codepoints)
        if hasattr(backend, "flush"):
            backend.flush()
        # Keep the shared FontHandler caches coherent for this session.
        handler.localData[("glyphs", glyphName)] = glyph
        if handler.glyphMap is not None:
            handler.glyphMap[glyphName] = codepoints
        handler.localData["glyphMap"] = handler.glyphMap if handler.glyphMap is not None else {
            **glyphMap,
            glyphName: codepoints,
        }
        result["written"] = True
        return result

    # ------------------------------------------------------------------
    # Writes (gated by FONTRA_MCP_ALLOW_WRITES=1)
    # ------------------------------------------------------------------

    async def setGlyph(
        self,
        font: str,
        glyphName: str,
        glyphData: dict,
        codepoints: list[int] | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Write a whole glyph (create or replace) through the writable backend.

        `glyphData` is the same structured shape `getGlyphFull` returns
        (VariableGlyph JSON). With `dryRun=True` (default) nothing is
        written: the glyph is validated and summarized instead.
        """
        if not self.writesAllowed:
            raise FontServiceError(
                "Writes are disabled. Start the Fontra MCP server with "
                "FONTRA_MCP_ALLOW_WRITES=1 to enable set_glyph."
            )
        glyph = structure(glyphData, VariableGlyph)
        glyph.name = glyphName
        handler = self._getHandler(font)
        backend = handler.writableBackend
        if backend is None:
            raise FontServiceError(
                f"Backend for {font!r} does not support writing."
            )
        glyphMap = await handler.getGlyphMap()
        glyphMap = dict(glyphMap)
        cps: list[int] = (
            list(codepoints) if codepoints is not None else list(glyphMap.get(glyphName, []))
        )
        result = {
            "font": self._fontId(self._resolveFontPath(font)),
            "glyph": glyphName,
            "codepoints": cps,
            "summary": _summarizeGlyph(glyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await backend.putGlyph(glyphName, glyph, cps)
        if hasattr(backend, "flush"):
            backend.flush()
        # Keep the FontHandler caches coherent with what we just wrote.
        handler.localData[("glyphs", glyphName)] = glyph
        handler.glyphMap[glyphName] = cps
        handler.localData["glyphMap"] = handler.glyphMap
        result["written"] = True
        return result

    # ------------------------------------------------------------------
    # Analysis + design guidance (reuses fork modules)
    # ------------------------------------------------------------------

    @staticmethod
    def _getDefaultPackedPath(glyph):
        from fontra.core.path import PackedPath

        for layer in glyph.layers.values():
            path = layer.glyph.path
            if isinstance(path, PackedPath):
                return path
            if hasattr(path, "asPackedPath"):
                return path.asPackedPath()
        return None

    async def analyzeGlyph(
        self, font: str, glyphName: str, metricLines: dict | None = None
    ) -> dict:
        handler = self._getHandler(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        packedPath = self._getDefaultPackedPath(glyph)
        if packedPath is None:
            return {"glyph": glyphName, "analyzed": False, "reason": "no path in default layer"}
        analysis = glyph_analysis.analyze_glyph(
            packedPath, glyph_name=glyphName, metric_lines=metricLines
        )
        return asdict(analysis)

    # The design guide is font-independent knowledge; expose the useful bits.

    def getGlyphTips(self, glyphName: str) -> dict:
        tips = design_guide.get_glyph_tips(glyphName)
        return unstructure(tips)

    def getDesignPhase(self, glyphName: str) -> dict:
        phase = design_guide.get_design_phase(glyphName)
        return unstructure(phase) if phase is not None else {"glyph": glyphName, "phase": None}

    def getDesignPhases(self) -> dict:
        return {"phases": unstructure(design_guide.get_design_phases())}

    def getProAdvice(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "proTips": design_guide.get_pro_tips(glyphName)}

    def getOpticalCorrections(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "corrections": unstructure(design_guide.get_optical_corrections(glyphName))}

    def getCommonMistakes(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "mistakes": design_guide.get_common_mistakes(glyphName)}

    def getSpacingPrinciples(self) -> dict:
        return design_guide.get_spacing_principles()

    def getTermDefinition(self, term: str) -> dict:
        return {"term": term, "definition": design_guide.get_term_definition(term)}

    def getComponentCatalog(self) -> dict:
        return design_guide.get_component_catalog()

    def getRelatedGlyphs(self, glyphName: str) -> dict:
        return design_guide.get_related_glyphs(glyphName)


def chainDicts(items: list | tuple) -> list:
    return [unstructure(i) for i in items]

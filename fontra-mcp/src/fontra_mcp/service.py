"""Shared service layer for the Fontra MCP server and CLI.

This module opens fonts *in-process* through Fontra's own backend layer
(`fontra.backends.getFileSystemBackend`) and the same `FontHandler` the
Fontra server uses, so agents see exactly the data the editor sees
(UFO, .designspace, .fontra, TTF/OTF, TTX, WOFF/WOFF2, workflow YAML).

Reads always work. Writes are gated behind `FONTRA_MCP_ALLOW_WRITES=1`
(or `FontService(root=..., writesAllowed=True)`); even then every write
tool defaults to `dryRun=True`, which validates and summarizes the
payload without touching the file.

Font paths are sandboxed to configured roots (path-traversal guarded).
FONTRA_MCP_ROOT (or --root) may hold multiple roots separated by the OS
path separator (';' on Windows): relative paths resolve against the
first root that contains them; absolute paths must be under one root.
Windows paths (`D:\\DESIGN\\...`) are accepted as-is.

Output is summarized by default so responses stay small enough for an
LLM context window; full glyph outlines are opt-in via `get_glyph_full`.
"""

from __future__ import annotations

import copy
import os
import pathlib
import uuid
from dataclasses import asdict, replace
from typing import Any

from fontra.backends import getFileSystemBackend
from fontra.core import design_guide, glyph_analysis
from fontra.core.classes import (
    Anchor,
    Component,
    FontSource,
    GlyphSource,
    Kerning,
    Layer,
    StaticGlyph,
    VariableGlyph,
    structure,
    unstructure,
)
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

# Kerning table key used when a font does not have a kerning table yet.
DEFAULT_KERN_TABLE = "kern"


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
    """Bound the size of a kerning structure for LLM contexts.

    `Kerning.values` is `left -> right -> [value per source]`: the inner
    list holds one entry per entry in `Kerning.sourceIdentifiers`, *not*
    a single scalar. Flattening it the wrong way reports pairs as
    `[-75, None, -215]`, which reads like garbage to an agent.
    """
    out: dict[str, Any] = {}
    pairCount = 0
    truncated = False
    for sourceIdentifier, kern in (kerning or {}).items():
        values: dict[str, Any] = {}
        for left, rightMap in (kern.values or {}).items():
            for right, sourceValues in (rightMap or {}).items():
                if pairCount >= maxPairs:
                    truncated = True
                    break
                key = f"{left} / {right}"
                if isinstance(sourceValues, (list, tuple)):
                    values[key] = list(sourceValues)
                else:
                    values[key] = [sourceValues]
                pairCount += 1
            if truncated:
                break
        out[sourceIdentifier] = {
            "groupsSide1": kern.groupsSide1,
            "groupsSide2": kern.groupsSide2,
            "sourceIdentifiers": list(kern.sourceIdentifiers or []),
            "values": values,
        }
        if truncated:
            break
    return {
        "pairsShown": pairCount,
        "truncated": truncated,
        "sources": out,
        "note": (
            "Each pair value is a list with one entry per source, in the "
            "order of 'sourceIdentifiers'."
        ),
    }


def _asPackedPath(path):
    """Return a PackedPath for any path flavour (Path or PackedPath)."""
    if path is None:
        return None
    if hasattr(path, "asPackedPath"):
        return path.asPackedPath()
    return path


def _summarizeGlyph(variableGlyph) -> dict:
    """Compact summary of a VariableGlyph (no full contour data)."""
    layersSummary = {}
    for layerName, layer in variableGlyph.layers.items():
        sg = layer.glyph
        packedPath = _asPackedPath(sg.path)
        bounds = packedPath.getControlBounds() if packedPath is not None else None
        layersSummary[layerName] = {
            "xAdvance": sg.xAdvance,
            "yAdvance": sg.yAdvance,
            "anchors": [a.name for a in (sg.anchors or [])],
            "guidelines": len(sg.guidelines or []),
            "components": [
                {
                    "name": c.name,
                    "location": dict(c.location or {}),
                    "transformation": unstructure(c.transformation),
                }
                for c in (sg.components or [])
            ],
            "numContours": len(getattr(packedPath, "contourInfo", []) or []),
            "numPoints": len(getattr(packedPath, "pointTypes", []) or []),
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


def _interpolateTransform(a, b, factor: float):
    """Linearly interpolate two DecomposedTransforms."""
    def lerp(name: str, default: float) -> float:
        av = getattr(a, name, default)
        bv = getattr(b, name, default)
        return av + (bv - av) * factor

    return type(a)(
        translateX=lerp("translateX", 0),
        translateY=lerp("translateY", 0),
        rotation=lerp("rotation", 0),
        scaleX=lerp("scaleX", 1),
        scaleY=lerp("scaleY", 1),
        skewX=lerp("skewX", 0),
        skewY=lerp("skewY", 0),
        tCenterX=lerp("tCenterX", 0),
        tCenterY=lerp("tCenterY", 0),
    )


def _interpolatePackedPaths(a, b, factor: float):
    """Linearly interpolate two compatible PackedPaths."""
    if len(a.coordinates) != len(b.coordinates):
        raise FontServiceError(
            "Cannot interpolate: the two layers have a different number of points "
            f"({len(a.coordinates) // 2} vs {len(b.coordinates) // 2})."
        )
    if list(a.pointTypes) != list(b.pointTypes):
        raise FontServiceError(
            "Cannot interpolate: the two layers have different point types "
            "(on-curve / off-curve points must match)."
        )
    if len(a.contourInfo or []) != len(b.contourInfo or []):
        raise FontServiceError(
            "Cannot interpolate: the two layers have a different number of contours."
        )
    coordinates = [
        x + (y - x) * factor for x, y in zip(a.coordinates, b.coordinates)
    ]
    return replace(a, coordinates=coordinates)


class FontService:
    """Async access to font files through Fontra's backends.

    Reads always work. Writes are gated by the
    FONTRA_MCP_ALLOW_WRITES=1 environment variable so an MCP server can
    be configured read-only by default and opt into writes per config.
    """

    def __init__(
        self,
        root: str | pathlib.Path | None = None,
        writesAllowed: bool | None = None,
    ):
        envRoot = os.environ.get("FONTRA_MCP_ROOT")
        projectRoot = root or envRoot or os.getcwd()
        # Multiple roots, separated by the OS path separator (';' on Windows).
        entries = [e for e in str(projectRoot).split(os.pathsep) if e.strip()]
        self.roots = [
            pathlib.Path(e).expanduser().resolve() for e in entries
        ] or [pathlib.Path(os.getcwd()).resolve()]
        for r in self.roots:
            if not r.is_dir():
                raise FontServiceError(f"Fontra MCP root does not exist: {r}")
        self.root = self.roots[0]
        self.writesAllowed = (
            writesAllowed
            if writesAllowed is not None
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

        Windows paths are accepted verbatim (`D:\\DESIGN\\My Font.fontra`);
        the sandbox guarantee comes from resolving the path and checking
        that it lives under one of the configured roots — not from
        rejecting separators.

        Rejects paths that escape the configured roots, mirroring the
        path-traversal guard in `fontra.core.server.staticContentHandler`.
        Relative paths resolve against the first root that contains the file.
        """
        if not font:
            raise FontServiceError("No font path given.")
        if "\x00" in font:
            raise FontServiceError(f"Invalid font path: {font!r}")
        candidate = pathlib.Path(font)
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
                raise FontServiceError(f"Font not found under the MCP roots: {font!r}")
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
                        "pathPosix": fontPath.as_posix(),
                        "suffix": fontPath.suffix.lower(),
                        "name": fontPath.stem,
                    }
                )
        fonts.sort(key=lambda f: f["id"])
        return {"roots": [str(r) for r in self.roots], "count": len(fonts), "fonts": fonts}

    def _resolveDir(self, subdir: str) -> pathlib.Path:
        """Resolve a (possibly relative) directory under one of the roots.

        Relative directories are tried against *every* root: the first
        root that does not contain the directory must not abort the search.
        """
        if not subdir:
            raise FontServiceError("No directory given.")
        if "\x00" in subdir:
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
                if (r == c or r in c.parents) and c.is_dir():
                    resolved = c
                    break
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
            "id": self._fontId(self._resolveFontPath(font)),
            "familyName": fontInfo.familyName,
            "unitsPerEm": await handler.getUnitsPerEm(),
            "glyphCount": len(glyphMap),
            "axes": [
                {"name": a.name, "tag": getattr(a, "tag", None)}
                for a in (axes.axes or [])
            ],
            "readOnly": not self.writesAllowed,
            "writesAllowed": self.writesAllowed,
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

    async def getGlyphFull(
        self, font: str, glyphName: str, packed: bool = False
    ) -> dict:
        """Full structured glyph (all contour coordinates, components, ...).

        By default the outlines are returned in the *unpacked* form
        (`{"contours": [{"points": [{"x": .., "y": .., "type": "quad"}]}]}`)
        — the same representation Fontra stores on disk and the one
        `set_glyph` writes back, so a read/write round-trip is stable.
        Pass `packed=True` for the compact `coordinates/pointTypes`
        representation used on the editor wire.
        """
        handler = self._getHandler(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        if packed:
            return unstructure(glyph)
        return unstructure(glyph.convertToPaths())

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

    async def getSources(self, font: str) -> dict:
        """Font-level sources (masters)."""
        sources = await self._getHandler(font).getSources()
        return {
            "sources": {
                sourceIdentifier: {
                    "name": source.name,
                    "location": source.location,
                    "isSparse": source.isSparse,
                    "italicAngle": source.italicAngle,
                }
                for sourceIdentifier, source in (sources or {}).items()
            }
        }

    async def getKerning(self, font: str, maxPairs: int = DEFAULT_MAX_KERN_PAIRS) -> dict:
        kerning = await self._getHandler(font).getKerning()
        return {"font": font, **_summarizeKerning(kerning, maxPairs)}

    async def findGlyphsUsing(self, font: str, glyphName: str) -> dict:
        """Find the glyphs that reference `glyphName` as a component.

        `FontHandler.findGlyphsThatUseGlyph()` is a remote method and
        requires a `connection` keyword argument, so the backend is
        queried directly instead.
        """
        handler = self._getHandler(font)
        backend = handler.backend
        if not hasattr(backend, "findGlyphsThatUseGlyph"):
            return {
                "font": font,
                "glyph": glyphName,
                "supported": False,
                "glyphs": [],
                "reason": "backend does not support component lookups",
            }
        glyphs = await backend.findGlyphsThatUseGlyph(glyphName)
        return {
            "font": font,
            "glyph": glyphName,
            "supported": True,
            "glyphs": sorted(glyphs or []),
        }

    async def getComponentGraph(self, font: str) -> dict:
        """Which glyphs use which components — the backbone of a component workflow."""
        handler = self._getHandler(font)
        glyphMap = await handler.getGlyphMap()
        usedBy: dict[str, list[str]] = {}
        graph: dict[str, list[dict]] = {}
        for glyphName in sorted(glyphMap.keys()):
            glyph = await handler.getGlyph(glyphName)
            if glyph is None:
                continue
            entries = []
            for layerName, layer in glyph.layers.items():
                for component in layer.glyph.components or []:
                    entries.append(
                        {
                            "layer": layerName,
                            "component": component.name,
                            "location": dict(component.location or {}),
                            "transformation": unstructure(component.transformation),
                        }
                    )
                    usedBy.setdefault(component.name, []).append(glyphName)
            if entries:
                graph[glyphName] = entries
        return {
            "font": font,
            "components": {
                name: sorted(set(glyphs)) for name, glyphs in sorted(usedBy.items())
            },
            "glyphs": graph,
        }

    # ------------------------------------------------------------------
    # Writes (gated by FONTRA_MCP_ALLOW_WRITES=1)
    # ------------------------------------------------------------------

    def _requireWrites(self) -> None:
        if not self.writesAllowed:
            raise FontServiceError(
                "Writes are disabled. Restart the Fontra MCP server with "
                "FONTRA_MCP_ALLOW_WRITES=1 to enable write tools."
            )

    @staticmethod
    def _defaultLayerName(glyph: VariableGlyph) -> str:
        """The layer an agent should edit by default."""
        for source in glyph.sources or []:
            if not source.location:
                return source.layerName
        if glyph.sources:
            return glyph.sources[0].layerName
        if "default" in glyph.layers:
            return "default"
        return next(iter(glyph.layers), "default")

    @staticmethod
    def _structureGlyph(glyphName: str, glyphData: dict) -> VariableGlyph:
        if not glyphData or not isinstance(glyphData, dict):
            raise FontServiceError("glyphData must be a structured VariableGlyph object.")
        try:
            glyph = structure(glyphData, VariableGlyph)
        except Exception as e:  # cattrs raises a variety of errors
            raise FontServiceError(f"Invalid glyph payload for {glyphName!r}: {e}") from e
        glyph.name = glyphName
        return glyph

    async def _writeGlyph(
        self,
        handler: FontHandler,
        glyphName: str,
        glyph: VariableGlyph,
        codepoints: list[int],
    ) -> None:
        backend = handler.writableBackend
        if backend is None:
            raise FontServiceError("Backend does not support writing.")
        await backend.putGlyph(glyphName, glyph, codepoints)
        if hasattr(backend, "flush"):
            backend.flush()
        # Keep the shared FontHandler caches coherent for this session.
        glyphMap = await handler.getGlyphMap()
        glyphMap[glyphName] = codepoints
        handler.glyphMap = glyphMap
        handler.localData["glyphMap"] = glyphMap
        handler.localData[("glyphs", glyphName)] = glyph

    async def _codepointsFor(
        self, handler: FontHandler, glyphName: str, codepoints: list[int] | None
    ) -> list[int]:
        if codepoints is not None:
            return [int(c) for c in codepoints]
        glyphMap = await handler.getGlyphMap()
        return list(glyphMap.get(glyphName, []))

    async def setGlyph(
        self,
        font: str,
        glyphName: str,
        glyphData: dict,
        codepoints: list[int] | None = None,
        dryRun: bool = True,
        mode: str = "replace",
    ) -> dict:
        """Create or replace a glyph through Fontra's own backend `putGlyph`.

        `glyphData` is the same structured shape `get_glyph_full` returns
        (VariableGlyph JSON). Two write modes:

        - `mode="replace"` (default): the whole glyph is replaced. Layers
          and sources that exist in the font but not in `glyphData` are
          dropped — the result reports `droppedLayers` so the caller can
          see it.
        - `mode="merge"`: the layers/sources in `glyphData` are merged into
          the existing glyph; layers that are not mentioned are preserved.

        With `dryRun=True` (default) the payload is validated and
        summarized without touching the file.
        """
        self._requireWrites()
        glyph = self._structureGlyph(glyphName, glyphData)
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)

        existing = await handler.getGlyph(glyphName)
        existingLayers = list(existing.layers.keys()) if existing else []
        existingSources = (
            [s.name for s in (existing.sources or [])] if existing else []
        )

        if mode == "merge" and existing is not None:
            mergedLayers = dict(existing.layers)
            mergedLayers.update(glyph.layers or {})
            mergedSources = list(existing.sources or [])
            mergedSourceNames = {s.name for s in mergedSources}
            for source in glyph.sources or []:
                if source.name not in mergedSourceNames:
                    mergedSources.append(source)
                    mergedSourceNames.add(source.name)
            glyph = replace(
                glyph,
                layers=mergedLayers,
                sources=mergedSources,
                axes=list(existing.axes or []) or list(glyph.axes or []),
            )
        elif mode not in ("replace", "merge"):
            raise FontServiceError(f"Unknown write mode: {mode!r} (use 'replace' or 'merge')")

        cps = await self._codepointsFor(handler, glyphName, codepoints)
        newLayers = list((glyph.layers or {}).keys())
        droppedLayers = [name for name in existingLayers if name not in newLayers]
        newSources = [s.name for s in (glyph.sources or [])]
        droppedSources = [name for name in existingSources if name not in newSources]

        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "codepoints": cps,
            "mode": mode,
            "layers": newLayers,
            "addedLayers": [n for n in newLayers if n not in existingLayers],
            "droppedLayers": droppedLayers,
            "droppedSources": droppedSources,
            "summary": _summarizeGlyph(glyph),
        }
        if droppedLayers:
            result["warning"] = (
                f"Layers {droppedLayers} were dropped by this write. Use mode='merge' "
                "to keep the other masters."
            )
        if dryRun:
            result["dryRun"] = True
            return result

        await self._writeGlyph(handler, glyphName, glyph, cps)
        result["written"] = True
        return result

    async def setGlyphLayer(
        self,
        font: str,
        glyphName: str,
        layerName: str,
        glyphData: dict,
        dryRun: bool = True,
    ) -> dict:
        """Replace a single layer of a glyph, leaving other masters intact.

        `glyphData` is a StaticGlyph dict (the `glyph` value of a layer),
        e.g. `{"path": {...}, "xAdvance": 350, "components": [...],
        "anchors": [...]}`.
        """
        self._requireWrites()
        if not glyphData or not isinstance(glyphData, dict):
            raise FontServiceError("glyphData must be a structured StaticGlyph object.")
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)

        existing = await handler.getGlyph(glyphName)
        if existing is None:
            raise FontServiceError(
                f"Glyph not found: {glyphName!r}. Use set_glyph to create it first."
            )
        try:
            staticGlyph = structure(glyphData, StaticGlyph)
        except Exception as e:
            raise FontServiceError(f"Invalid layer payload: {e}") from e

        layers = dict(existing.layers)
        if layerName in layers:
            layers[layerName] = replace(layers[layerName], glyph=staticGlyph)
        else:
            layers[layerName] = replace(existing.layers[self._defaultLayerName(existing)], glyph=staticGlyph)

        sources = list(existing.sources or [])
        if not any(s.layerName == layerName for s in sources):
            base = sources[0] if sources else None
            sources.append(
                GlyphSource(
                    name=base.name if base else "",
                    layerName=layerName,
                    location=dict(base.location) if base else {},
                )
            )

        glyph = replace(existing, layers=layers, sources=sources)
        cps = await self._codepointsFor(handler, glyphName, None)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": layerName,
            "layers": list(glyph.layers.keys()),
            "codepoints": cps,
            "summary": _summarizeGlyph(glyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, glyphName, glyph, cps)
        result["written"] = True
        return result

    async def copyGlyph(
        self,
        font: str,
        sourceName: str,
        newName: str,
        codepoints: list[int] | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Copy a glyph (all layers, components and anchors) to a new name."""
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)
        source = await handler.getGlyph(sourceName)
        if source is None:
            raise FontServiceError(f"Glyph not found: {sourceName!r}")
        glyph = copy.deepcopy(source)
        glyph.name = newName
        cps = await self._codepointsFor(handler, newName, codepoints)
        result = {
            "font": self._fontId(fontPath),
            "glyph": newName,
            "copiedFrom": sourceName,
            "codepoints": cps,
            "layers": list(glyph.layers.keys()),
            "summary": _summarizeGlyph(glyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, newName, glyph, cps)
        result["written"] = True
        return result

    async def setAnchors(
        self,
        font: str,
        glyphName: str,
        anchors: list[dict],
        layerName: str | None = None,
        replaceExisting: bool = True,
        dryRun: bool = True,
    ) -> dict:
        """Set (or merge) the anchors of a glyph layer.

        `anchors` is a list of `{"name": "top", "x": 100, "y": 700}`.
        With `replaceExisting=False` the new anchors are merged into the
        existing ones (an anchor with the same name is replaced).
        """
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        layerName = layerName or self._defaultLayerName(glyph)
        if layerName not in glyph.layers:
            raise FontServiceError(
                f"Layer not found: {layerName!r} (layers: {list(glyph.layers)})"
            )
        try:
            newAnchors = [structure(a, Anchor) for a in anchors]
        except Exception as e:
            raise FontServiceError(f"Invalid anchor payload: {e}") from e

        layer = glyph.layers[layerName]
        if replaceExisting:
            merged = list(newAnchors)
        else:
            merged = [
                a
                for a in (layer.glyph.anchors or [])
                if a.name not in {n.name for n in newAnchors}
            ]
            merged.extend(newAnchors)

        layers = dict(glyph.layers)
        layers[layerName] = replace(
            layer, glyph=replace(layer.glyph, anchors=merged)
        )
        newGlyph = replace(glyph, layers=layers)
        cps = await self._codepointsFor(handler, glyphName, None)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": layerName,
            "anchors": [unstructure(a) for a in merged],
            "summary": _summarizeGlyph(newGlyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, glyphName, newGlyph, cps)
        result["written"] = True
        return result

    async def addComponent(
        self,
        font: str,
        glyphName: str,
        componentName: str,
        transformation: dict | None = None,
        layerName: str | None = None,
        location: dict | None = None,
        codepoints: list[int] | None = None,
        create: bool = True,
        dryRun: bool = True,
    ) -> dict:
        """Add a component to a glyph — the core of the component workflow.

        The component glyph must already exist in the font. `transformation`
        is a DecomposedTransform dict (e.g. `{"translateX": 100,
        "scaleX": 0.8, "rotation": 0}`); missing fields default to identity.
        `location` selects a master of a variable component glyph.
        """
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)

        componentGlyph = await handler.getGlyph(componentName)
        if componentGlyph is None:
            raise FontServiceError(f"Component glyph not found: {componentName!r}")

        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            if not create:
                raise FontServiceError(f"Glyph not found: {glyphName!r}")
            glyph = VariableGlyph(
                name=glyphName,
                sources=[GlyphSource(name="", layerName="default")],
                layers={"default": Layer(glyph=StaticGlyph())},
            )

        layerName = layerName or self._defaultLayerName(glyph)
        if layerName not in glyph.layers:
            raise FontServiceError(
                f"Layer not found: {layerName!r} (layers: {list(glyph.layers)})"
            )

        try:
            component = Component(
                name=componentName,
                transformation=_decomposedTransform(transformation or {}),
                location=dict(location or {}),
            )
        except Exception as e:
            raise FontServiceError(f"Invalid component payload: {e}") from e

        layer = glyph.layers[layerName]
        components = list(layer.glyph.components or [])
        components.append(component)
        layers = dict(glyph.layers)
        layers[layerName] = replace(layer, glyph=replace(layer.glyph, components=components))
        newGlyph = replace(glyph, layers=layers)
        cps = await self._codepointsFor(handler, glyphName, codepoints)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": layerName,
            "component": componentName,
            "components": [unstructure(c) for c in components],
            "codepoints": cps,
            "summary": _summarizeGlyph(newGlyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, glyphName, newGlyph, cps)
        result["written"] = True
        return result

    async def removeComponent(
        self,
        font: str,
        glyphName: str,
        componentName: str,
        layerName: str | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Remove every component named `componentName` from a glyph layer."""
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        layerName = layerName or self._defaultLayerName(glyph)
        layer = glyph.layers[layerName]
        components = [c for c in (layer.glyph.components or []) if c.name != componentName]
        layers = dict(glyph.layers)
        layers[layerName] = replace(layer, glyph=replace(layer.glyph, components=components))
        newGlyph = replace(glyph, layers=layers)
        cps = await self._codepointsFor(handler, glyphName, None)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": layerName,
            "components": [unstructure(c) for c in components],
            "summary": _summarizeGlyph(newGlyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, glyphName, newGlyph, cps)
        result["written"] = True
        return result

    async def decomposeGlyph(
        self,
        font: str,
        glyphName: str,
        layerName: str | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Flatten the components of a glyph into outlines.

        Each component's outline is fetched from the font and transformed
        with the component's transformation, then appended to the layer's
        own path.
        """
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        layerName = layerName or self._defaultLayerName(glyph)
        layer = glyph.layers[layerName]
        components = list(layer.glyph.components or [])
        if not components:
            return {
                "font": self._fontId(fontPath),
                "glyph": glyphName,
                "layer": layerName,
                "decomposed": False,
                "reason": "layer has no components",
            }

        basePath = copy.deepcopy(_asPackedPath(layer.glyph.path))
        for component in components:
            componentGlyph = await handler.getGlyph(component.name)
            if componentGlyph is None:
                raise FontServiceError(
                    f"Component glyph not found: {component.name!r}"
                )
            componentLayer = self._defaultLayerName(componentGlyph)
            componentPath = _asPackedPath(
                componentGlyph.layers[componentLayer].glyph.path
            )
            if componentPath is None:
                continue
            transform = component.transformation
            if hasattr(transform, "toTransform"):
                transform = transform.toTransform()
            basePath.appendPath(componentPath.transformed(transform))

        layers = dict(glyph.layers)
        layers[layerName] = replace(
            layer, glyph=replace(layer.glyph, path=basePath, components=[])
        )
        newGlyph = replace(glyph, layers=layers)
        cps = await self._codepointsFor(handler, glyphName, None)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": layerName,
            "decomposed": True,
            "componentsFlattened": [c.name for c in components],
            "summary": _summarizeGlyph(newGlyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, glyphName, newGlyph, cps)
        result["written"] = True
        return result

    async def interpolateGlyph(
        self,
        font: str,
        glyphName: str,
        layerA: str,
        layerB: str,
        factor: float,
        newLayerName: str | None = None,
        location: dict | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Create an interpolated master between two layers.

        `factor` is 0.0 (layer A) .. 1.0 (layer B). The new layer is added
        to the glyph; pass `location` to also register it as a source at
        that axis location.
        """
        self._requireWrites()
        if not 0.0 <= factor <= 1.0:
            raise FontServiceError(f"factor must be between 0 and 1, got {factor}")
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)
        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(f"Glyph not found: {glyphName!r}")
        for name in (layerA, layerB):
            if name not in glyph.layers:
                raise FontServiceError(
                    f"Layer not found: {name!r} (layers: {list(glyph.layers)})"
                )

        layerAData = glyph.layers[layerA]
        layerBData = glyph.layers[layerB]
        pathA = _asPackedPath(layerAData.glyph.path)
        pathB = _asPackedPath(layerBData.glyph.path)
        newPath = _interpolatePackedPaths(pathA, pathB, factor)

        componentsA = list(layerAData.glyph.components or [])
        componentsB = list(layerBData.glyph.components or [])
        if len(componentsA) != len(componentsB):
            raise FontServiceError(
                "Cannot interpolate: the two layers have a different number of components "
                f"({len(componentsA)} vs {len(componentsB)})."
            )
        newComponents = []
        for compA, compB in zip(componentsA, componentsB):
            if compA.name != compB.name:
                raise FontServiceError(
                    "Cannot interpolate: component names differ "
                    f"({compA.name!r} vs {compB.name!r})."
                )
            newComponents.append(
                replace(
                    compA,
                    transformation=_interpolateTransform(
                        compA.transformation, compB.transformation, factor
                    ),
                )
            )

        newLayerName = newLayerName or f"{layerA}-{factor:g}-{layerB}"
        newLayer = replace(
            layerAData,
            glyph=replace(
                layerAData.glyph,
                path=newPath,
                components=newComponents,
                xAdvance=(
                    layerAData.glyph.xAdvance
                    if layerAData.glyph.xAdvance is None
                    or layerBData.glyph.xAdvance is None
                    else layerAData.glyph.xAdvance
                    + (layerBData.glyph.xAdvance - layerAData.glyph.xAdvance) * factor
                ),
            ),
        )
        layers = dict(glyph.layers)
        layers[newLayerName] = newLayer
        sources = list(glyph.sources or [])
        if location is not None:
            sources.append(
                GlyphSource(
                    name=(sources[0].name if sources else ""),
                    layerName=newLayerName,
                    location=dict(location),
                )
            )
        newGlyph = replace(glyph, layers=layers, sources=sources)
        cps = await self._codepointsFor(handler, glyphName, None)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": newLayerName,
            "interpolatedBetween": [layerA, layerB],
            "factor": factor,
            "location": location,
            "summary": _summarizeGlyph(newGlyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result
        await self._writeGlyph(handler, glyphName, newGlyph, cps)
        result["written"] = True
        return result

    async def addSource(
        self,
        font: str,
        glyphName: str,
        sourceName: str,
        location: dict | None = None,
        layerName: str | None = None,
        baseLayer: str | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Add a new master (source + layer) to a glyph.

        A font-level source is created too when the font does not have one
        with that name yet, so the new master is a real interpolation
        master and not a stray layer.
        """
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)
        location = dict(location or {})

        axes = await handler.getAxes()
        axisByName = {a.name: a for a in (axes.axes or [])}
        for axisName, value in location.items():
            axis = axisByName.get(axisName)
            if axis is None:
                raise FontServiceError(
                    f"Unknown axis {axisName!r} (font axes: {sorted(axisByName)})"
                )
            minValue = getattr(axis, "minValue", None)
            maxValue = getattr(axis, "maxValue", None)
            if minValue is not None and maxValue is not None:
                if not (minValue <= value <= maxValue):
                    raise FontServiceError(
                        f"Location value {value} for axis {axisName!r} is outside "
                        f"[{minValue}, {maxValue}]."
                    )
        if not axisByName and location:
            raise FontServiceError(
                "This font has no axes, so a source cannot have a location."
            )

        glyph = await handler.getGlyph(glyphName)
        if glyph is None:
            raise FontServiceError(
                f"Glyph not found: {glyphName!r}. Use set_glyph to create it first."
            )

        layerName = layerName or f"{sourceName}"
        if layerName in glyph.layers:
            raise FontServiceError(f"Layer already exists: {layerName!r}")

        baseLayer = baseLayer or self._defaultLayerName(glyph)
        if baseLayer not in glyph.layers:
            raise FontServiceError(
                f"Base layer not found: {baseLayer!r} (layers: {list(glyph.layers)})"
            )
        newLayer = replace(glyph.layers[baseLayer])
        layers = dict(glyph.layers)
        layers[layerName] = newLayer

        sources = list(glyph.sources or [])
        sources.append(
            GlyphSource(
                name=sourceName,
                layerName=layerName,
                location=location,
            )
        )
        newGlyph = replace(glyph, layers=layers, sources=sources)

        fontSources = await handler.getSources()
        sourceExists = any(
            getattr(s, "name", None) == sourceName for s in (fontSources or {}).values()
        )
        newFontSource = None
        if not sourceExists:
            newFontSource = FontSource(name=sourceName, location=location)
            fontSources = dict(fontSources or {})
            fontSources[uuid.uuid4().hex[:8]] = newFontSource

        cps = await self._codepointsFor(handler, glyphName, None)
        result = {
            "font": self._fontId(fontPath),
            "glyph": glyphName,
            "layer": layerName,
            "source": sourceName,
            "location": location,
            "fontSourceCreated": newFontSource is not None,
            "summary": _summarizeGlyph(newGlyph),
        }
        if dryRun:
            result["dryRun"] = True
            return result

        if newFontSource is not None:
            backend = handler.writableBackend
            if backend is None:
                raise FontServiceError("Backend does not support writing.")
            await backend.putSources(fontSources)
            if hasattr(backend, "flush"):
                backend.flush()
        await self._writeGlyph(handler, glyphName, newGlyph, cps)
        result["written"] = True
        return result

    async def setKerning(
        self,
        font: str,
        pairs: dict | list,
        sourceIdentifier: str | None = None,
        groupsSide1: dict | None = None,
        groupsSide2: dict | None = None,
        dryRun: bool = True,
    ) -> dict:
        """Set kerning pairs.

        `pairs` is either `{"A / V": -75}` or a list of
        `{"left": "A", "right": "V", "value": -75}`. Existing pairs are
        kept; only the given pairs are written.
        """
        self._requireWrites()
        handler = self._getHandler(font)
        fontPath = self._resolveFontPath(font)

        parsed: list[tuple[str, str, float | None]] = []
        if isinstance(pairs, dict):
            for key, value in pairs.items():
                left, _, right = str(key).partition("/")
                parsed.append((left.strip(), right.strip(), value))
        elif isinstance(pairs, list):
            for item in pairs:
                if not isinstance(item, dict):
                    raise FontServiceError(
                        "Kerning pairs must be objects with 'left', 'right' and 'value'."
                    )
                parsed.append(
                    (str(item["left"]), str(item["right"]), item.get("value"))
                )
        else:
            raise FontServiceError("pairs must be a dict or a list of pair objects.")
        if not parsed:
            raise FontServiceError("No kerning pairs given.")

        kerning = await handler.getKerning()
        kerning = copy.deepcopy(kerning or {})
        tableKey = DEFAULT_KERN_TABLE
        for key in kerning:
            tableKey = key
            break
        table = kerning.get(tableKey) or Kerning(
            groupsSide1={},
            groupsSide2={},
            sourceIdentifiers=[],
            values={},
        )

        sourceIdentifiers = list(table.sourceIdentifiers or [])
        if sourceIdentifier is None:
            if sourceIdentifiers:
                # The kerning table already knows its masters: use the first.
                sourceIdentifier = sourceIdentifiers[0]
            else:
                fontSources = await handler.getSources()
                sourceIdentifier = next(iter(fontSources or {}), None) or "default"
        if sourceIdentifier not in sourceIdentifiers:
            sourceIdentifiers.append(sourceIdentifier)
        sourceIndex = sourceIdentifiers.index(sourceIdentifier)

        values = copy.deepcopy(table.values or {})
        for left, right, value in parsed:
            rightMap = values.setdefault(left, {})
            sourceValues = list(rightMap.get(right, []))
            while len(sourceValues) <= sourceIndex:
                sourceValues.append(None)
            sourceValues[sourceIndex] = value
            rightMap[right] = sourceValues

        newTable = Kerning(
            groupsSide1=groupsSide1
            if groupsSide1 is not None
            else (table.groupsSide1 or {}),
            groupsSide2=groupsSide2
            if groupsSide2 is not None
            else (table.groupsSide2 or {}),
            sourceIdentifiers=sourceIdentifiers,
            values=values,
        )
        kerning[tableKey] = newTable

        result = {
            "font": self._fontId(fontPath),
            "table": tableKey,
            "sourceIdentifier": sourceIdentifier,
            "pairsWritten": len(parsed),
            "pairs": {f"{l} / {r}": v for l, r, v in parsed},
        }
        if dryRun:
            result["dryRun"] = True
            return result

        backend = handler.writableBackend
        if backend is None:
            raise FontServiceError("Backend does not support writing.")
        await backend.putKerning(kerning)
        if hasattr(backend, "flush"):
            backend.flush()
        handler.localData["kerning"] = kerning
        result["written"] = True
        return result

    # ------------------------------------------------------------------
    # Analysis + design guidance (reuses fork modules)
    # ------------------------------------------------------------------

    @staticmethod
    def _getDefaultPackedPath(glyph):
        for layer in glyph.layers.values():
            path = layer.glyph.path
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

    def getAllTerms(self) -> dict:
        return {"terms": design_guide.get_all_terms()}

    def getComponentCatalog(self) -> dict:
        return design_guide.get_component_catalog()

    def getAllComponents(self) -> dict:
        return {"components": design_guide.get_all_components()}

    def getComponents(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "components": design_guide.get_components(glyphName)}

    def getSuggestions(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "suggestions": design_guide.get_suggestions(glyphName)}

    def getInfoCards(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "cards": design_guide.get_info_cards(glyphName)}

    def getCards(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "cards": design_guide.get_cards(glyphName)}

    def getAccelerationTips(self, glyphName: str) -> dict:
        return {"glyph": glyphName, "tips": design_guide.get_acceleration_tips(glyphName)}

    def getCardLayout(self) -> dict:
        return design_guide.get_card_layout()

    def getRelatedGlyphs(self, glyphName: str) -> dict:
        return design_guide.get_related_glyphs(glyphName)


def _decomposedTransform(data: dict):
    """Build a DecomposedTransform from a (possibly partial) dict."""
    from fontTools.misc.transform import DecomposedTransform

    if isinstance(data, DecomposedTransform):
        return data
    if not isinstance(data, dict):
        raise FontServiceError("transformation must be an object.")
    fieldNames = set(DecomposedTransform.__dataclass_fields__.keys())
    unknown = set(data) - fieldNames
    if unknown:
        raise FontServiceError(
            f"Unknown transformation field(s): {sorted(unknown)}; "
            f"expected a subset of {sorted(fieldNames)}"
        )
    return DecomposedTransform(**data)


def chainDicts(items: list | tuple) -> list:
    return [unstructure(i) for i in items]

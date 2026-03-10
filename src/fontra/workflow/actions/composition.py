"""Glyph composition and decomposition automation features.

This module provides workflow filter actions for:
- auto-position-diacritics: Automatically position combining marks based on base glyph metrics
- smart-compose-glyphs: Automatically compose glyphs from base + diacritics
- suggest-components: Analyze glyphs and suggest optimal component structure
"""

from __future__ import annotations

import logging
import unicodedata
from dataclasses import dataclass, field, replace
from typing import Any, Optional

from fontTools.misc.transform import DecomposedTransform

from ...core.classes import (
    Anchor,
    Component,
    GlyphSource,
    Layer,
    StaticGlyph,
    VariableGlyph,
)
from .base import BaseFilter, registerFilterAction

logger = logging.getLogger(__name__)

# Unicode combining class ranges
# See: https://www.unicode.org/reports/tr44/#Combining_Class
COMBINING_CLASSES = {
    # Spacing and enclosing marks
    0: "Not_Reordered",  # Other
    1: "Overlay",
    3: "Nukta",
    4: "Virama",
    # Diacritic marks
    5: "Vowel_Sign",
    6: "Vowel_Sign_Below",
    7: "Vowel_Sign_Above",
    8: "Vowel_Sign_Top",
    9: "Vowel_Sign_Bottom",
    # More diacritics
    11: "Vowel_Sign_Top_Bottom",
    12: "Vowel_Sign_Bottom_Above",
    13: "Vowel_Sign_Top_Bottom_Above",
    14: "Vowel_Sign_Top_Bottom_Below",
    15: "Vowel_Sign_Above_Below",
    # Consonant marks
    16: "Consonant",
    17: "Consonant_Below",
    18: "Consonant_Above",
    19: "Consonant_Preceding",
    20: "Consonant_Following",
    21: "Consonant_Succeeding",
}

# Common Latin/Greek/Cyrillic combining marks and their typical anchor positions
# These are used as defaults when no explicit anchors are defined
COMMON_COMBINING_MARKS = {
    # Diacritics
    "acute": {"anchor": "_top", "y_offset": 0},
    "grave": {"anchor": "_top", "y_offset": 0},
    "circumflex": {"anchor": "_top", "y_offset": 0},
    "tilde": {"anchor": "_top", "y_offset": 0},
    "macron": {"anchor": "_top", "y_offset": 0},
    "breve": {"anchor": "_top", "y_offset": 0},
    "dotabove": {"anchor": "_top", "y_offset": 0},
    "dotbelow": {"anchor": "_bottom", "y_offset": 0},
    "dieresis": {"anchor": "_top", "y_offset": 0},
    "cedilla": {"anchor": "_bottom", "y_offset": 0},
    "caron": {"anchor": "_top", "y_offset": 0},
    "ring": {"anchor": "_top", "y_offset": 0},
    "stroke": {"anchor": "_top", "y_offset": 0},
    "doubleacute": {"anchor": "_top", "y_offset": 0},
    "hungarumlaut": {"anchor": "_top", "y_offset": 0},
    # Tone marks
    "verticallinebelow": {"anchor": "_bottom", "y_offset": 0},
    "horn": {"anchor": "_right", "y_offset": 0},
    "hookabove": {"anchor": "_top", "y_offset": 0},
    "gravecomb": {"anchor": "_top", "y_offset": 0},
    "acutecomb": {"anchor": "_top", "y_offset": 0},
    "tildecomb": {"anchor": "_top", "y_offset": 0},
    "macroncomb": {"anchor": "_top", "y_offset": 0},
    "brevecomb": {"anchor": "_top", "y_offset": 0},
    "dotabovecomb": {"anchor": "_top", "y_offset": 0},
    "dotbelowcomb": {"anchor": "_bottom", "y_offset": 0},
    "dieresiscomb": {"anchor": "_top", "y_offset": 0},
    "cedillacomb": {"anchor": "_bottom", "y_offset": 0},
    "caroncomb": {"anchor": "_top", "y_offset": 0},
    "ringcomb": {"anchor": "_top", "y_offset": 0},
    "strokecomb": {"anchor": "_top", "y_offset": 0},
}


def get_unicode_combining_class(code_point: int) -> int:
    """Get the Unicode combining class for a code point."""
    try:
        return unicodedata.combining(chr(code_point))
    except (ValueError, TypeError):
        return 0


def is_combining_mark(code_point: int) -> bool:
    """Check if a code point is a combining mark."""
    try:
        category = unicodedata.category(chr(code_point))
        return category in ("Mn", "Mc", "Me")  # Mark types
    except (ValueError, TypeError):
        return False


def get_diacritic_base_code_points(code_point: int) -> list[int]:
    """Get the base code point(s) for a decomposed diacritic.

    For example, for U+00C1 (Á), returns [U+0041, U+0301]
    """
    try:
        decomposition = unicodedata.decomposition(chr(code_point))
        if not decomposition:
            return []
        # Decomposition is in hex like "0041 0301"
        parts = decomposition.split()
        if not parts:
            return []
        # First part may have a tag like "<compat>"
        if parts[0].startswith("<"):
            parts = parts[1:]
        if not parts:
            return []
        return [int(p, 16) for p in parts]
    except (ValueError, TypeError, IndexError):
        return []


def get_glyph_metrics(glyph: StaticGlyph) -> dict[str, float]:
    """Extract metric information from a static glyph.

    Returns a dict with:
    - baseline: y=0
    - x_height: detected x-height
    - cap_height: detected cap-height
    - ascender: highest point
    - descender: lowest point
    - width: advance width
    """
    metrics = {
        "baseline": 0.0,
        "x_height": 0.0,
        "cap_height": 0.0,
        "ascender": 0.0,
        "descender": 0.0,
        "width": glyph.xAdvance or 0.0,
    }

    if not glyph.path or glyph.path.isEmpty():
        return metrics

    # PackedPath stores coordinates as a flat list [x0, y0, x1, y1, ...]
    # Extract all y values to find min/max
    coordinates = glyph.path.coordinates
    if not coordinates:
        return metrics

    # Get all y values (every other element starting at index 1)
    y_values = coordinates[1::2]
    if not y_values:
        return metrics

    min_y = min(y_values)
    max_y = max(y_values)

    metrics["ascender"] = max_y
    metrics["descender"] = min_y
    metrics["cap_height"] = max_y
    metrics["x_height"] = max_y  # Will need refinement based on glyph name

    return metrics


def suggest_diacritic_position(
    diacritic_name: str,
    base_metrics: dict[str, float],
) -> tuple[float, float]:
    """Suggest position for a diacritic based on base glyph metrics.

    Returns (x, y) position tuple.
    """
    # Check our known diacritics first
    diacritic_lower = diacritic_name.lower()
    if diacritic_lower in COMMON_COMBINING_MARKS:
        info = COMMON_COMBINING_MARKS[diacritic_lower]
        anchor_type = info.get("anchor", "_top")
        x = base_metrics.get("width", 500) / 2  # Center by default

        if anchor_type == "_top":
            y = base_metrics.get("x_height", 500)
        elif anchor_type == "_bottom":
            y = base_metrics.get("descender", 0)
        elif anchor_type == "_cap":
            y = base_metrics.get("cap_height", 700)
        elif anchor_type == "_right":
            y = base_metrics.get("x_height", 500) * 0.6
            x = base_metrics.get("width", 500)
        else:
            y = base_metrics.get("x_height", 500)

        return (x, y)

    # Generic fallback based on name heuristics
    x = base_metrics.get("width", 500) / 2

    # Heuristics based on diacritic name
    if "below" in diacritic_lower or "bottom" in diacritic_lower:
        y = base_metrics.get("descender", 0)
    elif "top" in diacritic_lower or "acute" in diacritic_lower or "grave" in diacritic_lower:
        y = base_metrics.get("cap_height", 700)
    elif "tilde" in diacritic_lower or "macron" in diacritic_lower:
        y = base_metrics.get("cap_height", 700)
    else:
        y = base_metrics.get("x_height", 500)

    return (x, y)


# --- Filter Actions ---


@registerFilterAction("auto-position-diacritics")
@dataclass(kw_only=True)
class AutoPositionDiacritics(BaseFilter):
    """Automatically position combining marks based on base glyph metrics.

    This filter analyzes the base glyphs and their metrics (x-height, cap-height,
    ascender) and automatically positions combining marks accordingly.

    Configuration options:
    - use_anchors: If True, respect existing anchor positions
    - skip_components: If True, skip glyphs that have components (they typically
                     inherit anchors from their base glyphs). Default: True
    - default_x_height: Default x-height to use if not detectable
    - default_cap_height: Default cap-height to use if not detectable
    """

    use_anchors: bool = True
    skip_components: bool = True
    default_x_height: float = 500.0
    default_cap_height: float = 700.0

    async def processGlyph(self, glyph: VariableGlyph) -> VariableGlyph:
        new_layers = {}

        for layer_name, layer in glyph.layers.items():
            # Handle both Layer objects and direct StaticGlyph (for backwards compatibility)
            static_glyph = layer.glyph if hasattr(layer, 'glyph') else layer

            # Skip glyphs with components (they inherit anchors from base glyphs)
            if self.skip_components and static_glyph.components:
                new_layers[layer_name] = layer
                continue

            # If glyph has anchors, respect them unless use_anchors is False
            if self.use_anchors and static_glyph.anchors:
                new_layers[layer_name] = layer
                continue

            # Get metrics from the glyph
            metrics = get_glyph_metrics(static_glyph)
            if metrics["x_height"] == 0:
                metrics["x_height"] = self.default_x_height
            if metrics["cap_height"] == 0:
                metrics["cap_height"] = self.default_cap_height

            # Get base glyph name (for components)
            base_name = glyph.name
            if static_glyph.components:
                # Use first component as base
                base_name = static_glyph.components[0].name

            # Position anchors based on metrics
            anchors = self._calculate_anchors(base_name, metrics)

            # Handle both Layer objects and direct StaticGlyph
            if hasattr(layer, 'glyph'):
                # It's a Layer object
                new_layers[layer_name] = replace(
                    layer,
                    glyph=replace(static_glyph, anchors=anchors),
                )
            else:
                # It's a direct StaticGlyph, wrap it in a new Layer
                new_layers[layer_name] = Layer(
                    glyph=replace(static_glyph, anchors=anchors)
                )

        return replace(glyph, layers=new_layers)

    def _calculate_anchors(
        self, glyph_name: str, metrics: dict[str, float]
    ) -> list[Anchor]:
        """Calculate anchor positions based on glyph metrics."""
        anchors = []

        # Determine glyph type from name heuristics
        name_lower = glyph_name.lower()

        # Top anchors for uppercase
        if name_lower and "a" <= name_lower[0] <= "z":
            if name_lower.isupper():
                # Uppercase - use cap height
                anchors.append(Anchor(name="top", x=metrics["width"] / 2, y=metrics["cap_height"]))
                anchors.append(Anchor(name="_top", x=metrics["width"] / 2, y=metrics["cap_height"]))
            elif len(name_lower) == 1 and name_lower.isalpha():
                # Lowercase - use x-height
                anchors.append(Anchor(name="top", x=metrics["width"] / 2, y=metrics["x_height"]))
                anchors.append(Anchor(name="_top", x=metrics["width"] / 2, y=metrics["x_height"]))

        # Bottom anchor
        anchors.append(Anchor(name="bottom", x=metrics["width"] / 2, y=metrics["descender"]))
        anchors.append(Anchor(name="_bottom", x=metrics["width"] / 2, y=metrics["descender"]))

        # Right anchor for diacritics that go to the right
        anchors.append(Anchor(name="right", x=metrics["width"], y=metrics["x_height"] * 0.6))
        anchors.append(Anchor(name="_right", x=metrics["width"], y=metrics["x_height"] * 0.6))

        return anchors


@registerFilterAction("smart-compose-glyphs")
@dataclass(kw_only=True)
class SmartComposeGlyphs(BaseFilter):
    """Automatically compose glyphs from base glyphs and diacritics.

    This filter analyzes Unicode data to find glyphs that can be composed
    from base glyphs + combining marks, and creates component-based composites.

    Note: This filter works on individual glyphs that have Unicode code points
    with NFD decompositions. It transforms the glyph into a component-based
    composite if possible.

    Configuration options:
    - decompose_first: Decompose existing composites before recomposing
    """

    decompose_first: bool = False

    async def getGlyph(self, glyphName: str) -> VariableGlyph | None:
        """Process a single glyph, attempting to compose it from components."""
        # Get the glyph from the input
        glyph = await self.validatedInput.getGlyph(glyphName)
        if glyph is None:
            return None

        # Get Unicode code points for this glyph
        glyph_map = await self.inputGlyphMap
        code_points = glyph_map.get(glyphName, [])

        if not code_points:
            return glyph  # No Unicode info, return as-is

        # Try to find components for the first code point
        code_point = code_points[0]
        components = await self._find_and_create_components(code_point, glyph)
        if components:
            # Create a component-based glyph
            return await self._create_composite_glyph(glyph, components)

        return glyph

    async def _find_and_create_components(
        self, code_point: int, original_glyph: VariableGlyph
    ) -> list[Component] | None:
        """Find and create components for a Unicode code point."""
        # Try NFD decomposition
        try:
            nfd = unicodedata.normalize("NFD", chr(code_point))
            code_points = [ord(c) for c in nfd]
        except ValueError:
            return None

        if len(code_points) < 2:
            return None  # Not a composite

        # Look up glyph names for these code points
        glyph_map = await self.inputGlyphMap

        # Reverse lookup: code point -> glyph name
        cp_to_name = {}
        for name, cps in glyph_map.items():
            for cp in cps:
                if cp not in cp_to_name:
                    cp_to_name[cp] = name

        # Build list of components
        components = []
        base_cp = code_points[0]
        base_name = cp_to_name.get(base_cp)
        if base_name:
            # First component is the base
            transform = DecomposedTransform()
            components.append(Component(name=base_name, transformation=transform))

        # Add diacritic components with positioning
        for cp in code_points[1:]:
            if cp in cp_to_name:
                dia_name = cp_to_name[cp]
                # Get metrics to position the diacritic
                base_metrics = self._get_default_metrics(original_glyph)
                x, y = suggest_diacritic_position(dia_name, base_metrics)

                transform = DecomposedTransform()
                transform.translate(x, y)
                components.append(Component(name=dia_name, transformation=transform))

        return components if len(components) > 1 else None

    def _get_default_metrics(self, glyph: VariableGlyph) -> dict[str, float]:
        """Get default metrics for positioning components."""
        for layer in glyph.layers.values():
            metrics = get_glyph_metrics(layer.glyph)
            if metrics["width"] > 0:
                return metrics
        return {
            "baseline": 0.0,
            "x_height": 500.0,
            "cap_height": 700.0,
            "ascender": 700.0,
            "descender": 0.0,
            "width": 500.0,
        }

    async def _create_composite_glyph(
        self, original_glyph: VariableGlyph, components: list[Component]
    ) -> VariableGlyph:
        """Create a composite glyph from components."""
        # Get the default layer
        default_layer = None
        for source in original_glyph.sources:
            if source.layerName in original_glyph.layers:
                default_layer = original_glyph.layers[source.layerName]
                break

        if default_layer:
            width = default_layer.glyph.xAdvance or 500
        else:
            width = 500

        # Create new glyph with components
        new_static_glyph = StaticGlyph(
            components=components,
            anchors=[],
            xAdvance=width,
        )

        new_layer = Layer(glyph=new_static_glyph)

        return replace(
            original_glyph,
            layers={"default": new_layer},
        )


@registerFilterAction("suggest-components")
@dataclass(kw_only=True)
class SuggestComponents(BaseFilter):
    """Analyze glyphs and suggest optimal component structure.

    This filter analyzes Unicode data to identify glyphs that could be
    represented as composites of base glyphs + diacritics.

    The result is stored in the glyph's customData for later review.
    """

    async def processGlyph(self, glyph: VariableGlyph) -> VariableGlyph:
        """Analyze a glyph and add component suggestions to its customData."""
        # Get Unicode code points for this glyph
        glyph_map = await self.inputGlyphMap
        code_points = glyph_map.get(glyph.name, [])

        if not code_points:
            return glyph  # No Unicode info

        suggestions = []

        for cp in code_points:
            # Check if this code point has a decomposition
            components = get_diacritic_base_code_points(cp)
            if len(components) > 1:
                # This is a composite character - build suggestion
                cp_to_name = {}
                for name, cps in glyph_map.items():
                    for c in cps:
                        if c not in cp_to_name:
                            cp_to_name[c] = name

                component_names = []
                for c in components[1:]:  # Skip base
                    if c in cp_to_name:
                        component_names.append(cp_to_name[c])

                if component_names:
                    suggestions.append({
                        "unicode": f"U+{cp:04X}",
                        "components": component_names,
                    })

        if suggestions:
            # Add suggestions to customData
            new_layers = {}
            for layer_name, layer in glyph.layers.items():
                # Handle both Layer objects and direct StaticGlyph
                if hasattr(layer, 'glyph'):
                    static_glyph = layer.glyph
                    new_custom_data = dict(static_glyph.customData)
                    new_custom_data["component_suggestions"] = suggestions
                    new_layers[layer_name] = replace(
                        layer,
                        glyph=replace(static_glyph, customData=new_custom_data),
                    )
                else:
                    # Direct StaticGlyph - create a new Layer wrapping it
                    static_glyph = layer
                    new_custom_data = dict(static_glyph.customData)
                    new_custom_data["component_suggestions"] = suggestions
                    new_layers[layer_name] = Layer(
                        glyph=replace(static_glyph, customData=new_custom_data)
                    )
            glyph = replace(glyph, layers=new_layers)

        return glyph


# --- Helper functions for external use ---


def analyze_glyph_composition(glyph: VariableGlyph) -> dict[str, Any]:
    """Analyze a glyph and return information about its composition.

    Returns:
    - is_composite: Whether the glyph is a composite
    - components: List of component names
    - has_anchors: Whether the glyph has anchors
    - anchor_positions: Dict of anchor name to (x, y) position
    - suggested_anchors: Suggested anchor positions based on metrics
    """
    result = {
        "is_composite": False,
        "components": [],
        "has_anchors": False,
        "anchor_positions": {},
        "suggested_anchors": {},
    }

    # Check for components
    for layer in glyph.layers.values():
        # Handle both Layer objects and direct StaticGlyph (for backwards compatibility)
        static_glyph = layer.glyph if hasattr(layer, 'glyph') else layer
        if static_glyph.components:
            result["is_composite"] = True
            result["components"] = [c.name for c in static_glyph.components]
            break

    # Check for anchors
    for layer in glyph.layers.values():
        static_glyph = layer.glyph if hasattr(layer, 'glyph') else layer
        if static_glyph.anchors:
            result["has_anchors"] = True
            result["anchor_positions"] = {
                a.name: (a.x, a.y) for a in static_glyph.anchors
            }
            break

    # Get metrics and suggest anchors
    for layer in glyph.layers.values():
        static_glyph = layer.glyph if hasattr(layer, 'glyph') else layer
        metrics = get_glyph_metrics(static_glyph)
        if metrics["width"] > 0:
            result["suggested_anchors"] = {
                "top": (metrics["width"] / 2, metrics.get("cap_height", 700)),
                "bottom": (metrics["width"] / 2, metrics.get("descender", 0)),
                "right": (metrics["width"], metrics.get("x_height", 500) * 0.6),
            }
            break

    return result

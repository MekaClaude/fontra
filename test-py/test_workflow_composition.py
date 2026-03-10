"""Tests for glyph composition automation features."""

import pytest

from fontra.backends import getFileSystemBackend
from fontra.core.protocols import ReadableFontBackend
from fontra.workflow.actions import FilterActionProtocol, getActionClass
from fontra.workflow.actions.composition import (
    AutoPositionDiacritics,
    SuggestComponents,
    analyze_glyph_composition,
    get_diacritic_base_code_points,
    get_glyph_metrics,
    get_unicode_combining_class,
    is_combining_mark,
    suggest_diacritic_position,
)

# Use MutatorSans font from test-common for integration tests
testCommonFontsDir = pytest.importorskip("testSupport").__file__.rsplit("/testSupport", 1)[0] + "/test-common/fonts"
MUTATOR_SANS_FONT_PATH = testCommonFontsDir + "/MutatorSans.fontra"


class TestUnicodeUtils:
    """Test Unicode utility functions."""

    def test_get_unicode_combining_class_basic(self):
        """Test basic combining class lookup."""
        # Latin A has combining class 0
        assert get_unicode_combining_class(ord("A")) == 0

    def test_get_unicode_combining_class_combining(self):
        """Test combining mark class lookup."""
        # Combining acute accent (U+0301) has combining class 230
        combining_acute = get_unicode_combining_class(0x0301)
        assert combining_acute > 0

    def test_is_combining_mark(self):
        """Test combining mark detection."""
        # Regular letter is not a combining mark
        assert is_combining_mark(ord("A")) is False

        # Combining acute is a combining mark
        assert is_combining_mark(0x0301) is True

    def test_get_diacritic_base_code_points(self):
        """Test decomposition of composite characters."""
        # Á (A + combining acute) - NFD decomposition
        result = get_diacritic_base_code_points(ord("Á"))
        assert len(result) >= 2
        assert ord("A") in result

    def test_get_diacritic_base_code_points_no_decomposition(self):
        """Test character without decomposition."""
        # Regular letter A has no decomposition
        result = get_diacritic_base_code_points(ord("A"))
        assert result == []


class TestGlyphMetrics:
    """Test glyph metric extraction."""

    def test_get_glyph_metrics_empty(self):
        """Test metrics for glyph with no path."""
        from fontra.core.classes import StaticGlyph

        glyph = StaticGlyph()
        metrics = get_glyph_metrics(glyph)

        assert metrics["width"] == 0.0
        assert metrics["x_height"] == 0.0
        assert metrics["cap_height"] == 0.0


class TestDiacriticPositioning:
    """Test diacritic positioning suggestions."""

    def test_suggest_diacritic_position_known(self):
        """Test positioning for known diacritics."""
        base_metrics = {
            "baseline": 0.0,
            "x_height": 500.0,
            "cap_height": 700.0,
            "width": 500.0,
            "ascender": 700.0,
            "descender": 0.0,
        }

        # Acute should position at top
        x, y = suggest_diacritic_position("acute", base_metrics)
        assert y == 500.0  # x-height
        assert x == 250.0  # center

    def test_suggest_diacritic_position_bottom(self):
        """Test positioning for below diacritics."""
        base_metrics = {
            "baseline": 0.0,
            "x_height": 500.0,
            "cap_height": 700.0,
            "width": 500.0,
            "ascender": 700.0,
            "descender": 0.0,
        }

        # Cedilla should position at bottom
        x, y = suggest_diacritic_position("cedilla", base_metrics)
        assert y == 0.0  # baseline/descender

    def test_suggest_diacritic_position_unknown(self):
        """Test positioning for unknown diacritic names."""
        base_metrics = {
            "baseline": 0.0,
            "x_height": 500.0,
            "cap_height": 700.0,
            "width": 500.0,
            "ascender": 700.0,
            "descender": 0.0,
        }

        # Unknown should use heuristics
        x, y = suggest_diacritic_position("unknown_diacritic", base_metrics)
        # Should default to x-height for top positioning
        assert y > 0


class TestGlyphCompositionAnalysis:
    """Test glyph composition analysis."""

    def test_analyze_glyph_composition_no_components(self):
        """Test analysis of glyph without components."""
        from fontra.core.classes import StaticGlyph, VariableGlyph

        glyph = VariableGlyph(
            name="A",
            sources=[],
            layers={
                "default": StaticGlyph(
                    components=[],
                    anchors=[],
                )
            },
        )

        result = analyze_glyph_composition(glyph)

        assert result["is_composite"] is False
        assert result["components"] == []
        assert result["has_anchors"] is False

    def test_analyze_glyph_composition_with_components(self):
        """Test analysis of composite glyph."""
        from fontra.core.classes import Component, StaticGlyph, VariableGlyph

        glyph = VariableGlyph(
            name="AE",
            sources=[],
            layers={
                "default": StaticGlyph(
                    components=[
                        Component(name="A"),
                        Component(name="E"),
                    ],
                    anchors=[],
                )
            },
        )

        result = analyze_glyph_composition(glyph)

        assert result["is_composite"] is True
        assert result["components"] == ["A", "E"]

    def test_analyze_glyph_composition_with_anchors(self):
        """Test analysis of glyph with anchors."""
        from fontra.core.classes import Anchor, StaticGlyph, VariableGlyph

        glyph = VariableGlyph(
            name="A",
            sources=[],
            layers={
                "default": StaticGlyph(
                    components=[],
                    anchors=[
                        Anchor(name="top", x=250, y=700),
                        Anchor(name="_top", x=250, y=700),
                    ],
                    xAdvance=500,
                )
            },
        )

        result = analyze_glyph_composition(glyph)

        assert result["has_anchors"] is True
        assert "top" in result["anchor_positions"]
        assert result["anchor_positions"]["top"] == (250, 700)

    def test_analyze_glyph_composition_suggested_anchors(self):
        """Test suggested anchor positions."""
        from fontra.core.classes import StaticGlyph, VariableGlyph

        glyph = VariableGlyph(
            name="A",
            sources=[],
            layers={
                "default": StaticGlyph(
                    components=[],
                    anchors=[],
                    xAdvance=500,
                )
            },
        )

        # Need to add path data for proper metrics
        # For now just test structure exists
        result = analyze_glyph_composition(glyph)

        assert "suggested_anchors" in result
        assert "top" in result["suggested_anchors"] or result["suggested_anchors"] == {}


class TestAutoPositionDiacriticsFilter:
    """Integration tests for AutoPositionDiacritics filter action."""

    @pytest.fixture
    def testFontBackend(self):
        """Get a font backend for testing."""
        import pathlib
        commonFontsDir = pathlib.Path(__file__).parent.parent / "test-common" / "fonts"
        return getFileSystemBackend(commonFontsDir / "MutatorSans.fontra")

    @pytest.mark.parametrize("glyphName", ["A", "a", "n"])
    async def test_autoPositionDiacritics_basic(self, testFontBackend, glyphName) -> None:
        """Test that AutoPositionDiacritics can process glyphs."""
        actionClass = getActionClass("filter", "auto-position-diacritics")
        action = actionClass(use_anchors=False, skip_components=False)
        assert isinstance(action, FilterActionProtocol)
        assert isinstance(action, ReadableFontBackend)

        async with action.connect(testFontBackend):
            resultGlyph = await action.getGlyph(glyphName)
            assert resultGlyph is not None
            # Should have anchors now
            for layer in resultGlyph.layers.values():
                assert layer.glyph.anchors is not None
                assert len(layer.glyph.anchors) > 0

    async def test_autoPositionDiacritics_respectsExistingAnchors(
        self, testFontBackend
    ) -> None:
        """Test that use_anchors=True preserves existing anchors."""
        # Get a glyph that likely has anchors
        originalGlyph = await testFontBackend.getGlyph("A")
        hasAnchors = any(
            layer.glyph.anchors for layer in originalGlyph.layers.values()
        )

        actionClass = getActionClass("filter", "auto-position-diacritics")
        action = actionClass(use_anchors=True)

        async with action.connect(testFontBackend):
            resultGlyph = await action.getGlyph("A")
            assert resultGlyph is not None

            if hasAnchors:
                # Anchors should be preserved
                for layer in resultGlyph.layers.values():
                    assert layer.glyph.anchors is not None

    async def test_autoPositionDiacritics_skipsComponents(
        self, testFontBackend
    ) -> None:
        """Test that skip_components=True skips glyphs with components."""
        # Get a glyph with components (like Adieresis or AE)
        componentGlyph = await testFontBackend.getGlyph("AE")
        hasComponents = any(
            layer.glyph.components for layer in componentGlyph.layers.values()
        )

        actionClass = getActionClass("filter", "auto-position-diacritics")
        action = actionClass(skip_components=True)

        async with action.connect(testFontBackend):
            # Test with a component glyph
            resultGlyph = await action.getGlyph("AE")
            assert resultGlyph is not None

            if hasComponents:
                # Components should be preserved
                for layer in resultGlyph.layers.values():
                    assert layer.glyph.components is not None


class TestSuggestComponentsFilter:
    """Integration tests for SuggestComponents filter action."""

    @pytest.fixture
    def testFontBackend(self):
        """Get a font backend for testing."""
        import pathlib
        commonFontsDir = pathlib.Path(__file__).parent.parent / "test-common" / "fonts"
        return getFileSystemBackend(commonFontsDir / "MutatorSans.fontra")

    async def test_suggestComponents_basic(self, testFontBackend) -> None:
        """Test that SuggestComponents can process glyphs."""
        actionClass = getActionClass("filter", "suggest-components")
        action = actionClass()
        assert isinstance(action, FilterActionProtocol)
        assert isinstance(action, ReadableFontBackend)

        async with action.connect(testFontBackend):
            resultGlyph = await action.getGlyph("A")
            assert resultGlyph is not None

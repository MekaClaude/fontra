"""Tests for the design guide module."""

import pytest

from fontra.core.design_guide import (
    DesignPhase,
    GlyphTips,
    OpticalCorrection,
    get_all_terms,
    get_design_phase,
    get_design_phases,
    get_glyph_tips,
    get_optical_corrections,
    get_related_glyphs,
    get_spacing_principles,
    get_term_definition,
)


class TestGetGlyphTips:
    def test_known_glyph_o(self):
        tips = get_glyph_tips("o")
        assert isinstance(tips, GlyphTips)
        assert tips.glyphName == "o"
        assert tips.category == "foundation"
        assert tips.phase == 1
        assert tips.phaseName == "Foundation"
        assert len(tips.tips) > 0
        assert len(tips.commonMistakes) > 0
        assert len(tips.opticalCorrections) > 0
        assert "b" in tips.informsDesignOf
        assert "c" in tips.informsDesignOf
        assert len(tips.informedBy) == 0

    def test_known_glyph_n(self):
        tips = get_glyph_tips("n")
        assert tips.glyphName == "n"
        assert tips.category == "foundation"
        assert tips.phase == 1
        assert "m" in tips.informsDesignOf
        assert "h" in tips.informsDesignOf
        assert "stem" in tips.reusableComponents

    def test_known_glyph_H(self):
        tips = get_glyph_tips("H")
        assert tips.glyphName == "H"
        assert tips.category == "capital_foundation"
        assert tips.phase == 6
        assert "I" in tips.informsDesignOf
        assert "E" in tips.informsDesignOf
        assert len(tips.opticalCorrections) > 0

    def test_unknown_glyph(self):
        tips = get_glyph_tips("nonexistent_glyph")
        assert isinstance(tips, GlyphTips)
        assert tips.glyphName == "nonexistent_glyph"
        assert tips.category == ""
        assert tips.phase == 0
        assert tips.tips == []
        assert tips.informsDesignOf == []

    def test_optical_corrections_resolved(self):
        tips = get_glyph_tips("o")
        for correction in tips.opticalCorrections:
            assert "id" in correction
            assert "name" in correction
            assert "description" in correction
            assert correction["name"] != ""


class TestGetRelatedGlyphs:
    def test_o_relationships(self):
        related = get_related_glyphs("o")
        assert "b" in related["informsDesignOf"]
        assert "c" in related["informsDesignOf"]
        assert "e" in related["informsDesignOf"]
        assert related["informedBy"] == []

    def test_H_relationships(self):
        related = get_related_glyphs("H")
        assert "I" in related["informsDesignOf"]
        assert "B" in related["informsDesignOf"]
        assert "E" in related["informsDesignOf"]

    def test_O_capital_informs(self):
        related = get_related_glyphs("o")
        assert "O" in related["informsCapitals"]
        assert "C" in related["informsCapitals"]

    def test_unknown_glyph(self):
        related = get_related_glyphs("xyz_unknown")
        assert related["informsDesignOf"] == []
        assert related["informedBy"] == []
        assert related["informsCapitals"] == []


class TestDesignPhases:
    def test_get_all_phases(self):
        phases = get_design_phases()
        assert len(phases) == 9
        assert all(isinstance(p, DesignPhase) for p in phases)
        assert phases[0].phase == 1
        assert phases[0].name == "Foundation"
        assert "o" in phases[0].glyphs
        assert "n" in phases[0].glyphs

    def test_get_phase_for_glyph(self):
        phase = get_design_phase("o")
        assert phase is not None
        assert phase.phase == 1
        assert phase.name == "Foundation"

    def test_get_phase_for_capital(self):
        phase = get_design_phase("H")
        assert phase is not None
        assert phase.phase == 6
        assert phase.name == "Capital Foundation"

    def test_get_phase_unknown_glyph(self):
        phase = get_design_phase("unknown_glyph")
        assert phase is None


class TestOpticalCorrections:
    def test_corrections_for_o(self):
        corrections = get_optical_corrections("o")
        assert len(corrections) > 0
        assert all(isinstance(c, OpticalCorrection) for c in corrections)
        correction_ids = [c.id for c in corrections]
        assert "overshoot" in correction_ids

    def test_corrections_for_H(self):
        corrections = get_optical_corrections("H")
        correction_ids = [c.id for c in corrections]
        assert "horizontalThinning" in correction_ids

    def test_corrections_for_x(self):
        corrections = get_optical_corrections("x")
        correction_ids = [c.id for c in corrections]
        assert "crossingDiagonals" in correction_ids

    def test_corrections_for_s(self):
        corrections = get_optical_corrections("s")
        correction_ids = [c.id for c in corrections]
        assert "counterBalance" in correction_ids

    def test_corrections_for_unknown(self):
        corrections = get_optical_corrections("unknown_glyph_xyz")
        assert corrections == []


class TestSpacingAndTerms:
    def test_spacing_principles(self):
        spacing = get_spacing_principles()
        assert "fundamentals" in spacing
        assert "referenceStrings" in spacing
        assert "rules" in spacing
        assert len(spacing["fundamentals"]) > 0

    def test_term_definition(self):
        defn = get_term_definition("stem")
        assert defn != ""
        assert "vertical" in defn.lower() or "stroke" in defn.lower()

    def test_unknown_term(self):
        defn = get_term_definition("nonexistent_term")
        assert defn == ""

    def test_all_terms(self):
        terms = get_all_terms()
        assert isinstance(terms, dict)
        assert "stem" in terms
        assert "bowl" in terms
        assert "counter" in terms
        assert "overshoot" in terms

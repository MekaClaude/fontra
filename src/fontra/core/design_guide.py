"""Design guide module for type design learning features.

Provides contextual type design advice, letter relationships, optical correction
recommendations, and design order guidance based on professional type design
knowledge from sources including Design With FontForge, Typographica, and
OH no Type Company.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from importlib.resources import files
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Path to the knowledge base JSON in the client data directory
_KNOWLEDGE_BASE_PATH = (
    files("fontra") / "client" / "data" / "type-design-knowledge.json"
)

_knowledge_base: dict | None = None


def _load_knowledge_base() -> dict:
    """Load and cache the type design knowledge base."""
    global _knowledge_base
    if _knowledge_base is None:
        try:
            kb_text = _KNOWLEDGE_BASE_PATH.read_text(encoding="utf-8")
            _knowledge_base = json.loads(kb_text)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            logger.error("Failed to load type design knowledge base: %s", e)
            _knowledge_base = {}
    return _knowledge_base


@dataclass
class GlyphTips:
    """Container for contextual tips about a specific glyph."""

    glyphName: str
    category: str = ""
    phase: int = 0
    phaseName: str = ""
    phaseDescription: str = ""
    tips: list[str] = field(default_factory=list)
    commonMistakes: list[str] = field(default_factory=list)
    opticalCorrections: list[dict[str, str]] = field(default_factory=list)
    reusableComponents: list[str] = field(default_factory=list)
    informsDesignOf: list[str] = field(default_factory=list)
    informedBy: list[str] = field(default_factory=list)


@dataclass
class DesignPhase:
    """Represents a phase in the recommended design order."""

    phase: int
    name: str
    description: str
    glyphs: list[str] = field(default_factory=list)
    tips: list[str] = field(default_factory=list)


@dataclass
class OpticalCorrection:
    """An optical correction recommendation."""

    id: str
    name: str
    description: str
    affectedGlyphs: list[str] = field(default_factory=list)
    rule: str = ""


def get_glyph_tips(glyph_name: str) -> GlyphTips:
    """Get contextual tips and advice for designing a specific glyph.

    Args:
        glyph_name: The glyph name (e.g., 'o', 'n', 'H', 'A').

    Returns:
        GlyphTips with construction advice, relationships, and corrections.
    """
    kb = _load_knowledge_base()
    glyphs = kb.get("glyphs", {})
    corrections = kb.get("opticalCorrections", {})
    phases = kb.get("designOrder", {}).get("phases", [])

    glyph_data = glyphs.get(glyph_name)
    if glyph_data is None:
        return GlyphTips(glyphName=glyph_name)

    # Resolve optical corrections with full descriptions
    correction_details = []
    for correction_id in glyph_data.get("opticalCorrections", []):
        correction_data = corrections.get(correction_id, {})
        if correction_data:
            correction_details.append(
                {
                    "id": correction_id,
                    "name": correction_data.get("name", correction_id),
                    "description": correction_data.get("description", ""),
                    "rule": correction_data.get("rule", ""),
                }
            )

    # Find the phase info
    phase_num = glyph_data.get("phase", 0)
    phase_name = ""
    phase_desc = ""
    for phase in phases:
        if phase.get("phase") == phase_num:
            phase_name = phase.get("name", "")
            phase_desc = phase.get("description", "")
            break

    return GlyphTips(
        glyphName=glyph_name,
        category=glyph_data.get("category", ""),
        phase=phase_num,
        phaseName=phase_name,
        phaseDescription=phase_desc,
        tips=glyph_data.get("tips", []),
        commonMistakes=glyph_data.get("commonMistakes", []),
        opticalCorrections=correction_details,
        reusableComponents=glyph_data.get("reusableComponents", []),
        informsDesignOf=glyph_data.get("informsDesignOf", []),
        informedBy=glyph_data.get("informedBy", []),
    )


def get_related_glyphs(glyph_name: str) -> dict[str, list[str]]:
    """Get typographic relationships for a glyph.

    Returns which glyphs this glyph informs the design of, and which
    glyphs inform its design.

    Args:
        glyph_name: The glyph name (e.g., 'o', 'n', 'H').

    Returns:
        Dict with 'informsDesignOf', 'informedBy', and 'informsCapitals' lists.
    """
    kb = _load_knowledge_base()
    glyph_data = kb.get("glyphs", {}).get(glyph_name)

    if glyph_data is None:
        return {"informsDesignOf": [], "informedBy": [], "informsCapitals": []}

    return {
        "informsDesignOf": glyph_data.get("informsDesignOf", []),
        "informedBy": glyph_data.get("informedBy", []),
        "informsCapitals": glyph_data.get("informsDesignOfCapitals", []),
    }


def get_design_phases() -> list[DesignPhase]:
    """Get the full recommended design order as a list of phases.

    Returns:
        List of DesignPhase objects, ordered by phase number.
    """
    kb = _load_knowledge_base()
    phases_data = kb.get("designOrder", {}).get("phases", [])

    return [
        DesignPhase(
            phase=p.get("phase", 0),
            name=p.get("name", ""),
            description=p.get("description", ""),
            glyphs=p.get("glyphs", []),
            tips=p.get("tips", []),
        )
        for p in phases_data
    ]


def get_design_phase(glyph_name: str) -> Optional[DesignPhase]:
    """Get the design phase for a specific glyph.

    Args:
        glyph_name: The glyph name (e.g., 'o', 'n', 'H').

    Returns:
        DesignPhase if the glyph is in the knowledge base, None otherwise.
    """
    kb = _load_knowledge_base()
    glyph_data = kb.get("glyphs", {}).get(glyph_name)
    if glyph_data is None:
        return None

    phase_num = glyph_data.get("phase", 0)
    phases_data = kb.get("designOrder", {}).get("phases", [])

    for p in phases_data:
        if p.get("phase") == phase_num:
            return DesignPhase(
                phase=p.get("phase", 0),
                name=p.get("name", ""),
                description=p.get("description", ""),
                glyphs=p.get("glyphs", []),
                tips=p.get("tips", []),
            )

    return None


def get_optical_corrections(glyph_name: str) -> list[OpticalCorrection]:
    """Get applicable optical corrections for a specific glyph.

    Args:
        glyph_name: The glyph name.

    Returns:
        List of OpticalCorrection objects applicable to the glyph.
    """
    kb = _load_knowledge_base()
    corrections_data = kb.get("opticalCorrections", {})
    glyph_data = kb.get("glyphs", {}).get(glyph_name)

    if glyph_data is None:
        # Even if the glyph isn't in our detailed database, check if it
        # appears in any correction's affectedGlyphs list
        results = []
        for correction_id, correction in corrections_data.items():
            if glyph_name in correction.get("affectedGlyphs", []):
                results.append(
                    OpticalCorrection(
                        id=correction_id,
                        name=correction.get("name", correction_id),
                        description=correction.get("description", ""),
                        affectedGlyphs=correction.get("affectedGlyphs", []),
                        rule=correction.get("rule", ""),
                    )
                )
        return results

    correction_ids = glyph_data.get("opticalCorrections", [])
    results = []
    for correction_id in correction_ids:
        correction = corrections_data.get(correction_id, {})
        if correction:
            results.append(
                OpticalCorrection(
                    id=correction_id,
                    name=correction.get("name", correction_id),
                    description=correction.get("description", ""),
                    affectedGlyphs=correction.get("affectedGlyphs", []),
                    rule=correction.get("rule", ""),
                )
            )
    return results


def get_spacing_principles() -> dict[str, Any]:
    """Get spacing fundamentals and reference strings.

    Returns:
        Dict with 'fundamentals', 'referenceStrings', and 'rules'.
    """
    kb = _load_knowledge_base()
    return kb.get("spacingPrinciples", {})


def get_term_definition(term: str) -> str:
    """Get the definition of a typographic term.

    Args:
        term: The term to look up (e.g., 'stem', 'bowl', 'counter').

    Returns:
        The definition string, or empty string if not found.
    """
    kb = _load_knowledge_base()
    terms = kb.get("commonTerms", {})
    return terms.get(term, "")


def get_all_terms() -> dict[str, str]:
    """Get all typographic term definitions.

    Returns:
        Dict mapping term names to their definitions.
    """
    kb = _load_knowledge_base()
    return kb.get("commonTerms", {})

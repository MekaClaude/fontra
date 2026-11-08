"""Component-workflow planning for AI agents.

The type-design workflow that makes agent-driven font design efficient is
the one described in the fontra-coach knowledge base: start from a small
set of *foundation* glyphs (the classic set is `o` + `n` for lowercase
and `H` + `O` for capitals), then derive everything else from them by
re-using the same components — the arch of `n`, the bowl of `o`, the
stem of `H`.

This module turns that knowledge into a concrete, ordered plan:

    plan = WorkflowPlanner().plan(["n", "o", "H", "O", "I"])

It reads two knowledge files:

* `fontra-coach/knowledge/v1/glyph-dna.json` — per glyph: `dna_role`,
  `builds_from`, `feeds_into` (with the method and the parts used).
* `fontra-coach/knowledge/v1/workflow-sequences.json` — the staged build
  order (stage 1 = `o` + `n`, stage 6 = the capitals, ...).

The richer per-glyph component list, tips and phase come from
`fontra.core.design_guide`, which is always available.
"""

from __future__ import annotations

import json
import os
import pathlib
from typing import Any

from fontra.core import design_guide

# Environment variable to point at a knowledge base explicitly.
KNOWLEDGE_ROOT_ENV = "FONTRA_MCP_KNOWLEDGE_ROOT"

# The classic foundation set: lowercase o + n, capitals H + O.
DEFAULT_START_GLYPHS = ["o", "n", "H", "O"]

# Priority of DNA roles when ordering glyphs inside one stage.
_ROLE_PRIORITY = {
    "primary_foundation": 0,
    "capital_foundation": 1,
    "arch_family": 2,
    "bowl_family": 3,
    "secondary": 4,
    "diagonal_family": 5,
}


def findKnowledgeRoot(explicit: str | pathlib.Path | None = None) -> pathlib.Path | None:
    """Locate the fontra-coach knowledge directory.

    Looks at (in order): the explicit argument, the
    `FONTRA_MCP_KNOWLEDGE_ROOT` environment variable, and the repository
    layout around this package (`<repo>/fontra-coach/knowledge/v1`).
    """
    candidates: list[pathlib.Path] = []
    if explicit:
        candidates.append(pathlib.Path(explicit))
    envRoot = os.environ.get(KNOWLEDGE_ROOT_ENV)
    if envRoot:
        candidates.append(pathlib.Path(envRoot))
    # <repo>/fontra-mcp/src/fontra_mcp/workflow.py -> <repo>/fontra-coach/knowledge/v1
    here = pathlib.Path(__file__).resolve()
    for parent in here.parents:
        candidates.append(parent / "fontra-coach" / "knowledge" / "v1")
    for candidate in candidates:
        try:
            if (candidate / "glyph-dna.json").is_file():
                return candidate
        except OSError:
            continue
    return None


class WorkflowPlanner:
    """Turn a set of starting glyphs into an ordered component build plan."""

    def __init__(self, knowledgeRoot: str | pathlib.Path | None = None):
        self.knowledgeRoot = findKnowledgeRoot(knowledgeRoot)
        self._dna: dict[str, dict] | None = None
        self._sequences: dict | None = None

    # ------------------------------------------------------------------
    # Knowledge loading
    # ------------------------------------------------------------------

    def _loadJson(self, name: str) -> dict:
        if self.knowledgeRoot is None:
            return {}
        path = self.knowledgeRoot / name
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    @property
    def dna(self) -> dict[str, dict]:
        if self._dna is None:
            self._dna = self._loadJson("glyph-dna.json").get("glyphs", {}) or {}
        return self._dna

    @property
    def sequences(self) -> dict:
        if self._sequences is None:
            self._sequences = self._loadJson("workflow-sequences.json")
        return self._sequences

    @property
    def available(self) -> bool:
        return self.knowledgeRoot is not None

    # ------------------------------------------------------------------
    # Stage handling
    # ------------------------------------------------------------------

    @staticmethod
    def _stageGlyphs(stage: dict) -> list[str]:
        """The glyph list of a stage, whatever key the KB uses."""
        glyphs: list[str] = []
        for key in (
            "glyphs",
            "glyphs_first",
            "glyphs_second",
            "glyphs_third",
            "glyphs_remainder",
        ):
            value = stage.get(key)
            if isinstance(value, list):
                glyphs.extend(str(g) for g in value)
        return glyphs

    def _stages(self) -> list[dict]:
        stages: list[dict] = []
        for sequence in self.sequences.get("sequences", []) or []:
            for stage in sequence.get("stages", []) or []:
                stages.append(
                    {
                        "sequenceId": sequence.get("id", ""),
                        "sequenceName": sequence.get("name", ""),
                        "stage": stage.get("stage", 0),
                        "name": stage.get("name", ""),
                        "rationale": stage.get("rationale", ""),
                        "completionCriteria": stage.get("completion_criteria", ""),
                        "unlocks": stage.get("unlocks", []),
                        "glyphs": self._stageGlyphs(stage),
                    }
                )
        stages.sort(key=lambda s: s["stage"])
        return stages

    def _stageFor(self, glyphName: str) -> dict | None:
        for stage in self._stages():
            if glyphName in stage["glyphs"]:
                return stage
        return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def glyphDNA(self, glyphName: str) -> dict:
        """The DNA record of one glyph: role, what it is built from, what it unlocks."""
        record = dict(self.dna.get(glyphName) or {})
        tips = design_guide.get_glyph_tips(glyphName)
        record.setdefault("name", glyphName)
        record["role"] = record.get("dna_role", "")
        record["components"] = list(tips.components or [])
        record["tips"] = list(tips.tips or [])
        record["phase"] = tips.phase
        record["phaseName"] = tips.phaseName
        record["commonMistakes"] = list(tips.commonMistakes or [])
        record["proTips"] = list(tips.proTips or [])
        stage = self._stageFor(glyphName)
        if stage:
            record["stage"] = stage["stage"]
            record["stageName"] = stage["name"]
            record["stageRationale"] = stage["rationale"]
        record["found"] = glyphName in self.dna
        return record

    def plan(self, startGlyphs: list[str] | None = None) -> dict:
        """Build an ordered plan for the requested starting glyphs."""
        startGlyphs = list(startGlyphs or DEFAULT_START_GLYPHS)
        stages = self._stages()

        entries: list[dict] = []
        for glyphName in startGlyphs:
            stage = self._stageFor(glyphName)
            dna = self.glyphDNA(glyphName)
            entry = {
                "glyph": glyphName,
                "role": dna.get("dna_role", ""),
                "stage": stage["stage"] if stage else dna.get("stage", 0),
                "stageName": stage["name"] if stage else dna.get("phaseName", ""),
                "components": dna.get("components", []),
                "tips": dna.get("tips", [])[:4],
                "commonMistakes": dna.get("commonMistakes", [])[:3],
                "buildsFrom": [
                    {
                        "glyph": b.get("glyph"),
                        "method": b.get("method"),
                        "confidence": b.get("confidence"),
                        "partsUsed": b.get("parts_used", []),
                    }
                    for b in (dna.get("builds_from") or [])
                ],
                "feedsInto": [
                    {
                        "glyph": f.get("glyph"),
                        "method": f.get("method"),
                        "confidence": f.get("confidence"),
                        "partsUsed": f.get("parts_used", []),
                    }
                    for f in (dna.get("feeds_into") or [])
                ],
                "inRequest": True,
            }
            entries.append(entry)

        # Order: stage first, then the stage's own order, then DNA role.
        stageOrder: dict[str, int] = {}
        for stage in stages:
            for index, glyphName in enumerate(stage["glyphs"]):
                stageOrder.setdefault(glyphName, index)

        entries.sort(
            key=lambda e: (
                e["stage"],
                stageOrder.get(e["glyph"], 999),
                _ROLE_PRIORITY.get(e["role"], 50),
                e["glyph"],
            )
        )
        for index, entry in enumerate(entries, start=1):
            entry["position"] = index

        # Dependencies between the requested glyphs themselves.
        requested = {e["glyph"] for e in entries}
        for entry in entries:
            entry["dependsOn"] = [
                b["glyph"]
                for b in entry["buildsFrom"]
                if b.get("glyph") in requested and b.get("glyph") != entry["glyph"]
            ]

        # What the requested set unlocks next.
        unlocked: dict[str, dict] = {}
        for entry in entries:
            for feed in entry["feedsInto"]:
                target = feed.get("glyph")
                if not target or target in requested:
                    continue
                current = unlocked.get(target)
                if current is None:
                    targetStage = self._stageFor(target)
                    unlocked[target] = {
                        "glyph": target,
                        "from": entry["glyph"],
                        "method": feed.get("method"),
                        "confidence": feed.get("confidence"),
                        "partsUsed": feed.get("parts_used", []),
                        "stage": targetStage["stage"] if targetStage else 0,
                        "stageName": targetStage["name"] if targetStage else "",
                    }
                elif current.get("from") == entry["glyph"]:
                    current.setdefault("alsoFrom", []).append(entry["glyph"])

        nextGlyphs = sorted(
            unlocked.values(), key=lambda u: (u["stage"], u["glyph"])
        )

        return {
            "startGlyphs": startGlyphs,
            "knowledgeAvailable": self.available,
            "knowledgeRoot": str(self.knowledgeRoot) if self.knowledgeRoot else None,
            "order": entries,
            "nextGlyphs": nextGlyphs,
            "stages": [
                {
                    "stage": s["stage"],
                    "name": s["name"],
                    "rationale": s["rationale"],
                    "completionCriteria": s["completionCriteria"],
                    "glyphs": s["glyphs"],
                }
                for s in stages
            ],
            "workflow": self._workflowSteps(entries),
            "notes": [
                "Build the glyphs in 'order'; each one fixes the weight, "
                "proportion and spacing of the whole family.",
                "'components' lists the reusable parts — build them as separate "
                "component glyphs and place them with add_component so later "
                "glyphs can reuse the same shapes.",
                "Use copy_glyph to start a new glyph from a finished one, then "
                "add_component to place the reused parts.",
                "Use find_glyphs_using / get_component_graph to check that a "
                "component really is shared.",
            ],
        }

    @staticmethod
    def _workflowSteps(entries: list[dict]) -> list[str]:
        steps = []
        for entry in entries:
            components = ", ".join(entry.get("components") or []) or "its outline"
            steps.append(
                f"{entry['position']}. {entry['glyph']} "
                f"[{entry.get('role') or 'glyph'}] — components: {components}"
            )
        return steps

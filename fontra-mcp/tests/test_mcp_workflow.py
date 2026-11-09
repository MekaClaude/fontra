"""Tests for the component-workflow planner."""

import pathlib

import pytest

from fontra_mcp.workflow import WorkflowPlanner, findKnowledgeRoot

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]


@pytest.fixture()
def planner():
    return WorkflowPlanner()


def test_knowledge_root_is_found(planner):
    root = findKnowledgeRoot()
    if root is None:
        pytest.skip("fontra-coach knowledge base is not available")
    assert (root / "glyph-dna.json").is_file()
    assert planner.available is True


def test_plan_orders_the_foundation_glyphs(planner):
    plan = planner.plan(["n", "o", "H", "O", "I"])
    order = [entry["glyph"] for entry in plan["order"]]
    # Lowercase foundations come before capitals.
    assert order.index("o") < order.index("H")
    assert order.index("n") < order.index("H")
    assert order.index("O") < order.index("I")


def test_plan_reports_components_and_dependencies(planner):
    plan = planner.plan(["n", "o", "H", "O", "I"])
    byGlyph = {entry["glyph"]: entry for entry in plan["order"]}
    assert "arch" in byGlyph["n"]["components"]
    assert "bowl" in byGlyph["o"]["components"]
    assert byGlyph["n"]["role"] == "primary_foundation"
    assert byGlyph["H"]["role"] == "capital_foundation"


def test_plan_lists_the_glyphs_unlocked(planner):
    plan = planner.plan(["n", "o", "H", "O", "I"])
    unlocked = {entry["glyph"] for entry in plan["nextGlyphs"]}
    assert "h" in unlocked
    assert "m" in unlocked
    assert "I" not in unlocked  # already requested


def test_plan_depends_on_inside_the_requested_set(planner):
    plan = planner.plan(["n", "h"])
    byGlyph = {entry["glyph"]: entry for entry in plan["order"]}
    assert byGlyph["h"]["dependsOn"] == ["n"]


def test_glyph_dna(planner):
    dna = planner.glyphDNA("n")
    assert dna["name"] == "n"
    assert dna["role"] == "primary_foundation"
    assert dna["components"]
    assert any(feed["glyph"] == "m" for feed in dna["feeds_into"])
    assert dna["found"] is True


def test_glyph_dna_for_unknown_glyph(planner):
    dna = planner.glyphDNA("no_such_glyph")
    assert dna["found"] is False
    assert dna["components"] == []


def test_default_start_glyphs_are_the_classic_foundations(planner):
    plan = planner.plan()
    order = [entry["glyph"] for entry in plan["order"]]
    assert order[:2] == ["o", "n"]

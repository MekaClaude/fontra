"""Tests for the fontra-mcp service layer (reads, gated writes, workflow)."""

import pathlib
import shutil

import pytest

from fontra_mcp.service import FontService, FontServiceError

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT_PATH = REPO_ROOT / "test-common" / "fonts" / "MutatorSans.fontra"

# asyncio_mode=auto (pyproject) runs async tests automatically; sync tests
# are unaffected, so no pytestmark needed.


@pytest.fixture()
def service():
    return FontService(root=REPO_ROOT / "test-common" / "fonts")


@pytest.fixture()
def writeService(tmp_path):
    dst = tmp_path / "MutatorSans.fontra"
    shutil.copytree(FONT_PATH, dst)
    return FontService(root=tmp_path, writesAllowed=True)


# ----------------------------------------------------------------------
# Discovery / paths
# ----------------------------------------------------------------------


async def test_list_fonts_finds_mutator(service):
    result = service.listFonts()
    assert result["count"] >= 1
    assert any(f["id"] == "MutatorSans.fontra" for f in result["fonts"])


async def test_list_fonts_path_round_trips(service):
    """The `path` returned by list_fonts must be accepted by open_font.

    Regression: list_fonts returned Windows backslash paths while
    _resolveFontPath rejected any path containing a backslash.
    """
    listed = service.listFonts()
    entry = next(f for f in listed["fonts"] if f["id"] == "MutatorSans.fontra")
    summary = await service.openFont(entry["path"])
    assert summary["unitsPerEm"] == 1000


async def test_absolute_path_with_backslashes_accepted(tmp_path):
    """Windows absolute paths must work (they contain backslashes)."""
    dst = tmp_path / "MutatorSans.fontra"
    shutil.copytree(FONT_PATH, dst)
    service = FontService(root=tmp_path)
    # str(tmp_path) on Windows is a backslash path.
    summary = await service.openFont(str(dst))
    assert summary["unitsPerEm"] == 1000


async def test_open_font_summary(service):
    summary = await service.openFont("MutatorSans.fontra")
    assert summary["familyName"] == "MutatorMathTest"
    assert summary["unitsPerEm"] == 1000
    assert summary["glyphCount"] >= 54
    assert summary["readOnly"] is True


async def test_open_font_reports_writable_state(writeService):
    summary = await writeService.openFont("MutatorSans.fontra")
    assert summary["readOnly"] is False
    assert summary["writesAllowed"] is True


async def test_list_glyphs_bounded(service):
    result = await service.listGlyphs("MutatorSans.fontra", maxGlyphs=5)
    assert len(result["codepoints"]) == 5
    assert result["count"] >= 54
    assert result["truncated"] is True


# ----------------------------------------------------------------------
# Glyphs
# ----------------------------------------------------------------------


async def test_get_glyph_summary(service):
    glyph = await service.getGlyph("MutatorSans.fontra", "A")
    assert glyph["name"] == "A"
    assert glyph["layers"], "variable glyph should have layers"
    for layer in glyph["layers"].values():
        assert "xAdvance" in layer
        assert "bounds" in layer


async def test_get_glyph_summary_reports_components(service):
    glyph = await service.getGlyph("MutatorSans.fontra", "Aacute")
    components = glyph["layers"]["light-condensed"]["components"]
    assert [c["name"] for c in components] == ["A", "acute"]
    assert components[1]["transformation"]["translateX"] == 99


async def test_get_glyph_missing_raises(service):
    with pytest.raises(FontServiceError):
        await service.getGlyph("MutatorSans.fontra", "NOT_A_GLYPH")


async def test_get_glyph_full_has_layer_data(service):
    full = await service.getGlyphFull("MutatorSans.fontra", "A")
    assert full["name"] == "A"
    assert full["layers"], "expected layer data in full glyph"
    layer = next(iter(full["layers"].values()))
    assert "glyph" in layer


async def test_get_glyph_full_uses_unpacked_contours(service):
    """get_glyph_full must speak the same representation Fontra stores.

    The .fontra backend writes unpacked contours; returning the packed
    form made a read/write round-trip change the file.
    """
    full = await service.getGlyphFull("MutatorSans.fontra", "A")
    path = full["layers"]["light-condensed"]["glyph"]["path"]
    assert "contours" in path
    assert "pointTypes" not in path
    point = path["contours"][0]["points"][0]
    assert "x" in point and "y" in point


async def test_get_glyph_full_packed_variant(service):
    full = await service.getGlyphFull("MutatorSans.fontra", "A", packed=True)
    path = full["layers"]["light-condensed"]["glyph"]["path"]
    assert "pointTypes" in path
    assert "coordinates" in path


async def test_get_font_info_and_axes(service):
    info = await service.getFontInfo("MutatorSans.fontra")
    assert info["familyName"] == "MutatorMathTest"
    axes = await service.getAxes("MutatorSans.fontra")
    names = [a["name"] for a in axes["axes"]]
    for expected in ("weight", "width"):
        assert expected in names


async def test_get_sources(service):
    sources = await service.getSources("MutatorSans.fontra")
    assert len(sources["sources"]) >= 4


# ----------------------------------------------------------------------
# Kerning
# ----------------------------------------------------------------------


async def test_get_kerning_bounded(service):
    kerning = await service.getKerning("MutatorSans.fontra", maxPairs=3)
    assert kerning["pairsShown"] <= 3
    assert "sources" in kerning


async def test_kerning_values_are_lists_per_source(service):
    """Kerning.values is left -> right -> [value per source].

    The summarizer used to report the inner list as if it were a scalar.
    """
    kerning = await service.getKerning("MutatorSans.fontra", maxPairs=500)
    table = next(iter(kerning["sources"].values()))
    sourceCount = len(table["sourceIdentifiers"])
    assert sourceCount >= 1
    checked = 0
    for pair, value in table["values"].items():
        assert isinstance(value, list), f"pair {pair} should map to a list"
        assert len(value) == sourceCount
        checked += 1
    assert checked > 0


# ----------------------------------------------------------------------
# Component lookups
# ----------------------------------------------------------------------


async def test_find_glyphs_using_does_not_crash(service):
    """Regression: FontHandler.findGlyphsThatUseGlyph() needs a connection."""
    result = await service.findGlyphsUsing("MutatorSans.fontra", "A")
    assert result["supported"] is True
    assert "Aacute" in result["glyphs"]


async def test_get_component_graph(service):
    graph = await service.getComponentGraph("MutatorSans.fontra")
    assert "A" in graph["components"]
    assert "Aacute" in graph["components"]["A"]
    assert any(e["component"] == "acute" for e in graph["glyphs"]["Aacute"])


# ----------------------------------------------------------------------
# Analysis + design guide
# ----------------------------------------------------------------------


async def test_analyze_glyph_returns_analysis(service):
    analysis = await service.analyzeGlyph("MutatorSans.fontra", "A")
    assert analysis["glyphName"] == "A"
    assert analysis["numContours"] >= 0
    assert "verticalStems" in analysis


async def test_design_guide_helpers(service):
    tips = service.getGlyphTips("A")
    assert isinstance(tips, dict)
    phase = service.getDesignPhase("A")
    assert isinstance(phase, dict)
    spacing = service.getSpacingPrinciples()
    assert isinstance(spacing, dict)
    term = service.getTermDefinition("overshoot")
    assert isinstance(term, dict)
    catalog = service.getComponentCatalog()
    assert isinstance(catalog, dict)


async def test_design_guide_extras_are_exposed(service):
    assert "terms" in service.getAllTerms()
    assert "components" in service.getAllComponents()
    assert service.getComponents("n")["components"]
    assert "suggestions" in service.getSuggestions("n")
    assert "cards" in service.getInfoCards("n")
    assert "cards" in service.getCards("n")
    assert "tips" in service.getAccelerationTips("n")
    assert isinstance(service.getCardLayout(), dict)


async def test_design_phases_list_their_glyphs(service):
    """Regression: get_design_phases() returned phases with empty glyph lists."""
    phases = service.getDesignPhases()["phases"]
    assert phases
    assert any(phase["glyphs"] for phase in phases)
    phase1 = next(p for p in phases if p["phase"] == 1)
    assert "n" in phase1["glyphs"]
    assert "o" in phase1["glyphs"]


# ----------------------------------------------------------------------
# Sandbox
# ----------------------------------------------------------------------


async def test_path_traversal_rejected(service):
    with pytest.raises(FontServiceError):
        await service.openFont("../outside.fontra")
    with pytest.raises(FontServiceError):
        service._resolveFontPath("..\\evil.fontra")


async def test_unknown_extension_rejected(service):
    with pytest.raises(FontServiceError):
        await service.openFont("MutatorSans.txt")


# ----------------------------------------------------------------------
# Writes
# ----------------------------------------------------------------------


def _glyphPayload(name="NewGlyph"):
    return {
        "name": name,
        "axes": [],
        "sources": [{"name": "", "layerName": "default", "location": {}}],
        "layers": {
            "default": {
                "glyph": {
                    "path": {
                        "coordinates": [0, 0, 100, 0, 100, 500, 0, 500],
                        "pointTypes": [0, 0, 0, 0],
                        "contourInfo": [{"endPoint": 3, "isClosed": True}],
                    },
                    "xAdvance": 300,
                    "components": [],
                    "anchors": [],
                    "guidelines": [],
                }
            }
        },
        "customData": {},
    }


async def test_set_glyph_dry_run_does_not_write(writeService):
    result = await writeService.setGlyph("MutatorSans.fontra", "NewGlyph", _glyphPayload(), dryRun=True)
    assert result["dryRun"] is True
    assert result["summary"]["name"] == "NewGlyph"
    assert result["summary"]["layers"]["default"]["bounds"] == [0, 0, 100, 500]
    with pytest.raises(FontServiceError):
        await writeService.getGlyph("MutatorSans.fontra", "NewGlyph")


async def test_set_glyph_writes_and_reads_back(writeService):
    result = await writeService.setGlyph(
        "MutatorSans.fontra", "NewGlyph", _glyphPayload(), codepoints=[ord("N")], dryRun=False
    )
    assert result["written"] is True
    glyph = await writeService.getGlyph("MutatorSans.fontra", "NewGlyph")
    assert glyph["layers"]["default"]["xAdvance"] == 300
    assert glyph["layers"]["default"]["bounds"] == [0, 0, 100, 500]
    glyphMap = (await writeService.listGlyphs("MutatorSans.fontra"))["codepoints"]
    assert glyphMap["NewGlyph"] == [ord("N")]


async def test_set_glyph_overwrites_existing(writeService):
    await writeService.setGlyph("MutatorSans.fontra", "NewGlyph", _glyphPayload(), dryRun=False)
    payload = _glyphPayload()
    payload["layers"]["default"]["glyph"]["xAdvance"] = 500
    await writeService.setGlyph("MutatorSans.fontra", "NewGlyph", payload, dryRun=False)
    glyph = await writeService.getGlyph("MutatorSans.fontra", "NewGlyph")
    assert glyph["layers"]["default"]["xAdvance"] == 500


async def test_set_glyph_requires_writes_flag(service):
    with pytest.raises(FontServiceError, match="Writes are disabled"):
        await service.setGlyph("MutatorSans.fontra", "NewGlyph", _glyphPayload(), dryRun=False)


async def test_set_glyph_reports_dropped_layers(writeService):
    """Regression: writing a single-layer payload silently dropped the other masters."""
    before = await writeService.getGlyph("MutatorSans.fontra", "A")
    masterCount = len(before["layers"])
    assert masterCount >= 4
    payload = await writeService.getGlyphFull("MutatorSans.fontra", "A")
    oneLayer = {
        "name": "A",
        "sources": payload["sources"][:1],
        "layers": {"light-condensed": payload["layers"]["light-condensed"]},
    }
    result = await writeService.setGlyph("MutatorSans.fontra", "A", oneLayer, dryRun=True)
    assert result["droppedLayers"]
    assert "light-condensed" not in result["droppedLayers"]
    assert "warning" in result


async def test_set_glyph_merge_keeps_other_masters(writeService):
    before = await writeService.getGlyph("MutatorSans.fontra", "A")
    masterCount = len(before["layers"])
    payload = await writeService.getGlyphFull("MutatorSans.fontra", "A")
    oneLayer = {
        "name": "A",
        "sources": payload["sources"][:1],
        "layers": {"light-condensed": payload["layers"]["light-condensed"]},
    }
    result = await writeService.setGlyph(
        "MutatorSans.fontra", "A", oneLayer, dryRun=False, mode="merge"
    )
    assert result["droppedLayers"] == []
    after = await writeService.getGlyph("MutatorSans.fontra", "A")
    assert len(after["layers"]) == masterCount


async def test_set_glyph_layer_only_touches_one_layer(writeService):
    before = await writeService.getGlyph("MutatorSans.fontra", "A")
    masterCount = len(before["layers"])
    boldBefore = before["layers"]["bold-condensed"]["xAdvance"]
    layerData = {
        "xAdvance": 999,
        "path": (await writeService.getGlyphFull("MutatorSans.fontra", "A"))["layers"][
            "bold-condensed"
        ]["glyph"]["path"],
    }
    result = await writeService.setGlyphLayer(
        "MutatorSans.fontra", "A", "bold-condensed", layerData, dryRun=False
    )
    assert result["written"] is True
    after = await writeService.getGlyph("MutatorSans.fontra", "A")
    assert len(after["layers"]) == masterCount
    assert after["layers"]["bold-condensed"]["xAdvance"] == 999
    assert after["layers"]["light-condensed"]["xAdvance"] != 999
    assert before["layers"]["bold-condensed"]["xAdvance"] == boldBefore


async def test_copy_glyph(writeService):
    result = await writeService.copyGlyph(
        "MutatorSans.fontra", "A", "A_copy", codepoints=[], dryRun=False
    )
    assert result["written"] is True
    source = await writeService.getGlyph("MutatorSans.fontra", "A")
    copy = await writeService.getGlyph("MutatorSans.fontra", "A_copy")
    assert copy["layers"].keys() == source["layers"].keys()


async def test_set_anchors(writeService):
    result = await writeService.setAnchors(
        "MutatorSans.fontra",
        "A",
        [{"name": "top", "x": 300, "y": 800}],
        layerName="light-condensed",
        dryRun=False,
    )
    assert result["written"] is True
    glyph = await writeService.getGlyph("MutatorSans.fontra", "A")
    assert glyph["layers"]["light-condensed"]["anchors"] == ["top"]


async def test_set_anchors_merge_keeps_other_anchors(writeService):
    await writeService.setAnchors(
        "MutatorSans.fontra", "A", [{"name": "top", "x": 300, "y": 800}],
        layerName="light-condensed", dryRun=False,
    )
    await writeService.setAnchors(
        "MutatorSans.fontra", "A", [{"name": "bottom", "x": 300, "y": 0}],
        layerName="light-condensed", replaceExisting=False, dryRun=False,
    )
    glyph = await writeService.getGlyph("MutatorSans.fontra", "A")
    assert sorted(glyph["layers"]["light-condensed"]["anchors"]) == ["bottom", "top"]


async def test_add_component_and_find_glyphs_using(writeService):
    result = await writeService.addComponent(
        "MutatorSans.fontra",
        "Aacute",
        "A",
        transformation={"translateX": 10},
        layerName="light-condensed",
        dryRun=False,
    )
    assert result["written"] is True
    glyph = await writeService.getGlyph("MutatorSans.fontra", "Aacute")
    components = glyph["layers"]["light-condensed"]["components"]
    assert [c["name"] for c in components] == ["A", "acute", "A"]
    assert components[-1]["transformation"]["translateX"] == 10
    users = await writeService.findGlyphsUsing("MutatorSans.fontra", "A")
    assert "Aacute" in users["glyphs"]


async def test_add_component_rejects_unknown_component(writeService):
    with pytest.raises(FontServiceError, match="Component glyph not found"):
        await writeService.addComponent(
            "MutatorSans.fontra", "Aacute", "NoSuchGlyph", dryRun=True
        )


async def test_remove_component(writeService):
    await writeService.removeComponent(
        "MutatorSans.fontra", "Aacute", "acute", layerName="light-condensed", dryRun=False
    )
    glyph = await writeService.getGlyph("MutatorSans.fontra", "Aacute")
    assert [c["name"] for c in glyph["layers"]["light-condensed"]["components"]] == ["A"]


async def test_decompose_glyph_flattens_components(writeService):
    result = await writeService.decomposeGlyph(
        "MutatorSans.fontra", "Aacute", layerName="light-condensed", dryRun=False
    )
    assert result["decomposed"] is True
    glyph = await writeService.getGlyph("MutatorSans.fontra", "Aacute")
    layer = glyph["layers"]["light-condensed"]
    assert layer["components"] == []
    assert layer["numContours"] > 0


async def test_interpolate_glyph(writeService):
    result = await writeService.interpolateGlyph(
        "MutatorSans.fontra",
        "A",
        "light-condensed",
        "bold-condensed",
        0.5,
        newLayerName="mid",
        dryRun=False,
    )
    assert result["written"] is True
    glyph = await writeService.getGlyph("MutatorSans.fontra", "A")
    assert "mid" in glyph["layers"]
    light = glyph["layers"]["light-condensed"]
    bold = glyph["layers"]["bold-condensed"]
    mid = glyph["layers"]["mid"]
    assert mid["numPoints"] == light["numPoints"] == bold["numPoints"]
    assert mid["xAdvance"] == pytest.approx(
        (light["xAdvance"] + bold["xAdvance"]) / 2
    )


async def test_interpolate_glyph_rejects_incompatible_layers(writeService):
    with pytest.raises(FontServiceError):
        await writeService.interpolateGlyph(
            "MutatorSans.fontra", "A", "light-condensed", "bold-condensed", 1.5,
            newLayerName="bad",
        )


async def test_add_source(writeService):
    result = await writeService.addSource(
        "MutatorSans.fontra",
        "A",
        "medium",
        location={"weight": 500, "width": 100},
        layerName="medium",
        baseLayer="light-condensed",
        dryRun=False,
    )
    assert result["written"] is True
    glyph = await writeService.getGlyph("MutatorSans.fontra", "A")
    assert "medium" in glyph["layers"]
    assert any(s["layerName"] == "medium" for s in glyph["sources"])


async def test_add_source_validates_axis_location(writeService):
    with pytest.raises(FontServiceError, match="Unknown axis"):
        await writeService.addSource(
            "MutatorSans.fontra", "A", "bogus", location={"nope": 1}, dryRun=True
        )
    with pytest.raises(FontServiceError, match="outside"):
        await writeService.addSource(
            "MutatorSans.fontra", "A", "bogus", location={"weight": 100000}, dryRun=True
        )


async def test_set_kerning(writeService):
    result = await writeService.setKerning(
        "MutatorSans.fontra",
        {"T / o": -30},
        sourceIdentifier="light-condensed",
        dryRun=False,
    )
    assert result["written"] is True
    kerning = await writeService.getKerning("MutatorSans.fontra", maxPairs=5000)
    table = next(iter(kerning["sources"].values()))
    assert "T / o" in table["values"]
    index = table["sourceIdentifiers"].index("light-condensed")
    assert table["values"]["T / o"][index] == -30


async def test_set_kerning_accepts_pair_objects(writeService):
    result = await writeService.setKerning(
        "MutatorSans.fontra",
        [{"left": "T", "right": "o", "value": -42}],
        sourceIdentifier="light-condensed",
        dryRun=False,
    )
    assert result["written"] is True
    kerning = await writeService.getKerning("MutatorSans.fontra", maxPairs=5000)
    table = next(iter(kerning["sources"].values()))
    index = table["sourceIdentifiers"].index("light-condensed")
    assert table["values"]["T / o"][index] == -42


# ----------------------------------------------------------------------
# Multi-root + CLI + server
# ----------------------------------------------------------------------


def test_multi_root_resolution(tmp_path):
    rootA = tmp_path / "a"
    rootB = tmp_path / "b"
    rootA.mkdir()
    rootB.mkdir()
    shutil.copytree(FONT_PATH, rootB / "MutatorSans.fontra")
    service = FontService(root=f"{rootA};{rootB}")
    import asyncio

    result = asyncio.run(service.openFont("MutatorSans.fontra"))
    assert result["unitsPerEm"] == 1000
    listed = service.listFonts()
    assert listed["count"] == 1 and listed["roots"] == [str(rootA), str(rootB)]


def test_resolve_dir_tries_every_root(tmp_path):
    """Regression: a relative dir that was missing from root A aborted the search."""
    rootA = tmp_path / "a"
    rootB = tmp_path / "b"
    rootA.mkdir()
    (rootB / "sub").mkdir(parents=True)
    service = FontService(root=f"{rootA};{rootB}")
    resolved = service._resolveDir("sub")
    assert resolved == (rootB / "sub").resolve()


def test_service_has_a_single_set_glyph():
    """Regression: setGlyph was defined twice; the first copy was dead code."""
    import inspect

    from fontra_mcp.service import FontService

    source = inspect.getsource(FontService)
    assert source.count("async def setGlyph(") == 1


def test_cli_glyph_set_without_payload_reports_error():
    """Regression: `glyph set` without --data/--from-file raised a TypeError."""
    from fontra_mcp.cli import main

    with pytest.raises(SystemExit) as excinfo:
        main(["glyph", "set", "some.fontra", "A"])
    assert excinfo.value.code != 0


def test_cli_glyph_set_without_payload_prints_json_error(capsys):
    from fontra_mcp.cli import main

    with pytest.raises(SystemExit):
        main(["glyph", "set", "some.fontra", "A"])
    captured = capsys.readouterr()
    assert "error" in captured.err


def test_mcp_server_lists_tools():
    from fontra_mcp.server import buildServer

    service = FontService(root=REPO_ROOT / "test-common" / "fonts")
    mcp = buildServer(service)
    import asyncio

    tool_names = asyncio.run(mcp.list_tools())
    names = {t.name for t in tool_names}
    for expected in (
        "list_fonts",
        "open_font",
        "get_glyph",
        "get_glyph_full",
        "analyze_glyph",
        "get_design_phase",
        "get_pro_advice",
        "plan_workflow",
        "get_glyph_dna",
        "add_component",
        "set_anchors",
        "copy_glyph",
        "decompose_glyph",
        "interpolate_glyph",
        "add_source",
        "set_kerning",
        "set_glyph_layer",
    ):
        assert expected in names
    assert len(names) == len(tool_names), "duplicate tool name registered"


def test_mcp_server_prompts_and_resources():
    from fontra_mcp.server import buildServer

    service = FontService(root=REPO_ROOT / "test-common" / "fonts")
    mcp = buildServer(service)
    import asyncio

    prompts = asyncio.run(mcp.list_prompts())
    resources = asyncio.run(mcp.list_resources())
    assert any(p.name == "design_glyph" for p in prompts)
    assert any(p.name == "audit_font" for p in prompts)
    assert any(p.name == "component_workflow" for p in prompts)
    assert any(str(r.uri).startswith("fontra://") for r in resources)

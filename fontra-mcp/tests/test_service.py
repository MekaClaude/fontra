"""Tests for the fontra-mcp service layer (read-only)."""

import pathlib

import pytest

from fontra_mcp.service import FontService, FontServiceError

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT_PATH = REPO_ROOT / "test-common" / "fonts" / "MutatorSans.fontra"

# asyncio_mode=auto (pyproject) runs async tests automatically; sync tests
# are unaffected, so no pytestmark needed.


@pytest.fixture()
def service():
    return FontService(root=REPO_ROOT / "test-common" / "fonts")


async def test_list_fonts_finds_mutator(service):
    result = service.listFonts()
    assert result["count"] >= 1
    assert any(f["id"] == "MutatorSans.fontra" for f in result["fonts"])


async def test_open_font_summary(service):
    summary = await service.openFont("MutatorSans.fontra")
    assert summary["familyName"] == "MutatorMathTest"
    assert summary["unitsPerEm"] == 1000
    assert summary["glyphCount"] >= 54
    assert summary["readOnly"] is True


async def test_list_glyphs_bounded(service):
    result = await service.listGlyphs("MutatorSans.fontra", maxGlyphs=5)
    assert len(result["codepoints"]) == 5
    assert result["count"] >= 54
    assert result["truncated"] is True


async def test_get_glyph_summary(service):
    glyph = await service.getGlyph("MutatorSans.fontra", "A")
    assert glyph["name"] == "A"
    assert glyph["layers"], "variable glyph should have layers"
    for layer in glyph["layers"].values():
        assert "xAdvance" in layer
        assert "bounds" in layer


async def test_get_glyph_missing_raises(service):
    with pytest.raises(FontServiceError):
        await service.getGlyph("MutatorSans.fontra", "NOT_A_GLYPH")


async def test_get_glyph_full_has_layer_data(service):
    full = await service.getGlyphFull("MutatorSans.fontra", "A")
    assert full["name"] == "A"
    assert full["layers"], "expected layer data in full glyph"
    layer = next(iter(full["layers"].values()))
    assert "glyph" in layer


async def test_get_font_info_and_axes(service):
    info = await service.getFontInfo("MutatorSans.fontra")
    assert info["familyName"] == "MutatorMathTest"
    axes = await service.getAxes("MutatorSans.fontra")
    names = [a["name"] for a in axes["axes"]]
    for expected in ("weight", "width"):
        assert expected in names


async def test_get_kerning_bounded(service):
    kerning = await service.getKerning("MutatorSans.fontra", maxPairs=3)
    assert kerning["pairsShown"] <= 3
    assert "sources" in kerning


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


async def test_path_traversal_rejected(service):
    with pytest.raises(FontServiceError):
        await service.openFont("../outside.fontra")
    with pytest.raises(FontServiceError):
        service._resolveFontPath("..\\evil.fontra")


async def test_unknown_extension_rejected(service):
    with pytest.raises(FontServiceError):
        await service.openFont("MutatorSans.txt")


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


@pytest.fixture()
def writeService(tmp_path):
    import shutil

    src = FONT_PATH
    dst = tmp_path / "MutatorSans.fontra"
    shutil.copytree(src, dst)
    return FontService(root=tmp_path, writesAllowed=True)


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


def test_multi_root_resolution(tmp_path):
    import shutil

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


def test_mcp_server_lists_tools():
    from fontra_mcp.server import buildServer

    service = FontService(root=REPO_ROOT / "test-common" / "fonts")
    mcp = buildServer(service)
    tools = mcp._tool_manager._tools if hasattr(mcp, "_tool_manager") else {}
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
    ):
        assert expected in names


def test_mcp_server_prompts_and_resources():
    from fontra_mcp.server import buildServer

    service = FontService(root=REPO_ROOT / "test-common" / "fonts")
    mcp = buildServer(service)
    import asyncio

    prompts = asyncio.run(mcp.list_prompts())
    resources = asyncio.run(mcp.list_resources())
    assert any(p.name == "design_glyph" for p in prompts)
    assert any(p.name == "audit_font" for p in prompts)
    assert any(str(r.uri).startswith("fontra://") for r in resources)

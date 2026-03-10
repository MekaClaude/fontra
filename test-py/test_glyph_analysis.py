"""Tests for the glyph analysis module."""

import pytest

from fontra.core.classes import structure
from fontra.core.glyph_analysis import (
    GlyphAnalysis,
    OvershootMeasurement,
    StemMeasurement,
    analyze_glyph,
    detect_horizontal_stems,
    detect_vertical_stems,
    has_curves,
    measure_overshoots,
)
from fontra.core.path import PackedPath


# A simple rectangle path: 60,0 → 110,0 → 110,120 → 60,120
# This has a stem width of 50 and height of 120
rectPath = structure(
    {
        "contourInfo": [{"endPoint": 3, "isClosed": True}],
        "coordinates": [60, 0, 110, 0, 110, 120, 60, 120],
        "pointTypes": [0, 0, 0, 0],
    },
    PackedPath,
)

# A path with curves (like an 'o' shape):
# An oval from approx (100,-10) to (400,700) with cubic bezier curves
# This overshoots baseline by 10 units and x-height by 10 units
curvedPath = structure(
    {
        "coordinates": [
            232, -10, 338, -10, 403, 38, 403, 182,
            403, 700, 363, 700, 363, 182,
            363, 60, 313, 26, 232, 26,
            151, 26, 100, 60, 100, 182,
            100, 280, 60, 280, 60, 182,
            60, 38, 124, -10,
        ],
        "pointTypes": [8, 2, 2, 8, 0, 0, 8, 2, 2, 8, 2, 2, 8, 0, 0, 8, 2, 2],
        "contourInfo": [{"endPoint": 17, "isClosed": True}],
    },
    PackedPath,
)

# Two rectangles side by side (like an 'H' shape)
# Left stem: 0,0 → 40,0 → 40,700 → 0,700 (width=40)
# Right stem: 260,0 → 300,0 → 300,700 → 260,700 (width=40)
# Crossbar: 40,300 → 260,300 → 260,350 → 40,350 (height=50)
hShapePath = PackedPath(
    coordinates=[
        # Left stem
        0, 0, 40, 0, 40, 700, 0, 700,
        # Right stem
        260, 0, 300, 0, 300, 700, 260, 700,
        # Crossbar
        40, 300, 260, 300, 260, 350, 40, 350,
    ],
    pointTypes=[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    contourInfo=[
        structure({"endPoint": 3, "isClosed": True}, type(rectPath.contourInfo[0])),
        structure({"endPoint": 7, "isClosed": True}, type(rectPath.contourInfo[0])),
        structure({"endPoint": 11, "isClosed": True}, type(rectPath.contourInfo[0])),
    ],
)

# Empty path
emptyPath = PackedPath()


class TestDetectVerticalStems:
    def test_rectangle_has_one_stem(self):
        stems = detect_vertical_stems(rectPath, tolerance=5.0, min_height=40.0)
        assert len(stems) >= 1
        # The rectangle has width 50
        assert any(abs(s.width - 50.0) < 10 for s in stems)
        assert all(s.orientation == "vertical" for s in stems)

    def test_empty_path(self):
        stems = detect_vertical_stems(emptyPath)
        assert stems == []

    def test_h_shape_has_two_vertical_stems(self):
        stems = detect_vertical_stems(hShapePath, tolerance=10.0, min_height=100.0)
        # Should detect at least the two vertical stems of the H
        vertical_stems = [s for s in stems if s.orientation == "vertical"]
        assert len(vertical_stems) >= 2


class TestDetectHorizontalStems:
    def test_empty_path(self):
        stems = detect_horizontal_stems(emptyPath)
        assert stems == []

    def test_h_shape_has_crossbar(self):
        stems = detect_horizontal_stems(hShapePath, tolerance=10.0, min_width=50.0)
        # Should detect the crossbar
        assert len(stems) >= 1
        # Crossbar should have height around 50
        assert any(abs(s.height - 50.0) < 15 for s in stems)


class TestMeasureOvershoots:
    def test_curved_path_overshoot_at_baseline(self):
        overshoots = measure_overshoots(
            curvedPath,
            metric_lines={"baseline": 0},
        )
        # The curved path goes down to y=-10, so it overshoots the baseline
        assert len(overshoots) >= 1
        baseline_overshoot = next(
            (o for o in overshoots if o.metricName == "baseline"), None
        )
        assert baseline_overshoot is not None
        assert baseline_overshoot.overshootAmount > 0

    def test_rect_no_overshoot_at_baseline(self):
        overshoots = measure_overshoots(
            rectPath,
            metric_lines={"baseline": 0},
        )
        # Rectangle starts exactly at y=0, no overshoot
        assert len(overshoots) == 0

    def test_rect_overshoot_at_custom_line(self):
        overshoots = measure_overshoots(
            rectPath,
            metric_lines={"x-height": 100},
        )
        # Rectangle extends to 120, which is above 100
        assert len(overshoots) >= 1
        xh_overshoot = next(
            (o for o in overshoots if o.metricName == "x-height"), None
        )
        assert xh_overshoot is not None
        assert abs(xh_overshoot.overshootAmount - 20.0) < 1.0

    def test_empty_path(self):
        overshoots = measure_overshoots(emptyPath, metric_lines={"baseline": 0})
        assert overshoots == []


class TestHasCurves:
    def test_rect_has_no_curves(self):
        assert has_curves(rectPath) is False

    def test_curved_path_has_curves(self):
        assert has_curves(curvedPath) is True

    def test_empty_path(self):
        assert has_curves(emptyPath) is False


class TestAnalyzeGlyph:
    def test_analyze_rect(self):
        analysis = analyze_glyph(
            rectPath,
            glyph_name="test_rect",
            metric_lines={"baseline": 0, "x-height": 100},
        )
        assert isinstance(analysis, GlyphAnalysis)
        assert analysis.glyphName == "test_rect"
        assert analysis.hasCurves is False
        assert analysis.numContours == 1
        assert analysis.boundingBox is not None

    def test_analyze_curved(self):
        analysis = analyze_glyph(
            curvedPath,
            glyph_name="test_o",
            metric_lines={"baseline": 0},
        )
        assert analysis.hasCurves is True
        assert analysis.numContours == 1
        assert len(analysis.overshoots) >= 1

    def test_analyze_empty(self):
        analysis = analyze_glyph(emptyPath, glyph_name="empty")
        assert analysis.glyphName == "empty"
        assert analysis.verticalStems == []
        assert analysis.horizontalStems == []
        assert analysis.overshoots == []

    def test_analyze_h_shape(self):
        analysis = analyze_glyph(
            hShapePath,
            glyph_name="H",
            metric_lines={"baseline": 0, "cap-height": 700},
        )
        assert analysis.numContours == 3
        assert analysis.hasCurves is False
        assert len(analysis.verticalStems) >= 2

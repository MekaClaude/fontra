"""Glyph analysis module for type design learning features.

Analyzes glyph paths to detect stems, curves, bowls, and measure
overshoot distances. Provides consistency checking against reference
glyph measurements.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from .path import ContourInfo, PackedPath, PointType


@dataclass
class StemMeasurement:
    """A detected vertical or horizontal stem with position and width."""

    x: float  # X-center for vertical stems, or X-start for horizontal
    y: float  # Y-center for horizontal stems, or Y-start for vertical
    width: float  # Measured stem width
    height: float  # Measured stem height (extent)
    orientation: str  # "vertical" or "horizontal"


@dataclass
class OvershootMeasurement:
    """Overshoot/undershoot distance measurement at a metric line."""

    metricName: str  # e.g., "baseline", "x-height", "cap-height"
    metricValue: float  # The Y-value of the metric line
    overshootAmount: float  # How far past the line (positive = extending past)
    extremeY: float  # The actual Y-coordinate of the extreme point


@dataclass
class CurveSegment:
    """A detected curve segment within a contour."""

    startX: float
    startY: float
    endX: float
    endY: float
    isBowl: bool = False  # True if part of an enclosed counter


@dataclass
class GlyphAnalysis:
    """Complete analysis results for a glyph."""

    glyphName: str = ""
    verticalStems: list[StemMeasurement] = field(default_factory=list)
    horizontalStems: list[StemMeasurement] = field(default_factory=list)
    curveSegments: list[CurveSegment] = field(default_factory=list)
    overshoots: list[OvershootMeasurement] = field(default_factory=list)
    boundingBox: Optional[tuple[float, float, float, float]] = None
    hasCurves: bool = False
    numContours: int = 0


def _get_on_curve_points(
    packed_path: PackedPath,
) -> list[list[tuple[float, float]]]:
    """Extract lists of on-curve points per contour from a PackedPath.

    Returns:
        A list of contours, where each contour is a list of (x, y) tuples
        for on-curve points only.
    """
    contours = []
    start_idx = 0
    coordinates = packed_path.coordinates
    point_types = packed_path.pointTypes

    for contour_info in packed_path.contourInfo:
        end_idx = contour_info.endPoint + 1
        on_curve_points = []
        for i in range(start_idx, end_idx):
            pt_type = point_types[i]
            if pt_type in (PointType.ON_CURVE, PointType.ON_CURVE_SMOOTH):
                x = coordinates[i * 2]
                y = coordinates[i * 2 + 1]
                on_curve_points.append((x, y))
        contours.append(on_curve_points)
        start_idx = end_idx

    return contours


def _get_all_points_per_contour(
    packed_path: PackedPath,
) -> list[list[tuple[float, float, int]]]:
    """Extract all points (on-curve and off-curve) per contour.

    Returns:
        A list of contours, where each contour is a list of (x, y, point_type)
        tuples.
    """
    contours = []
    start_idx = 0
    coords = packed_path.coordinates
    types = packed_path.pointTypes

    for ci in packed_path.contourInfo:
        end_idx = ci.endPoint + 1
        pts = []
        for i in range(start_idx, end_idx):
            pts.append((coords[i * 2], coords[i * 2 + 1], int(types[i])))
        contours.append(pts)
        start_idx = end_idx
    return contours


def detect_vertical_stems(
    packed_path: PackedPath,
    tolerance: float = 5.0,
    min_height: float = 50.0,
) -> list[StemMeasurement]:
    """Detect vertical stems by scanning horizontal slices through the glyph.

    Scans the glyph at multiple Y positions, measuring widths between
    contour crossings that are consistent (within tolerance) across slices.

    Args:
        packed_path: The path to analyze.
        tolerance: Maximum width variation (in units) to consider as
            the same stem across Y slices.
        min_height: Minimum height extent to constitute a stem.

    Returns:
        List of detected vertical StemMeasurement objects.
    """
    bounds = packed_path.getControlBounds()
    if not bounds:
        return []

    x_min, y_min, x_max, y_max = bounds
    height = y_max - y_min
    if height < min_height:
        return []

    # Sample at multiple Y positions
    num_samples = max(5, int(height / 50))
    y_positions = [
        y_min + (y_max - y_min) * (i + 1) / (num_samples + 1)
        for i in range(num_samples)
    ]

    # For each Y, find X-intersections using on-curve segment approximation
    all_widths: list[list[tuple[float, float, float]]] = (
        []
    )  # per-sample list of (x_left, x_right, width)

    contour_segments = _get_linearized_segments(packed_path)

    for y_scan in y_positions:
        x_crossings = []
        for segments in contour_segments:
            for (x1, y1), (x2, y2) in segments:
                if (y1 <= y_scan <= y2) or (y2 <= y_scan <= y1):
                    if abs(y2 - y1) < 0.001:
                        continue
                    t = (y_scan - y1) / (y2 - y1)
                    x_cross = x1 + t * (x2 - x1)
                    x_crossings.append(x_cross)

        x_crossings.sort()
        if len(x_crossings) < 2:
            continue

        widths = []
        # Pair crossings: entry/exit
        for i in range(0, len(x_crossings) - 1, 2):
            if i + 1 < len(x_crossings):
                x_left = x_crossings[i]
                x_right = x_crossings[i + 1]
                w = x_right - x_left
                if w > 0:
                    widths.append((x_left, x_right, w))
        all_widths.append(widths)

    if not all_widths:
        return []

    # Find consistent widths across Y slices = stems
    stems = _cluster_stem_widths(all_widths, y_positions, tolerance, min_height)
    return stems


def _get_linearized_segments(
    packed_path: PackedPath,
) -> list[list[tuple[tuple[float, float], tuple[float, float]]]]:
    """Convert contours to lists of line segments, approximating curves.

    Returns a list of contours, where each contour is a list of
    ((x1, y1), (x2, y2)) line segments.
    """
    contour_pts = _get_all_points_per_contour(packed_path)
    result = []

    for ci_idx, contour_info in enumerate(packed_path.contourInfo):
        if ci_idx >= len(contour_pts):
            break
        pts = contour_pts[ci_idx]
        if len(pts) < 2:
            result.append([])
            continue

        segments = []
        n = len(pts)

        # Walk through points, connecting on-curve points
        # For curves, approximate with line from on-curve to on-curve
        on_curves = [(x, y) for x, y, t in pts if t in (0x00, 0x08)]

        if len(on_curves) < 2:
            result.append([])
            continue

        for i in range(len(on_curves)):
            j = (i + 1) % len(on_curves)
            if contour_info.isClosed or j > i:
                segments.append((on_curves[i], on_curves[j]))

        result.append(segments)

    return result


def _cluster_stem_widths(
    all_widths: list[list[tuple[float, float, float]]],
    y_positions: list[float],
    tolerance: float,
    min_height: float,
) -> list[StemMeasurement]:
    """Cluster width measurements across Y slices to identify consistent stems.

    A stem is a width that appears consistently (within tolerance) across
    multiple Y slices.
    """
    if not all_widths:
        return []

    # Collect all unique widths from the first valid sample
    stems = []

    # Flatten all measurements
    all_measurements: list[tuple[float, float, float, float]] = (
        []
    )  # (x_center, width, y_pos)
    for y_idx, widths_at_y in enumerate(all_widths):
        if y_idx >= len(y_positions):
            break
        y = y_positions[y_idx]
        for x_left, x_right, w in widths_at_y:
            x_center = (x_left + x_right) / 2
            all_measurements.append((x_center, w, y, 0))

    if not all_measurements:
        return []

    # Group by similar x_center position
    all_measurements.sort(key=lambda m: m[0])  # sort by x_center

    groups: list[list[tuple[float, float, float, float]]] = []
    current_group = [all_measurements[0]]

    for m in all_measurements[1:]:
        if abs(m[0] - current_group[-1][0]) < tolerance * 3:
            current_group.append(m)
        else:
            groups.append(current_group)
            current_group = [m]
    groups.append(current_group)

    # For each group (potential stem), check width consistency
    for group in groups:
        if len(group) < 2:
            continue

        widths = [m[1] for m in group]
        avg_width = sum(widths) / len(widths)
        consistent = all(abs(w - avg_width) < tolerance for w in widths)

        if not consistent:
            continue

        y_values = [m[2] for m in group]
        y_extent = max(y_values) - min(y_values)

        if y_extent < min_height:
            continue

        x_center = sum(m[0] for m in group) / len(group)
        y_center = (min(y_values) + max(y_values)) / 2

        stems.append(
            StemMeasurement(
                x=round(x_center, 1),
                y=round(min(y_values), 1),
                width=round(avg_width, 1),
                height=round(y_extent, 1),
                orientation="vertical",
            )
        )

    return stems


def detect_horizontal_stems(
    packed_path: PackedPath,
    tolerance: float = 5.0,
    min_width: float = 50.0,
) -> list[StemMeasurement]:
    """Detect horizontal stems by scanning vertical slices through the glyph.

    Similar to vertical stem detection but scans X positions to find
    consistent Y-direction widths.

    Args:
        packed_path: The path to analyze.
        tolerance: Maximum height variation to consider as the same stem.
        min_width: Minimum width extent to constitute a horizontal stem.

    Returns:
        List of detected horizontal StemMeasurement objects.
    """
    bounds = packed_path.getControlBounds()
    if not bounds:
        return []

    x_min, y_min, x_max, y_max = bounds
    width = x_max - x_min
    if width < min_width:
        return []

    num_samples = max(5, int(width / 50))
    x_positions = [
        x_min + (x_max - x_min) * (i + 1) / (num_samples + 1)
        for i in range(num_samples)
    ]

    contour_segments = _get_linearized_segments(packed_path)

    all_heights: list[list[tuple[float, float, float]]] = []

    for x_scan in x_positions:
        y_crossings = []
        for segments in contour_segments:
            for (x1, y1), (x2, y2) in segments:
                if (x1 <= x_scan <= x2) or (x2 <= x_scan <= x1):
                    if abs(x2 - x1) < 0.001:
                        continue
                    t = (x_scan - x1) / (x2 - x1)
                    y_cross = y1 + t * (y2 - y1)
                    y_crossings.append(y_cross)

        y_crossings.sort()
        if len(y_crossings) < 2:
            continue

        heights = []
        for i in range(0, len(y_crossings) - 1, 2):
            if i + 1 < len(y_crossings):
                y_bottom = y_crossings[i]
                y_top = y_crossings[i + 1]
                h = y_top - y_bottom
                if h > 0:
                    heights.append((y_bottom, y_top, h))
        all_heights.append(heights)

    if not all_heights:
        return []

    # Use the same clustering approach but with orientation="horizontal"
    stems = _cluster_horizontal_widths(
        all_heights, x_positions, tolerance, min_width
    )
    return stems


def _cluster_horizontal_widths(
    all_heights: list[list[tuple[float, float, float]]],
    x_positions: list[float],
    tolerance: float,
    min_width: float,
) -> list[StemMeasurement]:
    """Cluster height measurements across X slices to find horizontal stems."""
    all_measurements: list[tuple[float, float, float]] = []
    for x_idx, heights_at_x in enumerate(all_heights):
        if x_idx >= len(x_positions):
            break
        x = x_positions[x_idx]
        for y_bottom, y_top, h in heights_at_x:
            y_center = (y_bottom + y_top) / 2
            all_measurements.append((y_center, h, x))

    if not all_measurements:
        return []

    all_measurements.sort(key=lambda m: m[0])

    groups: list[list[tuple[float, float, float]]] = []
    current_group = [all_measurements[0]]

    for m in all_measurements[1:]:
        if abs(m[0] - current_group[-1][0]) < tolerance * 3:
            current_group.append(m)
        else:
            groups.append(current_group)
            current_group = [m]
    groups.append(current_group)

    stems = []
    for group in groups:
        if len(group) < 2:
            continue

        heights = [m[1] for m in group]
        avg_height = sum(heights) / len(heights)
        consistent = all(abs(h - avg_height) < tolerance for h in heights)

        if not consistent:
            continue

        x_values = [m[2] for m in group]
        x_extent = max(x_values) - min(x_values)

        if x_extent < min_width:
            continue

        y_center = sum(m[0] for m in group) / len(group)

        stems.append(
            StemMeasurement(
                x=round(min(x_values), 1),
                y=round(y_center, 1),
                width=round(x_extent, 1),
                height=round(avg_height, 1),
                orientation="horizontal",
            )
        )

    return stems


def measure_overshoots(
    packed_path: PackedPath,
    metric_lines: dict[str, float],
) -> list[OvershootMeasurement]:
    """Measure how far curves extend past metric lines.

    For each specified metric line, finds the extreme Y-coordinate of
    the glyph path that crosses or extends past it.

    Args:
        packed_path: The path to analyze.
        metric_lines: Dict mapping metric names to Y-values, e.g.:
            {"baseline": 0, "x-height": 500, "cap-height": 700}

    Returns:
        List of OvershootMeasurement objects, one per metric that has overshoot.
    """
    bounds = packed_path.getControlBounds()
    if not bounds:
        return []

    x_min, y_min, x_max, y_max = bounds
    measurements = []

    for metric_name, metric_y in metric_lines.items():
        if metric_name in ("baseline", "descender"):
            # For baseline/descender, check how far below the path extends
            if y_min < metric_y:
                measurements.append(
                    OvershootMeasurement(
                        metricName=metric_name,
                        metricValue=metric_y,
                        overshootAmount=round(metric_y - y_min, 1),
                        extremeY=round(y_min, 1),
                    )
                )
        else:
            # For x-height, cap-height, ascender — check how far above
            if y_max > metric_y:
                measurements.append(
                    OvershootMeasurement(
                        metricName=metric_name,
                        metricValue=metric_y,
                        overshootAmount=round(y_max - metric_y, 1),
                        extremeY=round(y_max, 1),
                    )
                )

    return measurements


def has_curves(packed_path: PackedPath) -> bool:
    """Check if the path contains any off-curve (bezier) points."""
    for pt_type in packed_path.pointTypes:
        if pt_type in (PointType.OFF_CURVE_CUBIC, PointType.OFF_CURVE_QUAD):
            return True
    return False


def analyze_glyph(
    packed_path: PackedPath,
    glyph_name: str = "",
    metric_lines: dict[str, float] | None = None,
    stem_tolerance: float = 5.0,
) -> GlyphAnalysis:
    """Perform a comprehensive analysis of a glyph's path.

    Args:
        packed_path: The glyph's path data.
        glyph_name: Optional name of the glyph being analyzed.
        metric_lines: Dict of metric line names to Y-values for
            overshoot measurement.
        stem_tolerance: Tolerance for stem width consistency.

    Returns:
        GlyphAnalysis with all detected features.
    """
    analysis = GlyphAnalysis(
        glyphName=glyph_name,
        boundingBox=packed_path.getControlBounds(),
        hasCurves=has_curves(packed_path),
        numContours=len(packed_path.contourInfo),
    )

    analysis.verticalStems = detect_vertical_stems(
        packed_path, tolerance=stem_tolerance
    )

    analysis.horizontalStems = detect_horizontal_stems(
        packed_path, tolerance=stem_tolerance
    )

    if metric_lines:
        analysis.overshoots = measure_overshoots(packed_path, metric_lines)

    return analysis

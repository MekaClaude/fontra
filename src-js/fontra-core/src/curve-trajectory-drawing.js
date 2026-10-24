/*
 * curve-trajectory-drawing.js — renders the "right trajectory" overlay.
 *
 * This module contains no DOM dependencies: it draws into a canvas-like
 * context, so it can be exercised by unit tests as well as by the editor.
 *
 * The overlay shows, for every curve of a glyph:
 *
 *   - the reference trajectory: the curve the segment should follow,
 *   - the circle it describes (when both ends agree on one),
 *   - the deviation ribbon between the drawn curve and the reference,
 *   - the ideal handles, and the gap between them and the drawn handles,
 *   - the deviation, as a number.
 */

import { sampleArc, severityRank } from "./ideal-curve.js";

export function severityColor(severity, parameters) {
  if (severity === "error") {
    return parameters.errorColor;
  }
  if (severity === "warn") {
    return parameters.warnColor;
  }
  return parameters.okColor;
}

/**
 * Draw the overlay of a single curve segment.
 *
 * @param {object} context - a canvas 2D context, in font units.
 * @param {object} entry - a segment entry, as produced by `analyzePath`.
 * @param {object} parameters - colors and sizes, in screen pixels.
 * @param {object} options - which parts to draw.
 */
export function drawCurveTrajectory(context, entry, parameters, options = {}) {
  const analysis = entry.analysis;
  const ideal = analysis?.ideal;
  if (!analysis || !ideal) {
    return;
  }

  const {
    showTrajectory = true,
    showCircle = true,
    showRibbon = true,
    showHandles = true,
    showLabels = false,
    isHighlighted = false,
  } = options;

  const isQuad = entry.type === "quad";
  const points = analysis.points;
  const p0 = points[0];
  const p3 = points[points.length - 1];
  const controls = ideal.controlPoints;
  const color = severityColor(analysis.severity, parameters);

  context.save();

  // 1. The deviation ribbon: the area between the drawn curve and the
  //    trajectory it should follow.
  if (showRibbon && analysis.actualPoints && analysis.idealPoints) {
    const ratio = analysis.maxDeviationRelative;
    if (ratio > 0.002) {
      const alpha = Math.min(parameters.ribbonOpacity * 4, 0.1 + ratio * 3);
      context.beginPath();
      context.moveTo(analysis.actualPoints[0].x, analysis.actualPoints[0].y);
      for (const point of analysis.actualPoints) {
        context.lineTo(point.x, point.y);
      }
      for (let i = analysis.idealPoints.length - 1; i >= 0; i--) {
        context.lineTo(analysis.idealPoints[i].x, analysis.idealPoints[i].y);
      }
      context.closePath();
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.fill();
      context.globalAlpha = 1;
    }
  }

  // 2. The circle the curve is meant to describe.
  if (showCircle && ideal.arc) {
    const arcPoints = sampleArc(ideal.arc, 48);
    context.beginPath();
    context.moveTo(arcPoints[0].x, arcPoints[0].y);
    for (const point of arcPoints) {
      context.lineTo(point.x, point.y);
    }
    context.setLineDash([parameters.dotLength, parameters.dotGap]);
    context.globalAlpha = 0.5;
    context.strokeStyle = parameters.idealColor;
    context.lineWidth = parameters.circleStrokeWidth;
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  // 3. The reference trajectory itself.
  if (showTrajectory) {
    context.beginPath();
    context.moveTo(ideal.anchors[0].x, ideal.anchors[0].y);
    if (isQuad) {
      context.quadraticCurveTo(
        controls[0].x,
        controls[0].y,
        ideal.anchors[1].x,
        ideal.anchors[1].y
      );
    } else {
      context.bezierCurveTo(
        controls[0].x,
        controls[0].y,
        controls[1].x,
        controls[1].y,
        ideal.anchors[1].x,
        ideal.anchors[1].y
      );
    }
    context.setLineDash([parameters.dashLength, parameters.dashGap]);
    context.strokeStyle = parameters.idealColor;
    context.lineWidth = parameters.trajectoryStrokeWidth;
    context.stroke();
    context.setLineDash([]);
  }

  // 4. Where the handles should be, and how far they are from there.
  if (showHandles) {
    const actualControls = isQuad ? [points[1]] : [points[1], points[2]];

    context.setLineDash([parameters.dashLength, parameters.dashGap]);
    context.globalAlpha = 0.45;
    context.strokeStyle = parameters.idealColor;
    context.lineWidth = parameters.strokeWidth * 0.8;
    context.beginPath();
    context.moveTo(p0.x, p0.y);
    context.lineTo(controls[0].x, controls[0].y);
    if (!isQuad) {
      context.moveTo(p3.x, p3.y);
      context.lineTo(controls[1].x, controls[1].y);
    }
    context.stroke();
    context.setLineDash([]);
    context.globalAlpha = 1;

    for (const control of controls) {
      context.beginPath();
      context.arc(control.x, control.y, parameters.handleRadius, 0, Math.PI * 2);
      context.strokeStyle = parameters.idealColor;
      context.lineWidth = parameters.strokeWidth;
      context.stroke();
    }

    // The gap between the drawn handle and the ideal handle.
    for (let i = 0; i < actualControls.length; i++) {
      const actual = actualControls[i];
      const idealControl = controls[i];
      const gap = Math.hypot(
        actual.x - idealControl.x,
        actual.y - idealControl.y
      );
      if (gap < 0.05) {
        continue;
      }
      context.beginPath();
      context.moveTo(actual.x, actual.y);
      context.lineTo(idealControl.x, idealControl.y);
      context.strokeStyle = color;
      context.lineWidth = parameters.strokeWidth;
      context.stroke();
    }
  }

  // 5. The deviation, as a number.
  if (showLabels && isHighlighted) {
    drawDeviationLabel(context, analysis, parameters, color);
  }

  context.restore();
}

/**
 * Draw the deviation of a segment as a number, with a halo so it stays
 * readable on top of the glyph outline.
 */
export function drawDeviationLabel(context, analysis, parameters, color) {
  const points = analysis.actualPoints;
  if (!points || !points.length) {
    return;
  }
  const middle = points[Math.floor(points.length / 2)];
  const text = `${analysis.maxDeviation.toFixed(1)}u`;
  const offset = parameters.labelFontSize * 0.7;

  context.font = `${parameters.labelFontSize}px sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";

  const x = middle.x + offset;
  const y = middle.y - offset;

  context.lineJoin = "round";
  context.lineWidth = parameters.haloWidth;
  context.strokeStyle = parameters.haloColor;
  context.strokeText(text, x, y);

  context.fillStyle = color;
  context.fillText(text, x, y);
}

/**
 * Draw a status ring around every anchor that has something to report.
 */
export function drawAnchorRings(context, path, entries, analysis, parameters) {
  const anchors = new Map();

  const record = (index, severity) => {
    const current = anchors.get(index);
    if (!current || severityRank(severity) > severityRank(current.severity)) {
      anchors.set(index, { severity: severity });
    }
  };

  for (const entry of entries) {
    if (!entry.pointIndices || !entry.analysis) {
      continue;
    }
    const severity = entry.analysis.severity;
    if (severity === "ok") {
      continue;
    }
    record(entry.pointIndices[0], severity);
    record(entry.pointIndices.at(-1), severity);
  }

  // Issues that live on an anchor rather than on a segment, such as a kink
  // between the handles of a smooth point.
  for (const issue of analysis.issues) {
    if (issue.pointIndex === undefined) {
      continue;
    }
    record(issue.pointIndex, issue.severity);
  }

  for (const [index, info] of anchors) {
    const point = path.getPoint(index);
    if (!point) {
      continue;
    }
    context.beginPath();
    context.arc(point.x, point.y, parameters.ringRadius, 0, Math.PI * 2);
    context.strokeStyle = severityColor(info.severity, parameters);
    context.lineWidth = parameters.ringStrokeWidth;
    context.globalAlpha = 0.85;
    context.stroke();
    context.globalAlpha = 1;
  }
}

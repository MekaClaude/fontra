/**
 * brush-preview — pure preview geometry for the brush sidebar panel.
 *
 * Delegates to the engine for the math, then formats the result as Path2D.
 * No DOM, no scene model, no storage. Used by the sidebar panel canvas.
 */
import { BrushEngine } from "./brush-engine.js";

/**
 * Compute left/right outline edges for a set of sample points.
 *
 * @param {object} settings — brush settings (any subset of DEFAULT_BRUSH_SETTINGS)
 * @param {Point2D[]} points — sample points [{x, y, pressure?}]
 * @returns {{ leftEdge: Point2D[], rightEdge: Point2D[] }}
 */
export function computeBrushEdges(settings, points) {
  const engine = new BrushEngine(settings);
  const n = points.length;
  const widths = BrushEngine.taperWidths(
    engine.calculateWidthsForPoints(points, { includeSpeed: false }),
    settings.taper,
    settings.minWidth
  );
  const leftEdge = new Array(n);
  const rightEdge = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const moveAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const perp = moveAngle + Math.PI / 2;
    const half = widths[i] / 2;
    const dx = Math.cos(perp) * half;
    const dy = Math.sin(perp) * half;
    leftEdge[i] = { x: points[i].x + dx, y: points[i].y + dy };
    rightEdge[i] = { x: points[i].x - dx, y: points[i].y - dy };
  }
  return { leftEdge, rightEdge };
}

/**
 * Draw the brush preview outline + centerline on a 2D canvas context.
 * Used by the sidebar panel only; the main editor canvas uses the
 * visualization layer defined in brush-tool-base.js.
 */
export function drawBrushPreview(ctx, canvasWidth, canvasHeight, settings) {
  // Wavy sample curve — same shape the old preview used, so the
  // panel layout doesn't change.
  const numPoints = 40;
  const samplePoints = new Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    samplePoints[i] = {
      x: 20 + t * (canvasWidth - 40),
      y: canvasHeight / 2 + Math.sin(t * Math.PI * 2) * 15,
      pressure: 0.5 + Math.sin(t * Math.PI) * 0.3,
    };
  }

  ctx.save();
  // Centerline (dashed pink)
  ctx.strokeStyle = "rgba(255,105,180,0.5)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(samplePoints[0].x, samplePoints[0].y);
  for (let i = 1; i < samplePoints.length; i++) ctx.lineTo(samplePoints[i].x, samplePoints[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Outline (filled blue)
  const { leftEdge, rightEdge } = computeBrushEdges(settings, samplePoints);
  ctx.fillStyle = "rgba(0,180,255,0.3)";
  ctx.strokeStyle = "rgba(0,153,255,0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
  for (let i = 1; i < leftEdge.length; i++) ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
  for (let i = rightEdge.length - 1; i >= 0; i--) ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Shared geometry helpers for Triangle Guardian.
 *
 * Computes the Adobe control-point triangle apex, detects S-curves,
 * and tests point-in-triangle containment.
 *
 * The Adobe control-point triangle is formed by:
 * - The start point P0
 * - The end point P3
 * - The apex where the two handle rays intersect
 *
 * @module triangle-guardian-geometry
 */

/**
 * Compute the apex where the two handle rays intersect.
 *
 * Ray A: P0 → P1 extended
 * Ray B: P3 → P2 extended
 *
 * @param {Object} P0 - Start point {x, y}
 * @param {Object} P1 - First control point {x, y}
 * @param {Object} P2 - Second control point {x, y}
 * @param {Object} P3 - End point {x, y}
 * @returns {{apex: {x: number, y: number}|null, isSCurve: boolean}}
 *          apex is null when rays are parallel; isSCurve indicates an S-shaped curve.
 */
export function computeApex(P0, P1, P2, P3) {
  const d1x = P1.x - P0.x;
  const d1y = P1.y - P0.y;
  const d2x = P2.x - P3.x;
  const d2y = P2.y - P3.y;
  const denom = d1x * d2y - d1y * d2x;

  if (Math.abs(denom) < 1e-6) {
    return { apex: null, isSCurve: false };
  }

  const dx = P3.x - P0.x;
  const dy = P3.y - P0.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const s = (dx * d1y - dy * d1x) / denom;

  const isSCurve = t < 0 || s < 0;
  const apex = { x: P0.x + t * d1x, y: P0.y + t * d1y };

  return { apex, isSCurve };
}

/**
 * Test whether a point lies inside or on the boundary of triangle ABC.
 *
 * Uses the sign-of-cross-product method with a small epsilon tolerance
 * to account for floating-point precision issues.
 *
 * @param {Object} pt - Point to test {x, y}
 * @param {Object} A - Triangle vertex A {x, y}
 * @param {Object} B - Triangle vertex B {x, y}
 * @param {Object} C - Triangle vertex C {x, y}
 * @param {number} [eps=0.5] - Epsilon tolerance for boundary detection
 * @returns {boolean} True if pt is inside or on the boundary of triangle ABC
 */
export function pointInTriangle(pt, A, B, C, eps = 0.5) {
  function sign(ax, ay, bx, by, cx, cy) {
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  }
  const d1 = sign(pt.x, pt.y, A.x, A.y, B.x, B.y);
  const d2 = sign(pt.x, pt.y, B.x, B.y, C.x, C.y);
  const d3 = sign(pt.x, pt.y, C.x, C.y, A.x, A.y);
  const hasNeg = d1 < -eps || d2 < -eps || d3 < -eps;
  const hasPos = d1 > eps || d2 > eps || d3 > eps;
  return !(hasNeg && hasPos);
}

/**
 * Check if a cubic segment is degenerate and should be skipped.
 *
 * A segment is degenerate when:
 * - Start and end points are identical (zero-length segment)
 * - Start point and first handle are identical (zero-length outgoing handle)
 * - End point and second handle are identical (zero-length incoming handle)
 *
 * @param {Object} P0 - Start point {x, y}
 * @param {Object} P1 - First control point {x, y}
 * @param {Object} P2 - Second control point {x, y}
 * @param {Object} P3 - End point {x, y}
 * @returns {boolean} True if the segment is degenerate
 */
export function isDegenerate(P0, P1, P2, P3) {
  // Zero-length segment
  if (P0.x === P3.x && P0.y === P3.y) return true;
  // Zero-length handle at start
  if (P0.x === P1.x && P0.y === P1.y) return true;
  // Zero-length handle at end
  if (P3.x === P2.x && P3.y === P2.y) return true;
  return false;
}

/**
 * Draw a line between two points on the given context.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D rendering context
 * @param {Object} a - Start point {x, y}
 * @param {Object} b - End point {x, y}
 */
export function drawLine(ctx, a, b) {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

/**
 * Basic geometric primitives for Fontra-coach.
 */
export function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function midPoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

export function angleFromVertical(p1, p2) {
  const dy = Math.abs(p2.y - p1.y);
  const dx = Math.abs(p2.x - p1.x);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export function isNearVertical(p1, p2, toleranceDegrees = 5) {
  return angleFromVertical(p1, p2) <= toleranceDegrees;
}

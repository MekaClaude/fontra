function vecAdd(a, b)  { return { x: a.x + b.x, y: a.y + b.y }; }
function vecSub(a, b)  { return { x: a.x - b.x, y: a.y - b.y }; }
function vecScale(v, s) { return { x: v.x * s, y: v.y * s }; }
export function vecLen(v)     { return Math.hypot(v.x, v.y); }
function vecNormalize(v) {
  const len = vecLen(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

export function solveCubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const point = {
    x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
  };
  const d1 = {
    x: 3*(mt*mt*(p1.x-p0.x) + 2*mt*t*(p2.x-p1.x) + t*t*(p3.x-p2.x)),
    y: 3*(mt*mt*(p1.y-p0.y) + 2*mt*t*(p2.y-p1.y) + t*t*(p3.y-p2.y)),
  };
  const d2 = {
    x: 6*(mt*(p2.x - 2*p1.x + p0.x) + t*(p3.x - 2*p2.x + p1.x)),
    y: 6*(mt*(p2.y - 2*p1.y + p0.y) + t*(p3.y - 2*p2.y + p1.y)),
  };
  return { point, d1, d2 };
}

export function solveQuad(p0, p1, p2, t) {
  const mt = 1 - t;
  const point = {
    x: mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x,
    y: mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y,
  };
  const d1 = {
    x: 2*mt*(p1.x-p0.x) + 2*t*(p2.x-p1.x),
    y: 2*mt*(p1.y-p0.y) + 2*t*(p2.y-p1.y),
  };
  const d2 = {
    x: 2*(p2.x - 2*p1.x + p0.x),
    y: 2*(p2.y - 2*p1.y + p0.y),
  };
  return { point, d1, d2 };
}

export function curvatureFromDerivatives(d1, d2) {
  const denom = Math.pow(vecLen(d1), 3);
  if (denom < 1e-10) return 0;
  const cross = d1.x * d2.y - d1.y * d2.x;
  return cross / denom;
}

export function curvatureColorHSL(kappa) {
  const absK = Math.abs(kappa);
  const hue = Math.max(0, Math.min(360, 280 - (Math.log(absK + 1e-8) + 8) * 32));
  return `hsl(${hue} 90% 60%)`;
}

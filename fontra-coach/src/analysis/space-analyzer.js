export function measureSidebearings(glyphData) {
  if (!glyphData.path || !glyphData.path.contours) return null;
  return {
    lsb: Math.min(...glyphData.path.contours.flatMap(c => c.points.map(p => p.x))),
    rsb: glyphData.xAdvance - Math.max(...glyphData.path.contours.flatMap(c => c.points.map(p => p.x)))
  };
}

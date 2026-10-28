/**
 * Normalize a Fontra glyph path into plain contours.
 *
 * Fontra's runtime path is a packed `VarPackedPath` exposing `numContours` and
 * `iterContourDecomposedSegments(ci)`. The coach's analysis code historically
 * assumed an invented `{ contours: [{ points: [{x,y}] }] }` shape, which never
 * occurs in real data. This adapter bridges the two so analysis runs on real glyphs.
 *
 * It also accepts the invented contour format (and plain arrays of {x,y}) so
 * legacy fixtures keep working.
 */

export function getContours(path) {
  if (!path) return [];

  // Fontra packed path.
  if (typeof path.numContours === "number" && typeof path.iterContourDecomposedSegments === "function") {
    const contours = [];
    for (let ci = 0; ci < path.numContours; ci++) {
      const points = [];
      for (const segment of path.iterContourDecomposedSegments(ci)) {
        const segPoints = Array.isArray(segment.points) ? segment.points : [];
        const n = segPoints.length;
        segPoints.forEach((p, i) => {
          points.push({
            x: p.x,
            y: p.y,
            kind: i === n - 1 ? "oncurve" : "offcurve",
            segmentType: segment.type,
          });
        });
      }
      if (points.length >= 2) contours.push({ points, closed: true });
    }
    return contours;
  }

  // Invented contour format.
  if (Array.isArray(path.contours)) {
    return path.contours.map((c) => ({
      points: Array.isArray(c.points) ? c.points : [],
      closed: c.closed !== false,
    }));
  }

  // Plain array of points.
  if (Array.isArray(path)) {
    return [{ points: path, closed: true }];
  }

  return [];
}

export function* iterSegments(path) {
  if (!path) return;
  if (typeof path.numContours === "number" && typeof path.iterContourDecomposedSegments === "function") {
    for (let ci = 0; ci < path.numContours; ci++) {
      for (const segment of path.iterContourDecomposedSegments(ci)) {
        yield { contourIndex: ci, ...segment };
      }
    }
    return;
  }
  // Fallback: synthesize segments from invented contours.
  const contours = getContours(path);
  for (let ci = 0; ci < contours.length; ci++) {
    const pts = contours[ci].points || [];
    for (let i = 0; i < pts.length; i++) {
      yield {
        contourIndex: ci,
        type: "line",
        points: [pts[i], pts[(i + 1) % pts.length]],
      };
    }
  }
}

export function isEmptyPath(path) {
  const contours = getContours(path);
  return contours.length === 0 || contours.every((c) => !c.points || c.points.length === 0);
}
// Pure selection logic shared by the selection transformation tools.
//
// The editor (sidebar panel, context menu) supplies the path and the current
// selection; everything in this module is a pure function of those two, which
// makes it unit-testable without a running editor.

import { getSelectionByContour } from "./path-functions.js";
import { parseSelection, range } from "./utils.ts";

// Return the indices of the contours that contain selected points.
export function getSelectedContourIndices(path, selection) {
  const { point: pointIndices } = parseSelection(selection);
  if (!pointIndices || !pointIndices.length) {
    return [];
  }
  return [...getSelectionByContour(path, pointIndices).keys()];
}

// Split the selection into groups of points that move as a unit: a closed
// contour is a single unit, an open contour contributes its individual
// points, and components, anchors and background images are units as well.
//
// When `pointLevel` is true, every selected point is treated as its own unit,
// even when it belongs to a closed contour. This is used by the "align/distribute
// points" actions, which operate on individual points instead of whole objects.
export function splitSelection(path, selection, options = {}) {
  const { pointLevel = false } = options || {};
  const {
    point: pointIndices,
    component: componentIndices,
    anchor: anchorIndices,
    backgroundImage: backgroundImageIndices,
  } = parseSelection(selection);

  const points = [];
  const contours = [];
  const components = componentIndices || [];
  const anchors = anchorIndices || [];
  const backgroundImages = backgroundImageIndices || [];

  const selectedPointIndices = pointIndices || [];
  if (selectedPointIndices.length && path) {
    const pointIndicesByContour = new Map();
    for (const pointIndex of selectedPointIndices) {
      if (pointIndex < 0 || pointIndex >= path.numPoints) {
        // Ignore out-of-bounds indices
        continue;
      }
      const [contourIndex] = path.getContourAndPointIndex(pointIndex);
      if (!pointIndicesByContour.has(contourIndex)) {
        pointIndicesByContour.set(contourIndex, []);
      }
      pointIndicesByContour.get(contourIndex).push(pointIndex);
    }

    for (const [contourIndex, contourPointIndices] of pointIndicesByContour) {
      const contourInfo = path.contourInfo[contourIndex];
      if (!pointLevel && contourInfo.isClosed) {
        // A closed contour is moved as a whole, even if only some of its
        // points are selected.
        const contourStartIndex = path.getAbsolutePointIndex(contourIndex, 0);
        const contourEndIndex = contourInfo.endPoint + 1;
        contours.push(Array.from(range(contourStartIndex, contourEndIndex)));
      } else {
        points.push(...contourPointIndices);
      }
    }
  }

  return { points, contours, components, anchors, backgroundImages };
}

// Return the selection of each object that can be moved independently.
export function getMovableObjectSelections(path, selection, options = {}) {
  const { pointLevel = false } = options || {};
  const { points, contours, components, anchors, backgroundImages } = splitSelection(
    path,
    selection,
    { pointLevel }
  );

  const movableObjects = [];
  for (const pointIndex of points) {
    movableObjects.push(new Set([`point/${pointIndex}`]));
  }
  for (const pointIndices of contours) {
    movableObjects.push(
      new Set(pointIndices.map((pointIndex) => `point/${pointIndex}`))
    );
  }
  for (const componentIndex of components) {
    movableObjects.push(new Set([`component/${componentIndex}`]));
  }
  for (const anchorIndex of anchors) {
    movableObjects.push(new Set([`anchor/${anchorIndex}`]));
  }
  for (const backgroundImageIndex of backgroundImages) {
    movableObjects.push(new Set([`backgroundImage/${backgroundImageIndex}`]));
  }

  return movableObjects;
}

// The number of objects that can be moved independently. Align and
// distribute need at least two.
export function countMovableObjects(path, selection, options = {}) {
  if (!path) {
    return 0;
  }
  return getMovableObjectSelections(path, selection, options).length;
}

// Align and distribute need at least two independently movable objects.
export function canAlignOrDistribute(path, selection, options = {}) {
  return countMovableObjects(path, selection, options) >= 2;
}

// The positions that the explicitly selected points must end up at, given the
// move delta of the object they belong to.
//
// Moving an on-curve point also drags the off-curve handles next to it along,
// so the change of one object can write the position of a point that belongs
// to another object. The explicit position of a selected point must win, so it
// is computed up front, from the unmodified geometry.
export function getExplicitPointTargets(path, selection, delta) {
  const targets = new Map();
  if (!path) {
    return targets;
  }

  const { point: pointIndices } = parseSelection(selection);
  for (const pointIndex of pointIndices || []) {
    if (pointIndex < 0 || pointIndex >= path.numPoints) {
      // Ignore out-of-bounds indices
      continue;
    }
    const point = path.getPoint(pointIndex);
    targets.set(pointIndex, {
      x: Math.round(point.x + delta.x),
      y: Math.round(point.y + delta.y),
    });
  }

  return targets;
}

// The boolean path operations: "union" merges the selected contours (or all
// contours if nothing is selected), the other operations combine the
// unselected contours with the selected ones, so they need at least one of
// each.
export function canDoPathOperation(path, selection, keyPart) {
  if (!path) {
    return false;
  }

  const selectedContourIndices = getSelectedContourIndices(path, selection);

  if (keyPart === "union") {
    // Union merges the selected contours. With no selection it merges all
    // contours of the glyph, which is only useful if there is more than one.
    return path.numContours > 1 || selectedContourIndices.length > 0;
  }

  return (
    selectedContourIndices.length > 0 &&
    selectedContourIndices.length < path.numContours
  );
}

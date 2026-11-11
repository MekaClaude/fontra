import { expect } from "chai";

import {
  canAlignOrDistribute,
  canDoPathOperation,
  countMovableObjects,
  getMovableObjectSelections,
  getSelectedContourIndices,
  splitSelection,
} from "@fontra/core/selection-transformations.js";
import { VarPackedPath } from "@fontra/core/var-path.js";

// A path with two closed square contours of four points each:
// contour 0: points 0..3, contour 1: points 4..7
function makeTwoClosedContours() {
  const path = new VarPackedPath();
  path.moveTo(0, 0);
  path.lineTo(100, 0);
  path.lineTo(100, 100);
  path.lineTo(0, 100);
  path.closePath();
  path.moveTo(200, 0);
  path.lineTo(300, 0);
  path.lineTo(300, 100);
  path.lineTo(200, 100);
  path.closePath();
  return path;
}

// A path with one closed square contour and one open contour of two points:
// contour 0: points 0..3 (closed), contour 1: points 4..5 (open)
function makeClosedAndOpenContours() {
  const path = new VarPackedPath();
  path.moveTo(0, 0);
  path.lineTo(100, 0);
  path.lineTo(100, 100);
  path.lineTo(0, 100);
  path.closePath();
  path.moveTo(200, 0);
  path.lineTo(300, 0);
  return path;
}

function selection(...pointIndices) {
  return new Set(pointIndices.map((pointIndex) => `point/${pointIndex}`));
}

describe("Selection Transformations tests", () => {
  describe("getSelectedContourIndices", () => {
    it("returns the contours that contain selected points", () => {
      const path = makeTwoClosedContours();
      expect(getSelectedContourIndices(path, selection(0, 1))).to.deep.equal([0]);
      expect(getSelectedContourIndices(path, selection(4, 5))).to.deep.equal([1]);
      expect(getSelectedContourIndices(path, selection(1, 5))).to.deep.equal([0, 1]);
    });

    it("returns an empty list without a point selection", () => {
      const path = makeTwoClosedContours();
      expect(getSelectedContourIndices(path, new Set())).to.deep.equal([]);
      expect(getSelectedContourIndices(path, new Set(["component/0"]))).to.deep.equal(
        []
      );
    });
  });

  describe("splitSelection", () => {
    it("treats a closed contour as a single unit", () => {
      const path = makeTwoClosedContours();
      const result = splitSelection(path, selection(0, 1, 2, 3));
      expect(result.contours).to.deep.equal([[0, 1, 2, 3]]);
      expect(result.points).to.deep.equal([]);
    });

    it("treats a partially selected closed contour as a single unit", () => {
      // This is the bug fix: selecting any point of a closed contour must
      // yield that whole contour as one movable object.
      const path = makeTwoClosedContours();
      const result = splitSelection(path, selection(2));
      expect(result.contours).to.deep.equal([[0, 1, 2, 3]]);
      expect(result.points).to.deep.equal([]);
    });

    it("keeps the points of an open contour separate", () => {
      const path = makeClosedAndOpenContours();
      const result = splitSelection(path, selection(4, 5));
      expect(result.contours).to.deep.equal([]);
      expect(result.points).to.deep.equal([4, 5]);
    });

    it("does not mix up points of different contours", () => {
      // The point indices are absolute, but the contour index must be derived
      // from the path, not from the order of the selection.
      const path = makeTwoClosedContours();
      const result = splitSelection(path, selection(4, 5, 6, 7));
      expect(result.contours).to.deep.equal([[4, 5, 6, 7]]);
      expect(result.points).to.deep.equal([]);
    });

    it("reports components, anchors and background images", () => {
      const path = makeTwoClosedContours();
      const result = splitSelection(
        path,
        new Set(["component/0", "anchor/1", "backgroundImage/2"])
      );
      expect(result.components).to.deep.equal([0]);
      expect(result.anchors).to.deep.equal([1]);
      expect(result.backgroundImages).to.deep.equal([2]);
    });
  });

  describe("getMovableObjectSelections / countMovableObjects", () => {
    it("returns one object per closed contour", () => {
      const path = makeTwoClosedContours();
      const objects = getMovableObjectSelections(
        path,
        selection(0, 1, 2, 3, 4, 5, 6, 7)
      );
      expect(objects.length).to.equal(2);
      expect(objects[0]).to.deep.equal(
        new Set(["point/0", "point/1", "point/2", "point/3"])
      );
      expect(objects[1]).to.deep.equal(
        new Set(["point/4", "point/5", "point/6", "point/7"])
      );
    });

    it("counts a single selected contour as one object", () => {
      const path = makeTwoClosedContours();
      expect(countMovableObjects(path, selection(0, 1, 2, 3))).to.equal(1);
      expect(countMovableObjects(path, selection(2))).to.equal(1);
      expect(countMovableObjects(path, new Set())).to.equal(0);
    });
  });

  describe("canAlignOrDistribute", () => {
    it("needs at least two movable objects", () => {
      const path = makeTwoClosedContours();
      expect(canAlignOrDistribute(path, selection(0, 1, 2, 3))).to.equal(false);
      expect(canAlignOrDistribute(path, selection(0, 1, 2, 3, 4, 5, 6, 7))).to.equal(
        true
      );
    });

    it("is false without a path", () => {
      expect(canAlignOrDistribute(null, selection(0))).to.equal(false);
    });
  });

  describe("canDoPathOperation", () => {
    it("enables union when more than one contour exists", () => {
      const path = makeTwoClosedContours();
      expect(canDoPathOperation(path, new Set(), "union")).to.equal(true);
      expect(canDoPathOperation(path, selection(0, 1, 2, 3), "union")).to.equal(true);
    });

    it("disables union for a single contour without selection", () => {
      const path = makeClosedAndOpenContours();
      expect(canDoPathOperation(path, new Set(), "union")).to.equal(true);
    });

    it("needs a selected and an unselected contour for the other operations", () => {
      const path = makeTwoClosedContours();
      // One of two contours selected: subtract, intersect and exclude can work.
      expect(canDoPathOperation(path, selection(0, 1, 2, 3), "subtract")).to.equal(
        true
      );
      expect(canDoPathOperation(path, selection(0, 1, 2, 3), "intersect")).to.equal(
        true
      );
      expect(canDoPathOperation(path, selection(0, 1, 2, 3), "exclude")).to.equal(true);

      // Both contours selected: nothing is left to combine with.
      expect(
        canDoPathOperation(path, selection(0, 1, 2, 3, 4, 5, 6, 7), "subtract")
      ).to.equal(false);
      expect(
        canDoPathOperation(path, selection(0, 1, 2, 3, 4, 5, 6, 7), "intersect")
      ).to.equal(false);
      expect(
        canDoPathOperation(path, selection(0, 1, 2, 3, 4, 5, 6, 7), "exclude")
      ).to.equal(false);

      // Nothing selected: there is no selected contour.
      expect(canDoPathOperation(path, new Set(), "subtract")).to.equal(false);
      expect(canDoPathOperation(path, new Set(), "intersect")).to.equal(false);
      expect(canDoPathOperation(path, new Set(), "exclude")).to.equal(false);
    });

    it("is false without a path", () => {
      expect(canDoPathOperation(null, selection(0), "union")).to.equal(false);
    });
  });
});

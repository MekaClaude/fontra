import { expect } from "chai";

import {
  KAPPA,
  RULE_ARC,
  RULE_BALANCE,
  RULE_CONTINUITY,
  RULE_S_SYMMETRY,
  RULE_TRAJECTORY,
  SEVERITY_ERROR,
  SEVERITY_OK,
  analyzeCubicSegment,
  analyzePath,
  applyIdealHandles,
  computeIdealCubic,
  sampleArc,
  sampleCubic,
} from "@fontra/core/ideal-curve.js";
import { VarPackedPath } from "@fontra/core/var-path.js";

const RADIUS = 100;
const K = KAPPA * RADIUS;

// A quarter circle of radius 100, drawn with the classic kappa handles:
// centre at (0, 100), from (0, 0) to (100, 100).
function quarterCircleCubic(radius = RADIUS) {
  const k = KAPPA * radius;
  return [
    { x: 0, y: 0 },
    { x: k, y: 0 },
    { x: radius, y: radius - k },
    { x: radius, y: radius },
  ];
}

function maxDistance(pointLists) {
  let max = 0;
  const [listA, listB] = pointLists;
  for (let i = 0; i < Math.min(listA.length, listB.length); i++) {
    const dx = listA[i].x - listB[i].x;
    const dy = listA[i].y - listB[i].y;
    max = Math.max(max, Math.hypot(dx, dy));
  }
  return max;
}

describe("Ideal curve tests", () => {
  describe("computeIdealCubic", () => {
    it("recognises a kappa quarter circle", () => {
      const ideal = computeIdealCubic(...quarterCircleCubic());
      expect(ideal).to.not.be.null;
      expect(ideal.kind).to.equal("arc");
      expect(ideal.isSCurve).to.be.false;
      expect(ideal.handleLength).to.be.closeTo(K, 1e-6);
      expect(ideal.radius).to.be.closeTo(RADIUS, 1e-6);
      expect(ideal.sweep).to.be.closeTo(Math.PI / 2, 1e-9);
    });

    it("places the ideal handles on the tangents", () => {
      const ideal = computeIdealCubic(...quarterCircleCubic());
      expect(ideal.controlPoints[0].x).to.be.closeTo(K, 1e-6);
      expect(ideal.controlPoints[0].y).to.be.closeTo(0, 1e-6);
      expect(ideal.controlPoints[1].x).to.be.closeTo(RADIUS, 1e-6);
      expect(ideal.controlPoints[1].y).to.be.closeTo(RADIUS - K, 1e-6);
    });

    it("finds the circle the arc lives on", () => {
      const ideal = computeIdealCubic(...quarterCircleCubic());
      expect(ideal.arc).to.not.be.null;
      expect(ideal.arc.center.x).to.be.closeTo(0, 1e-6);
      expect(ideal.arc.center.y).to.be.closeTo(RADIUS, 1e-6);
      expect(ideal.arc.radius).to.be.closeTo(RADIUS, 1e-6);
    });

    it("approximates the true circle to within a fraction of a percent", () => {
      const cubic = quarterCircleCubic();
      const ideal = computeIdealCubic(...cubic);
      const cubicPoints = sampleCubic(...cubic, 128);
      // Measure the radial error: how far the cubic strays from the circle
      // it is meant to describe.
      let maxRadialError = 0;
      for (const point of cubicPoints) {
        const radialError = Math.abs(
          Math.hypot(
            point.x - ideal.arc.center.x,
            point.y - ideal.arc.center.y
          ) - ideal.arc.radius
        );
        maxRadialError = Math.max(maxRadialError, radialError);
      }
      // The classic kappa cubic misses the circle by ~0.027% of the radius.
      expect(maxRadialError).to.be.below(0.05);
    });

    it("reduces to a straight line handle of a third of the chord", () => {
      const ideal = computeIdealCubic(
        { x: 0, y: 0 },
        { x: 33, y: 0 },
        { x: 66, y: 0 },
        { x: 100, y: 0 }
      );
      expect(ideal.handleLength).to.be.closeTo(100 / 3, 1e-6);
      expect(ideal.sweep).to.equal(0);
      expect(ideal.arc).to.be.null;
    });

    it("returns null for a degenerate segment", () => {
      expect(
        computeIdealCubic(
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 50, y: 50 },
          { x: 100, y: 0 }
        )
      ).to.be.null;
    });
  });

  describe("analyzeCubicSegment", () => {
    it("accepts a correct arc", () => {
      const analysis = analyzeCubicSegment(...quarterCircleCubic());
      expect(analysis.issues).to.deep.equal([]);
      expect(analysis.severity).to.equal(SEVERITY_OK);
      expect(analysis.maxDeviation).to.be.below(0.001);
    });

    it("flags handles that are too long", () => {
      const cubic = quarterCircleCubic();
      const stretched = [
        cubic[0],
        { x: cubic[1].x * 1.25, y: cubic[1].y * 1.25 },
        { x: cubic[2].x, y: cubic[2].y + (RADIUS - cubic[2].y) * 0.25 },
        cubic[3],
      ];
      const analysis = analyzeCubicSegment(...stretched);
      const issue = analysis.issues.find((item) => item.rule === RULE_TRAJECTORY);
      expect(issue).to.not.be.undefined;
      expect(issue.severity).to.equal(SEVERITY_ERROR);
      expect(analysis.severity).to.equal(SEVERITY_ERROR);
      // The ideal handle length is still the kappa distance.
      expect(analysis.ideal.handleLength).to.be.closeTo(K, 1e-6);
    });

    it("flags handles that are too short", () => {
      const cubic = quarterCircleCubic();
      const shrunk = [
        cubic[0],
        { x: cubic[1].x * 0.7, y: cubic[1].y * 0.7 },
        { x: cubic[2].x, y: cubic[2].y + (RADIUS - cubic[2].y) * 0.7 },
        cubic[3],
      ];
      const analysis = analyzeCubicSegment(...shrunk);
      const issue = analysis.issues.find((item) => item.rule === RULE_TRAJECTORY);
      expect(issue).to.not.be.undefined;
      expect(issue.severity).to.equal(SEVERITY_ERROR);
    });

    it("flags a segment whose ends describe different arcs", () => {
      // Leaves the start at 30° above the chord, arrives at the end at 60°
      // below it: the two ends disagree about the circle.
      const analysis = analyzeCubicSegment(
        { x: 0, y: 0 },
        { x: 86.6, y: 50 },
        { x: 50, y: 86.6 },
        { x: 100, y: 0 }
      );
      expect(analysis.ideal.isSCurve).to.be.false;
      const issue = analysis.issues.find((item) => item.rule === RULE_ARC);
      expect(issue).to.not.be.undefined;
      expect(issue.value).to.be.closeTo(30, 0.5);
    });

    it("accepts a symmetric S-curve", () => {
      const analysis = analyzeCubicSegment(
        { x: 0, y: 0 },
        { x: 25, y: 50 },
        { x: 75, y: -50 },
        { x: 100, y: 0 }
      );
      expect(analysis.ideal.isSCurve).to.be.true;
      expect(analysis.issues).to.deep.equal([]);
      expect(analysis.severity).to.equal(SEVERITY_OK);
    });

    it("flags an asymmetric S-curve", () => {
      const analysis = analyzeCubicSegment(
        { x: 0, y: 0 },
        { x: 25, y: 50 },
        { x: 60, y: -50 },
        { x: 100, y: 0 }
      );
      expect(analysis.ideal.isSCurve).to.be.true;
      const issue = analysis.issues.find((item) => item.rule === RULE_S_SYMMETRY);
      expect(issue).to.not.be.undefined;
      expect(issue.severity).to.equal(SEVERITY_ERROR);
    });

    it("does not apply the arc rule to S-curves", () => {
      const analysis = analyzeCubicSegment(
        { x: 0, y: 0 },
        { x: 25, y: 50 },
        { x: 75, y: -50 },
        { x: 100, y: 0 }
      );
      expect(analysis.issues.find((item) => item.rule === RULE_TRAJECTORY)).to.be
        .undefined;
    });
  });

  describe("analyzePath", () => {
    function makePath(outgoingHandle) {
      const path = new VarPackedPath();
      path.appendUnpackedContour({
        isClosed: true,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0, type: "cubic" },
          { x: 50, y: 100, type: "cubic" },
          { x: 100, y: 100, smooth: true },
          { x: outgoingHandle.x, y: outgoingHandle.y, type: "cubic" },
          { x: 150, y: 200, type: "cubic" },
          { x: 200, y: 200 },
        ],
      });
      return path;
    }

    it("finds no issues in a well formed contour", () => {
      const analysis = analyzePath(makePath({ x: 150, y: 100 }));
      expect(analysis.issues).to.deep.equal([]);
      expect(analysis.severity).to.equal(SEVERITY_OK);
      expect(analysis.segments.length).to.equal(3);
    });

    it("flags a kink at a smooth anchor", () => {
      const analysis = analyzePath(makePath({ x: 150, y: 60 }));
      const issue = analysis.issues.find((item) => item.rule === RULE_CONTINUITY);
      expect(issue).to.not.be.undefined;
      expect(issue.severity).to.equal(SEVERITY_ERROR);
    });

    it("flags unbalanced handles at a smooth anchor", () => {
      const analysis = analyzePath(makePath({ x: 150, y: 100 }));
      // Move the outgoing handle further away, but keep the tangent straight.
      const path = new VarPackedPath();
      path.appendUnpackedContour({
        isClosed: true,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0, type: "cubic" },
          { x: 50, y: 100, type: "cubic" },
          { x: 100, y: 100, smooth: true },
          { x: 180, y: 100, type: "cubic" },
          { x: 150, y: 200, type: "cubic" },
          { x: 200, y: 200 },
        ],
      });
      const analysis2 = analyzePath(path);
      const issue = analysis2.issues.find((item) => item.rule === RULE_BALANCE);
      expect(issue).to.not.be.undefined;
      expect(issue.severity).to.equal(SEVERITY_ERROR);
    });

    it("reports segments and contours", () => {
      const analysis = analyzePath(makePath({ x: 150, y: 100 }));
      expect(analysis.contours.length).to.equal(1);
      expect(analysis.contours[0].segments.length).to.equal(3);
      expect(analysis.segments[0].type).to.equal("cubic");
      expect(analysis.segments[0].pointIndices).to.deep.equal([0, 1, 2, 3]);
    });
  });

  describe("applyIdealHandles", () => {
    it("brings a curve onto its trajectory", () => {
      // A quarter circle whose handles are 30% too long.
      const path = new VarPackedPath();
      path.appendUnpackedContour({
        isClosed: true,
        points: [
          { x: 0, y: 0 },
          { x: K * 1.3, y: 0, type: "cubic" },
          { x: RADIUS, y: RADIUS - K * 1.3, type: "cubic" },
          { x: RADIUS, y: RADIUS },
        ],
      });

      const before = analyzePath(path);
      expect(before.issues.length).to.be.greaterThan(0);

      const entry = before.segments.find(
        (segment) => segment.type === "cubic" && segment.analysis
      );
      expect(applyIdealHandles(path, entry)).to.be.true;

      const after = analyzePath(path);
      expect(after.issues).to.deep.equal([]);
      expect(after.severity).to.equal(SEVERITY_OK);

      // The handles now sit at the kappa distance.
      expect(path.getPoint(1).x).to.be.closeTo(K, 1e-6);
      expect(path.getPoint(2).y).to.be.closeTo(RADIUS - K, 1e-6);

      // The anchors did not move.
      expect(path.getPoint(0).x).to.equal(0);
      expect(path.getPoint(3).x).to.equal(RADIUS);
    });

    it("leaves a correct curve alone", () => {
      const path = new VarPackedPath();
      path.appendUnpackedContour({
        isClosed: true,
        points: [
          { x: 0, y: 0 },
          { x: K, y: 0, type: "cubic" },
          { x: RADIUS, y: RADIUS - K, type: "cubic" },
          { x: RADIUS, y: RADIUS },
        ],
      });
      const entry = analyzePath(path).segments[0];
      expect(applyIdealHandles(path, entry)).to.be.true;
      expect(path.getPoint(1).x).to.be.closeTo(K, 1e-9);
      expect(path.getPoint(2).y).to.be.closeTo(RADIUS - K, 1e-9);
    });
  });
});

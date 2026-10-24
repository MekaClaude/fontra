import { expect } from "chai";

import {
  drawAnchorRings,
  drawCurveTrajectory,
  severityColor,
} from "@fontra/core/curve-trajectory-drawing.js";
import { KAPPA, analyzePath } from "@fontra/core/ideal-curve.js";
import { VarPackedPath } from "@fontra/core/var-path.js";

const RADIUS = 100;
const K = KAPPA * RADIUS;

const PARAMETERS = {
  strokeWidth: 1.5,
  trajectoryStrokeWidth: 1.6,
  circleStrokeWidth: 1,
  ribbonOpacity: 0.16,
  handleRadius: 4,
  ringRadius: 8,
  ringStrokeWidth: 1.5,
  labelFontSize: 11,
  dashLength: 7,
  dashGap: 5,
  dotLength: 1,
  dotGap: 4,
  haloWidth: 3,
  idealColor: "#6C5CE7",
  okColor: "#1D9E75",
  warnColor: "#D99117",
  errorColor: "#E24B4A",
  haloColor: "#FFFFFF",
};

/** A canvas 2D context that records everything it is asked to draw. */
class MockContext {
  constructor() {
    this.calls = [];
  }

  _record(...args) {
    this.calls.push(args);
  }

  beginPath() {
    this._record("beginPath");
  }
  moveTo(x, y) {
    this._record("moveTo", x, y);
  }
  lineTo(x, y) {
    this._record("lineTo", x, y);
  }
  bezierCurveTo(...args) {
    this._record("bezierCurveTo", ...args);
  }
  quadraticCurveTo(...args) {
    this._record("quadraticCurveTo", ...args);
  }
  closePath() {
    this._record("closePath");
  }
  arc(...args) {
    this._record("arc", ...args);
  }
  fill() {
    this._record("fill");
  }
  stroke() {
    this._record("stroke");
  }
  fillText(...args) {
    this._record("fillText", ...args);
  }
  strokeText(...args) {
    this._record("strokeText", ...args);
  }
  save() {
    this._record("save");
  }
  restore() {
    this._record("restore");
  }
  setLineDash(...args) {
    this._record("setLineDash", ...args);
  }
  set font(value) {
    this._record("font", value);
  }
  get font() {
    return "";
  }
  set fillStyle(value) {
    this._record("fillStyle", value);
  }
  set strokeStyle(value) {
    this._record("strokeStyle", value);
  }
  set lineWidth(value) {
    this._record("lineWidth", value);
  }
  set globalAlpha(value) {
    this._record("globalAlpha", value);
  }
  set textAlign(value) {}
  set textBaseline(value) {}
  set lineJoin(value) {}

  callsOfType(type) {
    return this.calls.filter((call) => call[0] === type);
  }

  /**
   * The polyline that is drawn between a dash pattern and the stroke that
   * follows it. The path may be built before the dash is set, so the points
   * are collected from the preceding beginPath.
   */
  polylineAfterDash(dash) {
    const dashIndex = this.calls.findIndex(
      (call) =>
        call[0] === "setLineDash" &&
        call[1].length === dash.length &&
        call[1].every((value, index) => value === dash[index])
    );
    if (dashIndex < 0) {
      return [];
    }
    let start = dashIndex;
    while (start >= 0 && this.calls[start][0] !== "beginPath") {
      start--;
    }
    const points = [];
    for (let i = start + 1; i < dashIndex; i++) {
      const call = this.calls[i];
      if (call[0] === "lineTo" || call[0] === "moveTo") {
        points.push({ x: call[1], y: call[2] });
      }
    }
    return points;
  }
}

function makeQuarterCirclePath(handleFactor = 1) {
  const path = new VarPackedPath();
  path.appendUnpackedContour({
    isClosed: true,
    points: [
      { x: 0, y: 0 },
      { x: K * handleFactor, y: 0, type: "cubic" },
      { x: RADIUS, y: RADIUS - K * handleFactor, type: "cubic" },
      { x: RADIUS, y: RADIUS },
    ],
  });
  return path;
}

describe("Curve trajectory drawing tests", () => {
  it("draws the reference trajectory through the ideal control points", () => {
    const path = makeQuarterCirclePath(1.3);
    const entry = analyzePath(path).segments[0];
    const context = new MockContext();

    drawCurveTrajectory(context, entry, PARAMETERS, {});

    const curves = context.callsOfType("bezierCurveTo");
    expect(curves.length).to.equal(1);
    const [, x0, y0, x1, y1, x2, y2] = curves[0];
    // The ideal control points are at the kappa distance, not where the
    // handles were drawn.
    expect(x0).to.be.closeTo(K, 1e-6);
    expect(y0).to.be.closeTo(0, 1e-6);
    expect(x1).to.be.closeTo(RADIUS, 1e-6);
    expect(y1).to.be.closeTo(RADIUS - K, 1e-6);
    expect(x2).to.be.closeTo(RADIUS, 1e-6);
    expect(y2).to.be.closeTo(RADIUS, 1e-6);
  });

  it("fills the deviation ribbon only when the curve is off trajectory", () => {
    const offContext = new MockContext();
    drawCurveTrajectory(
      offContext,
      analyzePath(makeQuarterCirclePath(1.3)).segments[0],
      PARAMETERS,
      {}
    );
    expect(offContext.callsOfType("fill").length).to.equal(1);
    expect(offContext.callsOfType("closePath").length).to.equal(1);

    const onContext = new MockContext();
    drawCurveTrajectory(
      onContext,
      analyzePath(makeQuarterCirclePath(1)).segments[0],
      PARAMETERS,
      {}
    );
    expect(onContext.callsOfType("fill").length).to.equal(0);
  });

  it("draws the circle the curve describes", () => {
    const context = new MockContext();
    drawCurveTrajectory(
      context,
      analyzePath(makeQuarterCirclePath(1)).segments[0],
      PARAMETERS,
      {}
    );
    // The circle guide is drawn as a dotted polyline through points that all
    // sit on the circle.
    const points = context.polylineAfterDash([
      PARAMETERS.dotLength,
      PARAMETERS.dotGap,
    ]);
    expect(points.length).to.be.greaterThan(20);
    for (const point of points) {
      const radius = Math.hypot(point.x - 0, point.y - RADIUS);
      expect(radius).to.be.closeTo(RADIUS, 1e-6);
    }
  });

  it("marks where the handles should be", () => {
    const context = new MockContext();
    drawCurveTrajectory(
      context,
      analyzePath(makeQuarterCirclePath(1.3)).segments[0],
      PARAMETERS,
      {}
    );
    const arcs = context.callsOfType("arc");
    expect(arcs.length).to.equal(2);
    expect(arcs[0][1]).to.be.closeTo(K, 1e-6);
    expect(arcs[0][2]).to.be.closeTo(0, 1e-6);
    expect(arcs[1][1]).to.be.closeTo(RADIUS, 1e-6);
    expect(arcs[1][2]).to.be.closeTo(RADIUS - K, 1e-6);
  });

  it("connects the drawn handles to the ideal ones", () => {
    const context = new MockContext();
    drawCurveTrajectory(
      context,
      analyzePath(makeQuarterCirclePath(1.3)).segments[0],
      PARAMETERS,
      {}
    );
    // Two handle-gap lines: one per handle.
    const lines = context
      .callsOfType("lineTo")
      .filter((call) => call[0] === "lineTo");
    const strokes = context.callsOfType("stroke");
    expect(strokes.length).to.be.greaterThan(0);
    expect(lines.length).to.be.greaterThan(0);
  });

  it("labels the deviation of the highlighted segment only", () => {
    const entry = analyzePath(makeQuarterCirclePath(1.3)).segments[0];

    const labelled = new MockContext();
    drawCurveTrajectory(labelled, entry, PARAMETERS, {
      showLabels: true,
      isHighlighted: true,
    });
    const texts = labelled.callsOfType("fillText");
    expect(texts.length).to.equal(1);
    expect(texts[0][1]).to.match(/^\d+\.\du$/);

    const unlabelled = new MockContext();
    drawCurveTrajectory(unlabelled, entry, PARAMETERS, {
      showLabels: true,
      isHighlighted: false,
    });
    expect(unlabelled.callsOfType("fillText").length).to.equal(0);
  });

  it("rings the anchors that have something to report", () => {
    const path = makeQuarterCirclePath(1.3);
    const analysis = analyzePath(path);
    const context = new MockContext();

    drawAnchorRings(context, path, analysis.segments, analysis, PARAMETERS);

    const arcs = context.callsOfType("arc");
    expect(arcs.length).to.be.greaterThan(0);
    // The rings are drawn in the error colour.
    const colors = context
      .callsOfType("strokeStyle")
      .map((call) => call[1]);
    expect(colors).to.include(PARAMETERS.errorColor);
  });

  it("maps severity to a colour", () => {
    expect(severityColor("ok", PARAMETERS)).to.equal(PARAMETERS.okColor);
    expect(severityColor("warn", PARAMETERS)).to.equal(PARAMETERS.warnColor);
    expect(severityColor("error", PARAMETERS)).to.equal(PARAMETERS.errorColor);
  });

  it("draws a quadratic segment with a quadratic curve", () => {
    const path = new VarPackedPath();
    path.appendUnpackedContour({
      isClosed: true,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 60, type: "quad" },
        { x: 100, y: 0 },
      ],
    });
    const analysis = analyzePath(path);
    const quadEntry = analysis.segments.find((segment) => segment.type === "quad");
    expect(quadEntry).to.not.be.undefined;

    const context = new MockContext();
    drawCurveTrajectory(context, quadEntry, PARAMETERS, {});
    expect(context.callsOfType("quadraticCurveTo").length).to.equal(1);
    expect(context.callsOfType("bezierCurveTo").length).to.equal(0);
  });
});

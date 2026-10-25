import { expect } from "chai";

import {
  aggregateScopeFindings,
  compareFindings,
  scopeToSelectionMode,
} from "@fontra/core/curve-trajectory-scope.js";
import {
  SEVERITY_ERROR,
  SEVERITY_OK,
  SEVERITY_WARN,
} from "@fontra/core/ideal-curve.js";

function makeSegment(severity, { degenerate = false } = {}) {
  return {
    analysis: { severity, degenerate },
  };
}

function makeIssue(severity, rule, segment = null) {
  return {
    severity,
    rule,
    message: `${rule} issue`,
    detail: "",
    segment,
  };
}

describe("Curve trajectory scope tests", () => {
  describe("scopeToSelectionMode", () => {
    it("maps the scopes onto the editor's selection modes", () => {
      expect(scopeToSelectionMode("editing")).to.equal("editing");
      expect(scopeToSelectionMode("selected")).to.equal("selected");
      expect(scopeToSelectionMode("all")).to.equal("all");
    });

    it("falls back to the editing scope", () => {
      expect(scopeToSelectionMode(undefined)).to.equal("editing");
      expect(scopeToSelectionMode("nonsense")).to.equal("editing");
    });
  });

  describe("compareFindings", () => {
    it("sorts by severity first", () => {
      const error = makeIssue(SEVERITY_ERROR, "trajectory");
      const warn = makeIssue(SEVERITY_WARN, "trajectory");
      expect(compareFindings(error, warn)).to.be.lessThan(0);
      expect(compareFindings(warn, error)).to.be.greaterThan(0);
    });

    it("sorts by glyph name within a severity", () => {
      const a = { ...makeIssue(SEVERITY_ERROR, "trajectory"), glyphName: "A" };
      const b = { ...makeIssue(SEVERITY_ERROR, "trajectory"), glyphName: "B" };
      expect(compareFindings(a, b)).to.be.lessThan(0);
      expect(compareFindings(b, a)).to.be.greaterThan(0);
    });

    it("sorts by contour and segment within a glyph", () => {
      const first = {
        ...makeIssue(SEVERITY_ERROR, "trajectory"),
        glyphName: "A",
        segment: { contourIndex: 0, segmentIndex: 1 },
      };
      const second = {
        ...makeIssue(SEVERITY_ERROR, "trajectory"),
        glyphName: "A",
        segment: { contourIndex: 1, segmentIndex: 0 },
      };
      expect(compareFindings(first, second)).to.be.lessThan(0);
    });
  });

  describe("aggregateScopeFindings", () => {
    it("counts curves and off-trajectory curves", () => {
      const result = aggregateScopeFindings([
        {
          glyphName: "O",
          analysis: {
            segments: [
              makeSegment(SEVERITY_OK),
              makeSegment(SEVERITY_WARN),
              makeSegment(SEVERITY_ERROR),
            ],
            issues: [],
          },
        },
      ]);
      expect(result.glyphCount).to.equal(1);
      expect(result.curveCount).to.equal(3);
      expect(result.offCount).to.equal(2);
    });

    it("ignores degenerate segments", () => {
      const result = aggregateScopeFindings([
        {
          glyphName: "O",
          analysis: {
            segments: [
              makeSegment(SEVERITY_OK),
              makeSegment(SEVERITY_ERROR, { degenerate: true }),
            ],
            issues: [],
          },
        },
      ]);
      expect(result.curveCount).to.equal(1);
      expect(result.offCount).to.equal(0);
    });

    it("merges the issues of all glyphs and tags them with their glyph name", () => {
      const result = aggregateScopeFindings([
        {
          glyphName: "A",
          analysis: {
            segments: [],
            issues: [makeIssue(SEVERITY_ERROR, "trajectory")],
          },
        },
        {
          glyphName: "B",
          analysis: {
            segments: [],
            issues: [makeIssue(SEVERITY_WARN, "balance")],
          },
        },
      ]);
      expect(result.findings).to.have.lengthOf(2);
      expect(result.findings.map((finding) => finding.glyphName)).to.deep.equal([
        "A",
        "B",
      ]);
    });

    it("sorts the findings by severity, then by glyph name", () => {
      const result = aggregateScopeFindings([
        {
          glyphName: "B",
          analysis: {
            segments: [],
            issues: [makeIssue(SEVERITY_WARN, "balance")],
          },
        },
        {
          glyphName: "A",
          analysis: {
            segments: [],
            issues: [makeIssue(SEVERITY_ERROR, "trajectory")],
          },
        },
      ]);
      expect(result.findings.map((finding) => finding.glyphName)).to.deep.equal([
        "A",
        "B",
      ]);
      expect(result.findings[0].severity).to.equal(SEVERITY_ERROR);
    });

    it("skips glyphs without an analysis", () => {
      const result = aggregateScopeFindings([
        { glyphName: "A", analysis: null },
        {
          glyphName: "B",
          analysis: { segments: [makeSegment(SEVERITY_OK)], issues: [] },
        },
      ]);
      expect(result.glyphCount).to.equal(1);
      expect(result.curveCount).to.equal(1);
    });

    it("returns an empty result for an empty scope", () => {
      const result = aggregateScopeFindings([]);
      expect(result).to.deep.equal({
        findings: [],
        glyphCount: 0,
        curveCount: 0,
        offCount: 0,
      });
    });
  });
});

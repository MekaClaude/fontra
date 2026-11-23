import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeApex,
  pointInTriangle,
  isDegenerate,
} from "../triangle-guardian-geometry.js";

test("computeApex: parallel handles on opposite sides are an S-curve", () => {
  // P0=(0,0), P3=(10,0); handles point up and down → parallel-ish S-curve
  const P0 = { x: 0, y: 0 };
  const P1 = { x: 2, y: 5 };
  const P2 = { x: 8, y: -5 };
  const P3 = { x: 10, y: 0 };
  const { apex, isSCurve } = computeApex(P0, P1, P2, P3);
  // denom ~ 0 (parallel vectors); should be flagged as S-curve
  assert.equal(isSCurve, true);
});

test("computeApex: a normal triangle has an apex", () => {
  const P0 = { x: 0, y: 0 };
  const P1 = { x: 2, y: 5 };
  const P2 = { x: 8, y: 5 };
  const P3 = { x: 10, y: 0 };
  const { apex, isSCurve } = computeApex(P0, P1, P2, P3);
  assert.ok(apex !== null);
  assert.equal(isSCurve, false);
});

test("pointInTriangle: a point inside is contained", () => {
  const A = { x: 0, y: 0 };
  const B = { x: 10, y: 0 };
  const C = { x: 5, y: 10 };
  assert.equal(pointInTriangle({ x: 5, y: 3 }, A, B, C), true);
});

test("isDegenerate: zero-length handle is degenerate", () => {
  assert.equal(
    isDegenerate({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }),
    true
  );
});

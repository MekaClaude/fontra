import { getContours, iterSegments, isEmptyPath } from '../../src/utils/path-adapter.js';

describe('path-adapter', () => {
  it('handles invented contour format', () => {
    const path = { contours: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] };
    const c = getContours(path);
    expect(c).toHaveLength(1);
    expect(c[0].points).toHaveLength(2);
  });

  it('handles packed path', () => {
    const path = {
      numContours: 1,
      iterContourDecomposedSegments(ci) {
        return [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }];
      },
    };
    const c = getContours(path);
    expect(c).toHaveLength(1);
    expect(c[0].points[0].kind).toBe('offcurve');
    expect(c[0].points[1].kind).toBe('oncurve');
    const segs = [...iterSegments(path)];
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('line');
  });

  it('isEmptyPath', () => {
    expect(isEmptyPath(null)).toBe(true);
    expect(isEmptyPath({ contours: [] })).toBe(true);
    expect(isEmptyPath({ contours: [{ points: [{ x: 1, y: 1 }] }] })).toBe(false);
  });

  it('handles empty packed path', () => {
    const path = { numContours: 0, iterContourDecomposedSegments() { return []; } };
    expect(getContours(path)).toHaveLength(0);
    expect(isEmptyPath(path)).toBe(true);
  });
});
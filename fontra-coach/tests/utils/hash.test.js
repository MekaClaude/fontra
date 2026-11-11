import { hashGlyphData } from '../../src/utils/hash.js';

const quadPath = {
  numContours: 1,
  iterContourDecomposedSegments(ci) {
    return [
      { type: 'move', points: [{ x: 0, y: 0 }] },
      { type: 'cubic', points: [{ x: 0, y: 500, }, { x: 100, y: 700 }, { x: 200, y: 0 }] },
    ];
  },
};

const inventedPath = {
  contours: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }],
};

describe('hashGlyphData', () => {
  it('hashes invented contour format deterministically', () => {
    const a = hashGlyphData(inventedPath);
    const b = hashGlyphData(inventedPath);
    expect(a).toEqual(b);
    expect(a).not.toBe('empty');
  });

  it('hashes packed paths deterministically', () => {
    const a = hashGlyphData({ path: quadPath });
    const b = hashGlyphData({ path: quadPath });
    expect(a).toEqual(b);
    expect(a).not.toBe('empty');
  });

  it('detects a one-point change', () => {
    const a = hashGlyphData(inventedPath);
    const moved = {
      contours: [{ points: [{ x: 0, y: 0 }, { x: 101, y: 100 }] }],
    };
    expect(hashGlyphData(moved)).not.toEqual(a);
  });

  it('returns "empty" for empty paths', () => {
    expect(hashGlyphData(null)).toBe('empty');
    expect(hashGlyphData({ contours: [] })).toBe('empty');
  });
});

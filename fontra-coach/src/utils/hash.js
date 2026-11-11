/**
 * Stable content hash for glyph data.
 *
 * Works on real Fontra packed paths (via the path adapter) and on the
 * legacy invented contour format. FNV-1a over contour structure so two
 * identical glyphs hash identically across sessions.
 */
import { getContours } from './path-adapter.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashGlyphData(glyphData) {
  const contours = getContours(glyphData?.path ?? glyphData);
  if (!contours.length) return 'empty';

  let hash = FNV_OFFSET >>> 0;
  for (const contour of contours) {
    const points = contour.points || [];
    hash = fnv1a(hash, points.length);
    for (const p of points) {
      // Round to 1/64 upm to avoid hash churn from cosmetic float noise.
      const qx = Math.round((p.x ?? 0) * 64);
      const qy = Math.round((p.y ?? 0) * 64);
      hash = fnv1a(hash, qx);
      hash = fnv1a(hash, qy);
      hash = fnv1a(hash, p.kind === 'oncurve' ? 1 : 2);
      if (p.segmentType) hash = fnv1aString(hash, p.segmentType);
    }
  }
  return `${hash >>> 0}`;
}

function fnv1a(hash, value) {
  // 32-bit FNV-1a over 4 bytes of `value` (little endian).
  let h = hash >>> 0;
  for (let i = 0; i < 4; i++) {
    const byte = value & 0xff;
    h = Math.imul(h ^ byte, FNV_PRIME);
    value >>>= 8;
  }
  return h >>> 0;
}

function fnv1aString(hash, str) {
  let h = hash >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), FNV_PRIME);
  }
  return h >>> 0;
}

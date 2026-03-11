import { measureOvershoot } from '../../src/analysis/geom-analyzer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name) {
  const filePath = path.join(__dirname, '../fixtures', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('measureOvershoot', () => {
  it('detects missing overshoot on o that sits exactly on baseline', () => {
    const glyph = loadFixture('o-no-overshoot.json');
    const metrics = { baseline: 0, xHeight: 500 };
    const result = measureOvershoot(glyph, metrics);
    expect(result.bottom).toBeLessThanOrEqual(0);
  });

  it('returns positive overshoot for correctly drawn o', () => {
    const glyph = loadFixture('o-correct-overshoot.json');
    const metrics = { baseline: 0, xHeight: 500 };
    const result = measureOvershoot(glyph, metrics);
    expect(result.bottom).toBeGreaterThan(5);
    expect(result.bottom).toBeLessThan(30);
  });

  it('returns null for non-round glyphs (H, I)', () => {
    const glyph = loadFixture('H-no-curves.json');
    const result = measureOvershoot(glyph, {});
    expect(result).toBeNull();
  });
});

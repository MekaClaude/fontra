/**
 * Analysis cache by glyph content hash.
 */
export class AnalysisCache {
  constructor() { 
    this.store = new Map(); 
  }

  get(glyphName, glyphHash) {
    const entry = this.store.get(glyphName);
    if (!entry || entry.hash !== glyphHash) return null;
    return entry.result;
  }

  set(glyphName, glyphHash, result) {
    this.store.set(glyphName, { hash: glyphHash, result, timestamp: Date.now() });
  }

  invalidate(glyphName) { this.store.delete(glyphName); }
  invalidateAll() { this.store.clear(); }
}

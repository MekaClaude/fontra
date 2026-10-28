/**
 * Analysis cache by glyph content hash.
 */
export class AnalysisCache {
  constructor(maxEntries = 200) { 
    this.store = new Map(); 
    this.maxEntries = maxEntries;
  }

  get(glyphName, glyphHash) {
    const entry = this.store.get(glyphName);
    if (!entry || entry.hash !== glyphHash) return null;
    // LRU: refresh insertion order
    this.store.delete(glyphName);
    this.store.set(glyphName, entry);
    return entry.result;
  }

  set(glyphName, glyphHash, result) {
    if (this.store.has(glyphName)) {
      this.store.delete(glyphName);
    } else if (this.store.size >= this.maxEntries) {
      // Evict least-recently-used entry
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(glyphName, { hash: glyphHash, result, timestamp: Date.now() });
  }

  invalidate(glyphName) { this.store.delete(glyphName); }
  invalidateAll() { this.store.clear(); }
}

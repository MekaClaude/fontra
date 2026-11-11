export class EventBroker {
  constructor(fontraEventBus, analysisEngine) {
    this.analysisEngine = analysisEngine;

    // Per-glyph debounce so rapid edits to one glyph coalesce, without
    // dropping unrelated selections or edits to other glyphs.
    this.editTimers = new Map();
    this.editDelay = 150;

    if (fontraEventBus && fontraEventBus.on) {
      fontraEventBus.on('glyphEdited', (e) => this.scheduleEdit(e?.glyphName, e?.glyphData));
      fontraEventBus.on('glyphSelected', (e) => this.handleSelected(e?.glyphName));
      fontraEventBus.on('fontChanged', () => {
        if (this.analysisEngine && this.analysisEngine.invalidateCache) {
          this.analysisEngine.invalidateCache();
        }
      });
    }
  }

  scheduleEdit(glyphName, glyphData) {
    if (!glyphName) return;
    const existing = this.editTimers.get(glyphName);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.editTimers.delete(glyphName);
      if (this.analysisEngine && this.analysisEngine.onGlyphEdited) {
        this.analysisEngine.onGlyphEdited(glyphName, glyphData);
      }
    }, this.editDelay);

    this.editTimers.set(glyphName, timer);
  }

  handleSelected(glyphName) {
    if (!glyphName) return;
    if (this.analysisEngine && this.analysisEngine.onGlyphSelected) {
      this.analysisEngine.onGlyphSelected(glyphName);
    }
  }
}

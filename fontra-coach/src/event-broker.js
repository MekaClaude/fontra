export class EventBroker {
  constructor(fontraEventBus, analysisEngine) {
    this.queue = [];
    this.processing = false;
    this.debounceTimer = null;
    this.analysisEngine = analysisEngine;

    // Hook into Fontra event bus
    if (fontraEventBus && fontraEventBus.on) {
      fontraEventBus.on('glyphEdited', (e) => this.enqueue('glyphEdited', e));
      fontraEventBus.on('glyphSelected', (e) => this.enqueue('glyphSelected', e));
      fontraEventBus.on('fontChanged', (e) => {
        if (this.analysisEngine && this.analysisEngine.invalidateCache) {
          this.analysisEngine.invalidateCache();
        }
      });
    }
  }

  enqueue(type, payload) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processEvent(type, payload);
    }, 50);
  }

  processEvent(type, payload) {
    if (!this.analysisEngine) return;
    
    if (type === 'glyphEdited') {
      if (this.analysisEngine.onGlyphEdited) {
        this.analysisEngine.onGlyphEdited(payload.glyphName, payload.glyphData);
      }
    } else if (type === 'glyphSelected') {
      if (this.analysisEngine.onGlyphSelected) {
        this.analysisEngine.onGlyphSelected(payload.glyphName);
      }
    }
  }
}

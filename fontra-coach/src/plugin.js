import { KnowledgeLoader } from './knowledge/knowledge-loader.js';
import { DNAPanel } from './ui/dna-panel.js';
import { WorkflowPanel } from './ui/workflow-panel.js';
import { ConsistencyPanel } from './ui/consistency-panel.js';
import { OverlayLayer } from './ui/overlay-layer.js';
import { EventBroker } from './event-broker.js';
import { analyzeGlyph } from './analysis/geom-analyzer.js';
import { evaluateRules } from './knowledge/rule-evaluator.js';
import { AnalysisCache } from './utils/cache.js';
import { hashGlyphData } from './utils/hash.js';

export const pluginManifest = {
  name: "fontra-coach",
  version: "1.0.0",
  description: "Type design coaching and best practice guidance",
  author: "MekaClaude",
  fontraVersion: ">=0.9.0",
  panels: [
    { id: "coach-dna", title: "DNA", component: "DNAPanel" },
    { id: "coach-workflow", title: "Workflow", component: "WorkflowPanel" },
    { id: "coach-consistency", title: "Consistency", component: "ConsistencyPanel" }
  ],
  visualizationLayers: [
    { id: "coach-overlay", title: "Coach Overlay", component: "OverlayLayer" }
  ],
};

const DEFAULT_METRICS = Object.freeze({ baseline: 0, xHeight: 500 });

function getRealMetrics(fontController) {
  if (!fontController) return null;
  if (typeof fontController.getMetrics === 'function') {
    try {
      const m = fontController.getMetrics();
      if (m && typeof m === 'object') return m;
    } catch {
      // fall through to next source
    }
  }
  const m = fontController.metrics;
  if (m && typeof m === 'object') return m;
  return null;
}

class AnalysisEngine {
  constructor(kb, fontController) {
    this.kb = kb;
    this.fontController = fontController;
    this.cache = new AnalysisCache();
    this.listeners = new Set();
    this.stateListeners = new Set();
    this.userSettings = { verbosity: 'learner' };
    this._warnedAboutMetrics = false;

    const realMetrics = getRealMetrics(fontController);
    if (!realMetrics && !this._warnedAboutMetrics) {
      console.warn(
        '[fontra-coach] fontController.getMetrics() unavailable; ' +
        'using default metrics (baseline: 0, xHeight: 500).'
      );
      this._warnedAboutMetrics = true;
    }
    this.metrics = realMetrics || { ...DEFAULT_METRICS };
  }

  onGlyphSelected(glyphName) {
    this.notifyStateUpdate(glyphName);
  }

  onGlyphEdited(glyphName, glyphData) {
    const hash = hashGlyphData(glyphData);

    let analysis = this.cache.get(glyphName, hash);
    if (!analysis) {
      analysis = analyzeGlyph(glyphData, this.metrics);
      if (analysis) {
        this.cache.set(glyphName, hash, analysis);
      }
    }

    const warnings = evaluateRules(glyphName, analysis, this.kb, this.userSettings);
    this.notifyWarnings(warnings);
    this.notifyStateUpdate(glyphName);
  }

  invalidateCache() {
    this.cache.invalidateAll();
  }

  onWarningsUpdated(cb) {
    this.listeners.add(cb);
  }

  onStateUpdated(cb) {
    this.stateListeners.add(cb);
  }

  notifyWarnings(warnings) {
    for (const cb of this.listeners) cb(warnings);
  }

  notifyStateUpdate(glyphName) {
    for (const cb of this.stateListeners) cb(glyphName);
  }
}


export async function activate(context) {
  const { fontController, eventBus, ui } = context;

  // 1. Load knowledge base — without it the coach has nothing to teach,
  //    so bail out loudly instead of rendering an empty UI.
  let kb;
  try {
    kb = await KnowledgeLoader.loadDefault();
  } catch (e) {
    console.error('[fontra-coach] failed to load knowledge base; coach is disabled:', e);
    return;
  }

  // 2. Bootstrap analysis engine
  const engine = new AnalysisEngine(kb, fontController);

  // 3. Register event handlers
  const broker = new EventBroker(eventBus, engine);

  // 4. Register UI components
  if (ui && ui.registerPanel) {
    ui.registerPanel('coach-dna', () => new DNAPanel(engine, kb));
    ui.registerPanel('coach-workflow', () => new WorkflowPanel(engine, kb));
    ui.registerPanel('coach-consistency', () => new ConsistencyPanel(engine, kb));

    const overlay = new OverlayLayer(engine);
    engine.onWarningsUpdated(warnings => overlay.updateWarnings(warnings));
    ui.registerVisualizationLayer('coach-overlay', () => overlay);
  }
}

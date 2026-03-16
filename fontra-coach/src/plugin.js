import { KnowledgeLoader } from './knowledge/knowledge-loader.js';
import { DNAPanel } from './ui/dna-panel.js';
import { WorkflowPanel } from './ui/workflow-panel.js';
import { ConsistencyPanel } from './ui/consistency-panel.js';
import { OverlayLayer } from './ui/overlay-layer.js';
import { EventBroker } from './event-broker.js';
import { analyzeGlyph } from './analysis/geom-analyzer.js';
import { evaluateRules } from './knowledge/rule-evaluator.js';
import { AnalysisCache } from './utils/cache.js';

export const pluginManifest = {
  name: "fontra-coach",
  version: "1.0.0",
  description: "Type design coaching and best practice guidance",
  author: "Your Name",
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

class AnalysisEngine {
  constructor(kb) {
    this.kb = kb;
    this.cache = new AnalysisCache();
    this.listeners = new Set();
    this.stateListeners = new Set();
    this.userSettings = { verbosity: 'learner' };
  }

  onGlyphSelected(glyphName) {
    this.cache.invalidate(glyphName); // Ensure fresh state
    this.notifyStateUpdate(glyphName);
  }

  onGlyphEdited(glyphName, glyphData) {
    this.cache.invalidate(glyphName);
    const metrics = { baseline: 0, xHeight: 500 }; // placeholder
    const analysis = analyzeGlyph(glyphData, metrics);
    this.cache.set(glyphName, "mockHash", analysis);
    
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
  const { fontController, glyphController, eventBus, ui } = context;

  // 1. Load knowledge base
  const kb = await KnowledgeLoader.loadDefault();

  // 2. Bootstrap analysis engine
  const engine = new AnalysisEngine(kb);

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

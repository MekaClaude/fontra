export class KnowledgeLoader {
  constructor() {
    this.bundle = null;
    this.version = null;
    this.watchers = new Set();
  }

  static async loadDefault() {
    const loader = new KnowledgeLoader();
    try {
      // In a real environment, this would resolve the plugin dist path
      await loader.load('../../dist/coach-kb-1.0.0.json');
    } catch (e) {
      console.warn("Default KB load failed, returning empty", e);
    }
    return loader.bundle;
  }

  async load(bundlePath) {
    try {
      // Typically via fetch() in Fontra's browser context
      const response = await fetch(bundlePath);
      const bundle = await response.json();
      this.validateBundle(bundle); // throws if invalid
      this.bundle = bundle;
      this.version = bundle.meta.version;
      this.notify();
    } catch (e) {
      console.error("Failed to load knowledge base", e);
    }
  }

  async hotReload(bundlePath) {
    const tempLoader = new KnowledgeLoader();
    await tempLoader.load(bundlePath);
    if (tempLoader.bundle) {
      this.bundle = tempLoader.bundle;
      this.version = tempLoader.version;
      this.notify();
    }
  }

  validateBundle(bundle) {
    if (!bundle || !bundle.meta || !bundle.meta.version) {
      throw new Error("Invalid knowledge bundle format");
    }
  }

  subscribe(callback) {
    this.watchers.add(callback);
    return () => this.watchers.delete(callback);
  }

  notify() {
    for (const cb of this.watchers) cb(this.bundle);
  }
}

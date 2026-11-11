/**
 * Knowledge base discovery and loading.
 *
 * Throws when the bundle is missing or invalid so callers can decide
 * whether to disable the coach instead of running with an empty KB.
 */
export class KnowledgeLoader {
  static async loadDefault() {
    const bundleUri = new URL('../../dist/coach-kb-bundle.json', import.meta.url).href;
    const response = await fetch(bundleUri);

    if (!response.ok) {
      throw new Error(`knowledge base bundle not found (HTTP ${response.status})`);
    }

    const bundle = await response.json();
    KnowledgeLoader.#validate(bundle);
    return bundle;
  }

  static #validate(bundle) {
    if (!bundle || !bundle.meta || !bundle.meta.version) {
      throw new Error('invalid knowledge bundle format: missing meta.version');
    }
    const required = ['opticalRules', 'workflowSequences'];
    for (const key of required) {
      if (!bundle[key]) {
        throw new Error(`invalid knowledge bundle format: missing ${key}`);
      }
    }
  }
}

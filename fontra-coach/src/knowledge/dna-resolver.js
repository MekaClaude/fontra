/**
 * Resolves DNA relationships for the ui.
 */
export function resolveDNA(glyphName, knowledgeBundle) {
  if (!knowledgeBundle || !knowledgeBundle.glyphDna) return { empty: true, glyph: glyphName };
  
  const dnaEntry = knowledgeBundle.glyphDna.glyphs?.[glyphName];
  if (!dnaEntry) return { empty: true, glyph: glyphName };

  return {
    empty: false,
    glyph: glyphName,
    buildsFrom: dnaEntry.builds_from || [],
    feedsInto: dnaEntry.feeds_into || [],
    sharesDnaWith: dnaEntry.shares_dna_with || [],
    card: knowledgeBundle.knowledgeCards?.cards?.find(c => c.id === dnaEntry.knowledge_card_id)
  };
}

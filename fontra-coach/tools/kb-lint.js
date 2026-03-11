import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

async function main() {
  const v1Dir = process.argv[2] || 'knowledge/v1/';
  let hasErrors = false;

  const error = (msg) => { console.log(chalk.red(`[ERROR] ${msg}`)); hasErrors = true; };
  const warn = (msg) => { console.log(chalk.yellow(`[WARN] ${msg}`)); };

  try {
    const glyphDna = await loadJson(path.join(v1Dir, 'glyph-dna.json'));
    const knowledgeCards = await loadJson(path.join(v1Dir, 'knowledge-cards.json'));
    const opticalRules = await loadJson(path.join(v1Dir, 'optical-rules.json'));
    const workflowSequences = await loadJson(path.join(v1Dir, 'workflow-sequences.json'));

    const knownGlyphs = new Set(Object.keys(glyphDna.glyphs));
    const knownCardIds = new Set(knowledgeCards.cards.map(c => c.id));
    const knownRuleIds = new Set(opticalRules.rules.map(r => r.id));

    for (const [glyph, data] of Object.entries(glyphDna.glyphs)) {
      if (data.feeds_into) {
        data.feeds_into.forEach(rel => {
          if (!knownGlyphs.has(rel.glyph) && !rel.glyph.match(/^[A-Za-z0-9]+$/)) {
            warn(`Glyph '${glyph}' feeds_into unknown glyph '${rel.glyph}'`);
          }
        });
      }
      if (data.knowledge_card_id && !knownCardIds.has(data.knowledge_card_id)) {
        error(`Glyph '${glyph}' references unknown knowledge_card_id '${data.knowledge_card_id}'`);
      }
    }

    knowledgeCards.cards.forEach(card => {
      if (card.related_cards) {
        card.related_cards.forEach(rc => {
          if (!knownCardIds.has(rc) && !knownRuleIds.has(rc) && !rc.startsWith('workflow-')) {
            warn(`Card '${card.id}' has unknown related_card/rule '${rc}'`);
          }
        });
      }
      if (!card.id.match(/^(?:lc|uc|num|gen)-[A-Za-z0-9]+-[0-9]{3}$/)) {
        error(`Card ID '${card.id}' does not match format (e.g., lc-n-001)`);
      }
    });

    opticalRules.rules.forEach(rule => {
      if (Array.isArray(rule.applies_to_glyphs)) {
        rule.applies_to_glyphs.forEach(g => {
          if (!knownGlyphs.has(g) && !g.match(/^[A-Za-z0-9]+$/)) {
            warn(`Rule '${rule.id}' applies to unknown glyph '${g}'`);
          }
        });
      }
      if (!rule.id.match(/^[A-Z]+-[0-9]+$/)) {
        error(`Rule ID '${rule.id}' does not match format (e.g., OPT-001)`);
      }
    });

    if (hasErrors) {
      console.log(chalk.red.bold('\nLinting failed with errors.'));
      process.exit(1);
    } else {
      console.log(chalk.green.bold('\nLinting passed. No critical errors.'));
    }

  } catch (err) {
    console.error(chalk.red(`Error during linting: ${err.message}`));
    process.exit(1);
  }
}

main();

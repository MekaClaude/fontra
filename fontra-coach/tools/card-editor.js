import inquirer from 'inquirer';
import chalk from 'chalk';
import { marked } from 'marked';
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const command = process.argv[2];
  const cardId = process.argv[3];
  
  const kbPath = 'knowledge/v1/knowledge-cards.json';

  if (command === 'add') {
    const answers = await inquirer.prompt([
      { name: 'glyph', message: 'Glyph name (e.g. "n", "H"): ' },
      { name: 'title', message: 'Card title: ' },
      { name: 'body', message: 'Body text (end with empty line): ' }
    ]);
    
    try {
      const data = JSON.parse(await fs.readFile(kbPath, 'utf-8'));
      const newId = `gen-${answers.glyph}-001`;
      data.cards.push({
        id: newId,
        glyph: answers.glyph,
        title: answers.title,
        body: answers.body,
        tags: [],
        verbosity: "learner",
        tips: [],
        related_cards: [],
        sources: []
      });
      await fs.writeFile(kbPath, JSON.stringify(data, null, 2));
      console.log(chalk.green(`✓ Added new card ${newId}`));
    } catch(err) {
      console.error(chalk.red('Error saving: ' + err.message));
    }
  } else if (command === 'preview' && cardId) {
    console.log(chalk.blue(`Previewing card ${cardId}...`));
  } else {
    console.log('Usage: node tools/card-editor.js [add|edit <id>|preview <id>]');
  }
}

main();

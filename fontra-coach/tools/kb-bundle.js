import fs from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import chalk from 'chalk';

async function main() {
  const outPathArg = process.argv.indexOf('--output');
  const outFile = outPathArg > -1 ? process.argv[outPathArg + 1] : 'dist/coach-kb-bundle.json';
  const v1DirArg = process.argv.findIndex(arg => !arg.startsWith('--') && arg !== outFile);
  const v1Dir = v1DirArg > 1 ? process.argv[v1DirArg] : 'knowledge/v1/';

  try {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8'));
    const version = pkg.version || '1.0.0';

    const files = ['glyph-dna.json', 'optical-rules.json', 'curve-thresholds.json', 'knowledge-cards.json', 'workflow-sequences.json'];
    const bundle = {
      meta: {
        version,
        generated: new Date().toISOString(),
        checksums: {}
      }
    };

    for (const f of files) {
      const content = await fs.readFile(path.join(v1Dir, f), 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      const key = f.replace('.json', '').replace(/([-_])([a-z])/g, (_, __, letter) => letter.toUpperCase());

      bundle.meta.checksums[key] = hash;
      const parsed = JSON.parse(content);
      delete parsed.$schema;
      bundle[key] = parsed;
    }

    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
    console.log(chalk.green(`✓ Bundled knowledge base to ${outFile}`));

  } catch (err) {
    console.error(chalk.red(`Error creating bundle: ${err.message}`));
    process.exit(1);
  }
}

main();

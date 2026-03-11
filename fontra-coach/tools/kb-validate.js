import fs from 'fs/promises';
import path from 'path';
import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';
import chalk from 'chalk';

const ajv = new Ajv({ allErrors: true, strict: false });
ajvErrors(ajv);

async function loadSchemas(schemaDir) {
  const files = await fs.readdir(schemaDir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const content = JSON.parse(await fs.readFile(path.join(schemaDir, file), 'utf-8'));
      if (content.$schema) {
        ajv.addSchema(content, file);
      }
    }
  }
}

async function validateFile(filePath, schemaName) {
  try {
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const validate = ajv.getSchema(schemaName);
    if (!validate) {
      console.log(chalk.yellow(`⚠ No schema available for ${filePath} (${schemaName})`));
      return true;
    }
    const valid = validate(data);
    if (valid) {
      console.log(chalk.green(`✓ valid: ${filePath}`));
      return true;
    } else {
      console.log(chalk.red(`✗ invalid: ${filePath}`));
      validate.errors.forEach(err => {
        console.log(chalk.red(`  - ${err.instancePath} ${err.message}`));
      });
      return false;
    }
  } catch (err) {
    console.log(chalk.red(`✗ error reading/parsing ${filePath}: ${err.message}`));
    return false;
  }
}

async function main() {
  const v1Dir = process.argv[2] || 'knowledge/v1/';
  const schemaDir = path.join(v1Dir, '../schema/');

  try {
    await loadSchemas(schemaDir);
  } catch (err) {
    console.error(chalk.red(`Error loading schemas: ${err.message}`));
    process.exit(1);
  }

  const filesToValidate = [
    { file: 'glyph-dna.json', schema: 'glyph-dna.schema.json' },
    { file: 'optical-rules.json', schema: 'optical-rules.schema.json' },
    { file: 'curve-thresholds.json', schema: 'curve-thresholds.schema.json' },
    { file: 'knowledge-cards.json', schema: 'knowledge-cards.schema.json' },
    { file: 'workflow-sequences.json', schema: 'workflow-sequences.schema.json' }
  ];

  let allValid = true;
  for (const item of filesToValidate) {
    const filePath = path.join(v1Dir, item.file);
    const isValid = await validateFile(filePath, item.schema);
    if (!isValid) allValid = false;
  }

  if (!allValid) {
    process.exit(1);
  } else {
    console.log(chalk.green.bold('\nAll files passed schema validation.'));
  }
}

main();

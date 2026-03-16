import fs from 'fs/promises';
import path from 'path';

async function main() {
  const bundlePath = process.argv[2] || 'dist/coach-kb-bundle.json';
  const outputPath = process.argv[3] || '../src-js/fontra-core/assets/data/type-design-knowledge.json';

  try {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf-8'));
    const { glyphDna, knowledgeCards, opticalRules } = bundle;

    // Build a map of knowledge cards by glyph
    const cardByGlyph = {};
    if (knowledgeCards?.cards) {
      for (const card of knowledgeCards.cards) {
        if (card.glyph) {
          cardByGlyph[card.glyph] = card;
        }
      }
    }

    // Build optical corrections map
    const opticalCorrections = {};
    if (opticalRules?.rules) {
      for (const rule of opticalRules.rules) {
        opticalCorrections[rule.id] = {
          name: rule.name,
          description: rule.description,
          rule: rule.formula || rule.trigger_when
        };
      }
    }

    // Merge glyph DNA with knowledge cards
    const glyphs = {};
    if (glyphDna?.glyphs) {
      for (const [glyphName, dna] of Object.entries(glyphDna.glyphs)) {
        const card = cardByGlyph[glyphName];
        
        glyphs[glyphName] = {
          unicode: dna.unicode,
          name: dna.name,
          category: dna.category,
          dna_role: dna.dna_role,
          phase: dna.category === 'lowercase' ? '1' : dna.category === 'uppercase' ? '2' : '3',
          builds_from: dna.builds_from?.map(b => b.glyph) || [],
          informsDesignOf: dna.feeds_into?.map(f => f.glyph) || [],
          informedBy: [], // Will be populated below
          tips: [],
          commonMistakes: [],
          reusableComponents: [],
          opticalCorrections: []
        };

        // Add tips from knowledge card
        if (card) {
          glyphs[glyphName].tips = card.tips || [];
          if (card.body) {
            glyphs[glyphName].tips.unshift(card.body);
          }
        }
      }
    }

    // Populate informedBy by reversing informsDesignOf
    for (const [glyphName, data] of Object.entries(glyphs)) {
      for (const informedGlyph of data.informsDesignOf) {
        if (glyphs[informedGlyph]) {
          glyphs[informedGlyph].informedBy.push(glyphName);
        }
      }
    }

    // Build design order phases
    const designOrder = {
      phases: [
        { phase: '1', name: 'Lowercase Foundation', description: 'Build n, o, H, O first - they define the DNA' },
        { phase: '2', name: 'Lowercase Extensions', description: 'Extend from foundation letters' },
        { phase: '3', name: 'Uppercase', description: 'Capitals derive from H and O' },
        { phase: '4', name: 'Numerals & Symbols', description: 'Final details' }
      ]
    };

    // Build common terms
    const commonTerms = {
      'overshoot': 'Small extension beyond baseline/cap-height for optical balance',
      'counter': 'Enclosed or partially enclosed space in a letter',
      'stem': 'Main vertical stroke',
      'bowl': 'Curved stroke that encloses a counter',
      'ascender': 'Part of lowercase letter extending above x-height',
      'descender': 'Part of lowercase letter extending below baseline',
      'crossbar': 'Horizontal stroke connecting two stems',
      'terminal': 'End of a stroke without a serif',
      'serif': 'Small stroke at the end of a main stroke',
      'x-height': 'Height of lowercase letters without ascenders/descenders',
      'baseline': 'Line on which most letters sit',
      'cap-height': 'Height of uppercase letters',
      'sidebearing': 'Space between glyph outline and advance width edges',
      'aperture': 'Opening of a partially enclosed letter'
    };

    const proAdviceKnowledge = {
      glyphs,
      opticalCorrections,
      designOrder,
      commonTerms
    };

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    await fs.writeFile(outputPath, JSON.stringify(proAdviceKnowledge, null, 2));
    console.log(`✓ Converted coach bundle to Pro Advice format: ${outputPath}`);
    console.log(`  - ${Object.keys(glyphs).length} glyphs converted`);
    console.log(`  - ${Object.keys(opticalCorrections).length} optical corrections`);

  } catch (err) {
    console.error('Error converting bundle:', err);
    process.exit(1);
  }
}

main();

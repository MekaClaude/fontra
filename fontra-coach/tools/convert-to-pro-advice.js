import fs from 'fs/promises';
import path from 'path';

async function main() {
  const bundlePath = process.argv[2] || 'dist/coach-kb-bundle.json';
  const outputPath = process.argv[3] || '../src-js/fontra-core/assets/data/type-design-knowledge.json';

  try {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf-8'));
    const { glyphDna, knowledgeCards, opticalRules } = bundle;

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

    // Build glyphs from knowledge cards (primary source)
    const glyphs = {};
    if (knowledgeCards?.cards) {
      for (const card of knowledgeCards.cards) {
        const glyphName = card.glyph;
        if (!glyphName) continue;

        // Find DNA info if available
        const dna = glyphDna?.glyphs?.[glyphName] || {};

        // Determine phase based on tags
        let phase = '3';
        if (card.tags?.includes('foundation')) {
          phase = card.glyph === card.glyph.toUpperCase() ? '2' : '1';
        } else if (card.tags?.includes('capitals')) {
          phase = '2';
        } else if (card.tags?.includes('lowercase')) {
          phase = '1';
        }

        // Get builds_from and informsDesignOf from DNA
        const buildsFrom = dna.builds_from?.map(b => b.glyph) || [];
        const informsDesignOf = dna.feeds_into?.map(f => f.glyph) || [];

        // Get related glyphs from related_cards
        const informedBy = [];
        if (card.related_cards) {
          // Find glyphs that have this glyph in their related_cards
          for (const otherCard of knowledgeCards.cards) {
            if (otherCard.related_cards?.includes(card.id) && otherCard.glyph !== glyphName) {
              informedBy.push(otherCard.glyph);
            }
          }
        }

        glyphs[glyphName] = {
          unicode: dna.unicode || null,
          name: card.title || glyphName,
          category: card.tags?.includes('capitals') ? 'uppercase' :
            card.tags?.includes('lowercase') ? 'lowercase' : 'unknown',
          dna_role: dna.dna_role || '',
          phase: phase,
          builds_from: buildsFrom,
          informsDesignOf: informsDesignOf,
          informedBy: informedBy,
          tips: card.tips || [],
          commonMistakes: [],
          reusableComponents: [],
          opticalCorrections: []
        };

        // Add card body as first tip if available
        if (card.body) {
          glyphs[glyphName].tips.unshift(card.body);
        }
      }
    }

    // Build design order phases
    const designOrder = {
      phases: [
        { phase: '1', name: 'Lowercase Foundation', description: 'Build n, o first - they define the DNA for ~80% of lowercase letters' },
        { phase: '2', name: 'Lowercase Extensions', description: 'Extend from foundation letters to build h, m, u, r, and bowl letters' },
        { phase: '3', name: 'The Devil Letters', description: 'Complex curves: s, a, g - the most challenging lowercase' },
        { phase: '4', name: 'Diagonals', description: 'v, w, x, y, z - establish diagonal angles' },
        { phase: '5', name: 'Uppercase Foundation', description: 'H and O define the uppercase DNA' },
        { phase: '6', name: 'Uppercase Extensions', description: 'Build remaining capitals from H and O' },
        { phase: '7', name: 'Numerals & Symbols', description: 'Final details' }
      ]
    };

    // Build common terms
    const commonTerms = {
      'overshoot': 'Small extension beyond baseline/cap-height for optical balance. Curved letters must extend past metric lines to appear optically aligned with straight letters.',
      'counter': 'Enclosed or partially enclosed negative space within a letterform. Active counter design affects readability.',
      'stem': 'Main vertical stroke in a letter. The stem weight is the primary measurement that all other strokes are calibrated against.',
      'bowl': 'Curved stroke that encloses a counter. Found in b, d, p, q, o, and uppercase B, D, P, R.',
      'ascender': 'Part of lowercase letter extending above x-height (b, d, f, h, k, l, t).',
      'descender': 'Part of lowercase letter extending below baseline (g, j, p, q, y).',
      'crossbar': 'Horizontal stroke connecting two stems or crossing a stem. Found in A, H, f, t, e.',
      'terminal': 'End of a stroke without a serif. Terminal style (round, flat, angled) is a key personality signature.',
      'serif': 'Small stroke at the end of a main stroke. Serif treatment defines typeface classification.',
      'x-height': 'Height of lowercase letters without ascenders/descenders (n, o, x). Critically important for text readability.',
      'baseline': 'Horizontal line on which most letters sit. The fundamental reference for all vertical measurements.',
      'cap-height': 'Height of uppercase letters. Usually references the flat-topped H.',
      'sidebearing': 'Space between glyph outline and advance width edges. Controls spacing rhythm.',
      'aperture': 'Opening of a partially enclosed letter (c, e, s). Wider aperture = more legible at small sizes.',
      'stress axis': 'Angle through the thinnest points of curved strokes. Vertical = geometric; tilted = humanist.',
      'ink trap': 'Negative space cut into tight junctions to prevent ink fill and improve legibility at small sizes.',
      'spine': 'Diagonal stroke in s that carries the same visual weight as thick strokes.',
      'tittle': 'The dot on i and j. Requires careful sizing - make it larger than feels right.',
      'apex': 'Top point where two strokes meet (A, V, W). Can be sharp, flat, or rounded - a key personality decision.',
      'crotch': 'Bottom point where strokes meet (V, W, Y, v, w, y).'
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

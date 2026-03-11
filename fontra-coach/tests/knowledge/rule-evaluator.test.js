import { evaluateRules } from '../../src/knowledge/rule-evaluator.js';

const testKnowledgeBundle = {
  opticalRules: {
    rules: [
      {
        id: "OPT-001",
        name: "Horizontal Bar Weight",
        applies_to_glyphs: ["H"],
        severity: "warning",
        verbosity_threshold: "learner",
        detection: { method: "compare_stroke_widths" },
        display: { overlay_type: "highlight_stroke", label_template: "Crossbar" }
      }
    ]
  }
};

describe('OPT-001 Horizontal Bar Weight', () => {
  it('warns when crossbar equals stem width', () => {
    const analysis = { stems: [{ width: 85, side: 'left', isMain: true }],
                       horizontalBars: [{ width: 85, isMain: true }] };
    const warnings = evaluateRules('H', analysis, testKnowledgeBundle, { verbosity: 'learner' });
    const opt001 = warnings.find(w => w.ruleId === 'OPT-001');
    expect(opt001).toBeDefined();
    expect(opt001.severity).toBe('warning');
  });

  it('does not warn when crossbar is appropriately thinned', () => {
    const analysis = { stems: [{ width: 85, side: 'left', isMain: true }],
                       horizontalBars: [{ width: 68, isMain: true }] }; // 80% of stem
    const warnings = evaluateRules('H', analysis, testKnowledgeBundle, { verbosity: 'learner' });
    const opt001 = warnings.find(w => w.ruleId === 'OPT-001');
    expect(opt001).toBeUndefined();
  });

  it('is filtered out at Expert verbosity when below threshold', () => {
    const analysis = { stems: [{ width: 85, side: 'left', isMain: true }],
                       horizontalBars: [{ width: 85, isMain: true }] };
    const warnings = evaluateRules('H', analysis, testKnowledgeBundle, { verbosity: 'expert' });
    expect(warnings.filter(w => w.ruleId === 'OPT-001')).toHaveLength(0);
  });
});

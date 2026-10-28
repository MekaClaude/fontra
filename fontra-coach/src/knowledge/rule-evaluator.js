/**
 * Rule evaluation engine.
 */

export function evaluateRules(glyphName, analysis, knowledgeBundle, userSettings) {
  const warnings = [];
  if (!analysis || !knowledgeBundle || !knowledgeBundle.opticalRules) return warnings;

  const rules = knowledgeBundle.opticalRules.rules;
  const verbosityLevels = { 'expert': 3, 'practitioner': 2, 'learner': 1 };
  const userLevel = verbosityLevels[userSettings.verbosity] || 1;

  for (const rule of rules) {
    const ruleLevel = verbosityLevels[rule.verbosity_threshold] || 1;
    if (userLevel < ruleLevel) continue;

    // Hide rules that are not yet implemented (stubs) so no fabricated
    // data is surfaced to users.
    if (rule.implementation_status === 'stub') continue;

    const appliesTo = rule.applies_to_glyphs;
    const applies =
      appliesTo === 'all' ||
      (Array.isArray(appliesTo) && appliesTo.includes(glyphName)) ||
      appliesTo === glyphName;
    if (!applies) continue;

    if (isDismissed(rule.id, glyphName, analysis)) continue;

    const conditionType = rule.detection.method;
    const warning = evaluateCondition(conditionType, rule, analysis, glyphName);
    if (warning) {
      warnings.push(warning);
    }
  }

  return warnings;
}

function evaluateCondition(conditionType, rule, analysis, glyphName) {
  switch (conditionType) {
    case 'compare_stroke_widths':
      return checkStrokeWidths(rule, analysis, glyphName);
    case 'check_extrema_vs_metrics':
      return checkExtremaVsMetrics(rule, analysis, glyphName);
    default:
      return null;
  }
}

function checkStrokeWidths(rule, analysis, glyphName) {
  if (!analysis.horizontalBars || !analysis.stems) return null;
  const mainBar = analysis.horizontalBars.find(b => b.isMain);
  const mainStem = analysis.stems.find(s => s.isMain);

  if (mainBar && mainStem) {
    if (mainBar.width >= mainStem.width * 0.95) {
      return createWarning(rule, glyphName, { horizontal_width: mainBar.width, vertical_width: mainStem.width, suggested_width: Math.round(mainStem.width * 0.8) });
    }
  }
  return null;
}

function checkExtremaVsMetrics(rule, analysis, glyphName) {
  if (!analysis.overshoot) return null;
  if (analysis.overshoot.bottom <= 1) { // baseline mismatch
    return createWarning(rule, glyphName, { recommended_overshoot: 12 });
  }
  return null;
}

function createWarning(rule, glyphName, measurement) {
  return {
    ruleId: rule.id,
    glyphName,
    severity: rule.severity,
    title: rule.name,
    body: typeof rule.knowledge === 'string' ? rule.knowledge : rule.knowledge?.why,
    measurement,
    display: {
      overlay_type: rule.display.overlay_type,
      color: rule.display.color,
      label: fillTemplate(rule.display.label_template, measurement),
      positions: {}
    },
    fixes: rule.knowledge?.fix_steps || [],
    dismissed: false
  };
}

function fillTemplate(template, context) {
  if (!template || !context) return template;
  return template.replace(/{(\w+)}/g, (match, key) => {
    return context[key] !== undefined ? context[key] : '[?]';
  });
}

export function glyphContentHash(glyphOrAnalysis) {
  try {
    // Prefer real path coordinates when available.
    const src = glyphOrAnalysis?.path?.coordinates || glyphOrAnalysis?.coordinates;
    if (Array.isArray(src) && src.length) {
      let h = 0x811c9dc5;
      for (let i = 0; i < src.length; i++) {
        h ^= (src[i] | 0);
        h = Math.imul(h, 0x01000193);
      }
      return `${h}_${src.length}`;
    }
    // Fall back to hashing the analysis result so dismissals expire when
    // the glyph's measurements change.
    const json = JSON.stringify(glyphOrAnalysis || {});
    if (json && json !== '{}') {
      let h = 0x811c9dc5;
      for (let i = 0; i < json.length; i++) {
        h ^= json.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return `${h}_${json.length}`;
    }
  } catch (e) { /* ignore */ }
  return 'nohash';
}

export function isDismissed(ruleId, glyphName, glyphOrAnalysis) {
  if (typeof localStorage === 'undefined') return false;
  const hash = glyphContentHash(glyphOrAnalysis);
  return localStorage.getItem(`coach.dismissed.${ruleId}.${glyphName}.${hash}`) === 'true';
}

export function dismiss(ruleId, glyphName, glyphOrAnalysis) {
  if (typeof localStorage !== 'undefined') {
    const hash = glyphContentHash(glyphOrAnalysis);
    localStorage.setItem(`coach.dismissed.${ruleId}.${glyphName}.${hash}`, 'true');
  }
}

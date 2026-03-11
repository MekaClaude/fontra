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
    if (userLevel > ruleLevel) continue;

    if (rule.applies_to_glyphs !== 'all' && !rule.applies_to_glyphs.includes(glyphName)) {
      continue;
    }

    if (isDismissed(rule.id, glyphName)) continue;

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

export function isDismissed(ruleId, glyphName) {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(`coach.dismissed.${ruleId}.${glyphName}`) === 'true';
}

export function dismiss(ruleId, glyphName) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`coach.dismissed.${ruleId}.${glyphName}`, 'true');
  }
}

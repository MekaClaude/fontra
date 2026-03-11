/**
 * Detects optical issues directly related to geometry, such as horizontal bar weight.
 */
export function checkOpticalWeights(analysis) {
  const issues = [];
  if (analysis.horizontalBars && analysis.stems) {
    const mainStem = analysis.stems.find(s => s.isMain);
    const mainBar = analysis.horizontalBars.find(b => b.isMain);
    if (mainStem && mainBar) {
      if (mainBar.width >= mainStem.width * 0.95) {
        issues.push({
          type: 'heavy_horizontal',
          horizontal_width: mainBar.width,
          vertical_width: mainStem.width,
          suggested_width: Math.round(mainStem.width * 0.8)
        });
      }
    }
  }
  return issues;
}

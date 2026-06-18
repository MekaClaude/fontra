# Category A (v2): Consolidated Coach Architecture

> Better solution: eliminate duplication, leverage existing infrastructure, single source of truth

## Problem with v1

The original `A-complete-stubbed-coach-system.md` treats each stub as an independent fix but ignores the fundamental architectural problem:

| System | Analysis | UI | Status |
|--------|----------|----|--------|
| Python server `glyph_analysis.py` | 544 lines of real analysis | No consumer | Built but invisible |
| JS client `geom-analyzer.js` | Stubs | Coach panels (stubs) | Redundant |
| Pro Advice panel (existing) | Static KB only | Works but empty data | Needs live data |
| Coach plugin panels | None | Stubs | Never wired in |

**Six separate fixes mean six chances for integration failure.** The better solution is to consolidate.

---

## Better Solution: Single Architecture

```
┌──────────────────────────────────────────────────┐
│                 Pro Advice Panel                   │
│  (existing, enhanced to accept live results)       │
├──────────────────────────────────────────────────┤
│         AnalysisCoordinator (new JS module)        │
│  - Calls server RPC for analysis                   │
│  - Formats results for display                     │
│  - Triggers visualization layers                   │
├──────────────────────────────────────────────────┤
│   Server RPC (existing remote.py + fonthandler)    │
│   add: analyzeGlyph(), runFontAudit(),             │
│        checkCurves(), compareGlyphs()              │
├──────────────────────────────────────────────────┤
│        glyph_analysis.py (existing, expand)         │
│   - Add curve quality checks                       │
│   - Add cross-glyph comparison                     │
│   - Return structured reports                      │
└──────────────────────────────────────────────────┘
```

**Single source of truth:** Python server-side analysis. JS is just a consumer.
**No separate plugin activation**: Logic lives in the main editor's codebase.
**No redundant analysis**: One analysis path, not two.

---

## Feature AV2-1: Absorb the Coach Plugin (Replaces A1)

**v1 approach:** Wire the `fontra-coach/` plugin's `activate()` into `editor.js`.

**v2 approach:** Don't wire it. **Absorb it.**

### What's wrong with wiring:
- `fontra-coach/` has its own event system (`event-broker.js`) that duplicates Fontra's existing change broadcasting
- It registers panels through `ui.registerPanel()` which is an API that doesn't match the current editor's sidebar system
- It would introduce a second lifecycle to manage alongside the editor's existing initialization

### Better implementation:

1. **Port analysis logic** from `fontra-coach/src/analysis/` into `src-js/fontra-core/src/`:
   - `geom-analyzer.js` → deleted (replaced by server RPC calls)
   - `curve-inspector.js` → deleted (same)
   - `optical-checker.js` → deleted (same)
   - `space-analyzer.js` → deleted (same)
   - `font-auditor.js` → deleted (same)

2. **Port UI logic** from `fontra-coach/src/ui/` into the existing panel system:
   - `dna-panel.js` → merge into Pro Advice panel (`panel-pro-advice.js`)
   - `workflow-panel.js` → add as a new section within Pro Advice panel
   - `consistency-panel.js` → add as a new section within Pro Advice panel
   - `overlay-layer.js` → register as a visualization layer in `visualization-layer-definitions.js`
   - `knowledge-card.js` → merge into Pro Advice panel's card rendering

3. **Port knowledge data** into the existing knowledge base:
   - `fontra-coach/knowledge/v1/*.json` → merge into `type-design-knowledge.json`
   - `rule-evaluator.js` → integrate into `AnalysisCoordinator` (new module)
   - `dna-resolver.js` → integrate into Pro Advice panel

4. **Delete** `fontra-coach/src/plugin.js` — it's the root of the integration problem

### Files to create/modify:

| File | Action |
|------|--------|
| `src-js/views-editor/src/editor.js` | Add `AnalysisCoordinator` instantiation |
| `src-js/fontra-core/src/analysis-coordinator.js` | **NEW** — orchestrates analysis |
| `src-js/views-editor/src/panel-pro-advice.js` | Enhanced to accept live analysis results |
| `src-js/views-editor/src/visualization-layer-definitions.js` | Add coach overlay layers |
| `fontra-coach/src/plugin.js` | Delete (no longer needed) |
| `fontra-coach/src/analysis/geom-analyzer.js` | Delete (replaced by server) |
| `fontra-coach/src/analysis/curve-inspector.js` | Delete (replaced by server) |
| `fontra-coach/src/analysis/font-auditor.js` | Delete (replaced by server) |
| `fontra-coach/src/event-broker.js` | Delete (duplicates existing event system) |

---

## Feature AV2-2: Server-Side Curve Analysis (Replaces A2)

**v1 approach:** Implement 4 JS stub functions in `curve-inspector.js`.

**v2 approach:** Add the detection logic to `glyph_analysis.py` on the server, expose via RPC.

### Why server-side is better:
- `fonttools` is already a Python dependency — it has cubic bezier math utilities
- No need to port bezier math to JavaScript (and keep them in sync)
- The existing `remote.js` / `fonthandler.py` RPC infrastructure already handles JSON serialization of analysis results
- Server has direct access to the raw `PackedPath` data without serialization overhead

### Implementation:

Add these methods to `glyph_analysis.py`:

```python
class CurveQualityReport:
    segmentIndex: int
    ruleId: str  # CURV-001 through CURV-005
    severity: str  # "error" | "warning" | "info"
    message: str
    location: dict  # {t: float, x: float, y: float}

def check_curve_quality(path: PackedPath) -> List[CurveQualityReport]:
    """Check all 5 curve quality rules against a path."""
    reports = []
    for segment in get_cubic_segments(path):
        reports.extend(_check_circular_arc(segment))       # CURV-001
        reports.extend(_check_extrema(segment))            # CURV-002
        reports.extend(_check_tangent_continuity(segment)) # CURV-003
        reports.extend(_check_curvature_reversal(segment)) # CURV-004
        reports.extend(_check_handle_length(segment))      # CURV-005
    return reports
```

### Rule implementations:

**CURV-001** (Circular arc handle ratio): For a cubic bezier approximating a circular arc, the handle length should be approximately `0.552 * chordLength`. Flag if ratio deviates >15%.

**CURV-002** (Missing extrema): Solve for t where `dx/dt = 0` (vertical extremum) and `dy/dt = 0` (horizontal extremum) on each cubic segment. If an extremum exists at t where 0 < t < 1 and no on-curve point is within threshold distance, flag it.

**CURV-003** (Tangent break at joins): At the junction of two segments, compute the angle between the outgoing handle of segment N and the incoming handle of segment N+1. Flag if angle > 5 degrees (configurable).

**CURV-004** (Curvature reversal): Sample curvature `k(t) = (x'y'' - y'x'') / (x'^2 + y'^2)^(3/2)` at 20 t-values. If sign changes, report the S-curve.

**CURV-005** (Handle length ratio): Compare the two handles of a cubic segment. Flag if `handle1 / handle2 > 2` or `< 0.5` — this creates uneven velocity.

### RPC method:

In `fonthandler.py`:
```python
async def get_curve_analysis(self, glyphName: str) -> dict:
    glyph = self._font.getGlyph(glyphName)
    path = glyph.getLayer(glyph.defaultLayer).path
    report = check_curve_quality(path)
    analysis = analyze_glyph(path)
    return {
        "curveReport": report,
        "analysis": analysis.to_dict()
    }
```

### Files to modify:

| File | Action |
|------|--------|
| `src/fontra/core/glyph_analysis.py` | Add `check_curve_quality()` and 5 rule implementations |
| `src/fontra/core/fonthandler.py` | Add `get_curve_analysis` RPC handler |
| `src-js/fontra-core/src/analysis-coordinator.py` | **NEW** — calls server, formats results |

---

## Feature AV2-3: Register Coach Layers in Existing Visualization System (Replaces A3)

**v1 approach:** Implement 4 `paint()` methods in `overlay-layer.js`.

**v2 approach:** Register coach overlay layers using Fontra's existing visualization layer system.

### Why v2 is better:
- Fontra already has `visualization-layer-definitions.js` which registers layers like `metrics`, `points`, `grid`, `selection`, `cubic-handles`, etc.
- Each layer has a `paint(ctx, controller)` method and can be toggled via the UI
- The coach tool already calls `ui.registerVisualizationLayer()` — but since the plugin is never activated, the registrations go nowhere
- Instead of a new rendering system, just add new layers to the existing `visualization-layer-definitions.js`

### Implementation:

In `visualization-layer-definitions.js`, add:

```javascript
{
  identifier: "fontra.coach.curvature",
  name: localize("Curvature Helpers"),
  icon: "curve",
  selected: true,
  paint: (ctx, controller) => {
    // Called by the existing rendering loop
    const analysis = controller.getAnalysis?.();
    if (!analysis) return;
    paintCurvatureOverlay(ctx, analysis, controller);
  }
}
```

### Layer types to add:

| Layer | What it paints | Toggle behavior |
|-------|---------------|-----------------|
| `fontra.coach.curvature` | Curvature comb + handle length indicators | On by default when editing |
| `fontra.coach.stems` | Dimension arrows on detected stems with width labels | Toggle from Pro Advice panel |
| `fontra.coach.overshoot` | Metric line indicators with overshoot labels | Toggle from Pro Advice panel |
| `fontra.coach.issues` | Red/yellow highlights on problematic segments | Auto-show when issues detected |
| `fontra.coach.ghost` | Semi-transparent comparison glyph | Toggle from DNA section |

### Canvas rendering approach:

Each `paint()` receives the existing `CanvasRenderingContext2D` from the editor's scene rendering pipeline. The methods draw additional visual elements **on top of** the glyph outline:

```javascript
function paintCurvatureOverlay(ctx, analysis, controller) {
  const scale = controller.sceneView.scale;
  
  for (const issue of analysis.curveReport) {
    ctx.save();
    ctx.strokeStyle = issue.severity === "error" ? "#ff4444" : "#ffaa00";
    ctx.lineWidth = 2 / scale;
    
    // Draw a marker at the problem location
    const pt = controller.sceneView.modelToScreen(issue.location.x, issue.location.y);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5 / scale, 0, 2 * Math.PI);
    ctx.stroke();
    
    ctx.restore();
  }
}
```

### Files to modify:

| File | Action |
|------|--------|
| `src-js/views-editor/src/visualization-layer-definitions.js` | Add 5 coach layers |
| `src-js/views-editor/src/visualization-layers.js` | Add `paint*` helper functions |
| `fontra-coach/src/ui/overlay-layer.js` | Delete (replaced by above) |

---

## Feature AV2-4: Server-Side Font-Wide Audit (Replaces A4)

**v1 approach:** Implement `conductAudit()` in JS by iterating all glyphs client-side.

**v2 approach:** Add `runFontAudit()` to `fonthandler.py` — iterate glyphs server-side, cache results.

### Why v2 is better:
- Server has direct access to all glyph data without fetching each one individually over WebSocket
- Iterating 200+ glyphs in JS would require 200+ RPC calls (or one massive batch)
- Server can use `fonttools` for advanced comparisons (e.g., path area, overlap detection)
- Caching is trivial on the server — invalidate when any glyph changes

### Implementation:

In `fonthandler.py` or a new `src/fontra/core/font_audit.py`:

```python
class FontAuditReport:
    glyphCount: int
    stemConsistency: AuditMetric  # mean, stddev, outliers
    overshootConsistency: AuditMetric
    spacingRhythm: AuditMetric
    terminalConsistency: AuditMetric
    strokeContrast: AuditMetric
    issues: List[AuditIssue]  # per-glyph issues

def run_font_audit(font) -> FontAuditReport:
    glyphs = font.getGlyphs()
    stems = []
    overshoots = []
    sidebearings = []
    
    for glyphName, glyph in glyphs.items():
        path = glyph.defaultLayer.path
        analysis = analyze_glyph(path)
        stems.extend(analysis.verticalStems)
        overshoots.extend(analysis.overshoots)
        sidebearings.append((glyph.name, glyph.lsb, glyph.rsb))
    
    return FontAuditReport(
        glyphCount=len(glyphs),
        stemConsistency=_analyze_consistency([s.width for s in stems]),
        overshootConsistency=_analyze_consistency([o.amount for o in overshoots]),
        spacingRhythm=_analyze_spacing_rhythm(sidebearings),
        terminalConsistency=_analyze_terminals(glyphs),
        strokeContrast=_analyze_contrast(stems),
        issues=_find_issues(glyphs, stems, overshoots, sidebearings)
    )

def _analyze_consistency(values: List[float]) -> AuditMetric:
    if not values:
        return AuditMetric(mean=0, stddev=0, outliers=[], score=100)
    mean = sum(values) / len(values)
    variance = sum((v - mean)**2 for v in values) / len(values)
    stddev = sqrt(variance)
    outliers = [v for v in values if abs(v - mean) > 2 * stddev]
    score = max(0, 100 - stddev * 2)  # Simple scoring heuristic
    return AuditMetric(mean=mean, stddev=stddev, outliers=outliers, score=score)
```

### RPC & caching:

```python
class FontHandler:
    def __init__(self):
        self._auditCache = None
        self._auditCacheValid = False
    
    async def addGlyph(self, change):
        await super().addGlyph(change)
        self._auditCacheValid = False  # Invalidate on any change
    
    async def runFontAudit(self) -> dict:
        if self._auditCacheValid:
            return self._auditCache
        report = run_font_audit(self._font)
        self._auditCache = report.to_dict()
        self._auditCacheValid = True
        return self._auditCache
```

### Files to modify:

| File | Action |
|------|--------|
| `src/fontra/core/font_audit.py` | **NEW** — font-wide audit logic |
| `src/fontra/core/fonthandler.py` | Add `runFontAudit` RPC handler + caching |
| `fontra-coach/src/analysis/font-auditor.js` | Delete (replaced) |

---

## Feature AV2-5: Auto-Generate Knowledge Base Data (Replaces A5)

**v1 approach:** Manually populate empty arrays in JSON.

**v2 approach:** Write a script that **generates** the data from the existing DNA graph and geometric rules.

### Why v2 is better:
- The DNA data in `glyph-dna.json` already knows that `h` is derived from `n` via `add_ascender`
- A script can infer: if `h = n + ascender`, then `h`'s reusable components are `n` (base) and `l` (ascender) — and `h`'s common mistakes are things like "ascender doesn't match l"
- Manual authoring is error-prone, incomplete, and doesn't scale

### Generator script logic:

In `fontra-coach/tools/generate-knowledge-base.js`:

```javascript
function generateGlyphData(dna, geometricRules) {
  const result = {};
  
  for (const [glyphName, node] of Object.entries(dna)) {
    const card = { glyphName };
    
    // Infer reusable components from parents
    card.reusableComponents = node.parents.map(p => ({
      glyph: p.glyph,
      derivedBy: p.method,
      tip: `Start from ${p.glyph} and ${p.method.replace('_', ' ')}`
    }));
    
    // Infer common mistakes from children
    const children = findChildren(dna, glyphName);
    card.commonMistakes = [];
    for (const child of children) {
      card.commonMistakes.push({
        mistake: `${child.method.replace('_', ' ')} not matching ${child.glyph}`,
        severity: "warning"
      });
    }
    
    // Infer optical corrections from geometric rules
    card.opticalCorrections = [];
    for (const rule of geometricRules) {
      if (rule.appliesTo.includes(glyphName)) {
        card.opticalCorrections.push(rule.id);
      }
    }
    
    result[glyphName] = card;
  }
  
  return result;
}
```

### Build integration:

In `package.json`:
```json
{
  "scripts": {
    "generate-knowledge": "node fontra-coach/tools/generate-knowledge-base.js",
    "build": "npm run generate-knowledge && webpack --mode production"
  }
}
```

### Files to modify:

| File | Action |
|------|--------|
| `fontra-coach/tools/generate-knowledge-base.js` | **NEW** — auto-generator script |
| `fontra-coach/knowledge/v1/glyph-dna.json` | Verify completeness (needs all ~50 cards) |
| `src-js/fontra-core/assets/data/type-design-knowledge.json` | **Auto-generated** — not manually edited |
| `package.json` | Add `generate-knowledge` npm script |

---

## Feature AV2-6: Ghost Overlays via Existing Component System (Replaces A6)

**v1 approach:** New `GhostOverlayRenderer` class with a second rendering pipeline.

**v2 approach:** Use Fontra's existing component system + background layer to render comparison glyphs.

### Why v2 is better:
- The glyph editor already knows how to render components (it's how `n` renders its bowl from `o`)
- The background image/layer system already handles semi-transparent rendering for reference images
- Components automatically handle zoom, pan, and selection — no custom code needed
- Component transforms (scale, offset, flip) are already implemented in `glyph-controller.js`

### Implementation:

When user activates "ghost overlay" for `n` while editing `h`:

```javascript
// In the scene model, add a virtual component
sceneModel.addGhostComponent({
  glyphName: "n",
  opacity: 0.3,
  color: "blue",
  transform: { x: 0, y: 0 },  // No offset by default
  // The component is rendered by the existing path rendering pipeline
});
```

### Component rendering path in Fontra:

The existing flow is:
1. `GlyphController` instantiates a glyph at a location → returns `StaticGlyph`
2. `StaticGlyph` contains `path` (contours) and `components` (references)
3. Components are resolved recursively via `GlyphController.getComponentGlyph()`
4. The scene view renders the resolved paths

For ghost overlays, we add a **virtual component** that:
- References an existing glyph (e.g., `n`)
- Has no effect on metrics (LSB/RSB/advance width)
- Is rendered at reduced opacity
- Is rendered with a color tint (e.g., light blue)
- Is automatically removed when toggled off

### Toggle UI:

In the Pro Advice panel's DNA section:

```html
<button class="ghost-toggle" data-glyph="n">
  <span class="ghost-indicator"></span>
  Show n as reference
</button>
```

Clicking toggles the ghost component on/off. Multiple ghosts can be active simultaneously.

### Files to modify:

| File | Action |
|------|--------|
| `src-js/fontra-core/src/scene-model.js` | Add `addGhostComponent()`/`removeGhostComponent()` |
| `src-js/fontra-core/src/glyph-controller.js` | Handle ghost components (skip metrics, apply opacity) |
| `src-js/views-editor/src/panel-pro-advice.js` | Add ghost toggle buttons in DNA section |
| `fontra-coach/src/ui/overlay-layer.js` | Delete (replaced) |
| `fontra-coach/src/ui/dna-panel.js` | Delete (merged into Pro Advice panel) |

---

## Effort Comparison: v1 vs v2

| Aspect | v1 (6 discrete fixes) | v2 (consolidated) |
|--------|----------------------|-------------------|
| **Files created** | 2 new | 3 new (coordinator, font_audit, generator) |
| **Files deleted** | 0 | 8 (entire coach analysis/ + plugin.js) |
| **Files modified** | ~12 | ~8 |
| **New analysis code** | ~800 JS lines | ~400 Python lines |
| **Duplicate logic** | Yes (Python + JS bezier math) | No (single Python source) |
| **Integration risk** | High (plugin activation order, API mismatch) | Low (uses existing Visualiser/Coimbra/components) |
| **Maintenance burden** | Two systems to keep in sync | One system |

### Why v2 is strictly better:

1. **No plug-in activation problem** — the "wire the coach" task disappears entirely because there's nothing to wire
2. **No bezier math duplicates** — all curve analysis is server-side Python where `fonttools` lives
3. **No rendering infrastructure** — coach overlays are just new entries in the existing visualization layer registry
4. **No data inconsistency** — knowledge base data is auto-generated from the DNA graph, not manually populated
5. **No event system duplication** — uses the existing change broadcasting from `fonthandler.py`
6. **8 files deleted** vs **3 files created** — net reduction in codebase size

---

## Estimated Effort (v2)

| Feature | Effort | Risk | Dependencies |
|---------|--------|------|-------------|
| AV2-1: Absorb coach plugin | Medium | Low | None (pure code movement) |
| AV2-2: Server curve analysis | Medium | Medium | Bezier math in `fonttools` |
| AV2-3: Register coach layers | Low | Low | Existing viz layer system |
| AV2-4: Font-wide audit | Medium | Low | AV2-2 for per-glyph analysis |
| AV2-5: Generate knowledge base | Low | Low | Existing DNA data |
| AV2-6: Ghost overlays | Medium | Low | Existing component system |

**Total:** ~1400 lines of new code, **~2000 lines of code deleted** — net reduction of ~600 lines.

**v1 total:** ~1500 lines new, 0 deleted — net addition of ~1500 lines.

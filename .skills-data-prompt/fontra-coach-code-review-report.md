# Fontra Coach — Comprehensive Code Review & Remediation Report

**Branch:** `code-review-feedback-42427`
**Review date:** 2026-09-14
**Scope:** `fontra-coach/` plugin, `panel-pro-advice.js`, `glyph_analysis.py`, `design_guide.py`,
`composition.py`, `triangle-guardian/`, server/instancer/workflow diffs, repo hygiene.

---

## 1. Executive Summary

Fontra Coach is a well-conceived feature: a knowledge-base-driven "type design coach" that
analyzes glyphs (stems, overshoot, contrast, curve quality), evaluates optical rules, and
surfaces warnings in panels and canvas overlays. The **knowledge-base layer is the strongest
part of the work** (versioned JSON + JSON Schemas + validate/lint/bundle tooling), and the
Python-side analysis (`src/fontra/core/glyph_analysis.py`, 544 lines, with tests) is solid.

However, in its current state the plugin is **dead code**: it is never activated by the editor,
it targets APIs that do not exist in Fontra (`ui.registerPanel()`, `eventBus.on('glyphEdited')`),
and its analyzer assumes a glyph data model (`path.contours[].points[]`) that Fontra does not
use. The JavaScript test suite passes **only because the test fixtures use the same invented
data model** — against real Fontra glyphs, `analyzeGlyph()` returns `null` for every glyph.

**Severity summary**

| Priority | Count | Theme |
|---|---|---|
| 🔴 P0 | 2 | Not integrated; wrong data model — feature is inert on real data |
| 🟠 P1 | 6 | Correctness bugs (rule filter, substring match, extrema, cache, metrics) |
| 🟡 P2 | 8 | Stub implementations presented as working features |
| 🔵 P3 | 6 | Design/UX/consistency issues |
| ⚪ P4 | 8 | Repo hygiene, accidental upstream regressions |

---

## 2. What Was Added (Inventory)

| Component | Location | State |
|---|---|---|
| Coach plugin | `fontra-coach/` (plugin.js, event-broker.js, analysis/, knowledge/, ui/, tools/, tests/) | Orphaned — never activated |
| Pro Advice panel | `src-js/views-editor/src/panel-pro-advice.js` | ✅ Working, integrated (the correct pattern) |
| Python analysis engine | `src/fontra/core/glyph_analysis.py` + `test-py/test_glyph_analysis.py` | ✅ Working; no UI consumes it |
| Design guide | `src/fontra/core/design_guide.py` + `test-py/test_design_guide.py` | Working |
| Workflow action | `src/fontra/workflow/actions/composition.py` + `test-py/test_workflow_composition.py` | Working; registered in `workflow.py` |
| Triangle Guardian | `triangle-guardian/` **and** `src/fontra/localplugins/triangle-guardian/` | Working but **duplicated in two places** |
| Server/workflow patches | `server.py`, `workflow.py`, `instancer.py` | Mixed: one dedupe fix, one **upstream regression** |
| Test font | `test-common/fonts/Aileron-SemiBold.fontra/` | Huge; likely unnecessary |
| Misc | `fontra-coach/test_output.txt`, `.qwen/`, `.skills-data-prompt/` | Should not be committed |

**Current test status:** `fontra-coach`: 2 suites / 6 tests **pass** (the committed
`test_output.txt` showing a FAIL is stale and should be deleted).


---

## 3. 🔴 P0 — Blockers

### P0-1. The plugin is never activated; it targets a non-existent API

**Evidence**
- No file under `src-js/` imports anything from `fontra-coach/`. `activate(context)` in
  `fontra-coach/src/plugin.js:82` is never called.
- `ui.registerPanel()` / `ui.registerVisualizationLayer()` do not exist anywhere in Fontra.
- `event-broker.js` subscribes to `glyphEdited` / `glyphSelected` / `fontChanged` events that
  no Fontra object ever emits. Fontra propagates glyph changes through model listeners
  (`fontController.addGlyphChangeListener(...)`, scene-settings key listeners).

**Impact:** The DNA, Workflow and Consistency panels and the Coach Overlay are invisible to
users. Zero user-facing value is delivered today.

**Action (recommended): fold the coach into the editor, following the proven
`panel-pro-advice.js` pattern.**

Fontra's real panel contract (see `src-js/views-editor/src/panel.js`): `Panel extends
SimpleElement`, receives `editorController` in the constructor, exposes `identifier`,
`inlineSVG`, `styles`, `getContentElement()`, and the class **must** be registered with
`customElements.define(...)`.

`fontra-coach/src/ui/dna-panel.js` → new file `src-js/views-editor/src/panel-coach-dna.js`:

```js
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import Panel from "./panel.js";
import { analyzeGlyph } from "../coach/geom-analyzer.js";   // moved, see P0-2
import { evaluateRules } from "../coach/rule-evaluator.js";

export default class CoachDNAPanel extends Panel {
  identifier = "coach-dna";
  title = translate("sidebar.coach-dna");   // add lang keys, see P3-2
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"
    fill="currentColor"><!-- tabler "dna" icon path --></svg>`;

  static styles = `
    .coach-dna-container { height: 100%; overflow-y: auto; padding: 0.75em;
      font-size: 0.88em; line-height: 1.45; }
    /* use Fontra CSS custom properties, never hardcoded colors (see P3-1) */
  `;

  getContentElement() {
    const container = html.div({ class: "coach-dna-container" }, []);
    this.fontController.addGlyphChangeListener("coach-dna", (glyphName) =>
      this.refresh(glyphName));
    return container;
  }

  async refresh(glyphName) {
    const glyph = await this.fontController.getGlyphInstance(glyphName);
    if (!glyph) return;
    const metrics = extractFontMetrics(this.fontController);   // see P1-5
    const analysis = analyzeGlyph(glyph, metrics);
    const warnings = evaluateRules(glyphName, analysis, this.knowledgeBase, this.settings);
    this.render(analysis, warnings);
  }
}

customElements.define("panel-coach-dna", CoachDNAPanel);
```

Then register the panel where the editor declares its sidebar panels (same place
`ProAdvicePanel` is registered in `src-js/views-editor/src/editor.js`), using the exact
registration shape used by the other panels.

**For canvas overlays**, do not invent a layer registry — use the existing one in
`src-js/views-editor/src/visualization-layer-definitions.js`:

```js
registerVisualizationLayerDefinition({
  identifier: "fontra.coach.overlay",
  name: "sidebar.user-settings.glyph.coach-overlay",   // lang key
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 250,
  screenParameters: { strokeWidth: 1 },
  colors: { strokeColor: "#E44" },
  colorsDarkMode: { strokeColor: "#F88" },
  draw: (context, positionedGlyph, parameters, model, controller) =>
    coachOverlay.draw(context, positionedGlyph, parameters, model, controller),
});
```

**Event wiring replacement** — delete `event-broker.js` and its invented bus:

```js
// Glyph edits (live):
this.fontController.addGlyphChangeListener("coach", (glyphName) =>
  this.scheduleAnalysis(glyphName));

// Current glyph selection / location:
this.editorController.sceneController.sceneSettingsController.addKeyListener(
  ["selectedGlyphName", "glyphLocation"],
  (change) => this.scheduleAnalysis(change.newValue));
```

Keep the 50–100 ms debounce idea from `event-broker.js`, but implement it with a simple
`setTimeout` per glyph, not the current shared `clearTimeout` (which drops events — see P1-7).

**Action (alternative):** if a plugin architecture is desired long-term, base it on the
existing `fontra.webcontent` entry-point mechanism (already used in `server.py`) rather than
a new `ui.registerPanel()` API, and get it approved upstream first. Do not ship both.


### P0-2. The glyph data model is wrong — analysis silently does nothing

**Evidence**
- `geom-analyzer.js`, `space-analyzer.js`, `curve-inspector.js` all assume
  `glyphData.path.contours[].points[]`.
- Fontra's runtime glyph path is a **packed** `VarPackedPath` (`coordinates`, `endPathIndices`,
  `curveTypes`); it exposes `numContours`, `iterPoints()`, and
  `iterContourDecomposedSegments(ci)` which yields segments like
  `{ type: "line"|"quad"|"cubic"|"quadBlob", points: [{x, y}...] }`.
- Your own `.skills-data-prompt/ressources/triangle-guardian-revised-plan.md` flagged this
  exact mistake as P0 for triangle-guardian and fixed it there (`path.contours` →
  `iterContourDecomposedSegments`) — but the coach was never fixed.
- The Jest fixtures (e.g. `tests/fixtures/o-correct-overshoot.json`) contain `path.contours`,
  so the tests validate the bug, not the behavior.

**Impact:** `analyzeGlyph()` returns `null` for every real glyph; all rules silently no-op.

**Action 1 — add a single path adapter and route all analysis through it.**
New file (inside the relocated coach code, e.g. `src-js/views-editor/src/coach/path-adapter.js`):

```js
/**
 * Normalize a Fontra glyph path into plain contours:
 * [{ points: [{x, y, kind}], closed: true }]
 * kind is "oncurve" | "offcurve"
 */
export function getContours(path) {
  if (!path || typeof path.numContours !== "number") return [];
  const contours = [];
  for (let ci = 0; ci < path.numContours; ci++) {
    const points = [];
    for (const segment of path.iterContourDecomposedSegments(ci)) {
      const n = segment.points.length;
      segment.points.forEach((p, i) => {
        const isEndPoint = i === n - 1;
        points.push({
          x: p.x,
          y: p.y,
          kind: isEndPoint ? "oncurve" : "offcurve",
        });
      });
    }
    if (points.length >= 2) contours.push({ points, closed: true });
  }
  return contours;
}

/** Iterate raw segments (line/quad/cubic) — use this for curve inspection. */
export function* iterSegments(path) {
  if (!path || typeof path.numContours !== "number") return;
  for (let ci = 0; ci < path.numContours; ci++) {
    for (const segment of path.iterContourDecomposedSegments(ci)) {
      yield { contourIndex: ci, ...segment };
    }
  }
}
```

Then in `geom-analyzer.js`, replace every `glyphData.path.contours` access:

```js
// before
if (!glyphData.path || !glyphData.path.contours || glyphData.path.contours.length === 0) return null;
// after
const contours = getContours(glyphData.path);
if (contours.length === 0) return null;
```

Note: `curve-inspector.js` should iterate `iterSegments()` (real line/quad/cubic segments),
not reconstructed point pairs — see P2-1.

**Action 2 — replace the invented fixtures with real ones** so the conversion is exercised
end-to-end. Generate from an actual `.fontra` test font:

```python
# fontra-coach/tools/dump_glyph_fixture.py — run once, commit the output
import asyncio, json, pathlib, sys
from fontra.backends import getFileSystemFont

async def main():
    font = getFileSystemFont("test-common/fonts/MutatorSans.fontra")
    for name in ["o", "H", "I", "n"]:
        glyph = await font.getGlyph(name)
        out = pathlib.Path("fontra-coach/tests/fixtures") / f"mutatorsans-{name}.json"
        out.write_text(json.dumps(glyph.asdict(), indent=2))

asyncio.run(main())
```

```js
// fontra-coach/tests/analysis/geom-analyzer.integration.test.js
import { analyzeGlyph } from "../../src/analysis/geom-analyzer.js";
import { getContours } from "../../src/utils/path-adapter.js";
import { readFileSync } from "fs";

const raw = JSON.parse(readFileSync(new URL(
  "../fixtures/mutatorsans-o.json", import.meta.url)));
// Convert the real packed path through the adapter, exactly as the editor will:
const glyph = { ...raw, path: { contours: getContours(raw.path) } };

test("real 'o' has positive bottom overshoot", () => {
  const result = analyzeGlyph(glyph, { baseline: 0, xHeight: 490 });
  expect(result).not.toBeNull();
  expect(result.overshoot.bottom).toBeGreaterThan(0);
  expect(result.overshoot.bottom).toBeLessThan(30);
});
```

**Verification:** after both P0 fixes, load the editor, select `o` in MutatorSans, and confirm
the DNA panel populates and the overlay draws. Before the fixes, none of this can ever work.


---

## 4. 🟠 P1 — Correctness Bugs (fix even before the P0 refactor)

### P1-1. Verbosity filter is exact-match, not a threshold — `rule-evaluator.js:15`

```js
// BEFORE (bug): an "expert" user never sees "learner" rules and vice versa
if (userLevel !== ruleLevel) continue;

// AFTER: show rules at or below the user's chosen verbosity
if (userLevel < ruleLevel) continue;
```

### P1-2. `applies_to_glyphs` substring match — `rule-evaluator.js:17`

`rule.applies_to_glyphs.includes(glyphName)` performs a **substring** match when the field is
a string: `"A"` matches `"Aacute"`. Guard the type:

```js
const appliesTo = rule.applies_to_glyphs;
const applies =
  appliesTo === "all" ||
  (Array.isArray(appliesTo) && appliesTo.includes(glyphName)) ||
  appliesTo === glyphName;
if (!applies) continue;
```

Also tighten `knowledge/schema/optical-rules.schema.json` so `applies_to_glyphs` must be
`"all"`, an array of glyph names, or a single glyph name — never a free string.

### P1-3. `findExtrema()` ignores `direction` and returns control points
`geom-analyzer.js:83-92` returns **all** points, including Bézier off-curve handles, so
`measureOvershoot()` measures the lowest **control point**, not the true curve extremum —
overestimating overshoot on round glyphs. Compute true per-segment extrema (endpoints +
derivative roots), or better: call the already-correct overshoot routine in
`src/fontra/core/glyph_analysis.py` via the server API and use that result. Reusing one
implementation avoids JS/Python divergence.

```js
// Sketch of true cubic extrema along an axis:
function cubicAxisExtrema(p0, p1, p2, p3, axis) {
  const a = 3 * (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]);
  const b = 6 * (p0[axis] - 2 * p1[axis] + p2[axis]);
  const c = 3 * (p1[axis] - p0[axis]);
  const ts = [0, 1];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      ts.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return ts.filter((t) => t >= 0 && t <= 1)
    .map((t) => cubicAt(p0, p1, p2, p3, t)[axis]);
}
```

### P1-4. Stem pairing logic is fragile — `geom-analyzer.js:21-34`
- The `i += 2` pairing after sorting by `midX` assumes perfectly interleaved vertical pairs.
  Glyphs with 3+ vertical strokes (`Ш`, `M`, `W`), italic glyphs, or glyphs mixing vertical
  curves and lines produce wrong widths.
- `side: i === 0 ? "left" : "right"` mislabels every stem after the first as `"right"`.

**Action:** pair stems by *nearest unmatched neighbor* instead of strict interleaving, and
drop the `side` label until it is computed correctly:

```js
export function measureStems(glyphData, upm) {
  const contours = getContours(glyphData.path);
  const verticals = collectVerticalStrokes(contours, 15 /* deg */);
  verticals.sort((a, b) => a.midX - b.midX);
  const stems = [];
  const used = new Set();
  for (let i = 0; i < verticals.length; i++) {
    if (used.has(i)) continue;
    let best = -1, bestDist = Infinity;
    for (let j = i + 1; j < verticals.length; j++) {
      if (used.has(j)) continue;
      const d = Math.abs(verticals[j].midX - verticals[i].midX);
      if (d > 0 && d < bestDist && d < upm * 0.5) { best = j; bestDist = d; }
    }
    if (best >= 0) {
      used.add(i); used.add(best);
      stems.push({
        width: bestDist,
        midY: (verticals[i].midY + verticals[best].midY) / 2,
        isMain: stems.length === 0,
      });
    }
  }
  return stems;
}
```

Long-term: replace this heuristic with the stem detection already implemented in
`src/fontra/core/glyph_analysis.py` (server-side), which handles curves properly.


### P1-5. Wrong font-metrics API — `plugin.js:45-50`
`fontController.getMetrics()` does not exist; the fallback `{ baseline: 0, xHeight: 500 }` is
wrong for most fonts and poisons every optical rule. Fontra stores metrics in
`lineMetricsHorizontalLayout` (see `src/fontra/core/classes.py`, `backends/designspace.py`),
and the client font controller exposes `unitsPerEm`.

```js
export function extractFontMetrics(fontController) {
  const fallback = { baseline: 0, xHeight: null, capHeight: null, upm: 1000 };
  if (!fontController) return fallback;
  const lm = fontController.fontMetrics ?? fontController.lineMetricsHorizontalLayout;
  const get = (key) => (lm?.[key] !== undefined ? (lm[key].value ?? lm[key]) : null);
  const metrics = {
    upm: fontController.unitsPerEm ?? 1000,
    baseline: get("baseline") ?? 0,
    xHeight: get("xHeight"),
    capHeight: get("capHeight"),
  };
  // Coach rules depend on metrics precision: fail loudly rather than guess.
  if (metrics.xHeight == null) {
    console.warn("fontra-coach: xHeight unavailable; overshoot rules disabled");
  }
  return metrics;
}
```

> Verify the exact client accessor at implementation time (`fontController.fontMetrics` vs
> reading `lineMetricsHorizontalLayout`). The rule is: **never hardcode 500** — disable the
> affected rules instead of guessing.

### P1-6. Fake cache — `plugin.js:53`
`this.cache.set(glyphName, "mockHash", analysis)` stores the literal hash `"mockHash"`, and
`AnalysisCache.get()` is never called anywhere. Either make it real or delete it:

```js
function hashGlyph(glyph) {
  const path = glyph.path;
  if (!path || path.numPoints === 0) return "empty";
  const coords = path.coordinates;   // packed array — cheap to hash
  let h = 0x811c9dc5;
  for (let i = 0; i < coords.length; i++) {
    h ^= coords[i] | 0; h = Math.imul(h, 0x01000193);
  }
  return `${h}_${path.numContours}`;
}

// in the analysis pipeline:
const hash = hashGlyph(glyph);
const analysis = this.cache.get(glyphName, hash) ?? analyzeGlyph(glyph, metrics);
this.cache.set(glyphName, hash, analysis);
```

Note: `AnalysisCache` also has no eviction policy — add an LRU cap (e.g. 200 entries) once it
is actually used.

### P1-7. Event broker debounce drops events — `event-broker.js:20-25`
`clearTimeout` + a single timer means any event cancels the pending one of a *different* type
(`glyphSelected` cancels a pending `glyphEdited`), and `this.queue` / `this.processing` are
unused. After P0-1 removes the fake bus, keep only a per-glyph debounce:

```js
scheduleAnalysis(glyphName) {
  clearTimeout(this._timers.get(glyphName));
  this._timers.set(glyphName, setTimeout(() => {
    this._timers.delete(glyphName);
    this.runAnalysis(glyphName);
  }, 75));
}
```

---

## 5. 🟡 P2 — Stub Implementations Presented as Features

Every item below renders in the UI as if functional, but returns fabricated data. A coach that
shows fabricated measurements destroys user trust faster than no coach. **Feature-flag all of
them off until implemented.**

| # | File | Problem |
|---|---|---|
| P2-1 | `curve-inspector.js:63-67` | `extractCurveSegments()` returns `[{type:"curve"}]`; 4 of 6 detection helpers return `false`/`null`. CURV-001…005 are never evaluated. Rewrite using `iterSegments()` from the path adapter (real line/quad/cubic segments). |
| P2-2 | `overlay-layer.js:1-17` | All four renderer `paint()` methods are empty; `requestRepaint` is never assigned, so even a working renderer would never redraw. Replace with a `registerVisualizationLayerDefinition` draw function (see P0-1). |
| P2-3 | `font-auditor.js` | `conductAudit()` returns a hardcoded all-pass report. |
| P2-4 | `consistency-panel.js:36` | "Run Audit" button only `console.log`s. |
| P2-5 | `dna-panel.js:130` | "Toggle Ghost Overlay" 👁 button only `console.log`s. |
| P2-6 | `geom-analyzer.js:65` | `measureCounter()` returns constants `{area: 150000, shape: "oval"}`. |
| P2-7 | `geom-analyzer.js:80` | `estimateStressAngle()` returns `0` unconditionally. |
| P2-8 | `geom-analyzer.js:76` | `measureContrast()` fallback returns hardcoded `85` unit widths. |

**Pattern to adopt — feature flag in the knowledge base:**

```json
// optical-rules.json — mark unimplemented rules so the UI can hide them
{ "id": "CURV-002", "implementation_status": "stub", ... }
```

```js
// rule-evaluator.js
if (rule.implementation_status === "stub") continue;
```

Then the panels show only rules backed by real analysis, and each implemented rule flips the
flag with its own tests.


---

## 6. 🔵 P3 — Design & UX

### P3-1. Hardcoded dark theme in Shadow DOM
`dna-panel.js`, `workflow-panel.js`, `consistency-panel.js` hardcode `#1e1e1e`, `#e0e0e0`,
`#3a3a3a`, `#888` — panels will look broken in Fontra's light theme. The variables they
reference (`--fontra-panel-bg`, `--fontra-text-primary`, `--fontra-font-ui`) do not exist.
Use Fontra's real design tokens (the same ones used by `panel-pro-advice.js`:
`--fontra-ui-surface-color`, `--fontra-ui-on-surface-color`, `--fontra-ui-accent-color`,
`--horizontal-rule-color`, …) and follow the `panelStyles` conventions from `panel.js`.

```css
:host {
  color: var(--fontra-ui-on-surface-color);
  background: var(--fontra-ui-surface-color);
}
.glyph-item:hover { background: var(--fontra-ui-secondary-color); }
.pill { background: var(--fontra-ui-element-bg-color, rgba(127, 127, 127, 0.2)); }
```

### P3-2. No internationalization
Panel strings are hardcoded English. Fontra uses `translate()` plus
`src/fontra/client/lang/*.js` (this branch already contributes ES/PT strings elsewhere).
Extract all strings to lang keys (`sidebar.coach-dna`, `coach.no-glyph-selected`,
`coach.run-audit`, …) and add them at minimum to `en.js`; upstream will translate the rest.

### P3-3. Dismissals never expire — `rule-evaluator.js:91-100`
`localStorage["coach.dismissed.<rule>.<glyph>"] = "true"` is per-browser, per-forever: a fixed
glyph keeps its warning suppressed. Include the glyph content hash in the key so a dismissed
warning re-appears after the glyph actually changes:

```js
const key = `coach.dismissed.${ruleId}.${glyphName}.${glyphHash}`;
```

Consider persisting dismissals in `fontController.customData` (per project) so a team shares
them, instead of per-browser localStorage.

### P3-4. Two knowledge bases diverging
The working `panel-pro-advice.js` loads `/data/type-design-knowledge.json`; the coach loads
`dist/coach-kb-bundle.json`. Two overlapping rule sources will drift. **Consolidate to one KB
and one loader.** Recommendation: keep the coach's versioned KB (`knowledge/v1/` + schemas +
`npm run build:kb`) because it is better engineered, and serve it via a webcontent entry
point; make `panel-pro-advice.js` consume the same bundle.

### P3-5. KB bundle filename mismatch
`package.json` `build:kb` writes `dist/coach-kb-1.0.0.json`, but `knowledge-loader.js:12`
fetches `../../dist/coach-kb-bundle.json`. Fix the script to write the bundle name the loader
expects (or vice versa), and add a CI check that the `build:kb` output is fresh.

### P3-6. `loadDefault()` swallows errors and returns `null`
Panels then silently render "None" everywhere. Surface a visible "Knowledge base failed to
load" state in each panel, and log the underlying error once.


---

## 7. ⚪ P4 — Repo Hygiene & Upstream Regressions

| # | Item | Action |
|---|---|---|
| P4-1 | `fontra-coach/test_output.txt` committed (and stale — shows a FAIL that no longer exists) | Delete; add `test_output*.txt` and `dist/` to `.gitignore` |
| P4-2 | `fontra-coach/package.json`: `"author": "Your Name"` | Fill in real author, add a `license` field |
| P4-3 | `test-common/fonts/Aileron-SemiBold.fontra/` (thousands of files) | Remove unless a test references it; if needed, commit a 3-glyph subset only |
| P4-4 | `triangle-guardian/` exists twice: repo root **and** `src/fontra/localplugins/triangle-guardian/` (already diverging: 438 vs 7-line `start.js`) | Keep the `localplugins` copy; delete the root copy or make it a build artifact |
| P4-5 | `.qwen/` editor settings committed | Remove from git; add to `.gitignore` |
| P4-6 | `.gitignore` diff is 321 lines | Audit: ensure nothing upstream needs was ignored |
| P4-7 | **`instancer.py` removes guideline instancing** (deleted `Guideline` add/subtract/multiply ops and `guidelines=` handling) — an upstream feature regression | If deliberate: separate commit + changelog + upstream discussion. If accidental (bad merge resolution): restore |
| P4-8 | `server.py` swallows `RuntimeError("method HEAD is already registered")` | The entry-point dedupe should fix the root cause — prefer failing loudly over masking future duplicate-route bugs. Also decide dedupe order (keep **first**, not last, and log conflicts) |
| P4-9 | `workflow.py`: silent `except ImportError` around `fontra_compile` imports | Add `logger.warning("fontra_compile not installed; compile actions unavailable")` so PyInstaller packaging issues stay diagnosable |

---

## 8. Test Strategy

1. **Fixtures:** replace invented-format fixtures with real glyphs exported from
   `MutatorSans.fontra` (see P0-2 Action 2). Keep the small handcrafted fixtures for unit edge
   cases, but mark them clearly as *unpacked contour* format and always pass them through the
   same adapter the editor uses.
2. **Integration test per rule:** for each implemented rule, one positive and one negative
   real-glyph case (e.g., `o` with/without overshoot).
3. **Golden tests for the evaluator:** snapshot `evaluateRules()` output for a small KB —
   protects against regressions in severity/label templates.
4. **Python side:** `test-py/test_glyph_analysis.py` is good; add a test that exercises the
   same glyph through both Python and JS analysis and asserts tolerance-level agreement
   (guards against JS/Python divergence once the server API is consumed).
5. **CI:** run `npm test`, `npm run test:kb`, and
   `pytest test-py/test_glyph_analysis.py test-py/test_design_guide.py
   test-py/test_workflow_composition.py` on every PR touching these paths.


---

## 9. Roadmap (Recommended Order)

| Step | Items | Effort | Payoff |
|---|---|---|---|
| 1 | P1-1, P1-2 (one-line evaluator fixes) + unit tests | ~30 min | Correct rule filtering immediately |
| 2 | P4 cleanup (delete stale artifacts, fix package.json, gitignore) | ~1 h | Clean review surface |
| 3 | P0-2 path adapter + real fixtures + integration test | ~1 day | Analysis works on real data |
| 4 | P0-1 panel integration (DNA panel first, following `panel-pro-advice.js`) | ~1–2 days | First user-visible value |
| 5 | P1-5 real metrics; P1-3 true extrema (or server API) | ~1 day | Trustworthy overshoot/contrast |
| 6 | P2 feature-flag stubs; implement CURV rules via `iterSegments()` | ~2 days | No fabricated data in UI |
| 7 | P3: theme tokens, i18n, dismissal expiry, KB consolidation | ~2 days | Ship-quality polish |
| 8 | P4-7 decision on `instancer.py` guideline regression (restore or formalize) | ~0.5 day + discussion | No silent upstream feature loss |

**Recommended commit sequence:** one commit per roadmap step, each with tests, so review and
revert stay cheap.

---

## 10. Verification Checklist (run after each step)

```bash
# JS coach tests (from repo root)
cd fontra-coach && node --experimental-vm-modules node_modules/jest/bin/jest.js

# KB validity
cd fontra-coach && npm run test:kb

# Python tests
pytest test-py/test_glyph_analysis.py test-py/test_design_guide.py test-py/test_workflow_composition.py
```

Manual editor smoke test (after steps 3–4):
1. Build the client (`npm run build` or the repo's standard build command) and start the
   Fontra server; open the MutatorSans test font.
2. Select `o`: the DNA panel populates, no console errors.
3. Toggle the Coach overlay in glyph layer settings: the overlay draws.
4. Edit `o` (drag a point): warnings refresh within ~100 ms.

---

## 11. Appendix — Key File References

| Topic | File |
|---|---|
| Real panel pattern | `src-js/views-editor/src/panel.js`, `src-js/views-editor/src/panel-pro-advice.js` |
| Real visualization layer registration | `src-js/views-editor/src/visualization-layer-definitions.js` |
| Packed path API | `src-js/fontra-core/src/var-path.js` (`iterContourDecomposedSegments`, `numContours`, `iterPoints`) |
| Glyph change listeners | `fontController.addGlyphChangeListener` (client `font-controller.js`) |
| Font metrics model | `src/fontra/core/classes.py` (`LineMetric`), `src/fontra/backends/designspace.py` |
| Server-side analysis (reuse target) | `src/fontra/core/glyph_analysis.py` |
| Prior art for the P0 path fix | `.skills-data-prompt/ressources/triangle-guardian-revised-plan.md` |

**Bottom line:** the coach's content (knowledge base, schemas, Python analysis) is solid —
the work needed is to replace the invented APIs and data model with Fontra's real ones
(P0), fix the handful of small evaluator bugs (P1), and hide everything that is still a stub
(P2) so the feature ships only trustworthy coaching.

*End of report.*








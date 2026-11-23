# Plugin & Code Audit — 2026-11-17

Branch `code-review-feedback-42427` @ `1af4fa86b` · Scope: the 6 local plugins, plugin loader/infra, packaging (fontra-pak), recent fork changes.
Method: 3 parallel deep-audit agents + manual verification of key claims (marked ✓ where re-verified by hand). Read-only — **nothing was implemented**.

Pre-state: `main` = `upstream/main` = `origin/main` (`6e04a57e2`); feature branch pushed; **npm test pass · pytest 654 pass**.
Supersedes the plugin sections of `CODE_AUDIT_REPORT.md` (2026-11-12); items from that report re-checked below are marked "still open".

---

## Tier 0 — Verified data-loss / broken-feature bugs (fix first)

| # | Finding | Evidence | Status |
|---|---|---|---|
| 0.1 | **sketch-layer: over-quota trim crashes → all sketch saving silently stops** for a project past 1.5 MB. `glyphs[name].p.length` reads `.p` of an *array of strokes* → TypeError, swallowed by `persist()`'s catch. | `sketch-layer/sketch-store.js:162` ✓ | Confirmed by hand |
| 0.2 | **triangle-guardian plugin panel renders as garbage text.** Its `el()` helper doesn't flatten array children while every section uses `div(attrs, [ … ])` → `append([a,b,c])` stringifies to `"[object HTMLDivElement],…"`. | `triangle-guardian/triangle-guardian-panel.js:50–66, 191, 215, 222, 249–257` ✓ | Confirmed by hand; the 3 other plugin panels flatten correctly |
| 0.3 | **triangle-guardian plugin duplicates a built-in editor feature.** Built-in `fontra.triangle.guardian` layer + tool + panel exist in the bundle (`edit-tools-triangle-guardian.js`, `panel-triangle-guardian.js`, same geometry incl. the same `segmentIndex` bug). Plugin forces a second layer + panel on → **double-drawn triangles** and two near-identical tabs. | plugin `com.fontra.plugins.triangle-guardian.overlay` vs built-in `fontra.triangle.guardian` ✓ | Confirmed by hand |
| 0.4 | **commonform: uncaught exception in the paint loop.** `segmentsOfContour` guards iterator existence but not the contour index; core `var-path` throws on out-of-range (contour deleted after search, empty/dummy glyph). | `commonform/commonform-layer.js:79, 135–144` vs `var-path.js ~490` | Agent-verified |
| 0.5 | **cadence-spacer: rename deletes the old entry before validating the new one** → empty/invalid name = silent data loss; duplicate name silently clobbers. | `cadence-panel.js:860–871` | Agent-verified |
| 0.6 | **cadence-spacer: constructor clobbers persisted `state.beamY`** with preset `meta.nBeam` (all presets declare 200) and re-saves → the user's beam height never survives a reload. | `cadence-panel.js:190–192`, `cadence-state.js:132–156` | Agent-verified |
| 0.7 | **commonform: `clearSearch()` is dead code** ("called when the selection changes" per its own comment) → stale matches/highlights after selection change or query swap. | `commonform-state.js:213–217` ✓ (grep: only the definition) | Confirmed; still open from Nov-12 |
| 0.8 | **triangle-guardian opacity slider is a no-op** (panel writes `state.triangleOpacity`, layer reads `parameters.triangleOpacity` from the layer definition). | `triangle-guardian-panel.js:158–246` vs `triangle-guardian-layer.js:172, 255` ✓ | Confirmed; still open from Nov-12 |

## Tier 1 — Stale UI / races / lifecycle

| # | Finding | Evidence |
|---|---|---|
| 1.1 | cadence plans never invalidated on glyph edits/selection → overlay shows stale current sidebearings after edits; after apply, `currentLeft/Right` stay pre-apply. | `cadence-panel.js:176–179, 744–748, 907–914`; `cadence-layer.js:90–104` |
| 1.2 | cadence `_updateDiagnostics` async without sequencing → stale result can overwrite fresh one. | `cadence-panel.js:545–573` |
| 1.3 | commonform Search doesn't flush the pending 150 ms query debounce → can search the old query and then have results replaced. | `commonform-panel.js:443–453` |
| 1.4 | sketch-layer pointer handling: no `buttons`/`pointerId` check on move, no `lostpointercapture`/`pointercancel` → second finger interleave, capture-loss keeps appending to the open stroke. | `sketch-overlay.js:216–239` |
| 1.5 | Plugin layers force re-enable on every load (sketch-layer + triangle-guardian + cadence): a user's "off" choice is silently reverted each reload. | `sketch-layer.js:52–56`; `triangle-guardian-layer.js:146–151`; `cadence-layer.js:193–198` |
| 1.6 | Loader: `parsePluginBasePath` runs outside try/catch → one malformed `fontra.pluginsplugins` entry kills loading of all remaining plugins *and* the deferred sidebar restore. | `editor.js:816–817, 280–284` |
| 1.7 | Core `observable-object.ts` `JSON.parse` unguarded in the sync path → corrupted localStorage value crashes startup. | `observable-object.ts:307` (upstream, on the plugin-load path) |
| 1.8 | umarks: window listeners never removed (`anchors-view.js:86`), controller listeners registered with no teardown (`marks-layer.js:176–179`), tutorials panel `fontra-tour-end` listener leak (`panel.js:51`). | Agent-verified |
| 1.9 | triangle-guardian violation scan drops triggers while a scan is pending → stale list; `segmentIndex || ci` mislabels segments (also in the built-in copy). | `triangle-guardian-panel.js:260–265, 295–306` |
| 1.10 | umarks `init.js:31–37` unguarded `getSidebarPanel("glyph-note")` duck-typing → whole plugin fails on host drift. Also `undoLastBatch` restores components as plain JSON (`make.js:859`) contradicting its own component-shape policy. | Agent-verified |

## Tier 2 — Performance

| # | Finding | Evidence |
|---|---|---|
| 2.1 | umarks `refreshGlyph()` full-font scan + loads ALL comb marks per open-glyph change (50 ms debounce); `refresh()` reclassifies the whole font per change (200 ms–2 s); `madeOnce()` iterates sources × glyphs every render; `path-view` per-row `JSON.stringify` reconciliation; `Array.includes` over glyph names in `suggest.js` (→ Set). | `marks-panel.js:564–660, 929–936, 2186–2189`; `path-view.js:312–321`; `suggest.js:386–433` |
| 2.2 | commonform prepares the query 3× per search and fully prepares every candidate before cheap early-outs; `collectCandidates` walks the whole font synchronously (UI freeze on large fonts); results table uncapped. | `commonform-panel.js:403–483`; `commonform-font.js:295–334, 552–574` |
| 2.3 | cadence `beamCrossings` full contour walk per glyph per repaint, uncached. | `cadence-layer.js:118` |
| 2.4 | sketch-layer quota is per-project (1.5 MB) but origin quota ~5 MB → 3–4 projects overflow `localStorage` silently; no cross-project trim, no user-visible warning. | `sketch-store.js:12, 308–326` |

## Tier 3 — Packaging / infra (exe & server)

| # | Finding | Evidence |
|---|---|---|
| 3.1 | **`fontra-pak/hook-fontra.py` is dead code** — PyInstaller never sees it (`FontraPak.spec` passes `hookspath=[]`, no `--additional-hooks-dir`, no entry point). Plugins reach the exe only as a side effect of `collect_all("fontra")`. Fragile: a spec cleanup could silently drop all plugins; nothing tests it (`test-export.py` doesn't check `/localplugins/`). | `hook-fontra.py:13–14`; `FontraPak.spec:63–76, 99`; verified against installed PyInstaller 6.22.3 |
| 3.2 | **exe bloat from blanket collection**: fontra-umarks 2.05 MB total (1.58 MB docs/guide: 5 orphaned PNGs ~640 KB — the guide inlines base64 instead — plus 849.9 KB `guide/index.html`, CHANGELOG 29 KB, LICENSE 35 KB ×2); every plugin's `tests/` + READMEs ship; tutorials ships `.github/workflows/pages.yml`, `scripts/purge-jsdelivr.sh`, `.gitignore`, and an untracked `.pyc` can leak in at build time. Realistic saving ~1.6–2 MB. | file-size survey ✓; PNG orphanhood ✓ (`data-capture` attrs are provenance only) |
| 3.3 | Server static allowlist has **no `png`/`jpg`/`gif`** → any plugin image asset 404s on `/localplugins/…`. This is why umarks inlined its screenshots as base64. Also no `Cache-Control` (Nov-12 finding still open; `Last-Modified` = server start). | `core/server.py:28–39, 270–312` ✓ |
| 3.4 | Loader still (Nov-12, all open): `fetchJSON` ignores `response.ok`; registered draw callbacks run outside any try/catch (no `safeInvoke` — one throwing callback breaks the canvas every frame); sequential loads with no timeout; no enable/disable UI; no version pinning; trust-model undocumented. | `utils.ts:358–361` ✓; `editor.js:798–846` ✓ |
| 3.5 | `validatePlugin` passes 500/HTML responses; dedup by exact string (`/x` vs `/x/` both registerable); editor duplicate-panel guard keys on `panelElement.name` (never set) instead of `identifier` → duplicate panels possible. | `plugin-manager.js:120–138`; `editor.js:1402–1406`; `sidebar.js:20` |
| 3.6 | plugin.json schema drift: tutorials missing `identifier/version/author/license`; umarks missing `identifier/author/license/description`; loader reads only `init/function/name` and never validates. Loader convention drift: `init.js/init` (tutorials, umarks) vs `start.js/registerPlugin` (other four). | Agent-verified table |
| 3.7 | Vendoring provenance: tutorials = adapted copy of Fontra Hive "Try Fontra" tours (© Jérémie Hornus / U+Type, GPL-3.0, **no version declared**); umarks = subset + locally modified (fork `995b2344e` stripped ~130 lines from 8 files, deleted `register-dev.js`) but still labeled upstream v0.1.4 — misleading, blocks future upgrade diffs. Recommend `VENDORED.md` + fork version suffix (or unmodified re-vendor of a tag). | Agent-verified |
| 3.8 | GPL accounting: both vendored plugins are GPLv3 inside an MIT-licensed host — redistribution fine, notices travel with the files; the identical 35 KB GPL text ships twice. | Agent-verified |

## Tier 4 — Dead code / docs / i18n hygiene

- cadence: `mBeam/fBeam/gBeam` parsed, stored, round-tripped, never read — README advertises them (`README.md:104`); `tabular=` without `tabularWidth` parses but silently applies to 0 glyphs (engine says `tabularWidth` required); `state.enabled` persisted but has no UI toggle (stale `false` = permanently blank overlay); `.cust` file load doesn't update the source label; `_cust` custom-table edits still not persisted (Nov-12, believed open).
- commonform: `splitContourBySelectedIndices` + `extractSelection` ~100 dead lines with 6+ tests; `openCount`, `state.isSearching/progress` written but unread; `checkbox` alias of `input`; non-editor fallback (`layerName=null`) resolves zero candidates; `collectCandidates` never includes component outlines while README says you can select a component as query; "settings remembered" claim false for Compare-directions; per-glyph `catch` swallows systematic failures; open query arcs compared by closed-polyline math.
- triangle-guardian: parallel/opposite handles silently skipped (built-in handles this S-curve case); settings never persisted; `icon.svg` unused; no README; eps semantics vary with segment length; S-curves counted as "violations" while painted informational.
- sketch-layer: overlay `keydown` listener is dead code (div without tabindex); `pluginPath` param unused; "Clear all" has no confirm and sketches have no undo.
- Cross-plugin: `el/Panel/SimpleElement/SimpleObservable/registerLayer/glyphSelector/formatNumber` duplicated ~4× with silent drift (one copy broken — 0.2). Recommend a shared `localplugins/_shared/` module imported relatively.
- i18n: zero `translate()` usage in any plugin; sketch tab tooltip renders the raw key (`sidebar.sketch-layer-plugin` missing from en.js).

## Test gaps (suites currently green: cadence 84/84, commonform 87/87, sketch 191 pass, pytest 654 pass)

- No tests at all: **triangle-guardian, fontra-umarks** (root `test:plugins` glob only picks up `*/tests/*.test.mjs` — empty dirs silently contribute nothing).
- Highest-value first tests: sketch-store over-quota round-trip (would have caught 0.1); TG `el()` no-`"[object"` assertion (catches 0.2); TG `computeApex` parallel-handle case; commonform out-of-range contourIndex (catches 0.4); cadence apply-verification branches + rename validation (catches 0.5); umarks load-without-`glyph-note`, Make-undo round-trip, `classifyTarget` golden cases.
- Tutorials' pytest+Playwright suite assumes server root = plugin folder → doesn't run from the fork root.
- `hook-fontra.py`: `hiddenimports = collect_submodules(...)` is a no-op (empty `__init__.py` only).

## Verified-clean notes (no action)

- All plugin imports are relative (native-import constraint respected everywhere).
- No `innerHTML` with untrusted strings in the plugins; server `/localplugins/` traversal guard correct (incl. encoded/backslash variants).
- Themes: deep-dark/clean-light use the `--fontra-theme-marker` trick correctly and are linked from all four views; `theme-settings.js` class handling correct.
- `selection-transformations.js` (new context-menu/align-distribute module): compute-before-apply fix is correct; reviewed, no defects found.
- umarks guide is network-free; tutorials runtime is network-free (no CDN at runtime).

## Proposed roadmap (for validation — nothing done yet)

1. **Batch A — user-data safety (small diffs):** 0.1, 0.5, 0.6, 0.8 (+ tests 0.1/0.5).
2. **Batch B — triangle-guardian resolution:** decide plugin vs built-in (recommend: **delete the plugin**, keep the built-in tool; the built-in already has the better S-curve handling) — this removes 0.2/0.3/1.9/opacity no-op wholesale.
3. **Batch C — loader & load-path hardening:** 1.6, 1.7, 3.4 (ok-check + `safeInvoke` + parallel/timeout), 3.5 guard fixes.
4. **Batch D — packaging:** wire-or-inline the plugin data collection with `tests/**` excluded (3.1), add `/localplugins/*/plugin.json → 200` to `test-export.py`, add `png` to the MIME table + `Cache-Control: no-cache` (3.3), delete the orphan PNGs and tutorials dev-files (3.2).
5. **Batch E — stale-UI/perf:** 1.1–1.5, 1.9, 1.10, then 2.1–2.4 as profiled follow-ups.
6. **Batch F — hygiene:** dead code + README alignment + plugin.json/provenance metadata + `_shared` extraction (only after A–E stabilize).

Suggested order rationale: A removes silent data loss; B removes a whole broken duplicate rather than fixing it; C/D protect every plugin; E improves trust in what the overlays show; F is cosmetic.

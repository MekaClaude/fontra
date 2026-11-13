# Fontra Code Audit — Security, Stability, Performance, Plugins, UI/UX

Date: 2026-11-12 · Branch: `code-review-feedback-42427` · Scope: full read-only audit of `src/fontra` (Python, 59 files), `src-js` (JS/TS, ~3.1 MB), the 5 local plugins, and the UI layer.

Severity counts: **Security 4H / 7M / 10L · Performance 6H / 9M / 6L · Frontend 4H / 9M / 9L · Plugins 6 loader findings + per-plugin · UX 25 findings.**

The 12 highest-leverage fixes are in §7 (Roadmap). Spot-checks verified: no `Origin` check on the WebSocket (`server.py`), `authorize()` returns `"yes"` unconditionally (`projectmanager.py:81`), `event.shitKey` typo (`editor.js:3483,3500`), `color: undefined var(--foreground-color)` (`icon-button.js:93`), byte-identical `figma-theme.css` shipped twice.

---

## 1. Server security & stability (`src/fontra/core`, `filesystem`)

### High

- **H1 · WebSocket has no auth and no Origin check → Cross-Site WebSocket Hijacking.** `core/server.py:153-193`; `filesystem/projectmanager.py:81-82` (`authorize()` returns `"yes"`). Any website the user visits can open `ws://localhost:8000/websocket?project=…` and read the font, call `editFinal` (write glyph data), `putBackgroundImage`, `exportAs`. **Fix:** validate `request.headers["Origin"]` against the serving host during the handshake, and/or issue a per-session token to the landing page that must be echoed in the first WS message. Single highest-value hardening.
- **H2 · Project identifier traversal: read/write any font outside the project root.** `filesystem/projectmanager.py:125-135` joins client-controlled `?project=` onto `rootPath` with no sanitization; `..` segments escape the root, and on Windows a drive-letter segment splices out of it (verified experimentally). **Fix:** reject `..`, empty segments, drive-letter/`:`-bearing segments; after join, `resolve()` and assert containment via `os.path.commonpath`.
- **H3 · Arbitrary file write/read via background images.** `core/fonthandler.py:342-352` + `backends/fontra.py:214-228`: `imageIdentifier` is never sanitized (unlike glyph names, which go through `stringToFileName`) and `type` is any string → `imageIdentifier="../../evil"` writes attacker bytes anywhere with any extension; `getBackgroundImage` mirrors it as arbitrary read. **Fix:** whitelist `[A-Za-z0-9._-]` for identifiers, and build `ImageData` through cattrs `structure()` so `type` can only be PNG/JPEG.
- **H4 · Static handler: Windows drive-letter splice escapes content root.** `core/server.py:277-295` blocks `.`, `..`, `\`, NUL (good) but not `C:`-style segments — verified: joining a `C:` segment discards the content root. `GET /C:/Users/x/notes.txt` reads any file with an allowed extension (js/css/html/ico/json/svg/txt/csv/woff2/wasm). **Fix:** reject segments containing `:` or matching `^[A-Za-z]:$`; also resolve-then-assert containment.

### Medium

- **M1 · Blocking `subprocess.run` without timeout on the event loop** — `backends/opentype.py:281-287` (`sr-aef`): a hung subprocess freezes every connection. Fix: `runInWorker` or `asyncio.create_subprocess_exec` + `wait_for`, cap output.
- **M2 · Heavy synchronous font parsing on the event loop** — `opentype.py:476-497` (`font.save()` to BytesIO), `FontraBackend.__init__` (`fontra.py:55-84`), `OTFBackend.__init__`. Opening a large font stalls all clients for seconds. Fix: route constructor-time parsing through the existing `runInWorker`.
- **M3 · Race in `getRemoteSubject` → duplicate/leaked FontHandlers** — `projectmanager.py:92-123`: handler registered *after* `await startTasks()`; two concurrent connections for one project create two handlers (two watchers, divergent localData); the later `del` can delete the other live handler's entry. Fix: register before awaiting (sync) or an `asyncio.Lock` per identifier.
- **M4 · `read-only` is sticky per handler, not per connection** — `projectmanager.py:111-123` + `fonthandler.py:382-446`: a client connecting `?read-only=true` to an already-open writable project still writes; the first read-only connection permanently bricks writes for later read-write clients. Fix: keep the flag per connection (`clientData`).
- **M5 · `/api` runs skia boolean ops inline** — `server.py:251-268`, `pathops.py:25-45`: one crafted POST stalls the loop. Fix: dispatch `unionPath/subtractPath/intersectPath/excludePath` through `runInWorker`.
- **M6 · Server→client futures never removed, awaited without timeout** — `core/remote.py:125-135`: entries only added to `callReturnFutures`; one hung client stalls `reloadData` fan-out for everyone. Fix: `pop()` on resolve + `wait_for` timeouts, `return_exceptions=True` in gathers.
- **M7 · Internal error details reflected to clients; spoofable `X-FORWARDED-FOR` in logs** — `server.py:160-178`: exception reprs (with local paths) sent to clients; the header is trusted unconditionally. Fix: generic message + correlation id server-side; honor the header only behind an explicit `--trust-proxy` flag.

### Low

- **L1** `server.py:297-300`: Windows `PermissionError` on directory requests → 500 instead of 404.
- **L2** `server.py:295-305`: file fully read before the extension check — check extension first.
- **L3** `server.py:260`: malformed `/api` JSON escapes the try → 500; move into try, return 400.
- **L4** `remote.py:41-53`: first-message handling runs before the try — malformed/absent first message escapes `websocketHandler` → 500-level log spam.
- **L5** Dead code: `_watcherTask` (`fonthandler.py:84`), `dummyEditor` (`:52`), `versionToken` (`server.py:48,327-332`) — never assigned/used.
- **L6** `client-uuid` is client-supplied and unsanitized (`remote.py:43-46`) — collisions can unsubscribe another client's change patterns. Generate server-side.
- **L7** `request.json()` ignores Content-Type (`server.py:260`) — latent CSRF the moment a state-changing API function is added; enforce `application/json` + Origin check on POST now.
- **L8** `findFreeTCPPort` bind/close TOCTOU (`server.py:335-349`) — benign race.
- **L9** `closeActiveWebsockets` aborts on a broken socket (`server.py:141-145`) — wrap each close.
- **L10** `backends/fontra.py:144`: `encoding="utf=8"` typo (normalizes harmlessly).

### Done well
Layered static-path guard (double-unquote, backslash/NUL rejection); clean WS lifecycle (heartbeat 55, 32 MB message cap, shutdown close, `finally` discard); `@remoteMethod` whitelist (no arbitrary dispatch); known aiohttp WSMsgType.ERROR pitfall handled; task cancellation on disconnect; self-healing write pipeline (revert + notify on backend failure); zero unsafe deserialization (only `yaml.safe_load`); glyph filenames percent-escaped via `stringToFileName`; 1 MiB POST body limit; localhost default bind; hardcoded MIME table; bounded LRU for localData; watcher feedback-loop protection; no HTML reflection anywhere.

---

## 2. Server performance & efficiency

### High

- **H1 · Full-font eager glyphMap scan at open and on every external reload, on the event loop.** `designspace.py:343-355,2554-2560` + `ufo_utils.py:13-28`: per glyph, `getGLIF()` reads the whole file and two regexes scan the entire buffer — seconds per 3-10k-glyph font, repeated on watcher events (`:1691-1697,398-399`), freezing all clients. Fix: build from `contents.plist`/fontTools `getCharacterMapping()`, cache on mtime, run via `runInWorker`.
- **H2 · Glyph LRU is only 128 entries, shared with axes/kerning/etc.** `fonthandler.py:60`: any session touching >128 glyphs thrashes the cache — each revisit is a full GLIF read + pen conversion + cattrs structure. This is the hottest path bypassing its cache. Fix: glyph-only LRU sized 1000-4000; pin small singleton data separately.
- **H3 · Systemic blocking file I/O inside `async def` backends** — `designspace.py`, `fontra.py:130-166,367-371`, `opentype.py:131-180`: nearly every `getGlyph`/`putGlyph` does sync disk I/O + XML/JSON parse on the loop. Fix: route leaves through `runInWorker` starting with `getGlyph`/`putGlyph`/font load.
- **H4 · Blocking subprocess + full font re-serialization in async methods** — `opentype.py:283-287,479-497`: multi-second first-open of features/kerning panel stalls the loop. Fix: async subprocess + worker.
- **H5 · `contents.plist`/`lib.plist` rewritten wholesale per glyph write** — `designspace.py:889-913` (the code itself carries `FIXME: this is inefficient if we write many glyphs`), `:1174-1181`: bulk writes are O(n²) bytes. Fix: per-transaction dirty-set flush.
- **H6 · Whole-structure `deepcopy` per scheduled write** — `fonthandler.py:531,501`: every kerning tick deep-copies the full kerning tree. Fix: serialize once (`unstructure` + compact separators) instead of deepcopying the dataclass tree.

### Medium

- **M1** `path.py:401,411,420`: `deepcopy(pointAttributes)` in every `__add__/__sub__/__mul__` — used per-source in delta building (`instancer.py:772-783`). Shallow-copy suffices.
- **M2** `workflow/actions/composition.py:386-393`: reverse cmap rebuilt per glyph → O(n²) run. Cache in `async_cached_property`.
- **M3** `instancer.py:60,151` + `workflow/actions/glyph.py:388-447`: `glyphInstancers` plain dict never evicts — decomposing/trimming pins the whole font in RAM. Use `LRUCache`.
- **M4** `opentype.py:123,155-158`: `variationGlyphSets` unbounded dict keyed by location string. Cap with LRU(64).
- **M5** `backends/copy.py:124`: `pop(0)` in the copy loop (O(n) per pop) + `numTasks` default 1 + sequential output processing → parallelize with deque + `Promise`-style gather.
- **M6** `fonthandler.py:666-703`: `computeGlyphMapChange` sorts the whole glyphMap per watch event; a set-diff is O(n) without sorting.
- **M7** `fontra.py:490-491`: glyph JSON written with `indent=0` (one line per token) — ~2× larger files, slower parse on every open. Use compact separators (already the pattern elsewhere).
- **M8** `opentype.py:96-124`: gvar/VARC/CFF2/cmap parsed eagerly in `__init__` — defer to lazy properties.
- **M9** Watcher callback runs full `_reloadEverything` on the loop (`designspace.py:1691-1786`) incl. fixed `sleep(0.15)`. Worker re-init + quiescence wait instead.

### Low

- **L1** `classes.py:405-412,477`: global float unstructure hook with try/except per coordinate — fast-path `is_integer()`.
- **L2** `classes.py:507-514`: `Component` hook registered twice; second registration silently drops `location=_unstructureDictSorted` (unstable serialization order). Merge registrations.
- **L3** `remote.py:123`: WS messages serialized with default separators (spaces) — pass compact `dumps` (~10-20% smaller payloads).
- **L4** `designspace.py:1389-1423,1490-1503`: kerning.plist re-parsed per call; GSUB recompiled per direction reset — cache on mtime.
- **L5** `instancer.py:1068-1071,267`: dict rebuilds + axis sorts in the per-frame instancing path — precompute.
- **L6** `changes.py:117`: deepcopy of change args even for pure-scalar `=xy` — skip for atomic args.

### Done well
Incremental change protocol (small diffs broadcast per-connection subscription patterns; `=xy` mutates packed coords in place); clean O(1) `LRUCache` + 0.2 s write coalescing scheduler; attribute-keyed `findItems` index cache; per-discrete-location variation model caching; lazy refcounted project lifecycle (no fonts at startup, teardown when last client leaves); glyph-dependency extraction off the loop.

---

## 3. Frontend (`src-js`)

### High

- **H1 · One failed connect bricks all RPCs until page reload.** `fontra-core/src/remote.js:82-106`: the rejected `_connectPromise` stays cached (deleted only in `onopen`); `reconnect` also fires on failure. Fix: clear in `.finally`, add exponential backoff + jitter, emit `reconnect` only after a successful open.
- **H2 · Pending RPCs hang forever; fragile message handling.** `remote.js:120-181`: close never rejects parked promises (map grows); `JSON.parse` without try/catch; unguarded `returnCallbacks` deref; `_doCall` sends after await without re-checking `readyState`; server→client calls can interleave out of order. Fix: reject-all on close, wrap parse, serialize server→client handling.
- **H3 · Rejected glyph fetches cached permanently.** `font-controller.js:445-470`: a transient `RemoteError` poisons that glyph's promise in the 2000-entry LRU for the whole session. Fix: evict on rejection so callers retry.
- **H4 · Full scene rebuild incl. harfbuzz re-shape of all text lines per pointermove.** `scene-controller.js:805-809` + `scene-model.js:366-423,452-571,1297-1361`: `editIncremental` → `updateScene()` → `buildScene()` re-creates `LineSetter` and re-shapes every line O(text) per mousemove. Fix: during editing update only the edited glyph's instance/placement; defer full re-shape to `editFinal` or composition-input changes.

### Medium

- **M1 · HTML injection via imported shortcut definitions** — `panel-shortcuts.js:360,381-384,425` + `actions.js:157-179`: `baseKey` unvalidated, interpolated into `innerHTML`; malformed import file throws unhandled. Fix: `textContent`, whitelist baseKeys, report import errors.
- **M2 · Plugin system executes arbitrary remote code ungated** — `editor.js:793-828`: localStorage-driven, no confirmation, failures console-only. Fix: `fetchJSON` throw on `!response.ok` (currently missing → `utils.ts:358-361`), per-plugin confirmation, surface load failures in settings.
- **M3 · Corrupted localStorage crashes app startup** — `observable-object.ts:268-317` + `actions.js:26`: unprotected re-parse in the sync path breaks every view on load. Fix: single guarded parse, string fallback.
- **M4 · `UnlitElement` rebuilds the whole shadowRoot per property change** — `html-utils.js:98-114`: re-fetches `<link>` each render; overlapping async renders can append stale children. Fix: detached-fragment swap + generation counter.
- **M5 · Listener accumulation on reconnect** — `glyph-cell-view.js:157-167,39-69` (re-adds parent `mousemove`, never removes key listeners), `menu-bar.js:52-65` (four window listeners, no teardown). Fix: symmetric connect/disconnect.
- **M6 · Canvas redraws via `setTimeout(0)` not rAF** — `utils.ts:44-59` + `canvas-controller.js:53`: full clear+redraw can run several times per display frame during input. Fix: rAF-back `requestUpdate` for canvas.
- **M7 · Zero ARIA across webcomponents** (spot checks `icon-button.js:82-98`, `menu-bar.js:198-212`, `modal-dialog.js:257-290`); icon buttons have no accessible name; menus are focusable divs without roles.
- **M8 · Dead/misplaced dependencies** — root `package.json`: `@codemirror/highlight`, `@codemirror/history` (pre-1.0, never imported), `ts-loader` (build uses babel-loader), `npm` as devDependency, babel in runtime deps, `tsc@^2.0.4` stub in fontra-core deps.
- **M9 · `import()` path built from localStorage-controlled locale** — `localization.js:70-99`: arbitrary same-origin script execution if tampered; validate against the `languages` list. Also `location.reload(true)` deprecated.

### Low

- **L1** `editor.js:3483,3500`: `event.shitKey` typo → Shift+middle-click wrongly toggles hand tool. *(verified)*
- **L2** `panel-characters-glyphs.js:439,472-481`: `!lineIndex === undefined` dead condition; `JSON.stringify` deep-equal per scene update.
- **L3** `editor.js:1425-1446`: global `console.log` monkey-patch does stringify + DOM writes per call.
- **L4** Silent error swallowing in edit paths — `edit-tools-brush-advanced.js:490-495`, `panel-base.js:68-77` (TODO handle error), `view-controller.js:41-47`.
- **L5** Dead/debug code: `canvas-controller.js:43-51,290-299`, `mouse-tracker.js:24-35`, `window._fontraMouseTracker` global, hardcoded English bypassing `translate()`.
- **L6** ~100+ `==` sites; deprecated `matchMedia().addListener` (`editor.js:281-283`); no ESLint config (add `eqeqeq`, `no-var`).
- **L7** Fetches without `response.ok`: `inline-svg.js:54`, `glyph-data.js:25`, `glyphsets-controller.js:128`, `backend-api.js:75-85`.
- **L8** `window.open` without `noopener` (`fontoverview.js:984`).
- **L9** `ui-list.js:384-395`: layout thrash (scroll reads interleaved with appends) — use IntersectionObserver like `glyph-cell.js`.
- **L10** No type-checking in build/test (`checkJs:false`, no `tsc --noEmit`); 8 `@ts-ignore`s unchecked; no `engines` pin.

### Done well
Representation caching (`flattenedPath2d` memoized; bounded client LRU caches); cancellation + subscription diffing in the scene model; consistent `escapeHTML()`/DOMPurify at innerHTML sinks (with tightened allow-list in `modal-dialog.js`); chunked DOM rendering with real cleanup in cells; central scheduling utilities (`consolidateCalls/scheduleCalls/throttleCalls`) with adaptive brush preview budget.

---

## 4. Plugin system & local plugins (`src/fontra/localplugins`)

### Loader

- **High · Trust model:** plugins are arbitrary JS in page context (no sandbox); jsDelivr `@latest` is unpinned — the same "installed" plugin can change server-side. Document "plugins run with full page privileges" at install; support ref pinning; warn on `@latest`. Longer term: capability API / CSP.
- **Med ·** `fetchJSON` ignores `response.ok` (`utils.ts:358-361`) → broken plugins pass `validatePlugin`; loader logs fixed messages without the error object.
- **Med ·** Registered async callbacks (draw hooks etc.) run outside any try/catch — one throwing draw callback breaks the canvas every frame. Add `safeInvoke` that catches once and disables the offending plugin.
- **Med ·** Sequential loads, no fetch timeout — hung CDN request blocks later plugins and sidebar restore. `Promise.allSettled` + `AbortSignal.timeout(10_000)`.
- **Low/Med ·** No enable/disable, no version pinning, manifest fields parsed but unused by loader/UI.
- **Low ·** Install failures are console-only; show toasts/inline errors in the plugin manager.

Server route `/localplugins/` is solid (traversal guard + extension allowlist), but `Last-Modified` = server start time and **no `Cache-Control`** → stale plugin JS until hard reload; all five READMEs tell devs to disable cache, which is the symptom. Add `Cache-Control: no-cache`.

### Per-plugin

| Plugin | ~LOC | Tests | Key findings (verified by audit) |
|---|---|---|---|
| **cadence-spacer** | 2,492 | 84 ✅ | Token race in `_updateDiagnostics` (stale result can overwrite newer); `_cust` custom table edits **not persisted** — silent user data loss. Best-engineered of the five; adopt shared helpers. |
| **commonform** | 2,064 | 87 ✅ | `clearSearch()` is **dead code** with a comment claiming it runs on selection change → stale matches/highlights after query change; `collectCandidates` clones every glyph's contours eagerly (memory spike); sync prepare loop can block UI. |
| **fontra-tutorials** | 1,553 | 0 node (Playwright suite exists, not wired into `test:plugins`) | Deep DOM coupling (`deepQuery` on hardcoded ids/classes) — no stable hook contract; global Escape capture fights Fontra's own handling. |
| **fontra-umarks** | 10,839 | ❌ none (comments reference a nonexistent `tests/`) | Fragile panel acquisition via `getSidebarPanel("glyph-note")` prototype poking; `editorController.umarks` global namespace; incomplete `plugin.json`; mojibake in CHANGELOG. Genuinely polished UX (tips, before/after SVG, batch undo, reports). |
| **triangle-guardian** | 633 | ❌ none | "Triangle opacity" slider is a **no-op** (panel writes `state.triangleOpacity`, layer reads `parameters.triangleOpacity`); violation rows `cursor: pointer` with no click handler; duplicated geometry (`computeApex`/`pointInTriangle`/`isDegenerate` in panel + geometry.js); `segment.segmentIndex \|\| ci` zero-index mislabel bug; two overlapping show-all toggles; unpersisted state. |

Test totals: **171/171 passing** (`npm run test:plugins`). Coverage is bimodal: the two engine plugins are excellently tested; the three interaction-heavy plugins have zero — and that is exactly where the verified bugs live.

### Cross-plugin

`el()`/`SimpleElement`/`Panel` re-implemented ~4× with **drift** (cadence flattens nested child arrays, triangle-guardian doesn't); `registerLayer` copy-pasted ×4; `formatNumber` ×3; `SimpleObservable` ×2. **Recommendation:** a shared `plugin-kit` module (plain ES module inside `localplugins/`) for Panel/el/SimpleElement, registerLayer, formatNumber — creates the seam for future loader API evolution.

**Top 5 plugin improvements (repo-wide):** 1) loader hardening (ok-checks, safeInvoke, parallel+timeout); 2) fix the two verified user-facing bugs (opacity slider, dead `clearSearch`); 3) shared `plugin-kit`; 4) test the untested three (umarks `rules.js`, triangle geometry are pure logic — easy); 5) trust-model messaging + enable/disable + manifest metadata.

---

## 5. UI/UX

### High
- **F1 ·** `figma-theme.css:13-35` bypasses the `--fontra-theme-marker` light/dark trick → figma theme is permanently light; the promised "Figma-style dark header" can never activate; dark-OS users get hard-flashed. Gate every `-light` value with the marker; add a dark block or label it light-only.
- **F2 ·** figma-theme ships in **3 copies** (2 byte-identical, verified MD5) — single source in `src-js/fontra-core/assets/css/`, generated into the legacy path at build.
- **F3 ·** `.fontra-button` (`shared.css:13`) hardcodes `#ddd` with no color → white-on-#ddd ≈ 1.35:1 in dark theme across Shortcuts + several fontinfo panels. Use tokens.
- **F4 ·** Pro Advice panel uses `--fontra-ui-*` tokens that exist nowhere (verified) → invisible `#333` section titles on dark panels; hardcoded `#09f`, `#cc6600`.
- **F14 ·** Sidebar tabs (`sidebar.js:48-57`) and multi-panel headers (`multi-panel.js:62-75`) are keyboard-inaccessible divs — Fontinfo/Settings unusable by keyboard/AT.
- **F15 ·** Menu system has zero ARIA (`menu-panel.js:286-345`): literal `"✓"` checkmarks, color-only disabled states, no `aria-haspopup/expanded`. Repo-wide only ONE aria attribute exists (`range-slider.js:277`).

### Medium
- **F5** Shadow-DOM components carry private hardcoded palettes (`menu-panel.js:46-52`, `range-slider.js:5-13`, `ui-list.js:10-16`, …) the figma theme can't reach → visibly split theme; `--figma-blue-hover` defined but consumed by nothing.
- **F6** `modal-dialog.js:113-147`: `gray`/`white` buttons ≈ 3.5:1 (fails AA) — the app's universal confirm/error surface.
- **F7** `menu-panel.js:79,90`: disabled `#8080a0` ≈ 3.1:1, divider `#80808080`.
- **F8** Zero `prefers-reduced-motion` support (verified) despite hover-scale, tab wiggle, `element.animate()`, spinner.
- **F9** Global `0.9em` base compounds downward (`panel-pro-advice.js` 0.88em ≈ 12.7px; handles 0.8em ≈ 11.5px).
- **F10** Three different navigation patterns across the four views (editor icon tabs / fontinfo+settings accordions / fontoverview fixed sidebar).
- **F11** Three overlapping settings/form systems (`simple-settings`, `grouped-settings`, `ui-form`) with drifted styling.
- **F12** Z-index ad-hoc magic numbers: 1/3/10/20/100/200/10000 — define a token ladder.
- **F13** `editor.html`/`landing.html` missing `lang` on `<html>`.
- **F16** Editor has no menu bar; undo/redo discoverability lives in the right-click menu + a 5s toast. Font Overview does have `makeFontraMenuBar` — mount it in the editor.
- **F17** `menu-panel.js:400` "FIXME: this probably only works one level deep" — nested trees silently misbehave.
- **F18** No responsive handling at all (zero breakpoints, verified): two sidebars ≥400px of a 600px window; tabs auto-restore from localStorage even on tiny screens; resize gutter is pointer-only.
- **F19** `#mini-console` (console.log → 5s corner toast) has no `aria-live`, no warn/error distinction, no dismiss.
- **F22** Empty states mostly missing: text entry has no placeholder, landing page renders nothing when no projects, glyph search has no "no matches".
- **F24** Hardcoded English bypassing the (solid, 15-locale) i18n system — incl. the connection-lost dialog "Reconnect"/"Try again" (`view-controller.js:199,239,249`), "Cancel"/"Add", feature-code error message, plugin-manager, tutorials plugin entirely.

### Low
- **F20** `icon-button.js:93` emits invalid `color: undefined var(--foreground-color)` (verified, `// TODO: huh.`); `shared.css:39-42` + `add-remove-buttons.js:60-62` suppress focus outlines without a `:focus-visible` replacement.
- **F21** Icon-only controls without accessible names (`add-remove-buttons.js:90-107`; IconButton has no label API).
- **F23** Icon fetch renders nothing until resolved (tab/toolbar jump); two icon families (UFO-exported + Tabler) with different stroke conventions.
- **F25** First-run guidance depends entirely on the optional tutorials plugin; without it: empty canvas, no hint.

### Done well
The marker-trick theming (one variable flips every token incl. shadow DOM); focus management discipline (dialogs restore focus, menus save/restore active element, IconButton FocusKeeper); loader-spinner anti-flicker (300 ms delay, ref-counted); menu overflow flipping + type-ahead + drag-vs-click disambiguation; validated shortcut conflicts with inline ⚠ warning + export/import/reset; IntersectionObserver virtualization.

---

## 6. What is already good (keep / do not regress)

1. No unsafe deserialization in Python; no HTML reflection server-side; glyph filenames properly escaped.
2. Incremental change protocol end-to-end (server diffs, client subscriptions, packed-coordinate in-place edits).
3. Clean `LRUCache`, write coalescing, per-discrete-location variation caching, lazy refcounted project lifecycle.
4. Client representation caching + scene cancellation + subscription diffing.
5. Focus management + persistence + shortcut-conflict validation infrastructure.
6. Server `/localplugins` route hardening; remote-method whitelist; robust write pipeline with auto-revert + user notification.

---

## 7. Prioritized roadmap

### Tier 0 — security (do first, small diffs)
1. **Origin check + per-session token on `/websocket`** (H1 server) — neutralizes drive-by write access; also closes H2/H3 browser exposure.
2. **Path containment asserts**: project identifier (`projectmanager.py:125`), static handler `:`/drive-segment rejection (`server.py:277`), background-image identifier whitelist + `structure()` (`fonthandler.py:342`, `fontra.py:214`).
3. Per-connection read-only enforcement (M4) + client-uuid server-side (L6).

### Tier 1 — stability + the five one-liners
4. `remote.js` lifecycle: clear rejected `_connectPromise`, reject pending calls on close, backoff+jitter (H1+H2 frontend).
5. Evict rejected glyph promises from the client LRU (H3 frontend).
6. Event-loop hygiene: `runInWorker` for `sr-aef`, font init/parse, skia `/api` ops; timeout on server→client futures (M1/M2/M5/M6 server).
7. The five trivial fixes: `event.shitKey` → `shiftKey`; `color: undefined var(...)` removal; `encoding="utf=8"`; `!lineIndex === undefined`; locale validation in `localization.js`.

### Tier 2 — performance
8. Glyph LRU 128 → 1000-4000 + serialize-don't-deepcopy write path (H2/H6 server).
9. rAF-backed canvas `requestUpdate` + edit-time incremental scene updates (M6 + H4 frontend).
10. `contents.plist` per-transaction flush + compact JSON separators (H5/M7 server, L3 remote).

### Tier 3 — plugins
11. Loader hardening (ok-check, safeInvoke, parallel + timeout) + enable/disable + pinned refs + trust-model warning.
12. Fix verified plugin bugs: triangle-guardian opacity slider + row-click; commonform `clearSearch()`; cadence `_cust` persistence + diagnostics race.
13. Shared `plugin-kit`; minimal test suites for umarks/triangle-guardian; wire tutorials' Playwright suite.

### Tier 4 — UX
14. Quick wins: `.fontra-button` tokens; Pro Advice token replacement; marker-gate figma theme + dedupe; keyboard+ARIA panel nav; `aria-live` mini-console; `prefers-reduced-motion` block; `:focus-visible` policy.
15. Structural: semantic token set propagated into shadow DOM (one palette everywhere); ARIA program with axe checks in CI; unified `<panel-nav>` component + responsive shell + editor menu bar (undo/redo discoverability).

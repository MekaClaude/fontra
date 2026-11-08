# Fontra MCP — audit report

Audit of `fontra-mcp/` (the MCP server + CLI added in `0e41856ce`) against
the live Fontra backend layer, plus the two defects found in the Fontra
server itself while chasing the console errors in the browser.

Every finding below was **reproduced**, not inferred from reading the code.
The fixes are implemented in the same commit as this report; the
regression test for each one is named.

---

## Part A — the MCP server

### A1. Windows absolute paths were rejected — **fixed**

`_resolveFontPath()` rejected any path containing a backslash:

```python
if "\\" in font or "\x00" in font:
    raise FontServiceError(f"Invalid font path: {font!r}")
```

so `D:\DESIGN\FONT MAKING\experiment.fontra` failed with
`Invalid font path` even though it was inside the configured root. Only a
forward-slash path worked. The guard was meant to stop path traversal, but
traversal is decided by *where the path resolves to*, not by which
separator it uses.

**Fix:** the backslash check is gone. The sandbox guarantee now rests on
resolving the path and checking that it is under one of the configured
roots — the same guard the editor's `staticContentHandler` uses. The
null-byte check stays.

*Test:* `test_absolute_path_with_backslashes_accepted`

### A2. `list_fonts` → `open_font` round-trip was broken — **fixed**

`list_fonts` returned `path` as `str(fontPath)` (backslashes on Windows)
while `open_font` rejected backslashes, so the documented
"feed the path back" flow could not work. `id` (POSIX-style) did work.

**Fix:** A1 makes the returned `path` usable as-is. `list_fonts` now also
returns `pathPosix` for callers that prefer a separator-stable form.

*Test:* `test_list_fonts_path_round_trips`

### A3. `find_glyphs_using` always crashed — **fixed**

```python
glyphs = sorted(await handler.findGlyphsThatUseGlyph(glyphName))
```

`FontHandler.findGlyphsThatUseGlyph()` is a `@remoteMethod` and takes a
keyword-only `connection` argument, so every call raised
`TypeError: missing 1 required keyword-only argument: 'connection'`.

**Fix:** the backend is queried directly
(`handler.backend.findGlyphsThatUseGlyph`), with an explicit
`supported: False` answer for backends that do not implement it.

*Test:* `test_find_glyphs_using_does_not_crash`

### A4. `setGlyph` was defined twice — **fixed**

`service.py` contained two `async def setGlyph(...)` methods. The second
definition replaced the first at class-creation time, so the first body was
dead code. The surviving copy was also the weaker one: it wrote
`handler.glyphMap[glyphName] = cps` without checking that `glyphMap` was
initialised.

**Fix:** one implementation, with the cache refresh done through
`handler.getGlyphMap()`.

*Test:* `test_service_has_a_single_set_glyph`

### A5. `set_glyph` was registered twice as an MCP tool — **fixed**

`server.py` had two `@mcp.tool()` functions named `set_glyph`. FastMCP
emits `Tool already exists: set_glyph`, and the tool list is ambiguous.

**Fix:** one tool; the test suite now asserts that the number of
registered tool names equals the number of tools.

*Test:* `test_mcp_server_lists_tools`

### A6. `open_font` always reported `readOnly: True` — **fixed**

The field was hard-coded, so an agent could not tell whether writes were
available.

**Fix:** `readOnly` is `not self.writesAllowed`, and `writesAllowed` is
reported alongside it.

*Test:* `test_open_font_reports_writable_state`

### A7. `set_glyph` silently dropped the other masters — **fixed**

Writing a single-layer payload to `A` in a four-master font reduced it to
one layer, with no warning. The result did not even name the layers that
were lost.

**Fix, in three parts:**

* `set_glyph` reports `droppedLayers` / `droppedSources` and adds a
  `warning` field when layers are dropped.
* `set_glyph` gained `mode="merge"`: the layers and sources in the payload
  are merged into the existing glyph and the other masters are preserved.
* `set_glyph_layer` writes exactly one layer and never touches the others.

*Tests:* `test_set_glyph_reports_dropped_layers`,
`test_set_glyph_merge_keeps_other_masters`,
`test_set_glyph_layer_only_touches_one_layer`

### A8. Unpacked `Path` glyphs did not round-trip — **fixed**

The `.fontra` backend stores outlines as unpacked contours
(`{"contours": [{"points": [{"x": …, "y": …, "type": "quad"}]}]}`) and
converts to packed paths when reading. `get_glyph_full` returned the
*packed* form (`coordinates` / `pointTypes` / `contourInfo`), so an agent
read one representation and wrote back another.

**Fix:** `get_glyph_full` returns the unpacked form by default — the
representation Fontra actually stores, and the one `set_glyph` writes
back. `packed=True` still returns the compact form for callers that want
it.

*Tests:* `test_get_glyph_full_uses_unpacked_contours`,
`test_get_glyph_full_packed_variant`

### A9. `_summarizeGlyph` broke on unpacked paths — **fixed**

It called `path.getControlBounds()` and read `path.contourInfo` /
`path.pointTypes`, none of which exist on `fontra.core.path.Path`. Any
font whose glyphs come back unpacked raised `AttributeError` from
`get_glyph`.

**Fix:** the summary converts the path to a `PackedPath` first.

*Test:* `test_get_glyph_summary` (now covers the user's own `n`)

### A10. Kerning values were reported with the wrong shape — **fixed**

`Kerning.values` is `left → right → [value per source]`, the inner list
being one entry per entry in `Kerning.sourceIdentifiers`. The summariser
put that list in the output as if it were a scalar, so a pair came out as
`[-75, null, -215, -150, null]` — meaningless to an agent.

**Fix:** the per-source list is preserved, `sourceIdentifiers` is reported
next to it, and the output says what the list means.

*Test:* `test_kerning_values_are_lists_per_source`

### A11. `glyph set` without a payload raised a `TypeError` — **fixed**

```python
glyphData = json.loads(args.data) if args.data else json.loads(args.from_file and open(...).read())
```

With neither `--data` nor `--from-file` this called
`json.loads(None)` → `TypeError: the JSON object must be str, bytes or
bytearray, not NoneType`.

**Fix:** the CLI reports a proper error (`glyph set needs a payload: pass
--data '<json>' or --from-file <path>`) on stderr and exits non-zero.

*Tests:* `test_cli_glyph_set_without_payload_reports_error`,
`test_cli_glyph_set_without_payload_prints_json_error`

### A12. `_resolveDir` gave up after the first root — **fixed**

```python
for r in self.roots:
    …
    if r == c or r in c.parents:
        if c.is_dir():
            resolved = c
            break
    else:
        raise FontServiceError(f"Invalid relative directory: {subdir!r}")
```

A directory that only exists under the *second* root raised instead of
being found — the `else` belongs to the `if`, not the `for`.

**Fix:** every root is tried; the error is raised only after all of them
fail.

*Test:* `test_resolve_dir_tries_every_root`

### A13. Seven knowledge-base functions were never exposed — **fixed**

`design_guide` implements `get_components`, `get_suggestions`,
`get_info_cards`, `get_cards`, `get_acceleration_tips`, `get_all_terms`
and `get_all_components`, but the MCP server exposed none of them.

**Fix:** all seven are exposed as tools (`get_components`,
`get_suggestions`, `get_info_cards`, `get_cards`, `get_acceleration_tips`,
`get_all_terms`, `get_all_components`), plus `get_card_layout`.

*Test:* `test_design_guide_extras_are_exposed`

### A14. `get_design_phases()` returned phases with no glyphs — **fixed**

The knowledge base stores the phase *per glyph* (`"phase": "2"`), not a
glyph list on the phase, so every phase came back with `glyphs: []` and
`tips: []` — useless for planning.

**Fix:** `fontra.core.design_guide.get_phase_glyphs()` derives the
phase → glyph mapping from the per-glyph field, and `get_design_phases()`
/ `get_design_phase()` fill it in. (Phase *tips* are still empty: the
knowledge base stores no per-phase tips — only a phase name and
description.)

*Test:* `test_design_phases_list_their_glyphs`

### A15. The write toolbox was far too small — **fixed**

The server could create and replace whole glyphs and nothing else. An
agent could not place a component, set an anchor, copy a glyph, add a
master, interpolate, decompose, or write a kerning pair.

**Fix — new write tools** (all gated, all `dry_run` by default):

| Tool | What it does |
|---|---|
| `set_glyph_layer` | Replace one master, leave the others alone |
| `copy_glyph` | Clone a glyph (all layers, components, anchors) |
| `add_component` | Place a component with a `DecomposedTransform` |
| `remove_component` | Remove a named component |
| `set_anchors` | Set or merge the anchors of a layer |
| `decompose_glyph` | Flatten components into outlines |
| `interpolate_glyph` | Create an interpolated master between two layers |
| `add_source` | Add a master (font source + layer), validating the axis location |
| `set_kerning` | Write kerning pairs |

**New read tools:** `get_sources`, `get_component_graph`, plus the seven
knowledge-base functions from A13.

*Tests:* `test_copy_glyph`, `test_set_anchors*`, `test_add_component_*`,
`test_remove_component`, `test_decompose_glyph_flattens_components`,
`test_interpolate_glyph*`, `test_add_source*`, `test_set_kerning*`

### A16. No workflow planning — **fixed**

The server could read and write, but it had no idea *what to draw first*.
The knowledge base for that lives in `fontra-coach/knowledge/v1/`
(`glyph-dna.json`, `workflow-sequences.json`) and was not loaded at all.

**Fix:** a new `fontra_mcp/workflow.py` module with a `WorkflowPlanner`
that turns a starting set into an ordered plan:

* `plan_workflow(glyphs)` — the ordered build plan for e.g. `"n,o,H,O,I"`:
  position, role, the components each glyph is built from, the glyphs it
  is built from, the glyphs it unlocks, and the next glyphs to tackle.
* `get_glyph_dna(glyph_name)` — the DNA of one glyph.

The plan is exposed as a tool, as the MCP resource
`fontra://guide/workflow/{glyphs}`, and as the CLI
`fontra-cli workflow plan n,o,H,O,I`.

*Tests:* `fontra-mcp/tests/test_workflow.py` (7 tests)

---

## Part B — the Fontra server

### B1. `/images/brush.svg` is referenced but does not exist — **fixed**

`src-js/views-editor/src/panel-brush.js:63` set
`iconPath = "/images/brush.svg"`, but `src/fontra/client/images/` only
contains `brush-calligraphic.svg`, `brush-eraser.svg`, `brush-sculpt.svg`
and `brush-straight.svg`. The brush panel's icon 404s in *every*
installation (verified on the healthy instance on port 8001 and on the
repo server on port 8123).

**Fix:** the panel uses `/images/brush-calligraphic.svg` — the default
brush mode of the panel.

> The committed client bundle still contains the old reference until
> `npm run bundle` is re-run. See "Not done" below.

### B2. The MIME lookup was case-sensitive — **fixed**

`src/fontra/core/server.py`:

```python
ext = resourceName.rsplit(".", 1)[-1].lower()
if ext not in self.allowedFileExtensions:
    raise web.HTTPNotFound()
contentType = mimeTypes.get(resourceName.rsplit(".")[-1], "")   # <- not lower-cased
```

The allow-list was case-insensitive but the MIME lookup was not, so a
file named `EN.JS` would be served with an empty content type. The lookup
now uses the same lower-cased extension.

### B3. The console errors were caused by a broken running instance — **no code fix**

The reported errors

```
Le chargement du module à l'adresse « …/lang/en.js » a été bloqué en
raison d'un type MIME interdit (« text/plain »).
Could not parse SVG from /images/brush.svg
```

are **not** caused by the Fontra source. The instance the browser was
pointing at (port 8000) has a **truncated PyInstaller extraction**:

```
_MEI0000180c2   39 top-level entries, no `fontra/`, no `icon/`, no *.dist-info
_MEI00003bb02   healthy: has `fontra/`, `icon/`, `fontra/client/editor.html`
```

Live probes confirm it:

| URL | port 8000 (broken) | port 8001 (same exe, fresh) | port 8123 (repo server) |
|---|---|---|---|
| `/` | **500** text/plain | 200 text/html | 200 text/html |
| `/lang/en.js` | **404** text/plain | 200 application/javascript | 200 application/javascript |
| `/images/brush.svg` | 404 | 404 | 404 |
| `/images/brush-calligraphic.svg` | 404 | 200 image/svg+xml | 200 image/svg+xml |

The `text/plain` MIME error was the **404 error page** being served for
`/lang/en.js` — aiohttp's default `text/plain` body for `HTTPNotFound`.
A second instance of the *identical* `Fontra Pak.exe` serves everything
correctly, so the artefact is fine and no code change can repair an
already-running process with a truncated extraction.

**Action for the user: quit and relaunch Fontra Pak.** The CSS parse
errors (`// background-color: red;` etc.) come from the same stale
instance — those comments do not exist anywhere in the current source
(`git log -S "background-color: red"` only matches old commits).

---

## Not done / deliberately out of scope

* **The client bundle was not rebuilt.** `npm run bundle` was not run, so
  `src/fontra/client/js/*` still contains the old `panel-brush.js` with
  the dead `/images/brush.svg` reference. The webpack bundle is not
  byte-reproducible, so it must be rebuilt and committed in one step
  (never rebuilt again afterwards). The B1 fix only reaches the browser
  after that rebuild.
* **No new `Fontra Pak` artefact was built**; the fix needs a new build
  to reach the packaged app.
* **Interpolation is linear** between two layers (point positions, x
  advance, component transforms). It refuses to interpolate layers with
  different point counts, point types, contour counts or component counts
  rather than producing a broken master.
* **`decompose_glyph` uses the default layer of each component glyph**
  and ignores the component's axis `location`, so a *variable* component
  is flattened at its default master.
* The MCP server is registered in `.opencode/opencode.jsonc` (OpenCode) and
  in the MCode runtime (`mcp list` → `fontra`), both pointing at
  `D:\DESIGN` with `FONTRA_MCP_ALLOW_WRITES=1`. The tools become callable
  in a session once the runtime has connected the server.

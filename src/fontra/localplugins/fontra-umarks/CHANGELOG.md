# Changelog

## 0.1.4 — 9 November 2026

- **Fonts whose glyph sources carry a location, not a `locationBase`** — a UFO imported before
  Fontra wrote `locationBase`, the Glyphs and rcjk backends — were invisible to Place anchors,
  Check, Make and Update: « 0 anchors written on 0 glyphs; 101 with no layer in some source » on
  fontrahive.com, 9 November, on a single UFO without axes (its one source still saying
  `{weight: 400}`, its glyph sources `{}`); Make would have added a second source per master to a
  glyph it rewrote. A glyph source now belongs to the font source with the same location on the
  font's axes — only the font's axes count —, a `locationBase` still winning when there is one.
  Nothing changes for fonts Fontra wrote.
- **A glyph drawn in some sources only** — a family where a master is sparse, MutatorSans and its
  italic — was expected to carry anchors in every source: Place anchors planned the missing ones on
  an interpolation and found no layer to write to; ③ and ④ counted those sources as not done. A
  source the glyph has no layer of its own at is now left out of the plan, the check and the
  states. Found on the way.

## 0.1.3 — 9 November 2026

- **The designer's words.** The panel says what you do or see, not what the code does
  (`claude/umarks-vocabulaire.md`, decided 9 Nov. 9:42). ② *Add 15 missing glyphs* (was *Create 15
  empty*), « 15 glyphs to add · 6 still to draw »; ③ « 11 drawn glyphs have no anchors yet »;
  ④ « 2 anchors out of place »; ⑤ « 32 waiting for A, E to be drawn · 61 can't be built yet », and
  a reason that names what to do — « needs top on a », « needs _top on acute »; ⑥ *Update 8* (was
  *Recompute 8*), « 8 glyphs have moved off their anchors », « top of e moved 20 u up since it was
  made (in both sources) ». ① says « 132 accented glyphs, built from 21 parts », and an empty glyph
  set says « This glyph set is empty — add glyphs with Edit… ».
- The open glyph: « spacing accent, from acutecomb » (was « legacy accent of »), « What its anchors
  would allow », « possible — not in your glyph set », « drawn by hand — tick it to replace its
  drawing with the components of its rule ». The foot says « Added 15 glyphs » and « Updated 8
  glyphs ». The first-pass messages say the same things in the same words.
- Kept as they were: Make, Place anchors, Check anchors, Re-place, Undo last batch, drawn by hand,
  moved by hand, Ghosts, Composes, Sits on, Keep, auto. The names in the code and the keys of the
  document do not change: nothing to migrate.
- The guide is rewritten in the same voice, word for word (`docs/guide.txt`). Its captures still
  show the old words until they are taken again — see `docs/brief.md` § 9, step 6e.
- Tests: the Node tests read the new words, and `tests/test_no_old_words.mjs` sweeps the client
  and refuses the old ones in every string a person reads.

- The orange block of an open base says the cause once — « top of a moved 175 u right since the
  last Make (Regular) » — then « 8 glyphs out of date: agrave, aacute, … » on one line, the
  detail per accent behind a ▸. Different causes are grouped by cause; the block is six lines
  at most and scrolls beyond. The foot's « Last: … ▸ » does the same for a long batch.
- With Fontra's text shaping on, the canvas already shows à from a + gravecomb and your
  anchors, though agrave is not in the font. A ready glyph that is absent now says so in one
  line when open, and ⑤ says it once: the canvas is a preview, Make writes the glyph.
- The guide: « Why does the canvas already show à? », and in ⑥ the ghosts that follow the
  anchor at once.
- Tests: the Fontra server of the panel's tests is killed on ⌃C and on exception, two seconds
  after asking it to stop; none is left behind.
- The orange block's list of glyphs cuts between two names, never inside one (« … adieresis,
  aring + 2 more »); the cause and the list stay put, only the detail behind the ▸ scrolls.

## 0.1.2 — 2026-11-09

- Nothing written into the font's `customData` holds a `null` any more: a from-scratch glyph set
  has no `from`, a document without an active glyph set has no `activeTarget`. A `.fontra` file
  kept nulls without complaint, but a UFO's `lib.plist` cannot hold one — fontTools refused with
  « unsupported type », Fontra showed « The data could not be saved » and reverted the edit,
  now and then, when a glyph set was added. Reading puts the nulls back.

- The *Add a glyph set…* dialog scrolls: Fontra's dialog keeps its content cell from
  overflowing, so the list lives in a scrolling child of it.

- The foot of the panel says which U+Marks this is (« U+Marks 0.1.2 »), for bug reports. One
  version number in `version.js`, `plugin.json`, `pyproject.toml` and the CHANGELOG, kept equal by
  a test.

## 0.1.1 — 2026-11-09

- « Target » is now **Glyph set**, wherever it is read: the ① line, the messages, the
  Edit… dialog, the first pass, the guide, the README. The document keeps `targets` and
  `activeTarget`: nothing to migrate.
- ①'s menu lists only the glyph sets chosen for this font, and *Add a glyph set…* (the only
  entry on a new font). That entry opens a dialog: Project glyph sets, My glyph sets,
  Fontra presets (by family, with a filter), then From scratch; several can be ticked, the first
  added becomes active, one already in the menu is greyed.
- *Edit…* has *Remove this glyph set* (it was *Delete*): only the menu entry goes, no rule and no
  glyph; the active one passes to the next.
- A glyph set of your own (Settings › Glyph sets) is kept as `from: {preset: <url>}`; another
  browser without it reads the URL as a plain list of glyph names.

- No faux italic anywhere in the panel: Fontra ships no italic of its UI font, so help and
  state texts are told apart by a muted colour, not by `font-style: italic`. A test keeps it
  that way (`tests/test_no_faux_italic.mjs`).

- Fontra's « This font's glyphs » — the project glyph set every font has, keyed by the empty
  string — is a glyph set like the others: it can be added to the menu, and it lists every glyph of
  the font with its code points. It used to be read as « from scratch ».

- The `?` opens the guide where it can be read: next to the plug-in when Hive, Pak or a local
  server serves it; on GitHub Pages (`https://uplus-type.github.io/fontra-umarks/guide/`) when
  the plug-in is loaded from jsDelivr, which serves `.html` as plain text.

## 0.1.0 — 2026-11-09

The first release: the panel ①–⑥, the ghosts on the canvas, the rules from
Unicode, the font and the anchors, Make, Recompute, Re-place, Undo last batch,
the guide. Everything below, step by step.

- Project skeleton and design brief (docs/brief.md).
- Step 0: Fontra plug-in contracts checked in a real editor and written down
  (README « Fontra contracts », docs/etape-0-verifications.md,
  scripts/hello-plugin/), notes for upstream (docs/notes-for-just.md), and the
  test font tests/data/Accents-test.fontra (scripts/build-test-font.py).
- Step 1: the pure modules and their Node tests (62 of them) — `compose.js`
  (anchor matching, composed layers, VariableGlyph per source, sync state),
  `rules.js` (the `umarks.rules` document, validation, JSON import/export),
  `glyph-data.js` (reads Fontra's own `/data/glyph-data.csv`), `suggest.js`
  (rules from Unicode decomposition, AGL names and mark variants) and
  `legacy-import.js` (the JSON files of `MakeAccents.py`).
- Step 2: the Python package serves the client at `/umarks/` — README install,
  dev loop and layout, and a pytest that runs a real Fontra server and asks it
  for every file `init.js` needs.
- Step 3: the ghosts layer. On a base, the accent each anchor would receive; on
  an accent, the reference base it would sit on; live while an anchor moves,
  per source, cached by glyph and location and emptied when a glyph changes.
  A switch and an opacity slider in the panel, which also lists what is being
  drawn. 13 Node tests over a stub editor, and a Playwright test that drives a
  real one.
- The plug-in address to enter in Settings › Plugins is `/umarks/`, with the
  trailing slash: Fontra reads a two-part address as a GitHub `owner/repo`
  shorthand. The test font is now written exactly the way Fontra writes it, so
  opening it in the editor leaves git clean.
- Step 4a: `font-adapter.js`, the bridge from Fontra's asynchronous
  `fontController` to the synchronous `font` object the pure modules expect,
  and `make.js` — create a composed glyph, recompute its components from the
  current anchors, decompose, store the rules, and compute the state of a
  whole glyph set in batches. 16 more Node tests, over a recording stub.
- Step 4b/4c: the Rules tab — glyph set with its counters, the list of rules
  with a colour per state, a text and a category filter, multiple selection,
  double-click to open a glyph, and the rule of the glyph being edited with
  its anchor and variant menus. Suggest, Make, Recompute and Decompose are
  wired, states are computed in batches of fifty, and `view-model.js` holds
  everything the panel decides, tested on its own.
- Step 4d: Playwright tests for the Rules tab — Suggest fills the rules with
  the anchors read from the font, Make all creates the glyphs with their code
  points in both sources, a made glyph undoes, moving an anchor marks only the
  composed glyphs that lean on it, Recompute all puts them back, and the
  filter narrows the list.
- Step 4 bis: the Anchors tab. `anchors.js` (pure) computes where `top`,
  `bottom`, `ogonek`, `_top`… go from presets (x: box centre / left / right,
  advance centre, `reference:<glyph>`; y: baseline, x-height, cap-height,
  case height, ascender, descender, box top/bottom; dx, dy, case, italic) and
  plans **Place**, **Move**, **Align**, **Copy from**, **Mirror**, **Check** and
  **Derive variants**; every batch is announced before it is written. The
  presets live in `customData["umarks.rules"].anchors` and, once saved, replace
  the defaults (a deleted default stays deleted). Two presets were added to the
  defaults: `top.cap` (cap height + 10, uppercase, off by default in Place) and
  `_ogonek` (top of the box, on marks).
- Undo of a batch: Fontra's undo is per glyph and `editNamedGlyphAndRecordChanges`
  returns nothing, so the plug-in keeps **its own one-deep stack** (`make.js`:
  `applyAnchorPlan`, `applyVariantPlan`, `undoLastBatch`), button *Undo last batch*.
  It restores each anchor to what it was, leaves alone an anchor the designer
  has touched since, and deletes a derived glyph only if it is as it was made.
  Hand edits of the open glyph's anchor rows go through Fontra's own undo, not
  the batch.
- Heuristics worth knowing: a glyph is a mark if a rule uses it, it has `_`
  anchors, glyph-data says Mark, or (no code point, not in the table) it is drawn
  entirely above the x-height or below the baseline; case comes from the code
  point, else from `settings.categories` suffixes, else lower. The italic shift
  is `−y·tan(italicAngle)`, so a right-leaning (negative) angle moves right.
- Tests: Node 156 (new `test_anchors.mjs`, `test_make_anchors.mjs`, extended
  `test_view_model.mjs` and `test_rules.mjs`), and Playwright scenarios in
  `tests/test_panel.py` on a copy of the test font stripped of its anchors in
  Python (Place, Check, Move with ghosts, Undo last batch, Derive variants).
  The test-font helper now reads CRLF CSV.
- Step 4 ter: a readable panel. Each tab owns everything under it; one `On:`
  line under the tabs (this glyph, the selection of the Rules list, a glyph
  set, a typed list, with its glyph and source count) is what Suggest, Make
  all, Recompute all, Place, Check and Adjust work on; the footer holds the
  ghosts switch and opacity, what is drawn, and the last report on one line
  that opens on a click. The Anchors tab opens on its positions, one sentence
  each (`center · x-height + 10 · caps: cap height + 10`) with the tick that
  says whether Place puts it, fields only after a click on the line; the
  sentence above *Place anchors* says what it will write (« Place 50 anchors
  (…) in 14 glyphs, 2 sources — 2 already there, kept »), and the button
  writes it; *Undo last batch* sits next to it. Everything else is in
  *Adjust*, closed by default: one operation at a time (Check, Move, Align,
  Copy from, Mirror, Derive variants, Replace existing — no longer a box
  under Place), its fields, the sentence of what *Apply* writes, Apply off
  until that sentence is there. *Follow the italic angle* is one setting of
  the document (`settings.followItalicAngle`) instead of a box per preset; a
  document whose presets said `italic: true` reads with the setting on. The
  open glyph's anchors left the panel: they are on the canvas and in Fontra's
  Selection info. Sections are Fontra's `ui-accordion`; the menus are as wide
  as their longest entry, with short labels. Counters at zero are left out.
  Tests: Node 161 (scope, sentences, italic migration, `planAnchors` kept),
  Playwright scenarios of 4 bis through the operation menu, plus the tabs'
  contents, a position opening and closing, and no menu cut.
- Step 4 quater: a panel that follows the work. One screen, no tabs: the
  designer's path from top to bottom — **① Target** (a preset of Fontra, a
  glyph set of the project, or From scratch, plus a list of our own, `+ 3 − 1`,
  edited in Fontra's dialog; a link to Fontra's own place to add a glyph set),
  **② Draw** (what is not in the font yet, *Create N empty*: Fontra's default
  advance, 0 for a combining accent, a layer per source, one batch), **③
  Anchors** (drawn glyphs without their anchors, the positions, *Place
  anchors*), **④ Check** (anchors far from their position, *Check*, and
  Adjust: Move, Align, Copy from, Mirror, Derive variants, Replace existing,
  the italic angle), **⑤ Compose** (ready, waiting for what, impossible and
  why, *Make N*), **⑥ Update** (out of date since the last Make, by how much
  and why — « top of e moved 20 u up » — *Recompute N*). Each line counts,
  offers one action, and unfolds its glyphs (all folded at first, « done » in
  green when nothing is left, a tick narrows the action: « Make 5 »). No step
  blocks another: what is ready is done, the rest waits, said as such.
- Under the path, the open glyph: on a base, its ghosts (all of them, or one
  rule from a menu) and what it composes (✓ made, ○ to make, possible outside
  the target; a click shows the rule, adds it to the target or takes it out);
  on a composed glyph, its rule (editable, auto or ✎ manual, *Keep*), its state
  and Make / Recompute / Decompose; on an accent, the bases it sits on; an
  out-of-date warning on a drifted glyph and on the base whose anchor moved.
- The ghosts come from the rules: on a base every accent of every rule built
  on it, superposed (mark-to-mark one level); on a composed glyph the result of
  its rule, which shows its offset; on an accent every base that uses it. The
  index of the font's accents (one per anchor) is gone.
- The rules document is version 2: `targets`, `activeTarget`, and every rule's
  `source` (`suggested` | `manual`); version 1 reads without loss. Suggest is
  no longer a button: the rules of the target's glyphs are proposed and written
  on their own, with the parts the target plans to have (`egrave` is `e` +
  `gravecomb` before `gravecomb` exists); a suggested rule follows the font, a
  manual one never moves, and Make does not change which is which (decision B).
- New `target.js` (pure: the target's glyphs, the proposed rules, where each
  glyph stands, what a base composes), `path-view.js`, `glyph-view.js`;
  `rules-view.js`, `scope-view.js` and the `On:` line are gone.
- Tests: Node 168 (new `test_target.mjs`: model, migration, typed items,
  proposals, the step of every glyph of the test font, composables; the layer
  from the rules), Playwright 17 scenarios through the path, the ghosts, the
  dialog, and a screenshot of every state of the panel (`$UMARKS_SHOTS`).
- Make no longer copies anchors onto the composed glyph: components and advance
  only, and a glyph made again keeps whatever anchors it has. A composed glyph
  used as a base is placed by the anchors its components give it — Fontra's
  `propagatedAnchors`, what its shaper reads (`getPositioningGlyph` in
  `font-adapter.js`; the ghosts do the same).
- Step 5: the batch, the conflicts, the files.
  - **Overwrite**: a glyph of the target that has a rule but a drawing of its
    own is « drawn by hand », listed apart in ⑤ (« 38 ready · 2 drawn by
    hand ») and left out of *Make N*. Ticked in the fold, or made from the open
    glyph, it goes through a sheet in Fontra's own dialog: each glyph with its
    rule, its drawing and what Make would put instead, a box unticked;
    *Overwrite checked* or *Leave them*. Nothing is overwritten without a tick.
    A drawing is now seen in Fontra's packed path too (`path.coordinates`), not
    only in the test font's contours: before, a glyph drawn by hand in Fontra
    read as « out of date ».
  - **One batch**: *Make N*, *Recompute N* and the Make of the open glyph are
    remembered glyph by glyph, before and after (components, advance,
    outlines), creations included; *Undo last batch* deletes a glyph it
    created if it is as the batch left it, gives a rewritten glyph its layers
    back, and leaves what was touched since, saying so. Each glyph is one edit
    of Fontra's — whole or not at all — and a batch cut short is still taken
    back as far as it went. « ⌘Z takes them back one at a time » is gone.
  - **The report** stays one line in the foot; unfolded, it lists the glyphs:
    created, rewritten, recomputed, already in place, left alone and why,
    impossible and why. A double-click opens one.
  - **Import and export**, in a `…` menu at the end of ①: *Export rules…*
    (`<family>-umarks.json`: rules and where they come from, targets, the
    active one, anchor positions, settings), *Import rules…* (a manual rule of
    the document is never replaced; targets are added, renamed when their key
    is taken; the active target stays; the report counts what was taken,
    ignored, invalid), *Import MakeAccents JSON…* (its groups become targets).
  - **Legacy accents**: `acute`, `grave`, `dieresis`… get a rule of their own
    kind, `{"legacy": "acutecomb"}`, proposed like the others when the
    `…comb` is in the font or the target (Unicode's compatibility
    decomposition, else the name). No line or button of its own: ② does not
    count it as something to draw, ⑤ makes it (« 9 ready, all legacy
    accents »), ⑥ follows it (« margins 10 u wider »). Make writes one
    component of the `…comb`, the advance its box plus two equal margins —
    `settings.legacyAccentMargin`, else the left side bearing of `o`, else
    UPM/20 — and no anchor. In the open glyph: « legacy accent of
    [acutecomb ▾] ». The other way round (making the `…comb` from drawn
    spacing accents) is not in this step.
  - New `overwrite.js` and `report.js` (pure). Tests: Node 207 (the sheet, the
    batch and its undo, the report, import and export, legacy accents, ǘ as
    `u` + `dieresiscomb` + `acutecomb` stacked and a manual rule that the
    proposals leave alone), Playwright 4 new scenarios and three more
    screenshots (the fold with a glyph drawn by hand, the sheet, the report).

- Step 5 bis: what a real font showed (an 18-source font, GF Latin
  Vietnamese, the path ①–⑥ walked on it; brief
  `claude/brief-session-umarks-5bis.md`).
  - **§ 0 Recompute no longer breaks the editor.** Make into an existing glyph
    wrote compose.js's bare components (`{name, transformation}`), and Fontra's
    variation model read `Object.keys(compo.location)`: every redraw threw
    until a reload. Everything Make writes is now in Fontra's shape —
    components with `location`, `customData` and a whole transformation,
    sources and layers through Fontra's own classes.
  - **§ 8 The combining accent as soon as it is in the font or the target**:
    `aacute` = `a` + `acutecomb`, « waiting for acutecomb » until it is drawn;
    the spacing accent only when there is no `…comb` anywhere. A suggested
    rule on the spacing accent follows when the comb appears; a manual one
    does not.
  - **§ 3 Soft-dotted i and j**: a mark above sits on the dotless twin (the
    font's own name for U+0131/U+0237, `dotlessi` in a family of 18 sources, else the
    target's, else `idotless` planned); a mark elsewhere stays on `i`/`j`.
    `i` = `idotless` + `dotaccentcomb @ top` (`j` likewise) when both pieces
    are in the font or the target; drawn, `i` is « drawn by hand » and still
    the base `iogonek` sits on. *Place anchors* puts no `top` on a dotted i
    (PropList.txt's Soft_Dotted letters).
  - **§ 2 ② and ① speak of the plug-in only**: ② lists the parts the
    target's rules ask for — bases, accents, the `…comb` of legacy rules — and
    *Create N empty* creates those only; the rest of the target appears
    nowhere. ① reads « 239 glyphs · 153 for U+Marks (132 to compose, 21
    parts) · 81 done ». Appended glyphs (`Ldot` = `L` +
    `periodcentered.loclCAT.case`) stay out of R2a.
  - **§ 1 Other glyphs than the rule's → drawn by hand**: `ecaron` = `e` +
    `caron.alt` under a rule `e` + `caroncomb` goes through the Overwrite
    sheet, not ⑥; the same glyphs placed elsewhere (or reordered) stay an
    offset in ⑥.
  - **§ 5 « Empty » says where and why**: « no drawing in ExtraLight Condensed
    Italic », « sources do not interpolate », « cannot be read in X: … » — in
    ②'s list and the open glyph's block. A part drawn in the default source
    but missing elsewhere is usable: Make composes the sources that work and
    names the one left out (« without Bold Italic (i not drawn there) »).
  - **§ 4 The panel follows the font**: the refresh (rules, classification
    ①–⑥, view) is grouped and deferred by what it costs — at least 200 ms,
    twice the last refresh, at most 2 s —; a change of the glyph map drops the
    index by code point. Measured on a family of 18 sources (18 sources, 239 target glyphs):
    30–45 ms a refresh.
  - **§ 6 ⑥ names the sources and says what is true**: « gravecomb sits 57 u
    above and 69 u left of top of A (Italic) », « in all 18 sources », « in
    Regular, Italic »; Make keeps where the anchors were (layer customData
    `umarks.made`), so « top of A moved 20 u up since the last Make » is said
    when it did. The open glyph puts the choice: *Recompute* or *Leave it*,
    ⑥ going on counting it.
  - **§ 7 « Impossible » condensed**: the true cause (« acute has no _top »,
    not « a has no top, or… »), the sources grouped (« in all 18 sources »),
    one short line, the causes on hover only when there are several.
  - Tests: Node 232 (new `tests/test_empty_sources.mjs`,
    `tests/helpers/fontra-shape.mjs`); Playwright 3 new scenarios and
    updated expectations — to be run on the Mac.
- **Step 6a: rules from the font and from the anchors** (brief
  `claude/brief-session-umarks-6a.md`, 8 Nov.). Where a rule comes from when
  Unicode does not say: the font, and the anchors.
  - **§ 1 A composed glyph of the font says its rule**: a glyph without
    outlines made of a base and marks of the font (an `_x` anchor, or an
    accent by its name — `acute`, a stacked `circumflexacute.cap` — before
    its anchors) reads as `base + mark @ x`, suggested: `Aacute` = `A` +
    `acute.cap` is made and in step, no longer « drawn by hand ». A suggested
    rule written otherwise is replaced by what the font shows; a manual one
    never. On the Vietnamese target of a family of 18 sources, « drawn by hand » went from 35 to
    the 5 glyphs that have outlines.
  - **§ 2 By code point before the name**: wherever a part is looked for, the
    font's glyph for the code point comes first: `idotless` of a glyph set is
    the font's `dotlessi` and counts once; a font that calls its acute
    `uni0301` gets `eacute` = `e` + `uni0301`. Fontra's table also answers
    for production names, `dotlessj` and `uniXXXX`.
  - **§ 3 `init` waits for the font**: the panel's shell is added at once
    (the editor puts back the sidebar left open), what reads the font, the
    ghosts layer and `editorController.umarks` wait for
    `fontController.ensureInitialized`. No more relaunch by hand.
  - **§ 4 The `…` menu is Fontra's**: its menu icon and menu, *Export rules…*
    and *Import rules…*; the import tells our JSON from a file of
    `MakeAccents.py` by what it holds.
  - **§ 5 « Composes … » from the anchors**: after Unicode's, a base offers
    the marks its anchors accept, anchor by anchor, « possible » (never an
    accent a rule of the base already puts there, nor a variant drawn for
    another category). A click writes `base_mark` = `base + mark @ x`,
    manual, into the target, open to be renamed.
  - **§ 6 « Compose these bases with these marks »** in *Edit…*: the bases of
    the target or the font, the marks, the anchors they share, the name
    pattern (`settings.namePattern`, `base_mark` or `{base}`/`{mark}`), the
    count (« 6 rules, 1 already there »), *Add* — manual rules and their
    glyphs in the target, one batch for *Undo last batch*. Nothing is
    proposed from the anchors on its own.
  - Tests: Node 247; Playwright 4 new scenarios (the editor restored without
    a second init, the menu and an import of either kind, a rule from the
    anchors in one click, the matrix 3 × 2 → 6 ready and its undo) — to be
    run on the Mac.
- **Step 6b: finishing touches, the guide, the public export** (brief
  `claude/brief-session-umarks-6b.md`)
  - **§ 0 The panel does not render on its own**: nothing is written to the
    document that it already says (`sameRulesData`, keys in any order, read
    as normalized; `writeRules` checks before it writes), a proposed rule is
    normalized before it is compared, one the document would drop is not
    proposed, and a proposal that comes back unchanged is never written
    twice. A render builds again only the rows whose state changed, never the
    one that holds the focus; the positions of ③ are brought up to date in
    place. The number fields are Fontra's: a text field without arrows of
    its own, ↑/↓ ±1, ⇧ ±10, a key held down keeps counting in the field.
  - **§ 1 *Re-place N* in ④**: Place notes in the layer's customData what it
    put and where (`umarks.placed`). ④ classes each anchor of the target
    against its position: on it; « out of date » (still where Place put it,
    its position worked out elsewhere now); « moved by hand » (elsewhere than
    Place put it, or put without Place). The line reads « 12 anchors out of
    date · 3 moved by hand », each row says it as ⑥ does (« top of e sits
    12 u below its position (Italic) »), and *Re-place N* puts the out of
    date back in one batch — the moved by hand only when ticked; *Undo last
    batch* takes the anchors and the notes back. « Replace existing » is gone
    from Adjust.
  - **§ 2 The guide**: `client/guide/index.html`, one page with Fontra's
    typography and colours, light and dark, no dependency; the text of
    `docs/guide.txt` word for word (a test checks it), built by
    `scripts/build-guide.py`; five captures of the test font, PNG at 2×,
    taken by Playwright (`test_guide_captures`), kept in `client/guide/` and
    written into the page — a Fontra server serves no PNG. A **?** at the end
    of ① opens it in a new tab, the README points to it.
  - **§ 3 The first pass**: under ①, one short message at a time, in the
    order of the work — choose a target; draw the missing parts or *Create N
    empty*; *Place anchors* and what it does; *Make N* and *Undo last batch*
    while no Make has happened in the document. Each goes once its step is
    done, and for good once closed (×); what is closed is the designer's,
    kept by the browser (`localStorage`), not by the document.
  - **§ 4 Finishing touches**: the English of the panel read again (the foot
    says why a rule cannot be placed in words, not codes; « position », not
    « preset »); the icon, ◌ with a +, checked in the sidebar, light and
    dark; the README says what the plug-in does, how to install it (Fontra
    Pak, a Fontra server, Hive), the path ①–⑥, the guide, the anchor
    conventions and the keys; this section dated 0.1.0.
  - **§ 5 The public repository, prepared**: `scripts/export-public.sh`
    copies into a clean folder what `Uplus-Type/fontra-umarks` holds — the
    client at its root, `guide/`, the public part of the README, LICENSE,
    this CHANGELOG — checks that every path is relative and that no private
    name is left; `scripts/serve-cors.py` serves it as jsDelivr will, for a
    try in Settings › Plugins. `docs/upstream-material.md` has every point of
    `docs/notes-for-just.md` in English, and one more (no PNG, no index for
    a plug-in's static files). Nothing pushed, no tag, no remote.

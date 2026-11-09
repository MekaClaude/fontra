// The rules document: what lives in the font's customData under
// `umarks.rules`, and what the JSON export/import carries. Pure, validated,
// never throwing on a font that holds something unexpected — a project edited
// by someone else, or by a later version of the plug-in, must still open.
// See docs/brief.md § 5.
//
// Version 2 (step 4 quater) adds the targets — the glyph sets the designer
// wants to end up with — and spells out where every rule comes from:
//
//   "targets": {"latin-core": {"name", "from", "add", "remove"}},
//   "activeTarget": "latin-core",
//   "rules": {"eacute": {…, "source": "suggested" | "manual"}}
//
// A version 1 document reads as version 2 without losing anything: its rules
// without `source` were Suggest's, so they are `suggested`, and it has no target.

export const RULES_KEY = "umarks.rules";
export const RULES_VERSION = 2;

/** Where a rule comes from (decision B, step 4 quater). */
export const RULE_SOURCES = ["suggested", "manual"];

export const ANCHOR_X_VALUES = [
  "bounds-center",
  "bounds-left",
  "bounds-right",
  "advance-center",
];
export const ANCHOR_Y_VALUES = [
  "baseline",
  "x-height",
  "cap-height",
  "case-height",
  "ascender",
  "descender",
  "bounds-top",
  "bounds-bottom",
];
export const CATEGORIES = ["upper", "lower", "smallcaps"];

/** The presets and settings a project starts with (brief § 5). */
export function defaultRulesData() {
  return {
    version: RULES_VERSION,
    rules: {},
    targets: {},
    activeTarget: null,
    anchors: {
      // `case-height` is the x-height on lowercase and the cap height on
      // capitals and small caps — brief § 4.2, which the § 5 example wrote
      // as `x-height` even though it describes both.
      top: { on: "bases", x: "bounds-center", y: "case-height", dy: 10 },
      "top.cap": {
        on: "bases",
        x: "bounds-center",
        y: "cap-height",
        dy: 10,
        case: "upper",
      },
      bottom: { on: "bases", x: "bounds-center", y: "baseline" },
      ogonek: { on: "bases", x: "bounds-right", y: "baseline" },
      _top: { on: "marks", x: "bounds-center", y: "bounds-bottom" },
      _bottom: { on: "marks", x: "bounds-center", y: "bounds-top" },
      _ogonek: { on: "marks", x: "bounds-center", y: "bounds-top" },
    },
    settings: {
      referenceBase: { _top: "o", "_top.cap": "O", _bottom: "o" },
      markVariants: { upper: ".cap", smallcaps: ".sc" },
      categories: { smallcaps: { baseSuffix: ".sc" } },
      // one setting for the whole document since step 4 ter: every anchor a
      // preset places, or an Adjust checks, follows the source's italic angle
      followItalicAngle: false,
    },
  };
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * One rule, cleaned up. Returns {rule, complaints}; `rule` is null when there
 * is nothing usable left.
 */
export function normalizeRule(glyphName, raw) {
  const complaints = [];
  if (!isObject(raw)) {
    return { rule: null, complaints: [`${glyphName}: not an object`] };
  }
  // a legacy accent (step 5): one component of its `…comb`, no base, no mark
  if (typeof raw.legacy === "string" && raw.legacy) {
    if (raw.legacy === glyphName) {
      return { rule: null, complaints: [`${glyphName}: a spacing accent cannot be made of itself`] };
    }
    const rule = { legacy: raw.legacy };
    if (typeof raw.category === "string" && raw.category) {
      rule.category = raw.category;
    }
    rule.source = raw.source === "manual" ? "manual" : "suggested";
    return { rule, complaints };
  }
  if (typeof raw.base !== "string" || !raw.base) {
    return { rule: null, complaints: [`${glyphName}: no base glyph`] };
  }

  const marks = [];
  for (const mark of Array.isArray(raw.marks) ? raw.marks : []) {
    if (!isObject(mark) || typeof mark.glyph !== "string" || !mark.glyph) {
      complaints.push(`${glyphName}: a mark without a glyph name, dropped`);
      continue;
    }
    const entry = { glyph: mark.glyph, anchor: mark.anchor || "top" };
    if (typeof mark.on === "string" && mark.on) {
      entry.on = mark.on;
    }
    marks.push(entry);
  }

  const rule = { base: raw.base, marks };

  const append = (Array.isArray(raw.append) ? raw.append : []).filter(
    (name) => typeof name === "string" && name
  );
  if (append.length) {
    rule.append = append;
  }
  if (typeof raw.category === "string" && raw.category) {
    rule.category = raw.category;
  }
  // version 2 always says where a rule comes from; anything but `manual` —
  // nothing at all, in a version 1 document — is a suggestion
  rule.source = raw.source === "manual" ? "manual" : "suggested";

  if (!marks.length && !rule.append) {
    complaints.push(`${glyphName}: neither a mark nor an append, dropped`);
    return { rule: null, complaints };
  }
  return { rule, complaints };
}

function stringList(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim())
    ),
  ].map((item) => item.trim());
}

/**
 * Where a target starts from: `{preset: <url of a Fontra preset>}`,
 * `{projectGlyphSet: <key>}`, or null — from scratch. The key of a project
 * glyph set may be the empty string: that is Fontra's « This font's glyphs »
 * (THIS_FONTS_GLYPHSET in glyphsets-controller.js), a real source.
 */
export function normalizeTargetFrom(raw) {
  if (isObject(raw)) {
    if (typeof raw.preset === "string" && raw.preset) {
      return { preset: raw.preset };
    }
    if (typeof raw.projectGlyphSet === "string") {
      return { projectGlyphSet: raw.projectGlyphSet };
    }
  }
  return null;
}

/**
 * One target, cleaned up: {name, from, add, remove}. `add` and `remove` hold
 * glyph names or characters, as typed. Returns {target, complaints}.
 */
export function normalizeTarget(key, raw) {
  if (typeof key !== "string" || !key) {
    return { target: null, complaints: ["a glyph set without a key, dropped"] };
  }
  if (!isObject(raw)) {
    return { target: null, complaints: [`glyph set ${key}: not an object, dropped`] };
  }
  return {
    target: {
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : key,
      from: normalizeTargetFrom(raw.from),
      add: stringList(raw.add),
      remove: stringList(raw.remove),
    },
    complaints: [],
  };
}

function isReference(value) {
  return typeof value === "string" && value.startsWith("reference:") && value.length > 10;
}

/**
 * One anchor preset, cleaned up: `x` and `y` fall back to the centre of the box
 * and the baseline, dx/dy must be numbers, `case` one of the known cases.
 * Returns {preset, complaints}; `preset` is null for a name that cannot be one.
 */
export function normalizeAnchorPreset(anchorName, raw) {
  if (typeof anchorName !== "string" || !anchorName || /\s/.test(anchorName)) {
    return { preset: null, complaints: [`anchor "${anchorName}": not a usable name, dropped`] };
  }
  if (!isObject(raw)) {
    return { preset: null, complaints: [`anchor ${anchorName}: not an object, dropped`] };
  }
  const preset = {
    on: raw.on === "marks" ? "marks" : "bases",
    x:
      ANCHOR_X_VALUES.includes(raw.x) || isReference(raw.x) ? raw.x : "bounds-center",
    y: ANCHOR_Y_VALUES.includes(raw.y) || isReference(raw.y) ? raw.y : "baseline",
  };
  if (typeof raw.dx === "number" && Number.isFinite(raw.dx)) {
    preset.dx = raw.dx;
  }
  if (typeof raw.dy === "number" && Number.isFinite(raw.dy)) {
    preset.dy = raw.dy;
  }
  if (CATEGORIES.includes(raw.case)) {
    preset.case = raw.case;
  }
  // `italic` is no longer a field of a preset: it became the document's
  // `settings.followItalicAngle` (step 4 ter), see normalizeRulesData
  return { preset, complaints: [] };
}

/**
 * A whole document, cleaned up: unknown keys dropped, missing parts filled from
 * the defaults, junk reported instead of thrown.
 */
export function normalizeRulesData(raw) {
  const data = defaultRulesData();
  const complaints = [];

  if (raw !== undefined && !isObject(raw)) {
    return { data, complaints: ["the rules are not an object, starting over"] };
  }
  if (!raw) {
    return { data, complaints };
  }

  if (typeof raw.version === "number" && raw.version > RULES_VERSION) {
    complaints.push(
      `these rules are version ${raw.version}, this plug-in knows ${RULES_VERSION}`
    );
  }

  for (const [glyphName, rawRule] of Object.entries(
    isObject(raw.rules) ? raw.rules : {}
  )) {
    const { rule, complaints: ruleComplaints } = normalizeRule(glyphName, rawRule);
    complaints.push(...ruleComplaints);
    if (rule) {
      data.rules[glyphName] = rule;
    }
  }

  if (isObject(raw.anchors)) {
    // the presets the document carries are *the* presets: a default the
    // designer deleted must stay deleted
    data.anchors = {};
    for (const [anchorName, rawPreset] of Object.entries(raw.anchors)) {
      const { preset, complaints: presetComplaints } = normalizeAnchorPreset(
        anchorName,
        rawPreset
      );
      complaints.push(...presetComplaints);
      if (preset) {
        data.anchors[anchorName] = preset;
      }
    }
  }

  if (isObject(raw.targets)) {
    for (const [key, rawTarget] of Object.entries(raw.targets)) {
      const { target, complaints: targetComplaints } = normalizeTarget(key, rawTarget);
      complaints.push(...targetComplaints);
      if (target) {
        data.targets[key] = target;
      }
    }
  }
  if (typeof raw.activeTarget === "string" && raw.activeTarget in data.targets) {
    data.activeTarget = raw.activeTarget;
  }

  if (isObject(raw.settings)) {
    const settings = raw.settings;
    if (isObject(settings.referenceBase)) {
      data.settings.referenceBase = { ...settings.referenceBase };
    }
    if (isObject(settings.markVariants)) {
      data.settings.markVariants = { ...settings.markVariants };
    }
    if (isObject(settings.categories)) {
      data.settings.categories = { ...settings.categories };
    }
    if (typeof settings.followItalicAngle === "boolean") {
      data.settings.followItalicAngle = settings.followItalicAngle;
    }
    // how a rule written from the anchors is named (6a): `base_mark` when absent
    if (typeof settings.namePattern === "string" && settings.namePattern.trim()) {
      data.settings.namePattern = settings.namePattern.trim();
    }
    // the margin of the legacy accents; absent: the left side bearing of `o`
    if (
      typeof settings.legacyAccentMargin === "number" &&
      Number.isFinite(settings.legacyAccentMargin) &&
      settings.legacyAccentMargin >= 0
    ) {
      data.settings.legacyAccentMargin = settings.legacyAccentMargin;
    }
  }

  // a document from before step 4 ter carries `italic: true` on some presets:
  // the global setting is on when any of them asked for it
  if (
    typeof raw.settings?.followItalicAngle !== "boolean" &&
    isObject(raw.anchors) &&
    Object.values(raw.anchors).some((preset) => isObject(preset) && preset.italic === true)
  ) {
    data.settings.followItalicAngle = true;
  }

  return { data, complaints };
}

/** Read the document out of a font's customData, whatever state it is in. */
/**
 * A JSON text of `value` whose objects have their keys sorted: two values that
 * only differ by the order of their keys give the same text (6b § 0).
 */
export function canonicalJSON(value) {
  return JSON.stringify(value, (key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]]))
      : item
  );
}

/**
 * Whether two rules documents say the same thing once read as the plug-in
 * reads them (normalized): what is about to be written against what the
 * document has, so that nothing is written that is already there (6b § 0).
 */
/**
 * The document as it is written into customData: a copy with no `null` and no
 * `undefined` anywhere (a from-scratch glyph set has no `from`, a document
 * without an active glyph set has no `activeTarget`, and so on). A `.fontra`
 * file would keep a null, but a UFO's lib.plist cannot hold one — fontTools
 * refuses with « unsupported type » and Fontra reverts the edit. Reading
 * puts the nulls back (normalizeRulesData).
 */
export function storable(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map(storable);
  }
  if (isObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && item !== undefined) {
        out[key] = storable(item);
      }
    }
    return out;
  }
  return value;
}

export function sameRulesData(a, b) {
  return canonicalJSON(normalizeRulesData(a).data) === canonicalJSON(normalizeRulesData(b).data);
}

export function readRulesData(customData) {
  return normalizeRulesData(customData?.[RULES_KEY]);
}

export function isManual(rule) {
  return rule?.source === "manual";
}

/**
 * A copy with one rule set. A rule the designer touched is `manual` (brief
 * § 4.5); otherwise the rule keeps the provenance it carries — Make does not
 * change it (decision B): a suggested rule stays suggested once made.
 */
export function withRule(data, glyphName, rule, { manual = false } = {}) {
  const { rule: normalized, complaints } = normalizeRule(glyphName, rule);
  if (!normalized) {
    throw new Error(complaints.join("; ") || `${glyphName}: unusable rule`);
  }
  if (manual) {
    normalized.source = "manual";
  }
  return { ...data, rules: { ...data.rules, [glyphName]: normalized } };
}

/** « Keep »: the designer takes a suggested rule as it is, and it stops following the font. */
export function withRuleKept(data, glyphName) {
  const rule = data.rules[glyphName];
  return rule ? withRule(data, glyphName, rule, { manual: true }) : data;
}

// --- targets

/** A key for a new target, from its name, that the document does not use yet. */
export function newTargetKey(name, targets = {}) {
  const stem =
    String(name || "target")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "target";
  let key = stem;
  for (let index = 2; key in targets; index++) {
    key = `${stem}-${index}`;
  }
  return key;
}

/** A copy with one target set (cleaned up) and, with `activate`, made the active one. */
export function withTarget(data, key, target, { activate = false } = {}) {
  const { target: clean, complaints } = normalizeTarget(key, target);
  if (!clean) {
    throw new Error(complaints.join("; "));
  }
  return {
    ...data,
    targets: { ...data.targets, [key]: clean },
    activeTarget: activate ? key : data.activeTarget,
  };
}

/** Do two sources (`from`) name the same glyph set? From scratch (null) is the same as no source. */
export function sameFrom(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Does the menu have a glyph set from this source already? From scratch never is: there can be several. */
export function glyphSetInMenu(targets, from) {
  return !!from && Object.values(targets || {}).some((target) => sameFrom(target.from, from));
}

/**
 * A copy with glyph sets added to the menu (6c, decision 3): `picks` is
 * [{name, from}], in the order they were listed in. The first one added
 * becomes the active glyph set; one whose source the menu has already is left
 * out. Nothing but `targets` and `activeTarget` changes — no rule, no glyph.
 * Returns {data, added: [{key, name, from}]}.
 */
export function withGlyphSets(data, picks) {
  let next = data;
  const added = [];
  for (const { name, from = null } of picks) {
    if (glyphSetInMenu(next.targets, from)) {
      continue;
    }
    const key = newTargetKey(name, next.targets);
    next = withTarget(next, key, { name, from, add: [], remove: [] }, { activate: !added.length });
    added.push({ key, name, from });
  }
  return { data: next, added };
}

export function withActiveTarget(data, key) {
  return { ...data, activeTarget: key && key in (data.targets || {}) ? key : null };
}

/**
 * A copy without one glyph set of the menu (6c, decision 4): only its entry of
 * `targets` goes — no rule, no glyph. When it was the active one, the next
 * takes over (the one after it in the menu, the one before for the last), and
 * `null` once the menu is empty.
 */
export function withoutTarget(data, key) {
  const keys = Object.keys(data.targets || {});
  const targets = { ...data.targets };
  delete targets[key];
  let active = data.activeTarget;
  if (active === key) {
    const rest = keys.filter((other) => other !== key);
    const index = keys.indexOf(key);
    active = rest[Math.min(index, rest.length - 1)] ?? null;
  }
  return { ...data, targets, activeTarget: active };
}

/** The active target, {key, ...target}, or null. */
export function activeTarget(data) {
  const key = data?.activeTarget;
  return key && data.targets?.[key] ? { key, ...data.targets[key] } : null;
}

/** A copy with some settings changed (`{followItalicAngle: true}`). */
export function withSettings(data, changes) {
  return { ...data, settings: { ...data.settings, ...changes } };
}

/** A copy with the anchor presets replaced (the Anchors tab edits them as a whole). */
export function withAnchors(data, anchors) {
  const { data: clean } = normalizeRulesData({ ...data, anchors });
  return { ...data, anchors: clean.anchors };
}

export function withoutRule(data, glyphName) {
  const rules = { ...data.rules };
  delete rules[glyphName];
  return { ...data, rules };
}

/** The rules whose glyph is in this glyph set, in the glyph set's order. */
export function rulesForGlyphSet(data, glyphNames) {
  const entries = [];
  for (const glyphName of glyphNames) {
    if (data.rules[glyphName]) {
      entries.push([glyphName, data.rules[glyphName]]);
    }
  }
  return entries;
}

/** What `Suggest` is allowed to touch: everything it did not get by hand. */
export function suggestableGlyphNames(data, glyphNames) {
  return glyphNames.filter((glyphName) => !isManual(data.rules[glyphName]));
}

export function exportRulesJSON(data) {
  const { data: clean } = normalizeRulesData(data);
  return JSON.stringify(clean, null, 2) + "\n";
}

export function importRulesJSON(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { data: null, complaints: [`not valid JSON: ${error.message}`] };
  }
  return normalizeRulesData(raw);
}

// --- import and export, from the panel's `…` menu (step 5, brief § 4.8) ------

/** The name of the exported file: `<family>-umarks.json`. */
export function exportFileName(familyName) {
  const stem = String(familyName || "")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "font"}-umarks.json`;
}

/**
 * Bring rules and targets from elsewhere into the document, without taking
 * anything from it: an imported rule never replaces a manual rule of the
 * document (decision B), targets are added — renamed when their key is
 * taken — and the active target stays the document's. Anchor positions the
 * document does not have are added; its own, and its settings, stay.
 *
 * `imported` is a normalized document (or {rules, targets}). Returns
 * {data, taken: [glyph], ignored: [glyph], targets: [{key, name, renamedFrom}],
 *  anchors: [name]}.
 */
export function mergeImported(data, imported) {
  const rules = { ...data.rules };
  const taken = [];
  const ignored = [];
  for (const [glyphName, rule] of Object.entries(imported.rules || {})) {
    if (isManual(rules[glyphName])) {
      ignored.push(glyphName);
      continue;
    }
    rules[glyphName] = rule;
    taken.push(glyphName);
  }

  const targets = { ...data.targets };
  const addedTargets = [];
  for (const [key, target] of Object.entries(imported.targets || {})) {
    const free = key in targets ? newTargetKey(key, targets) : key;
    targets[free] = target;
    addedTargets.push({ key: free, name: target.name, renamedFrom: free === key ? null : key });
  }

  const anchors = { ...data.anchors };
  const addedAnchors = [];
  for (const [name, preset] of Object.entries(imported.anchors || {})) {
    if (!(name in anchors)) {
      anchors[name] = preset;
      addedAnchors.push(name);
    }
  }

  return {
    data: { ...data, rules, targets, anchors, activeTarget: data.activeTarget },
    taken,
    ignored,
    targets: addedTargets,
    anchors: addedAnchors,
  };
}

/**
 * *Import rules…*: a JSON file of this plug-in, merged into `data` as
 * `mergeImported` says. `invalid` counts the rules of the file that could not
 * be read. Returns {ok, data, taken, ignored, invalid, targets, anchors,
 * complaints}; `ok: false` when the file is not JSON at all.
 */
export function importRulesFile(text, data) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, complaints: [`not valid JSON: ${error.message}`] };
  }
  const { data: imported, complaints } = normalizeRulesData(raw);
  const rawRules = isObject(raw?.rules) ? Object.keys(raw.rules) : [];
  const invalid = rawRules.filter((name) => !(name in imported.rules)).length;
  return { ok: true, ...mergeImported(data, imported), invalid, complaints };
}

/**
 * What a file of rules is, read from its content (6a, decision 4): `umarks`
 * — this plug-in's JSON, version 1 or 2 —, `legacy` — a file of
 * `MakeAccents.py`, groups of `{glyph: {bases, accents}}` —, or null.
 * Returns {kind, complaint}.
 */
export function rulesFileKind(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { kind: null, complaint: `not valid JSON: ${error.message}` };
  }
  if (!isObject(raw)) {
    return { kind: null, complaint: "not a file of rules" };
  }
  if (["version", "rules", "targets", "anchors", "settings", "activeTarget"].some((key) => key in raw)) {
    return { kind: "umarks", complaint: null };
  }
  const isDefinition = (value) => isObject(value) && (Array.isArray(value.bases) || Array.isArray(value.accents));
  const isEntry = (item) => isObject(item) && Object.values(item).length > 0 && Object.values(item).every(isDefinition);
  const groups = Object.values(raw);
  if (
    groups.length &&
    groups.every((group) => (Array.isArray(group) ? group.every(isEntry) : isEntry(group))) &&
    groups.some((group) => (Array.isArray(group) ? group.length : true))
  ) {
    return { kind: "legacy", complaint: null };
  }
  return { kind: null, complaint: "not a file of rules this plug-in reads" };
}

/**
 * An import of a file of `MakeAccents.py`: the rules of legacy-import.js (all manual), and
 * each group as a target of its own, added like any other.
 */
export function mergeLegacyImport(data, { rules = {}, groups = {} }) {
  const targets = {};
  for (const [groupName, glyphNames] of Object.entries(groups)) {
    targets[newTargetKey(groupName, { ...data.targets, ...targets })] = {
      name: groupName,
      from: null,
      add: [...glyphNames],
      remove: [],
    };
  }
  const normalized = {};
  for (const [glyphName, rule] of Object.entries(rules)) {
    const { rule: clean } = normalizeRule(glyphName, rule);
    if (clean) {
      normalized[glyphName] = clean;
    }
  }
  return mergeImported(data, { rules: normalized, targets });
}

/** The sentence of an import, for the report. */
export function importSummary(label, result) {
  if (!result.ok && result.ok !== undefined) {
    return `${label}: ${result.complaints.join("; ")}`;
  }
  const parts = [`${result.taken.length} rules taken`];
  if (result.ignored.length) {
    parts.push(`${result.ignored.length} ignored (manual here: ${result.ignored.join(", ")})`);
  }
  if (result.invalid) {
    parts.push(`${result.invalid} invalid`);
  }
  if (result.targets.length) {
    const renamed = result.targets.filter((target) => target.renamedFrom);
    parts.push(
      `${result.targets.length} glyph set${result.targets.length === 1 ? "" : "s"} added` +
        (renamed.length ? ` (${renamed.map((target) => `${target.renamedFrom} → ${target.key}`).join(", ")})` : "")
    );
  }
  if (result.anchors?.length) {
    parts.push(`${result.anchors.length} anchor positions added`);
  }
  return `${label}: ${parts.join(", ")}.`;
}

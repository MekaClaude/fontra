// Persistence + stroke bookkeeping for the Sketch Layer plugin.
//
// Pure data logic: no DOM and no editor imports, so this module is
// unit-tested directly. All values coming out of localStorage are validated
// (guarded JSON.parse, type checks, clamping, size caps) so a corrupted or
// hand-edited storage entry can never produce garbage geometry.

export const STORAGE_KEY_PREFIX = "fontra-sketch-layer.";

// Serialized payload budget per project, and per-glyph/stroke caps. These
// keep the localStorage usage bounded (origin quota is ~5MB).
export const MAX_STORE_BYTES = 1_500_000;
export const MAX_POINTS_PER_STROKE = 4000;
export const MAX_STROKES_PER_GLYPH = 500;

export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 1000;

export const state = {
  // Drawing mode on/off (overlay captures pointer events while on).
  mode: false,
  // Pen settings applied to newly drawn strokes.
  color: "#FF5470",
  width: 24,
  // The current project identifier (set by start.js on registration).
  projectId: null,
  // The stroke being drawn right now:
  // { glyphName, color, width, points: [[x, y], ...] } — or null.
  activeStroke: null,
};

// projectId -> Map(glyphName -> strokes[])
const projects = new Map();

// projectId -> timeout id (debounced persist)
const persistTimers = new Map();

// ---------------------------------------------------------------------
// Project access

export function setProject(projectId) {
  state.projectId = projectId;
  if (!projects.has(projectId)) {
    projects.set(projectId, loadProject(projectId));
  }
}

export function ensureProject(projectId) {
  let glyphs = projects.get(projectId);
  if (!glyphs) {
    glyphs = loadProject(projectId);
    projects.set(projectId, glyphs);
  }
  return glyphs;
}

export function glyphsFor(projectId) {
  return ensureProject(projectId);
}

export function strokesFor(projectId, glyphName) {
  return ensureProject(projectId).get(glyphName) || [];
}

export function strokeCount(projectId, glyphName) {
  return strokesFor(projectId, glyphName).length;
}

// ---------------------------------------------------------------------
// Mutation

export function addStroke(projectId, glyphName, stroke) {
  const glyphs = ensureProject(projectId);
  let strokes = glyphs.get(glyphName);
  if (!strokes) {
    strokes = [];
    glyphs.set(glyphName, strokes);
  }
  while (strokes.length >= MAX_STROKES_PER_GLYPH) {
    strokes.shift(); // drop the oldest stroke
  }
  strokes.push(stroke);
  return stroke;
}

export function clearGlyph(projectId, glyphName) {
  return ensureProject(projectId).delete(glyphName);
}

export function clearProject(projectId) {
  projects.set(projectId, new Map());
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + projectId);
  } catch (error) {
    // Storage unavailable (private mode, quota): keep the in-memory state.
  }
}

// ---------------------------------------------------------------------
// Input helpers

/** Squared euclidean distance between two [x, y] points. */
export function distance([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Drop intermediate points that are closer than `minDist` to the previously
 * kept point. Always keeps the first and last point.
 */
export function decimatePoints(points, minDist) {
  if (points.length <= 2 || !(minDist > 0)) {
    return points.slice();
  }
  const result = [points[0]];
  let last = points[0];
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    if (distance(point, last) >= minDist) {
      result.push(point);
      last = point;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Progressively decimate an over-long stroke in place (doubling the
 * distance threshold until it fits the cap).
 */
export function capStrokePoints(points, minDist) {
  let current = points;
  let threshold = minDist > 0 ? minDist : 1;
  while (current.length > MAX_POINTS_PER_STROKE) {
    current = decimatePoints(current, threshold);
    threshold *= 2;
  }
  return current;
}

// ---------------------------------------------------------------------
// Serialization

export function serializeProject(glyphsMap) {
  const glyphs = {};
  for (const [glyphName, strokes] of glyphsMap) {
    if (strokes.length) {
      glyphs[glyphName] = strokes.map(serializeStroke);
    }
  }
  let json = JSON.stringify({ version: 1, glyphs });
  if (json.length > MAX_STORE_BYTES) {
    // Over budget: drop the heaviest glyphs (by point count) until it fits.
    while (true) {
      const names = Object.keys(glyphs);
      if (!names.length) {
        break;
      }
      let largest = names[0];
      for (const name of names) {
        // `glyphs[name]` is an array of serialized strokes ({c,w,p}), not a
        // stroke, so count points across all of its strokes.
        const pointCount = (strokes) =>
          (strokes || []).reduce((sum, s) => sum + (Array.isArray(s?.p) ? s.p.length : 0), 0);
        if (pointCount(glyphs[name]) > pointCount(glyphs[largest])) {
          largest = name;
        }
      }
      delete glyphs[largest];
      json = JSON.stringify({ version: 1, glyphs });
      if (json.length <= MAX_STORE_BYTES) {
        break;
      }
    }
  }
  return json;
}

function serializeStroke(stroke) {
  const points = [];
  for (const [x, y] of stroke.points) {
    points.push(round2(x), round2(y));
  }
  return { c: stroke.color, w: round2(stroke.width), p: points };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------
// Parsing (all input validated)

export function loadProject(projectId) {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY_PREFIX + projectId);
  } catch (error) {
    return new Map();
  }
  return parseSketches(raw);
}

/**
 * Parse a serialized sketch payload into a Map(glyphName -> strokes[]).
 * Never throws: any malformed input yields an empty (or partial) result.
 */
export function parseSketches(raw) {
  const glyphs = new Map();
  if (!raw || typeof raw !== "string") {
    return glyphs;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return glyphs;
  }
  if (!data || typeof data !== "object" || data.version !== 1) {
    return glyphs;
  }
  const glyphData = data.glyphs;
  if (!glyphData || typeof glyphData !== "object") {
    return glyphs;
  }
  for (const [glyphName, strokeList] of Object.entries(glyphData)) {
    if (!glyphName || !Array.isArray(strokeList)) {
      continue;
    }
    const strokes = [];
    for (const item of strokeList) {
      const stroke = parseStroke(item);
      if (stroke) {
        strokes.push(stroke);
      }
      if (strokes.length >= MAX_STROKES_PER_GLYPH) {
        break;
      }
    }
    if (strokes.length) {
      glyphs.set(String(glyphName).slice(0, 200), strokes);
    }
  }
  return glyphs;
}

function parseStroke(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const color = sanitizeColor(item.c);
  if (!color) {
    return null;
  }
  const width = clampNumber(item.w, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH, 24);
  if (!Array.isArray(item.p) || item.p.length < 2 || item.p.length % 2 !== 0) {
    // An odd-length point list is a truncated/corrupted pair list: reject it
    // instead of silently dropping the tail.
    return null;
  }
  const points = [];
  for (let index = 0; index + 1 < item.p.length; index += 2) {
    const x = item.p[index];
    const y = item.p[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null; // reject the whole stroke on a single bad coordinate
    }
    points.push([x, y]);
    if (points.length >= MAX_POINTS_PER_STROKE) {
      break;
    }
  }
  if (!points.length) {
    return null;
  }
  return { color, width, points };
}

function sanitizeColor(value) {
  if (typeof value !== "string") {
    return null;
  }
  return /^#[0-9a-fA-F]{3,8}$/.test(value) && value.length <= 9 ? value : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

// ---------------------------------------------------------------------
// Persistence

export function schedulePersist(projectId, delay = 400) {
  if (!projectId) {
    return;
  }
  clearTimeout(persistTimers.get(projectId));
  persistTimers.set(
    projectId,
    setTimeout(() => {
      persistTimers.delete(projectId);
      persist(projectId);
    }, delay)
  );
}

/** Write the project's sketches to localStorage. Never throws. */
export function persist(projectId) {
  if (!projectId) {
    return false;
  }
  clearTimeout(persistTimers.get(projectId));
  persistTimers.delete(projectId);
  const json = serializeProject(ensureProject(projectId));
  try {
    if (json === '{"version":1,"glyphs":{}}') {
      localStorage.removeItem(STORAGE_KEY_PREFIX + projectId);
    } else {
      localStorage.setItem(STORAGE_KEY_PREFIX + projectId, json);
    }
    return true;
  } catch (error) {
    console.warn("[Sketch Layer] could not save sketches:", error);
    return false;
  }
}

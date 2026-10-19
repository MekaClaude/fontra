/**
 * brush-stroke.js — input buffering and adaptive preview budgeting.
 *
 * Pure geometry/state for the brush tools. No DOM, no Fontra state, so the
 * commit path stays worker-ready and everything here is unit-testable.
 */

/** Live preview must never stall the drag loop: one frame budget… */
export const PREVIEW_FRAME_BUDGET_MS = 8;
/** …with the sample cap floating inside this window. */
export const PREVIEW_CAP_MIN = 64;
export const PREVIEW_CAP_MAX = 160;
export const PREVIEW_CAP_DEFAULT = 140;

/**
 * StrokeInput — growable typed-array accumulator for raw pointer input.
 *
 * During a drag each event appends four numbers; NO per-point objects are
 * created. Plain point objects materialize only when a consumer needs them
 * (bounded preview sampling, or once at commit via toPoints()).
 */
export class StrokeInput {
  constructor(capacity = 256) {
    this._capacity = capacity;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.pressure = new Float32Array(capacity);
    this.time = new Float64Array(capacity);
    this._length = 0;
    this._pathLength = 0;
  }

  get pointCount() {
    return this._length;
  }

  /** Path length accumulated between KEPT samples (mirrors strokeLength). */
  get pathLength() {
    return this._pathLength;
  }

  clear() {
    this._length = 0;
    this._pathLength = 0;
  }

  _grow() {
    this._capacity *= 2;
    for (const key of ["x", "y", "time"]) {
      const next = new Float64Array(this._capacity);
      next.set(this[key]);
      this[key] = next;
    }
    const p = new Float32Array(this._capacity);
    p.set(this.pressure);
    this.pressure = p;
  }

  addPoint(px, py, pressure, timestamp) {
    if (this._length === this._capacity) this._grow();
    const i = this._length;
    if (i > 0) {
      this._pathLength += Math.hypot(px - this.x[i - 1], py - this.y[i - 1]);
    }
    this.x[i] = px;
    this.y[i] = py;
    this.pressure[i] = pressure;
    this.time[i] = timestamp;
    this._length = i + 1;
  }

  getPoint(i) {
    return {
      x: this.x[i],
      y: this.y[i],
      pressure: this.pressure[i],
      timestamp: this.time[i],
    };
  }

  get firstPoint() {
    return this._length ? this.getPoint(0) : null;
  }

  get lastPoint() {
    return this._length ? this.getPoint(this._length - 1) : null;
  }

  /** Materialize all points (commit only — never called per frame). */
  toPoints() {
    const out = new Array(this._length);
    for (let i = 0; i < this._length; i++) out[i] = this.getPoint(i);
    return out;
  }

  /** Minimum resampling distance that keeps the sample count near `cap`. */
  minDistForCap(cap) {
    if (this._length <= cap) return 0;
    return Math.max(1, this._pathLength / cap);
  }

  /**
   * Distance-based decimation straight from the buffers (first/last kept).
   * Shape-preserving for any stroke length — unlike index-stride decimation
   * it never cuts corners on long curved strokes.
   */
  resampled(minDist) {
    const out = [];
    const n = this._length;
    if (!n) return out;
    out.push(this.getPoint(0));
    const md2 = minDist * minDist;
    let lx = this.x[0];
    let ly = this.y[0];
    for (let i = 1; i < n; i++) {
      const dx = this.x[i] - lx;
      const dy = this.y[i] - ly;
      if (i === n - 1 || dx * dx + dy * dy >= md2) {
        out.push(this.getPoint(i));
        lx = this.x[i];
        ly = this.y[i];
      }
    }
    return out;
  }
}

/**
 * Adapt the preview sample cap from the measured cost of the last frame.
 * Pure function (tested) — the tool owns the mutable cap value.
 *
 * Slow frame (> budget): cut proportionally, floored at PREVIEW_CAP_MIN.
 * Fast frame (< half budget): grow additively, capped at PREVIEW_CAP_MAX.
 * In between: hold (deadband avoids oscillation).
 */
export function adaptPreviewCap(cap, elapsedMs) {
  if (!Number.isFinite(cap)) return PREVIEW_CAP_DEFAULT;
  if (!(elapsedMs >= 0))
    return Math.min(Math.max(Math.round(cap), PREVIEW_CAP_MIN), PREVIEW_CAP_MAX);
  if (elapsedMs > PREVIEW_FRAME_BUDGET_MS) {
    return Math.max(
      PREVIEW_CAP_MIN,
      Math.round((cap * PREVIEW_FRAME_BUDGET_MS) / elapsedMs)
    );
  }
  if (elapsedMs < PREVIEW_FRAME_BUDGET_MS / 2) {
    return Math.min(PREVIEW_CAP_MAX, Math.round(cap) + 16);
  }
  return Math.round(cap);
}

/**
 * SpatialGrid — uniform hash grid for radius queries over point clouds.
 *
 * Built ONCE per sculpt stroke (glyph points are static until commit), so
 * each move event touches only cells overlapping the brush disc instead of
 * scanning every point of every editing layer.
 *
 * forEachInRadius visits every cell intersecting the radius box, hence it
 * stays correct for any radius/cellSize combination (cells beyond the box
 * can never hold an in-radius point; the distance check filters the rest).
 */
export class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = Math.max(1, cellSize);
    this.cells = new Map();
  }

  get cellCount() {
    return this.cells.size;
  }

  insert(id, x, y) {
    const key = SpatialGrid._key(
      Math.floor(x / this.cellSize),
      Math.floor(y / this.cellSize)
    );
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(id);
  }

  /** Invoke callback(id) for every id in cells overlapping the radius box. */
  forEachInRadius(x, y, radius, callback) {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs);
    const y1 = Math.floor((y + radius) / cs);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells.get(SpatialGrid._key(cx, cy));
        if (cell) {
          for (const id of cell) callback(id);
        }
      }
    }
  }

  static _key(cx, cy) {
    // Exact for |cell| ≤ 32767 at any sane cellSize — far beyond glyph space.
    return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
  }
}

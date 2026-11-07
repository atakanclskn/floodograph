import { lerpFrames, type FloodRepository, type GridFrame, type GridFrameRef, type GridMeta } from "@floodograph/core";

const NO_VEC = new Float32Array(0);
/** Decoded frames keep depth only; velocity is not drawn yet and would triple memory. */
const MEMORY_BUDGET_BYTES = 48 * 1024 * 1024;
const MAX_CONCURRENT = 4;

/**
 * Client-side cache of simulation frames: LRU of decoded depth grids, a small priority queue that
 * always fetches what is closest to the playhead first, and dry frames (max depth 0) answered
 * without a request.
 */
export class FrameStore {
  readonly times: number[];
  private readonly dry = new Set<number>();
  private readonly cache = new Map<number, GridFrame>();
  private readonly inflight = new Set<number>();
  private readonly failed = new Set<number>();
  private queue: number[] = [];
  private readonly capacity: number;
  private readonly empty: GridFrame;
  private listeners = new Set<(tMin: number) => void>();
  private disposed = false;

  constructor(
    private readonly repo: FloodRepository,
    private readonly scenarioId: string,
    refs: GridFrameRef[],
    grid: GridMeta,
  ) {
    this.times = refs.map((r) => r.tMin).sort((a, b) => a - b);
    for (const r of refs) if (r.maxDepth != null && r.maxDepth <= 0) this.dry.add(r.tMin);
    const n = grid.nx * grid.ny;
    this.capacity = Math.max(24, Math.floor(MEMORY_BUDGET_BYTES / (n * 4)));
    this.empty = { tMin: 0, nx: grid.nx, ny: grid.ny, depth: new Float32Array(n), u: NO_VEC, v: NO_VEC };
  }

  get size(): number {
    return this.times.length;
  }

  onLoad(fn: (tMin: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The two frames around t and the blend factor between them. */
  bracket(t: number): { a: number; b: number; alpha: number } | null {
    const ts = this.times;
    if (!ts.length) return null;
    if (t <= ts[0]!) return { a: ts[0]!, b: ts[0]!, alpha: 0 };
    const last = ts[ts.length - 1]!;
    if (t >= last) return { a: last, b: last, alpha: 0 };
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (ts[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const a = ts[lo]!;
    const b = ts[hi]!;
    return { a, b, alpha: b === a ? 0 : (t - a) / (b - a) };
  }

  /** Synchronous lookup; undefined when not loaded yet. */
  get(tMin: number): GridFrame | undefined {
    if (this.dry.has(tMin)) return this.empty;
    const f = this.cache.get(tMin);
    if (f) {
      this.cache.delete(tMin); // LRU touch
      this.cache.set(tMin, f);
    }
    return f;
  }

  /** Closest loaded frame at or before t (fallback while the exact one streams in). */
  nearestLoaded(t: number): GridFrame | undefined {
    for (let i = this.times.length - 1; i >= 0; i--) {
      const ti = this.times[i]!;
      if (ti > t) continue;
      const f = this.get(ti);
      if (f) return f;
    }
    return undefined;
  }

  /** Re-prioritise the download queue around t: the bracket first, then `ahead` frames forward, a few back. */
  want(t: number, ahead = 12, behind = 2): void {
    const br = this.bracket(t);
    if (!br) return;
    const i0 = this.times.indexOf(br.a);
    const order: number[] = [];
    for (let k = 0; k <= ahead; k++) order.push(i0 + k);
    for (let k = 1; k <= behind; k++) order.push(i0 - k);
    this.queue = order
      .filter((i) => i >= 0 && i < this.times.length)
      .map((i) => this.times[i]!)
      .filter((tm) => !this.dry.has(tm) && !this.cache.has(tm) && !this.inflight.has(tm) && !this.failed.has(tm));
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.listeners.clear();
    this.cache.clear();
  }

  private pump(): void {
    while (!this.disposed && this.inflight.size < MAX_CONCURRENT && this.queue.length) {
      const tMin = this.queue.shift()!;
      this.inflight.add(tMin);
      this.repo
        .loadGridFrame(this.scenarioId, tMin)
        .then((f) => {
          if (this.disposed) return;
          this.cache.set(tMin, { ...f, u: NO_VEC, v: NO_VEC });
          while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
          for (const fn of this.listeners) fn(tMin);
        })
        .catch(() => {
          this.failed.add(tMin);
        })
        .finally(() => {
          this.inflight.delete(tMin);
          this.pump();
        });
    }
  }
}

/** Depth colour ramp: transparent -> light blue -> deep blue. Indexed on sqrt(depth) for detail in the shallows. */
const LUT_MAX_M = 4;
const STOPS: [depth: number, r: number, g: number, b: number, a: number][] = [
  [0.02, 150, 210, 240, 0],
  [0.06, 168, 222, 247, 0.42],
  [0.15, 122, 198, 236, 0.66],
  [0.5, 62, 145, 200, 0.76],
  [1.5, 31, 94, 152, 0.88],
  [LUT_MAX_M, 14, 52, 96, 0.94],
];

function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const d = (i / 255) ** 2 * LUT_MAX_M;
    let r = 0, g = 0, b = 0, a = 0;
    if (d >= STOPS[0]![0]) {
      let k = 0;
      while (k < STOPS.length - 2 && d > STOPS[k + 1]![0]) k++;
      const s0 = STOPS[k]!;
      const s1 = STOPS[k + 1]!;
      const f = Math.min(1, (d - s0[0]) / (s1[0] - s0[0]));
      r = s0[1] + (s1[1] - s0[1]) * f;
      g = s0[2] + (s1[2] - s0[2]) * f;
      b = s0[3] + (s1[3] - s0[3]) * f;
      a = s0[4] + (s1[4] - s0[4]) * f;
    }
    lut.set([r, g, b, Math.round(a * 255)], i * 4);
  }
  return lut;
}

/** Legend stops for the UI (same ramp as the canvas). */
export const WATER_LEGEND = STOPS.slice(1, 5).map(([d, r, g, b, a]) => ({ depth: d, color: `rgba(${r},${g},${b},${a})` }));

/**
 * Draws a depth grid into a canvas (one pixel per cell, row 0 north) and blends between frames with
 * lerpFrames. The canvas is handed to MapLibre as a canvas source pinned to the grid corners.
 */
export class WaterPainter {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly scratch: GridFrame;
  private readonly lut = buildLut();
  private readonly cellHa: number;

  constructor(private readonly grid: GridMeta) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = grid.nx;
    this.canvas.height = grid.ny;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(grid.nx, grid.ny);
    const n = grid.nx * grid.ny;
    this.scratch = { tMin: 0, nx: grid.nx, ny: grid.ny, depth: new Float32Array(n), u: NO_VEC, v: NO_VEC };
    this.cellHa = (grid.res_m * grid.res_m) / 10_000;
  }

  /** Paint a blend of a and b; returns the flooded area (ha) deeper than wetM. */
  paint(a: GridFrame, b: GridFrame, alpha: number, wetM: number): number {
    const f = alpha <= 0 || a === b ? a : alpha >= 1 ? b : lerpFrames(a, b, alpha, this.scratch);
    const depth = f.depth;
    const px = this.img.data;
    const lut = this.lut;
    let wet = 0;
    for (let i = 0, n = depth.length; i < n; i++) {
      const d = depth[i]!;
      const o = i * 4;
      if (d < 0.02) {
        px[o + 3] = 0;
        continue;
      }
      if (d > wetM) wet++;
      const k = Math.min(255, Math.round(Math.sqrt(d / LUT_MAX_M) * 255)) * 4;
      px[o] = lut[k]!;
      px[o + 1] = lut[k + 1]!;
      px[o + 2] = lut[k + 2]!;
      px[o + 3] = lut[k + 3]!;
    }
    this.ctx.putImageData(this.img, 0, 0);
    return wet * this.cellHa;
  }

  clear(): void {
    this.img.data.fill(0);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

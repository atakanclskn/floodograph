import { decodeFrame, type GridFrame, type GridFrameRef, type GridMeta, type RainPoint } from "@floodograph/core";
import { floodRepository } from "@/lib/repository";

export const SCENARIO_ID = "istanbul-2026-10-14";
export const CITY_ID = "istanbul";

export type BuildingFeature = {
  type: "Feature";
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
  properties: { id: number; h: number; fw: number | null; md: number; tier: string };
};
export type BuildingCollection = { type: "FeatureCollection"; features: BuildingFeature[] };

/** Everything the scene reads, behind one seam: Supabase in production, the pipeline's local output in dev. */
export interface SceneSource {
  kind: "supabase" | "yerel";
  scenarioId: string;
  grid: GridMeta;
  frames: GridFrameRef[];
  loadFrame(tMin: number): Promise<GridFrame>;
  buildings(): Promise<BuildingCollection>;
  rain(): Promise<RainPoint[]>;
}

async function supabaseSource(): Promise<SceneSource | null> {
  const repo = floodRepository();
  const scenarios = await repo.listScenarios(CITY_ID);
  const sc = scenarios.find((s) => s.id === SCENARIO_ID);
  if (!sc?.grid) return null;
  const frames = (await repo.gridFrames(SCENARIO_ID)).slice().sort((a, b) => a.tMin - b.tMin);
  if (!frames.length) return null;
  return {
    kind: "supabase",
    scenarioId: SCENARIO_ID,
    grid: sc.grid,
    frames,
    loadFrame: (t) => repo.loadGridFrame(SCENARIO_ID, t),
    buildings: () => repo.buildings(CITY_ID, SCENARIO_ID) as Promise<BuildingCollection>,
    rain: () => repo.rainSeries(SCENARIO_ID).catch(() => []),
  };
}

async function localSource(): Promise<SceneSource | null> {
  const res = await fetch("/sinema/yerel/meta");
  if (!res.ok) return null;
  const meta = (await res.json()) as { id: string; grid: GridMeta | null; frames: GridFrameRef[] };
  if (!meta.grid || !meta.frames.length) return null;
  return {
    kind: "yerel",
    scenarioId: meta.id,
    grid: meta.grid,
    frames: meta.frames,
    loadFrame: async (t) => {
      const r = await fetch(`/sinema/yerel/kare/${t}`);
      if (!r.ok) throw new Error(`yerel kare ${t}: HTTP ${r.status}`);
      return decodeFrame(new Uint8Array(await r.arrayBuffer()));
    },
    buildings: async () => {
      const r = await fetch("/sinema/yerel/binalar");
      if (!r.ok) throw new Error(`yerel binalar: HTTP ${r.status}`);
      return (await r.json()) as BuildingCollection;
    },
    rain: async () => [],
  };
}

export async function openSource(): Promise<SceneSource> {
  let err: unknown = null;
  try {
    const s = await supabaseSource();
    if (s) return s;
  } catch (e) {
    err = e;
  }
  if (process.env.NODE_ENV === "development") {
    const s = await localSource().catch(() => null);
    if (s) return s;
  }
  if (err) throw err;
  throw new Error("14 Ekim senaryosunun kareleri henüz yüklenmedi.");
}

/* ------------------------------------------------------------------------------------------------ */

/** Texture encoding of a frame cell: R = sqrt(depth / D_MAX), G/B = 0.5 + u,v / (2 V_MAX). Linear-filterable RGBA8. */
export const D_MAX = 16;
export const V_MAX = 6;
const WET_EPS = 0.004;

export type FrameStats = { maxDepth: number; wetHa: number; meanSpeed: number };

/** A frame kept sparse (only wet cells), so all 361 frames fit in a few MB. */
type SparseFrame = { idx: Uint32Array; rgb: Uint8Array; stats: FrameStats };

function encode(f: GridFrame, resM: number): SparseFrame {
  const n = f.depth.length;
  let count = 0;
  for (let i = 0; i < n; i++) if (f.depth[i]! > WET_EPS) count++;
  const idx = new Uint32Array(count);
  const rgb = new Uint8Array(count * 3);
  let k = 0,
    maxDepth = 0,
    wet = 0,
    sp = 0;
  for (let i = 0; i < n; i++) {
    const d = f.depth[i]!;
    if (d <= WET_EPS) continue;
    const u = f.u[i]!;
    const v = f.v[i]!;
    idx[k] = i;
    rgb[k * 3] = Math.round(Math.sqrt(Math.min(d, D_MAX) / D_MAX) * 255);
    rgb[k * 3 + 1] = Math.round(Math.min(Math.max(0.5 + u / (2 * V_MAX), 0), 1) * 255);
    rgb[k * 3 + 2] = Math.round(Math.min(Math.max(0.5 + v / (2 * V_MAX), 0), 1) * 255);
    if (d > maxDepth) maxDepth = d;
    if (d > 0.05) {
      wet++;
      sp += Math.hypot(u, v);
    }
    k++;
  }
  return { idx, rgb, stats: { maxDepth, wetHa: (wet * resM * resM) / 1e4, meanSpeed: wet ? sp / wet : 0 } };
}

export const decodeDepth = (r: number) => (r / 255) ** 2 * D_MAX;
export const decodeVel = (g: number) => (g / 255 - 0.5) * 2 * V_MAX;

/**
 * Loads every frame in the background (closest to the playhead first), keeps them sparse,
 * and expands any one into a dense RGBA8 buffer on demand for the GPU.
 */
export class FrameStore {
  readonly times: number[];
  private readonly frames: (SparseFrame | null)[];
  private loading = new Set<number>();
  private focus = 0;
  private disposed = false;
  loaded = 0;
  onProgress: ((loaded: number, total: number) => void) | null = null;
  onFrame: ((index: number) => void) | null = null;

  constructor(
    private readonly src: SceneSource,
    private readonly concurrency = 6,
  ) {
    this.times = src.frames.map((f) => f.tMin);
    this.frames = this.times.map(() => null);
  }

  get count() {
    return this.times.length;
  }
  get cells() {
    return this.src.grid.nx * this.src.grid.ny;
  }

  has(i: number) {
    return !!this.frames[i];
  }
  stats(i: number): FrameStats | null {
    return this.frames[i]?.stats ?? null;
  }

  /** Index of the last frame at or before t (clamped) and the blend factor to the next one. */
  locate(t: number): [number, number, number] {
    const ts = this.times;
    if (t <= ts[0]!) return [0, 0, 0];
    const last = ts.length - 1;
    if (t >= ts[last]!) return [last, last, 0];
    let lo = 0,
      hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid]! <= t) lo = mid;
      else hi = mid;
    }
    return [lo, hi, (t - ts[lo]!) / (ts[hi]! - ts[lo]!)];
  }

  /** Nearest loaded frame index to i (so playback degrades gracefully while loading). */
  nearestLoaded(i: number): number {
    for (let d = 0; d < this.frames.length; d++) {
      if (this.frames[i - d]) return i - d;
      if (this.frames[i + d]) return i + d;
    }
    return -1;
  }

  setFocus(t: number) {
    this.focus = this.locate(t)[0];
    this.pump();
  }

  start() {
    this.pump();
  }

  private next(): number {
    const n = this.frames.length;
    for (let d = 0; d < n; d++) {
      for (const i of [this.focus + d, this.focus - d]) {
        if (i >= 0 && i < n && !this.frames[i] && !this.loading.has(i)) return i;
      }
    }
    return -1;
  }

  private pump() {
    while (!this.disposed && this.loading.size < this.concurrency) {
      const i = this.next();
      if (i < 0) return;
      this.loading.add(i);
      this.fetch(i, 0);
    }
  }

  private fetch(i: number, attempt: number) {
    this.src
      .loadFrame(this.times[i]!)
      .then((f) => {
        if (this.disposed) return;
        this.frames[i] = encode(f, this.src.grid.res_m);
        this.loaded++;
        this.loading.delete(i);
        this.onFrame?.(i);
        this.onProgress?.(this.loaded, this.frames.length);
        this.pump();
      })
      .catch(() => {
        if (this.disposed) return;
        if (attempt < 3) setTimeout(() => this.fetch(i, attempt + 1), 600 * (attempt + 1));
        else {
          this.loading.delete(i);
          this.pump();
        }
      });
  }

  /** Writes frame i into a dense RGBA8 buffer (dry cells: depth 0, velocity 0). Returns false if not loaded. */
  expand(i: number, out: Uint8Array): boolean {
    const f = this.frames[i];
    if (!f) return false;
    for (let c = 0; c < out.length; c += 4) {
      out[c] = 0;
      out[c + 1] = 128;
      out[c + 2] = 128;
      out[c + 3] = 255;
    }
    const { idx, rgb } = f;
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k]! * 4;
      out[o] = rgb[k * 3]!;
      out[o + 1] = rgb[k * 3 + 1]!;
      out[o + 2] = rgb[k * 3 + 2]!;
    }
    return true;
  }

  /** Per-cell maximum depth over all loaded frames (m). */
  maxDepthField(): Float32Array {
    const out = new Float32Array(this.cells);
    for (const f of this.frames) {
      if (!f) continue;
      for (let k = 0; k < f.idx.length; k++) {
        const d = decodeDepth(f.rgb[k * 3]!);
        const c = f.idx[k]!;
        if (d > out[c]!) out[c] = d;
      }
    }
    return out;
  }

  dispose() {
    this.disposed = true;
  }
}

import type { ExpressionSpecification, Map as MlMap } from "maplibre-gl";
import type { GridMeta } from "@floodograph/core";
import { OVERTURE_LAYER, OVERTURE_SOURCE } from "./overture-buildings";

/**
 * A city centre analysed building by building (pipeline output, `public/merkez/<id>.json`): every building with the
 * deepest water next to its walls at each simulated rain total, and the rain total at which the water first reaches
 * it. Everything the map shows follows from one number, the rain (mm) on the slider.
 */
export type Bbox = readonly [west: number, south: number, east: number, north: number];

type Geometry = { type: string; coordinates: unknown };
type RawProps = { id: number; h?: number | null; crit?: string | null; d?: number[] | null; wet?: number | null };
type RawFeature = { type: "Feature"; geometry: Geometry; properties: RawProps };

export type CentreFile = {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  levels: number[];
  scenario: string;
  grid: GridMeta;
  buildings: { type: "FeatureCollection"; features: RawFeature[] };
};

/** Flat properties for the map (MapLibre expressions read numbers far more reliably than nested arrays). */
export type MapProps = {
  id: number;
  h: number;
  crit: string | null;
  /** rain (mm) at which the water reaches the building / it turns yellow / it turns orange; NEVER = not up to the top level */
  wm: number;
  ym: number;
  om: number;
} & Record<`d${number}`, number>;

export type Centre = {
  id: string;
  name: string;
  bbox: Bbox;
  levels: number[];
  scenario: string;
  grid: GridMeta;
  fc: { type: "FeatureCollection"; features: { type: "Feature"; geometry: Geometry; properties: MapProps }[] };
  /** ascending thresholds, for counting at any rain total */
  wmSorted: Float64Array;
  ymSorted: Float64Array;
  omSorted: Float64Array;
  /** critical facilities (hospital, school, ...) only */
  critSorted: Float64Array;
  /** buildings the water reaches at some level (named-place labels, priority list); i = index in fc.features */
  wet: { geometry: Geometry; id: number; crit: string | null; wm: number; d: number[]; cx: number; cy: number; i: number }[];
};

export const NEVER = 1e9;
/** Water at the walls: "reached" from 0.15 m, high priority (yellow) from 0.5 m, urgent (orange) from 1.5 m. */
export const WET_M = 0.15;
export const HIGH_M = 0.5;
export const URGENT_M = 1.5;

export const DRY = "#2c363b";
export const ORANGE = "#ff5a2b";
export const YELLOW = "#ffc23a";
/** Lit buildings stand LIFT m higher than the rest (nested OSM footprints z-fight otherwise), as on the pilot. */
const LIFT = 1.5;

export const CRIT_LABEL: Record<string, string> = { hastane: "Hastane", okul: "Okul", itfaiye: "İtfaiye", bakimevi: "Bakımevi" };

/** Depth (m) at `mm` of rain: linear between the simulated levels, 0 m at 0 mm, flat past the last level. */
export function depthAt(d: readonly number[], levels: readonly number[], mm: number): number {
  if (mm <= 0 || !levels.length) return 0;
  let pm = 0;
  let pd = 0;
  for (let i = 0; i < levels.length; i++) {
    const lm = levels[i]!;
    const ld = d[i] ?? 0;
    if (mm <= lm) return lm === pm ? ld : pd + ((ld - pd) * (mm - pm)) / (lm - pm);
    pm = lm;
    pd = ld;
  }
  return pd;
}

/** First rain total (mm) at which the depth reaches x m, interpolated; NEVER if it never does. */
function firstCrossing(d: readonly number[], levels: readonly number[], x: number): number {
  let pm = 0;
  let pd = 0;
  for (let i = 0; i < levels.length; i++) {
    const lm = levels[i]!;
    const ld = d[i] ?? 0;
    if (ld >= x) return ld === pd ? lm : pm + ((x - pd) * (lm - pm)) / (ld - pd);
    pm = lm;
    pd = ld;
  }
  return NEVER;
}

/** Mean vertex of the (first) outer ring: a building's spot on the map. */
function centreOf(g: Geometry): [number, number] {
  const ring = (g.type === "Polygon" ? (g.coordinates as number[][][])[0] : g.type === "MultiPolygon" ? (g.coordinates as number[][][][])[0]?.[0] : undefined) ?? [];
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0]!;
    y += p[1]!;
  }
  return ring.length ? [x / ring.length, y / ring.length] : [0, 0];
}

export function prepareCentre(file: CentreFile): Centre {
  const levels = file.levels;
  const features: Centre["fc"]["features"] = [];
  const wet: Centre["wet"] = [];
  const wms: number[] = [];
  const yms: number[] = [];
  const oms: number[] = [];
  const crits: number[] = [];
  for (const f of file.buildings.features) {
    const p = f.properties;
    if (!f.geometry || p?.id == null) continue;
    const d = levels.map((_, i) => Math.max(0, Number(p.d?.[i] ?? 0) || 0));
    const crit = p.crit ?? null;
    const wm = p.wet === undefined ? firstCrossing(d, levels, WET_M) : p.wet == null ? NEVER : p.wet;
    // yellow: 0.5 m at the walls, or any water at a critical facility; orange: 1.5 m. Never before "reached".
    const ym = Math.max(wm, Math.min(firstCrossing(d, levels, HIGH_M), crit && wm < NEVER ? wm : NEVER));
    const om = Math.max(ym, firstCrossing(d, levels, URGENT_M));
    const props = { id: p.id, h: Number(p.h) > 0 ? Number(p.h) : 9, crit, wm, ym, om } as MapProps;
    d.forEach((v, i) => (props[`d${i}`] = Math.round(v * 100) / 100));
    features.push({ type: "Feature", geometry: f.geometry, properties: props });
    if (wm < NEVER) {
      wms.push(wm);
      const [cx, cy] = centreOf(f.geometry);
      wet.push({ geometry: f.geometry, id: p.id, crit, wm, d, cx, cy, i: features.length - 1 });
      if (crit) crits.push(wm);
    }
    if (ym < NEVER) yms.push(ym);
    if (om < NEVER) oms.push(om);
  }
  const sorted = (a: number[]) => Float64Array.from(a).sort();
  return {
    id: file.id,
    name: file.name,
    bbox: file.bbox,
    levels,
    scenario: file.scenario,
    grid: file.grid,
    fc: { type: "FeatureCollection", features },
    wmSorted: sorted(wms),
    ymSorted: sorted(yms),
    omSorted: sorted(oms),
    critSorted: sorted(crits),
    wet,
  };
}

/** The per-level depths of a building back from its map properties. */
export function depthsOf(p: Record<string, unknown>, levels: readonly number[]): number[] {
  return levels.map((_, i) => Number(p[`d${i}`] ?? 0) || 0);
}

// ---- paint expressions: all driven by the rain total `mm` (a literal), thresholds precomputed per building ----

const num = (key: string, fallback: number): ExpressionSpecification => ["to-number", ["get", key], fallback];
const WM = num("wm", NEVER);
const YM = num("ym", NEVER);
const OM = num("om", NEVER);
const BASE_H = num("h", 9);
const ID: ExpressionSpecification = ["to-number", ["get", "id"], -1];

/** Depth (m) at `mm` as an expression over the building's per-level depths d0..dn. */
function depthExpr(levels: readonly number[], mm: number): ExpressionSpecification {
  const d = (i: number) => num(`d${i}`, 0);
  if (mm <= 0 || !levels.length) return ["+", 0, 0];
  let pm = 0;
  for (let i = 0; i < levels.length; i++) {
    const lm = levels[i]!;
    if (mm <= lm) {
      const a = lm === pm ? 1 : (mm - pm) / (lm - pm);
      return i === 0 ? ["*", d(0), a] : ["+", ["*", d(i - 1), 1 - a], ["*", d(i), a]];
    }
    pm = lm;
  }
  return d(levels.length - 1);
}

/** Dry dark, shallow water blue (lighter = shallower), yellow from 0.5 m, orange from 1.5 m; the selection white. */
export function buildingColor(levels: readonly number[], mm: number, sel: number | null): ExpressionSpecification {
  return [
    "case",
    ["==", ID, sel ?? -1],
    "#ffffff",
    ["<=", OM, mm],
    ORANGE,
    ["<=", YM, mm],
    YELLOW,
    ["<=", WM, mm],
    ["interpolate", ["linear"], depthExpr(levels, mm), WET_M, "#9ad6f2", HIGH_M, "#4ea3d8"],
    DRY,
  ];
}

export const buildingHeight = (mm: number): ExpressionSpecification => ["+", BASE_H, ["case", ["<=", YM, mm], LIFT, 0]];
export const LIT_HEIGHT: ExpressionSpecification = ["+", BASE_H, LIFT];
export const litColor = (mm: number): ExpressionSpecification => ["case", ["<=", OM, mm], ORANGE, YELLOW];

/** A slider move up: the buildings lit between `lo` (exclusive) and `hi` mm blink from t0 for a moment. */
export type Blink = { lo: number; hi: number; t0: number };

export const NONE: ExpressionSpecification = ["==", ID, -2];

/** Lit at `mm`, inside one of the blink windows, and not the selected building (that one stays white). */
export function blinkFilter(blinks: readonly Blink[], mm: number, sel: number | null): ExpressionSpecification {
  if (!blinks.length) return NONE;
  return [
    "all",
    ["<=", YM, mm],
    ["!=", ID, sel ?? -1],
    ["any", ...blinks.map((b): ExpressionSpecification => ["all", [">", YM, b.lo], ["<=", YM, b.hi]])],
  ];
}

// ---- the analysed area on the map ----

/** lon/lat of a fractional grid position, from the grid's corner quad (NW, NE, SE, SW). */
function gridToLngLat(grid: GridMeta, s: number, t: number): [number, number] {
  const [nw, ne, se, sw] = grid.corners_lonlat;
  const top = [nw[0] + (ne[0] - nw[0]) * s, nw[1] + (ne[1] - nw[1]) * s];
  const bot = [sw[0] + (se[0] - sw[0]) * s, sw[1] + (se[1] - sw[1]) * s];
  return [top[0]! + (bot[0]! - top[0]!) * t, top[1]! + (bot[1]! - top[1]!) * t];
}

/** 1 for the grid cells whose centre lies inside the bbox (the flooded area counts only those). */
export function cellsInside(grid: GridMeta, b: Bbox): Uint8Array {
  const { nx, ny } = grid;
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [x, y] = gridToLngLat(grid, (i + 0.5) / nx, (j + 0.5) / ny);
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) out[j * nx + i] = 1;
    }
  return out;
}

/** bbox grown by m metres on every side. */
export function grow(b: Bbox, m: number): Bbox {
  const dLat = m / 111_320;
  const dLon = m / (111_320 * Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export function intersects(a: Bbox, b: Bbox) {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
}

export function extentOf(coords: unknown): Bbox {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as [number, number];
      if (x < box[0]!) box[0] = x;
      if (y < box[1]!) box[1] = y;
      if (x > box[2]!) box[2] = x;
      if (y > box[3]!) box[3] = y;
    } else for (const k of c as unknown[]) walk(k);
  };
  walk(coords);
  return box as unknown as Bbox;
}

/**
 * The basemap's Overture extrusions (shown between zoom 13 and 14, before the lit-window layer takes over) inside the
 * analysed area are ours to draw. Overture's tile ids are not OSM ids and MapLibre's `within` does not take polygons,
 * so the copies whose centre falls in the bbox are flattened through feature-state (`hide`, read by the
 * basemap-buildings height in cityStyle) as their tiles arrive.
 */
export class BasemapHole {
  private bbox: Bbox | null = null;
  private seen = new Set<string | number>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly map: MlMap) {
    map.on("moveend", this.schedule);
    map.on("sourcedata", this.onSource);
  }

  setBbox(b: Bbox | null) {
    this.bbox = b;
    this.seen.clear();
    if (this.map.getSource(OVERTURE_SOURCE)) this.map.removeFeatureState({ source: OVERTURE_SOURCE, sourceLayer: OVERTURE_LAYER });
    this.schedule();
  }

  dispose() {
    clearTimeout(this.timer);
    this.map.off("moveend", this.schedule);
    this.map.off("sourcedata", this.onSource);
  }

  private onSource = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId === OVERTURE_SOURCE && e.tile) this.schedule();
  };

  private schedule = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 200);
  };

  private run() {
    const map = this.map;
    const b = this.bbox;
    // the basemap extrusions are faded out from zoom 14 (the lit-window layer draws then)
    if (!b || !map.getSource(OVERTURE_SOURCE) || map.getZoom() > 14.2) return;
    for (const f of map.querySourceFeatures(OVERTURE_SOURCE, { sourceLayer: OVERTURE_LAYER })) {
      const id = f.id;
      if (id == null || this.seen.has(id)) continue;
      this.seen.add(id);
      const g = f.geometry;
      const ring = (g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0]?.[0] : undefined) as
        | number[][]
        | undefined;
      if (!ring?.length) continue;
      let x = 0;
      let y = 0;
      for (const p of ring) {
        x += p[0]!;
        y += p[1]!;
      }
      x /= ring.length;
      y /= ring.length;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
        map.setFeatureState({ source: OVERTURE_SOURCE, sourceLayer: OVERTURE_LAYER, id }, { hide: true });
    }
  }
}

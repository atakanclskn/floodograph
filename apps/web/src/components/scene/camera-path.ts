import type { LngLat } from "./geo";

export type Shot = { center: LngLat; zoom: number; pitch: number; bearing: number };
export type Key = Shot & {
  /** seconds from the start of the tour */
  at: number;
  /** simulation minute shown at this key */
  t: number;
  /** chapter caption that starts at this key */
  chapter?: string;
};

/** Ayazağa Deresi corridor (pilot AOI moved north-west); the meydan sits just south-west of it. */
export const AYAZAGA: LngLat = [29.005, 41.1205];
export const AYAZAGA_MEYDAN: LngLat = [28.9986, 41.1157];

export type TourPlan = { keys: Key[]; duration: number; chapters: { at: number; title: string; sub: string }[] };

/**
 * Overview -> Ayazağa corridor -> the overflow moment (deepest water), with simulation time driven alongside.
 * tStart: a little before water appears; tPeak: frame with the deepest water; peakAt: where it is.
 */
export function buildTour(opts: { center: LngLat; tStart: number; tPeak: number; peakAt: LngLat; narrow: boolean }): TourPlan {
  const { center, tStart, tPeak, peakAt, narrow } = opts;
  const dz = narrow ? -0.7 : 0;
  const tMid = tStart + (tPeak - tStart) * 0.55;
  const keys: Key[] = [
    { at: 0, t: tStart, center, zoom: 12.9 + dz, pitch: 48, bearing: -32 },
    { at: 7, t: tStart + (tMid - tStart) * 0.45, center, zoom: 13.5 + dz, pitch: 58, bearing: -12 },
    { at: 12, t: tMid, center: AYAZAGA_MEYDAN, zoom: 15.4 + dz, pitch: 66, bearing: 18 },
    { at: 20, t: tMid + (tPeak - tMid) * 0.55, center: AYAZAGA, zoom: 16.3 + dz, pitch: 72, bearing: 46 },
    { at: 26, t: tPeak - 10, center: peakAt, zoom: 16.9 + dz, pitch: 74, bearing: 78 },
    { at: 34, t: tPeak, center: peakAt, zoom: 17.4 + dz, pitch: 76, bearing: 118 },
    { at: 40, t: tPeak + 15, center: peakAt, zoom: 17.2 + dz, pitch: 72, bearing: 142 },
  ];
  return {
    keys,
    duration: keys[keys.length - 1]!.at,
    chapters: [
      { at: 0, title: "Genel görünüş", sub: "Sarıyer–Ayazağa havzası, 14 Ekim akşamı" },
      { at: 10, title: "Ayazağa koridoru", sub: "Gömülü derenin eski yatağı yeniden su taşıyor" },
      { at: 24, title: "Taşma anı", sub: "Modelde suyun en derin olduğu an ve yer" },
    ],
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Catmull-Rom on centre / zoom / pitch / bearing, eased per segment; returns the shot and sim minute at time s. */
export function sampleTour(plan: TourPlan, s: number): Shot & { t: number } {
  const ks = plan.keys;
  if (s <= 0) return ks[0]!;
  if (s >= plan.duration) return ks[ks.length - 1]!;
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1]!.at <= s) i++;
  const k1 = ks[i]!;
  const k2 = ks[i + 1]!;
  const k0 = ks[Math.max(0, i - 1)]!;
  const k3 = ks[Math.min(ks.length - 1, i + 2)]!;
  const u = (s - k1.at) / (k2.at - k1.at);
  const cr = (a: number, b: number, c: number, d: number, x: number) =>
    0.5 * (2 * b + (-a + c) * x + (2 * a - 5 * b + 4 * c - d) * x * x + (-a + 3 * b - 3 * c + d) * x * x * x);
  const e = smooth(u);
  return {
    center: [cr(k0.center[0], k1.center[0], k2.center[0], k3.center[0], e), cr(k0.center[1], k1.center[1], k2.center[1], k3.center[1], e)],
    zoom: cr(k0.zoom, k1.zoom, k2.zoom, k3.zoom, e),
    pitch: cr(k0.pitch, k1.pitch, k2.pitch, k3.pitch, e),
    bearing: cr(k0.bearing, k1.bearing, k2.bearing, k3.bearing, u),
    t: lerp(k1.t, k2.t, u),
  };
}

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

export type TourPlan = { keys: Key[]; duration: number; chapters: { at: number; title: string; sub: string }[] };

/**
 * Flood spots reported on 14 Oct 2026 in Ayazağa (pipeline/floodograph/pipeline/calibrate.py TARGETS), in route order:
 * north to south along the buried stream, then west along Kemerburgaz Cd. Atatürk Cd. is left out (it sits between
 * Dereboyu and the meydan, the camera flies over it); Hacıosman and Haydar Aliyev stay dry in the model.
 */
export const FLOOD_SPOTS: { title: string; report: string; at: LngLat }[] = [
  { title: "201. Sokak", report: "6–7 ev su altında kaldı, sakinler tahliye edildi", at: [28.9969505, 41.1196274] },
  {
    title: "Dereboyu Caddesi",
    report: "Bir mağazada su 1,70 m'ye çıktı, sokakta bel hizasını aştı (~18.00)",
    at: [28.9967181, 41.118341],
  },
  {
    title: "Ayazağa Meydanı",
    report: "Bir restoranda su 1,5–2 m'ye ulaştı, arabaların tavanını aştı (~20.00)",
    at: [28.9987033, 41.1153614],
  },
  { title: "Cendere Caddesi", report: "Yaklaşık 300 araç mahsur kaldı, bir araç 1 km sürüklendi", at: [28.996524, 41.110882] },
  { title: "Cendere Yolu", report: "Yollar yaklaşık 2 m su altında kaldı (22.49)", at: [28.988803, 41.1092353] },
  {
    title: "Kemerburgaz Caddesi",
    report: "İş yerlerinde ~200 kişi mahsur kaldı, botla ve kepçeyle kurtarıldı",
    at: [28.9828745, 41.1124239],
  },
];

export type TourStop = {
  at: LngLat;
  title: string;
  sub: string;
  /** sim minute the street water there first gets deep (Infinity if never) */
  arrive: number;
};

const M_PER_DEG_LAT = 110_950;
/** east / north metres from a to b */
function offsetM(a: LngLat, b: LngLat): [number, number] {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return [(b[0] - a[0]) * M_PER_DEG_LAT * k, (b[1] - a[1]) * M_PER_DEG_LAT];
}
/** compass heading (deg) of the move a -> b */
function heading(a: LngLat, b: LngLat) {
  const [dx, dy] = offsetM(a, b);
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/**
 * Establishing shot over the town -> each reported flood spot in turn (fly in, short dwell with a slow orbit)
 * -> pull back over the whole route. Simulation time runs alongside: onset at the first stops, the town's peak
 * about two thirds in, the aftermath at the end; a stop is never left before its water has arrived.
 */
export function buildTour(opts: {
  center: LngLat;
  stops: TourStop[];
  tStart: number;
  tPeak: number;
  tEnd: number;
  narrow: boolean;
  /** prefers-reduced-motion: no orbiting, gentler moves */
  calm?: boolean;
}): TourPlan {
  const { stops, narrow, calm } = opts;
  const tStart = opts.tStart;
  const tEnd = Math.max(opts.tEnd, tStart + 1);
  const tPeak = clamp(opts.tPeak, tStart, tEnd);
  const dz = narrow ? -0.6 : 0;
  const orbit = calm ? 4 : 20;
  const dwell = 5;
  const travel = (a: LngLat, b: LngLat) => clamp(2.4 + Math.hypot(...offsetM(a, b)) / 250, 2.8, 5.5);

  const pts = stops.length ? stops.map((s) => s.at) : [opts.center];
  const mid: LngLat = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

  // sim time along the story: x in [0, 1] -> onset .. peak (at x = PHI) .. aftermath
  const PHI = 0.65;
  const story = (x: number) => (x <= PHI ? tStart + (tPeak - tStart) * (x / PHI) : tPeak + (tEnd - tPeak) * ((x - PHI) / (1 - PHI)));
  const nKeys = stops.length * 2;
  const ts: number[] = [];
  for (let j = 0; j < nKeys; j++) {
    let t = story((j + 1) / (nKeys + 1));
    const s = stops[j >> 1]!;
    // leaving a stop: its water must be there by then
    if (j % 2 === 1 && Number.isFinite(s.arrive)) t = Math.max(t, Math.min(s.arrive + 10, tEnd));
    ts.push(Math.min(Math.max(t, ts[j - 1] ?? tStart), tEnd));
  }

  let bearing = -20;
  const keys: Key[] = [{ at: 0, t: tStart, center: mid, zoom: 14.6 + dz, pitch: 50, bearing }];
  const chapters: TourPlan["chapters"] = [
    { at: 0, title: "Ayazağa, 14 Ekim akşamı", sub: "Selin vurduğu yerleri sırayla geziyoruz" },
  ];
  bearing += calm ? 2 : 10;
  let at = 3;
  keys.push({ at, t: tStart + ((ts[0] ?? tEnd) - tStart) * 0.35, center: mid, zoom: 14.9 + dz, pitch: 54, bearing });

  let from = mid;
  stops.forEach((s, k) => {
    // face the direction of travel (within reason), then orbit slowly while the water rises
    bearing += clamp(wrap180(heading(from, s.at) - bearing), -70, 70);
    at += travel(from, s.at);
    chapters.push({ at: Math.max(at - 1.2, chapters[chapters.length - 1]!.at + 1), title: s.title, sub: s.sub });
    keys.push({ at, t: ts[2 * k]!, center: s.at, zoom: 16.0 + dz, pitch: 58, bearing });
    bearing += orbit;
    at += dwell;
    keys.push({ at, t: ts[2 * k + 1]!, center: s.at, zoom: 16.35 + dz, pitch: 62, bearing });
    from = s.at;
  });

  // pull back over the whole route for the aftermath
  if (stops.length) {
    chapters.push({
      at: at + 0.5,
      title: "Selin ardından",
      sub: `Haberlere yansıyan bu ${stops.length} noktanın hepsini model de su altında gösteriyor`,
    });
    bearing += calm ? 2 : 12;
    at += 4.5;
    keys.push({ at, t: tEnd, center: mid, zoom: 15.0 + dz, pitch: 56, bearing });
  } else {
    at += 30;
    keys.push({ at, t: tEnd, center: mid, zoom: 15.4 + dz, pitch: 60, bearing: bearing + orbit * 3 });
  }
  return { keys, duration: at, chapters };
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

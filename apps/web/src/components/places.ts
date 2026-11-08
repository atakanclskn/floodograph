import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MlMap } from "maplibre-gl";

/**
 * Names over the places that matter in a flood: hospitals, universities, stadiums, schools, town halls, fire
 * stations, big malls. From the basemap's POI layer (OpenFreeMap / OpenMapTiles `poi`), so they work in every
 * city. On the pilot, places whose building the water reaches get a second, orange label with depth and time.
 */
const MAJOR = ["hospital", "college", "stadium", "town_hall"];
const MINOR = ["school", "fire_station", "police", "museum", "castle"];
/** mosques and churches: many, so only close up */
const LOCAL = ["place_of_worship"];
const ALL = [...MAJOR, ...MINOR, ...LOCAL];

const COLOR: ExpressionSpecification = [
  "match",
  ["get", "class"],
  "hospital", "#ff8f9c",
  ["college", "school"], "#9cc8ff",
  "stadium", "#8fe3a8",
  ["town_hall", "fire_station", "police"], "#f0d08a",
  "#c9bfff",
] as unknown as ExpressionSpecification;

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:tr"], ["get", "name"]];
const named = (classes: string[]): ExpressionSpecification =>
  ["all", ["has", "name"], ["any", ["match", ["get", "class"], classes, true, false], ["==", ["get", "subclass"], "mall"]]] as unknown as ExpressionSpecification;

/** Style layers for the place names (append after the buildings, before or after place-label). */
export function placeLayers(source = "omt"): LayerSpecification[] {
  const label = (id: string, classes: string[], minzoom: number, size: [number, number]): LayerSpecification[] => [
    {
      id: `${id}-dot`,
      type: "circle",
      source,
      "source-layer": "poi",
      minzoom,
      filter: named(classes),
      paint: {
        "circle-color": COLOR,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], minzoom, 2.2, 17, 4],
        "circle-stroke-color": "#0b1115",
        "circle-stroke-width": 1.2,
        "circle-pitch-alignment": "viewport",
      },
    } as LayerSpecification,
    {
      id,
      type: "symbol",
      source,
      "source-layer": "poi",
      minzoom,
      filter: named(classes),
      layout: {
        "text-field": NAME,
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], minzoom, size[0], 17, size[1]],
        "text-anchor": "bottom",
        "text-offset": [0, -0.55],
        "text-max-width": 9,
        "text-padding": 4,
        "symbol-sort-key": ["to-number", ["coalesce", ["get", "rank"], 50]],
      },
      paint: {
        "text-color": COLOR,
        "text-halo-color": "rgba(8,12,15,0.92)",
        "text-halo-width": 1.6,
        "text-halo-blur": 0.4,
      },
    } as LayerSpecification,
  ];
  return [
    ...label("places-major", MAJOR, 12.5, [11, 14]),
    ...label("places-minor", MINOR, 14.6, [10.5, 12.5]),
    ...label("places-local", LOCAL, 16, [10.5, 12]),
  ];
}

/* ------------------------------------------------------------- flooded places */

type Ring = number[][];
type BuildingLike = {
  geometry: { type: string; coordinates: unknown };
  properties: { id: number; fw?: number | null; md?: number; crit?: string | null; tier?: string };
};
export type HitPlace = { name: string; cls: string; lng: number; lat: number; fw: number; md: number };

const CRIT_NAME: Record<string, string> = { hastane: "Hastane", okul: "Okul", itfaiye: "İtfaiye", bakimevi: "Bakımevi" };
const CRIT_CLASS: Record<string, string> = { hastane: "hospital", okul: "school", itfaiye: "fire_station", bakimevi: "hospital" };

function inRing(x: number, y: number, r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i] as [number, number];
    const [xj, yj] = r[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type Indexed = { b: BuildingLike; rings: Ring[]; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number };

/** Buildings that get wet, with bbox and centroid, for point-in-footprint lookups. */
export function indexWetBuildings(features: readonly BuildingLike[]): Indexed[] {
  const out: Indexed[] = [];
  for (const b of features) {
    if (b.properties.fw == null) continue;
    const g = b.geometry;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) as Ring[][];
    const rings = polys.map((p) => p[0]!).filter(Boolean);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0, n = 0;
    for (const r of rings)
      for (const [x, y] of r as [number, number][]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        sx += x;
        sy += y;
        n++;
      }
    if (n) out.push({ b, rings, x0, y0, x1, y1, cx: sx / n, cy: sy / n });
  }
  return out;
}

/**
 * Named places (basemap POIs) standing in a building the water reaches, plus our critical facilities
 * (schools, hospitals, ...) that the water reaches, named after the nearest POI when there is one.
 */
export function floodedPlaces(map: MlMap, wet: Indexed[]): HitPlace[] {
  if (!wet.length) return [];
  const pois = map
    .querySourceFeatures("omt", { sourceLayer: "poi" })
    .filter((f) => f.properties?.name && (ALL.includes(String(f.properties.class)) || f.properties.subclass === "mall"));
  const out = new Map<number, HitPlace>();
  const D = 0.0006; // ~50-65 m: a school's POI often sits in its yard, not on the building
  for (const p of pois) {
    if (p.geometry.type !== "Point") continue;
    const [x, y] = p.geometry.coordinates as [number, number];
    let best: Indexed | null = null;
    let bestD = Infinity;
    for (const w of wet) {
      if (x < w.x0 - D || x > w.x1 + D || y < w.y0 - D || y > w.y1 + D) continue;
      const inside = x >= w.x0 && x <= w.x1 && y >= w.y0 && y <= w.y1 && w.rings.some((r) => inRing(x, y, r));
      const d = inside ? 0 : Math.hypot(x - w.cx, (y - w.cy) * 1.3);
      // only big-footprint matches by distance (a schoolyard POI next to its school), not any neighbour
      if (!inside && (d > D || !w.b.properties.crit)) continue;
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (!best) continue;
    const id = best.b.properties.id;
    if (out.has(id)) continue;
    out.set(id, {
      name: String(p.properties!["name:tr"] ?? p.properties!.name),
      cls: String(p.properties!.class),
      lng: best.cx,
      lat: best.cy,
      fw: best.b.properties.fw!,
      md: best.b.properties.md ?? 0,
    });
  }
  for (const w of wet) {
    const c = w.b.properties.crit;
    if (!c || out.has(w.b.properties.id)) continue;
    out.set(w.b.properties.id, { name: CRIT_NAME[c] ?? "Kritik tesis", cls: CRIT_CLASS[c] ?? "school", lng: w.cx, lat: w.cy, fw: w.b.properties.fw!, md: w.b.properties.md ?? 0 });
  }
  return [...out.values()];
}

const clock = (t: number) => {
  // scenario minutes from 06:00 on 14 Oct
  const m = Math.round(360 + t) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Source + layers for flooded places; call setFloodedPlaces / setFloodedTime to drive them. */
export function addFloodedPlaceLayers(map: MlMap) {
  if (map.getSource("places-hit")) return;
  map.addSource("places-hit", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "places-hit-ring",
    type: "circle",
    source: "places-hit",
    filter: ["<=", ["get", "fw"], -1],
    paint: {
      "circle-color": "rgba(255,110,50,0.18)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 17, 16],
      "circle-stroke-color": "#ff7a3d",
      "circle-stroke-width": 1.6,
      "circle-pitch-alignment": "viewport",
    },
  });
  map.addLayer({
    id: "places-hit",
    type: "symbol",
    source: "places-hit",
    filter: ["<=", ["get", "fw"], -1],
    layout: {
      "text-field": ["format", ["get", "name"], { "font-scale": 1 }, "\n", {}, ["get", "note"], { "font-scale": 0.8 }],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11.5, 17, 14.5],
      "text-anchor": "bottom",
      "text-offset": [0, -0.9],
      "text-max-width": 10,
      "text-allow-overlap": false,
      "symbol-sort-key": ["-", 0, ["get", "md"]],
    },
    paint: { "text-color": "#ffb27a", "text-halo-color": "rgba(20,8,2,0.95)", "text-halo-width": 1.8 },
  });
}

/** Second line under a flooded place's name. Default (pilot): depth and the scenario clock time of first contact. */
export type PlaceNote = (p: HitPlace) => string;
const defaultNote: PlaceNote = (p) => `su ${p.md.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} m · ${clock(p.fw)}'da ulaştı`;

export function setFloodedPlaces(map: MlMap, places: HitPlace[], note: PlaceNote = defaultNote) {
  const src = map.getSource("places-hit") as GeoJSONSource | undefined;
  if (!src) return;
  src.setData({
    type: "FeatureCollection",
    features: places.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        name: p.name,
        fw: p.fw,
        md: p.md,
        note: note(p),
      },
    })),
  });
}

/** Show the flooded places the water has reached by scenario minute t (pass -1 to hide all). */
export function setFloodedTime(map: MlMap, t: number) {
  const f: ExpressionSpecification = ["<=", ["get", "fw"], t];
  for (const id of ["places-hit", "places-hit-ring"]) if (map.getLayer(id)) map.setFilter(id, f);
}

/** Keeps the flooded-place labels of one map in step with the buildings, the view and the scenario time. */
export class FloodedPlaces {
  private wet: Indexed[] = [];
  private fws: number[] = [];
  private applied = -2;
  private t = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `note`: wording of the second label line (default: the pilot's clock time). */
  constructor(
    private readonly map: MlMap,
    private readonly note: PlaceNote = defaultNote,
  ) {
    addFloodedPlaceLayers(map);
    map.on("moveend", this.schedule);
    map.on("sourcedata", this.onSource);
  }

  setBuildings(features: readonly BuildingLike[]) {
    this.wet = indexWetBuildings(features);
    this.schedule();
  }

  /** Scenario minute (or -1 = no scenario: hide). Repaints only when another place has been reached. */
  setTime(t: number) {
    this.t = t;
    let n = 0;
    if (t >= 0) while (n < this.fws.length && this.fws[n]! <= t) n++;
    const key = t < 0 ? -1 : n;
    if (key === this.applied) return;
    this.applied = key;
    setFloodedTime(this.map, t < 0 ? -1 : n > 0 ? this.fws[n - 1]! : -1);
  }

  dispose() {
    clearTimeout(this.timer);
    this.map.off("moveend", this.schedule);
    this.map.off("sourcedata", this.onSource);
  }

  private onSource = (e: { sourceId?: string; tile?: unknown }) => {
    if (e.sourceId === "omt" && e.tile) this.schedule();
  };

  private schedule = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 400);
  };

  private refresh() {
    if (!this.map.getSource("places-hit")) return;
    const places = floodedPlaces(this.map, this.wet);
    setFloodedPlaces(this.map, places, this.note);
    this.fws = places.map((p) => p.fw).sort((a, b) => a - b);
    this.applied = -2;
    this.setTime(this.t);
  }
}

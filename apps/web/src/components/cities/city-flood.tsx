"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  LngLatBoundsLike,
  Map as MlMap,
  StyleSpecification,
} from "maplibre-gl";
import type { GridFrame } from "@floodograph/core";
import { RainOverlay, trackPitch } from "@/components/rain-overlay";
import { sceneStyle } from "@/components/scene/scene-style";
import { FloodedPlaces, floodedPlaces, indexWetBuildings, type HitPlace } from "@/components/places";
import { NIGHT_MIN_ZOOM, NightBuildingsLayer } from "./night-buildings";
import { OVERTURE_BUILDINGS, registerPmtiles } from "./overture-buildings";
import {
  BasemapHole,
  CRIT_LABEL,
  LIT_HEIGHT,
  NEVER,
  blinkFilter,
  buildingColor,
  buildingHeight,
  cellsInside,
  depthAt,
  depthsOf,
  extentOf,
  grow,
  intersects,
  litColor,
  prepareCentre,
  type Blink,
  type Centre,
  type CentreFile,
} from "./center-data";
import { SiteNav } from "@/components/site-nav";
import { Water3DLayer } from "@/components/demo/water-3d";
import { floodRepository } from "@/lib/repository";
import { AREA_THRESHOLD_M, countAtMost, fmtDec, fmtInt } from "@/lib/scenario";
import { FrameStore } from "@/lib/water-frames";
import { CorridorTiles } from "@/lib/corridor-tiles";
import { CORRIDOR_ORDER, CORRIDOR_STYLE, type CorridorKind } from "@/lib/tier-style";

const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

type GeoData = GeoJSONSourceSpecification["data"];
/**
 * The İzmir centre (Konak-Alsancak-Bayraklı, Meles Çayı): the model validated on İstanbul's 14 October flood, asked
 * "what if this rain fell here?". `center`: where the map opens before the file (with its exact bbox) has arrived.
 */
const CENTRE = { id: "izmir-merkez", name: "İzmir", center: [27.14, 38.43] as [number, number] };
const MAX_MM = 300;
const PRESETS = [
  { mm: 40, label: "Kuvvetli yağmur" },
  { mm: 100, label: "Sağanak" },
  { mm: 188, label: "14 Ekim (Sarıyer)" },
  { mm: 280, label: "Aşırı" },
];
const MIN_ZOOM = 12.3;
/** Pan limit: the analysed area plus this ring of surroundings. */
const MARGIN_M = 1500;
/** How long (real time) a building blinks after the slider has brought the water to it; then it stays lit. */
const BLINK_MS = 2500;
const LAYERS = ["mb", "mb-blink"];
/** Rows in the "where first?" list. */
const TOP_N = 8;
/** Deep unnamed buildings closer than this (m) to a listed one are the same spot: listed once. */
const SPOT_M = 90;

/** `?yagis=188` -> 188 (rounded, clamped to 0..MAX_MM); null when absent or not a number. */
function rainParam(q: string | null): number | null {
  const v = q == null || q.trim() === "" ? NaN : Math.round(Number(q));
  return Number.isFinite(v) ? Math.max(0, Math.min(MAX_MM, v)) : null;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Flat night base (no 3D terrain: the water sits on z = 0) with every building lit at night: Overture's buildings
 * (OSM + ML footprints, with heights / floors where known). The extrusions read a `hide` feature-state, so the
 * copies inside the analysed area (drawn by our own layer) can be flattened (see BasemapHole).
 */
function cityStyle(): StyleSpecification {
  const s = sceneStyle(NIGHT_MIN_ZOOM, OVERTURE_BUILDINGS);
  delete (s as { terrain?: unknown }).terrain;
  const layer = s.layers.find((l) => l.id === "basemap-buildings") as { paint?: Record<string, unknown> } | undefined;
  if (layer?.paint) {
    const hide: ExpressionSpecification = ["boolean", ["feature-state", "hide"], false];
    layer.paint["fill-extrusion-height"] = ["case", hide, 0, OVERTURE_BUILDINGS.height];
    layer.paint["fill-extrusion-base"] = ["case", hide, 0, OVERTURE_BUILDINGS.base];
  }
  return s;
}

/** The water of one centre: its rain ladder (frames keyed by rain total in mm) on one grid. */
type Water = { layer: Water3DLayer; frames: FrameStore | null; zero: GridFrame; inside: Uint8Array; cellHa: number };

type Selected = { id: number; h: number; crit: string | null; wm: number; d: number[]; name?: string };

/** One row of the priority list: a critical facility, a named place, or a deep spot. */
type Row = { id: number; name: string; tag: string | null; depth: number; wm: number; lng: number; lat: number; i: number };

const GENERIC = new Set(Object.values(CRIT_LABEL));
/** The lowest simulated rain total: below it the reach is extrapolated from 0 mm, so never quote a number there. */
const FIRST_LEVEL_MM = 25;
/** "~120 mm'de su ulaşır" (rounded to 5 mm: levels are 25-50 mm apart), or "25 mm'nin altında bile …". */
function reachText(mm: number): string {
  return mm < FIRST_LEVEL_MM ? `${FIRST_LEVEL_MM} mm'nin altında bile su ulaşır` : `~${fmtInt(Math.round(mm / 5) * 5)} mm'de su ulaşır`;
}

/** Name of the street nearest to a point (within ~100 m), from the basemap's road-name lines. */
function nearestStreet(lines: { name: string; coords: number[][] }[], lng: number, lat: number): string | null {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestD = 0.0009;
  for (const l of lines)
    for (let k = 1; k < l.coords.length; k++) {
      const [ax, ay] = l.coords[k - 1]!;
      const [bx, by] = l.coords[k]!;
      const dx = (bx! - ax!) * kx;
      const dy = by! - ay!;
      const px = (lng - ax!) * kx;
      const py = lat - ay!;
      const len = dx * dx + dy * dy;
      const f = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
      const d = Math.hypot(px - f * dx, py - f * dy);
      if (d < bestD) {
        bestD = d;
        best = l.name;
      }
    }
  return best;
}

export function CityFlood() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [centre, setCentre] = useState<Centre | null>(null);
  const centreRef = useRef<Centre | null>(null);
  // ?yagis=188: open at that rain total (the İstanbul tour's end card links here with 14 October's)
  const query = useSearchParams();
  const [mm, setMm] = useState(() => rainParam(query.get("yagis")) ?? 100);
  const mmRef = useRef(mm);
  const prevMm = useRef(mm);
  const [areaHa, setAreaHa] = useState<number | null>(null);
  const [corr, setCorr] = useState<Record<CorridorKind, number>>({ derived: 0, buried_osm: 0, open: 0 });
  const [sel, setSel] = useState<Selected | null>(null);
  const selId = useRef<number | null>(null);
  const [more, setMore] = useState(false);
  const blinks = useRef<Blink[]>([]);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const water = useRef<Water | null>(null);
  const night = useRef<NightBuildingsLayer | null>(null);
  const hole = useRef<BasemapHole | null>(null);
  const places = useRef<FloodedPlaces | null>(null);
  const placesTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tiles = useRef<CorridorTiles | null>(null);
  const applyRaf = useRef(0);
  const [rank, setRank] = useState<Row[]>([]);
  /** building id -> name of the place standing in it (POIs come and go with the tiles on screen: remember them) */
  const names = useRef(new Map<number, string>());
  const rankTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---- map ----
  useEffect(() => {
    let map: MlMap | null = null;
    let disposed = false;
    (async () => {
      const { Map, AttributionControl, NavigationControl, setWorkerUrl, addProtocol } = await import("maplibre-gl");
      await registerPmtiles(addProtocol); // the Overture buildings are a pmtiles:// source
      if (disposed || !container.current) return;
      setWorkerUrl(WORKER_URL);
      const narrow = window.matchMedia("(max-width: 640px)").matches;
      map = new Map({
        container: container.current,
        style: cityStyle(),
        center: CENTRE.center,
        zoom: 13.6,
        pitch: 55,
        bearing: -20,
        minZoom: MIN_ZOOM,
        maxPitch: 75,
        attributionControl: false,
        fadeDuration: reducedMotion() ? 0 : 300,
      });
      mapRef.current = map;
      trackPitch(map);
      (window as unknown as { __cityMap?: MlMap }).__cityMap = map;
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");
      if (!narrow) map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
      map.on("load", () => {
        if (!map) return;
        // close up, the surrounding buildings are redrawn with lit windows (the analysed ones are ours, see setHole)
        const nb = new NightBuildingsLayer();
        night.current = nb;
        map.addLayer(nb, "place-label");
        hole.current = new BasemapHole(map);
        // stream corridors around the centre
        map.addSource("corridors", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const kind of CORRIDOR_ORDER) {
          const st = CORRIDOR_STYLE[kind];
          map.addLayer(
            {
              id: `corridor-${kind}`,
              type: "line",
              source: "corridors",
              filter: ["==", ["get", "kind"], kind],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": st.color,
                "line-opacity": kind === "derived" ? 0.9 : 0.7,
                "line-width": [
                  "interpolate", ["linear"], ["zoom"],
                  13, ["interpolate", ["linear"], ["coalesce", ["get", "up"], 1], 1, 1.1, 40, 2, 200, 3],
                  16, ["interpolate", ["linear"], ["coalesce", ["get", "up"], 1], 1, 2.4, 40, 3.4, 200, 4.4],
                ],
                ...(st.dash ? { "line-dasharray": st.dash } : {}),
              },
            },
            "basemap-buildings",
          );
        }
        // the analysed buildings: one layer for all, a second one for those blinking right now (never both)
        map.addSource("mb", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer(
          {
            id: "mb",
            type: "fill-extrusion",
            source: "mb",
            paint: { "fill-extrusion-color": "#2c363b", "fill-extrusion-height": 9, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 },
          },
          "place-label",
        );
        map.addLayer(
          {
            id: "mb-blink",
            type: "fill-extrusion",
            source: "mb",
            filter: ["==", ["get", "id"], -2],
            paint: { "fill-extrusion-color": "#ffc23a", "fill-extrusion-height": LIT_HEIGHT, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.95 },
          },
          "place-label",
        );
        map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.32, position: [1.3, 210, 35] });
        // named places in buildings the water reaches: depth at the current rain, and the rain that brings the water
        places.current = new FloodedPlaces(map, (p: HitPlace) => `su ${fmtDec(p.md)} m · ${reachText(p.fw)}`);

        map.on("click", LAYERS, (e) => {
          const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          const c = centreRef.current;
          if (!p || !c) return;
          const id = Number(p.id);
          setSel({
            id,
            name: names.current.get(id),
            h: Number(p.h) || 0,
            crit: typeof p.crit === "string" ? p.crit : null,
            wm: Number(p.wm ?? NEVER),
            d: depthsOf(p, c.levels),
          });
        });
        map.on("click", (e) => {
          if (!map?.queryRenderedFeatures(e.point, { layers: LAYERS }).length) setSel(null);
        });
        map.on("mouseenter", LAYERS, () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", LAYERS, () => map && (map.getCanvas().style.cursor = ""));
        // place names arrive with the basemap tiles: re-rank when they do
        map.on("sourcedata", (e) => {
          if (e.sourceId === "omt" && (e as { tile?: unknown }).tile) scheduleRanking(800);
        });
        map.on("moveend", () => scheduleRanking(500));
        setMapReady(true);
      });
    })();
    return () => {
      disposed = true;
      places.current?.dispose();
      hole.current?.dispose();
      places.current = null;
      hole.current = null;
      night.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; the handlers read refs only
  }, []);

  // ---- the centre's file (buildings, levels, grid) ----
  useEffect(() => {
    let cancelled = false;
    fetch(`/merkez/${CENTRE.id}.json`)
      .then(async (r) => {
        if (r.status === 404) throw new Error("missing");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return prepareCentre((await r.json()) as CentreFile);
      })
      .then((c) => {
        if (cancelled) return;
        centreRef.current = c;
        setCentre(c);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus(err instanceof Error && err.message === "missing" ? "missing" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- put a centre on the map: buildings, camera and pan limit, water, corridors, place labels ----
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const src = map.getSource("mb") as GeoJSONSource | undefined;
    if (!centre) {
      src?.setData({ type: "FeatureCollection", features: [] });
      night.current?.setHole(null);
      hole.current?.setBbox(null);
      places.current?.setBuildings([]);
      return;
    }
    let cancelled = false;
    blinks.current = [];
    prevMm.current = mmRef.current;
    src?.setData(centre.fc as unknown as GeoData);
    night.current?.setHole(centre.bbox);
    hole.current?.setBbox(centre.bbox);
    updatePlaces(true);
    scheduleApply();

    // camera: the whole centre in view, then the pan limit around it
    const [w, s, e, n] = centre.bbox;
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const reduce = reducedMotion();
    map.setMaxBounds(null);
    const cam = map.cameraForBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: narrow ? { top: 120, bottom: 200, left: 12, right: 12 } : { top: 90, bottom: 170, left: 340, right: 60 }, bearing: -20 },
    );
    const zoom = Math.max(MIN_ZOOM, cam?.zoom ?? 14);
    map.jumpTo({ center: cam?.center ?? [(w + e) / 2, (s + n) / 2], zoom: reduce ? zoom : zoom - 0.5, pitch: 55, bearing: reduce ? -20 : -34 });
    const lim = grow(centre.bbox, MARGIN_M);
    map.setMaxBounds([
      [lim[0], lim[1]],
      [lim[2], lim[3]],
    ] as LngLatBoundsLike);
    if (!reduce) map.easeTo({ zoom, bearing: -20, duration: 1800, essential: true });

    // corridors: drawn within the pan limit, counted inside the analysed area
    tiles.current ??= new CorridorTiles();
    void tiles.current.around(lim[0], lim[1], lim[2], lim[3]).then((all) => {
      if (cancelled || !map.getSource("corridors")) return;
      const counts = { derived: 0, buried_osm: 0, open: 0 } as Record<CorridorKind, number>;
      const feats = all.filter((f) => {
        const box = extentOf(f.geometry.coordinates);
        if (intersects(box, centre.bbox)) counts[f.properties.kind]++;
        return intersects(box, lim);
      });
      (map.getSource("corridors") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats } as unknown as GeoData);
      setCorr(counts);
    });

    // water: the rain ladder of this centre, blended by mm (a zero frame below the first level)
    const g = centre.grid;
    const lowPower = window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    const layer = new Water3DLayer(g, "flood-water", lowPower);
    if (map.getLayer("flood-water")) map.removeLayer("flood-water");
    map.addLayer(layer, `corridor-${CORRIDOR_ORDER[0]}`);
    const cells = g.nx * g.ny;
    const wt: Water = {
      layer,
      frames: null,
      zero: { tMin: 0, nx: g.nx, ny: g.ny, depth: new Float32Array(cells), u: new Float32Array(cells), v: new Float32Array(cells) },
      inside: cellsInside(g, centre.bbox),
      cellHa: (g.res_m * g.res_m) / 10_000,
    };
    water.current = wt;
    try {
      const repo = floodRepository();
      void repo
        .gridFrames(centre.scenario)
        .then((refs) => {
          if (cancelled) return;
          const fs = new FrameStore(repo, centre.scenario, refs, g);
          wt.frames = fs;
          fs.onLoad(() => drawWater(mmRef.current));
          fs.want(mmRef.current, refs.length, refs.length); // a ladder is short: fetch every level
          drawWater(mmRef.current);
        })
        .catch(() => {});
    } catch {
      // no data source configured: buildings only
    }
    return () => {
      cancelled = true;
      wt.frames?.dispose();
      if (water.current === wt) water.current = null;
      if (map.getLayer("flood-water")) map.removeLayer("flood-water");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs only
  }, [mapReady, centre]);

  /** Show the water for `total` mm of rain: blend the two nearest ladder levels; count the wet area in the bbox. */
  function drawWater(total: number) {
    const wt = water.current;
    const fs = wt?.frames;
    if (!wt || !fs) return;
    const first = fs.times[0];
    if (first == null) return;
    let a: GridFrame | undefined;
    let b: GridFrame | undefined;
    let alpha = 0;
    if (total <= first) {
      a = wt.zero;
      b = fs.get(first);
      alpha = first > 0 ? total / first : 1;
    } else {
      const br = fs.bracket(total);
      if (!br) return;
      a = fs.get(br.a);
      b = fs.get(br.b);
      alpha = br.alpha;
    }
    if (!a || !b) return; // still streaming
    wt.layer.setFrames(a, b, alpha);
    const da = a.depth;
    const db = b.depth;
    const inside = wt.inside;
    let wet = 0;
    for (let i = 0; i < da.length; i++) if (inside[i] && da[i]! * (1 - alpha) + db[i]! * alpha > AREA_THRESHOLD_M) wet++;
    setAreaHa(wet * wt.cellHa);
  }

  /** Repaint the buildings for the current rain, selection and blink windows (at most once per frame). */
  function scheduleApply() {
    if (applyRaf.current) return;
    applyRaf.current = requestAnimationFrame(() => {
      applyRaf.current = 0;
      const map = mapRef.current;
      const c = centreRef.current;
      if (!map?.getLayer("mb") || !c) return;
      const t = mmRef.current;
      const sid = selId.current;
      const bl = blinks.current;
      const blink = blinkFilter(bl, t, sid);
      map.setPaintProperty("mb", "fill-extrusion-color", buildingColor(c.levels, t, sid));
      map.setPaintProperty("mb", "fill-extrusion-height", buildingHeight(t));
      map.setFilter("mb", bl.length ? ["!", blink] : null);
      map.setFilter("mb-blink", blink);
      map.setPaintProperty("mb-blink", "fill-extrusion-color", litColor(t));
    });
  }

  /** Drop the blink windows that have run out; wake up again for the next one. */
  function pruneBlinks() {
    clearTimeout(blinkTimer.current);
    const now = performance.now();
    const before = blinks.current.length;
    blinks.current = blinks.current.filter((b) => now - b.t0 < BLINK_MS);
    if (blinks.current.length !== before) scheduleApply();
    if (blinks.current.length) {
      const next = Math.min(...blinks.current.map((b) => b.t0 + BLINK_MS)) - now;
      blinkTimer.current = setTimeout(pruneBlinks, Math.max(16, next));
    }
  }

  /** Named-place labels: buildings the water reaches, with the depth at the current rain (debounced). */
  function updatePlaces(now = false) {
    clearTimeout(placesTimer.current);
    const run = () => {
      const c = centreRef.current;
      const pl = places.current;
      if (!c || !pl) return;
      const t = mmRef.current;
      pl.setBuildings(
        c.wet.map((b) => ({ geometry: b.geometry, properties: { id: b.id, fw: b.wm, md: depthAt(b.d, c.levels, t), crit: b.crit } })),
      );
      pl.setTime(t);
      computeRanking();
    };
    if (now) run();
    else placesTimer.current = setTimeout(run, 250); // the slider has settled
  }

  function scheduleRanking(ms: number) {
    clearTimeout(rankTimer.current);
    rankTimer.current = setTimeout(computeRanking, ms);
  }

  /**
   * "Where first?": at the current rain, the critical facilities the water reaches (deepest first), then named places
   * (basemap POIs standing in a reached building), then the deepest remaining spots, one row per spot.
   */
  function computeRanking() {
    const map = mapRef.current;
    const c = centreRef.current;
    if (!map || !c) return;
    const t = mmRef.current;
    const wet = c.wet.filter((b) => b.wm <= t);
    if (map.getSource("omt")) {
      const idx = indexWetBuildings(wet.map((b) => ({ geometry: b.geometry, properties: { id: b.id, fw: b.wm, md: 0, crit: b.crit } })));
      const byKey = new Map(idx.map((w) => [`${w.cx},${w.cy}`, w.b.properties.id]));
      for (const h of floodedPlaces(map, idx)) {
        const id = byKey.get(`${h.lng},${h.lat}`);
        if (id != null && !GENERIC.has(h.name)) names.current.set(id, h.name);
      }
    }
    const rows = wet.map((b) => ({ b, depth: depthAt(b.d, c.levels, t) }));
    const byDepth = (x: { depth: number }, y: { depth: number }) => y.depth - x.depth;
    const out: Row[] = [];
    const toRow = ({ b, depth }: (typeof rows)[number], name: string, tag: string | null): Row => ({
      id: b.id,
      name,
      tag,
      depth,
      wm: b.wm,
      lng: b.cx,
      lat: b.cy,
      i: b.i,
    });
    for (const r of rows.filter((r) => r.b.crit).sort(byDepth)) {
      if (out.length >= TOP_N) break;
      const label = CRIT_LABEL[r.b.crit!] ?? "Kritik tesis";
      const nm = names.current.get(r.b.id);
      // a named place keeps its own name only: the facility class came from a nearby point and can disagree
      // (a stadium next to a school's point)
      out.push(toRow(r, nm ?? label, null));
    }
    for (const r of rows.filter((r) => !r.b.crit && names.current.has(r.b.id)).sort(byDepth)) {
      if (out.length >= TOP_N) break;
      out.push(toRow(r, names.current.get(r.b.id)!, null));
    }
    if (out.length < TOP_N) {
      const kx = 111_320 * Math.cos((((c.bbox[1] + c.bbox[3]) / 2) * Math.PI) / 180);
      const near = (r: (typeof rows)[number]) =>
        out.some((o) => Math.hypot((o.lng - r.b.cx) * kx, (o.lat - r.b.cy) * 111_320) < SPOT_M);
      const lines = map.getSource("omt")
        ? map
            .querySourceFeatures("omt", { sourceLayer: "transportation_name" })
            .filter((f) => f.properties?.name && f.geometry.type === "LineString")
            .map((f) => ({
              name: String(f.properties["name:tr"] ?? f.properties.name),
              coords: (f.geometry as { coordinates: number[][] }).coordinates,
            }))
        : [];
      const listed = new Set(out.map((o) => o.id));
      for (const r of rows.sort(byDepth)) {
        if (out.length >= TOP_N) break;
        if (listed.has(r.b.id) || near(r)) continue;
        const street = nearestStreet(lines, r.b.cx, r.b.cy);
        out.push(toRow(r, street ? `Bina · ${street}` : "Bina", null));
      }
    }
    setRank(out);
  }

  /** Fly to a listed place and select its building. */
  function focusRow(r: Row) {
    const map = mapRef.current;
    const c = centreRef.current;
    if (!map || !c) return;
    const p = c.fc.features[r.i]?.properties;
    setSel({
      id: r.id,
      name: names.current.get(r.id), // the place's own name; a bare "Hastane" row has none (the header shows the kind)
      h: p?.h ?? 0,
      crit: p?.crit ?? null,
      wm: r.wm,
      d: p ? depthsOf(p, c.levels) : [],
    });
    map.flyTo({
      center: [r.lng, r.lat],
      zoom: Math.max(map.getZoom(), 16.3),
      pitch: 58,
      duration: reducedMotion() ? 0 : 1400,
      essential: true,
    });
  }

  // ---- the rain slider ----
  useEffect(() => {
    mmRef.current = mm;
    const prev = prevMm.current;
    prevMm.current = mm;
    if (centreRef.current) {
      if (mm > prev && !reducedMotion()) {
        // the buildings the water reaches on the way up blink, each from its own moment
        const now = performance.now();
        const last = blinks.current[blinks.current.length - 1];
        if (last && last.hi === prev && now - last.t0 < 150) last.hi = mm;
        else blinks.current.push({ lo: prev, hi: mm, t0: now });
        pruneBlinks();
      } else if (mm < prev) {
        blinks.current = blinks.current.filter((b) => b.lo < mm);
      }
      scheduleApply();
      places.current?.setTime(mm);
      updatePlaces();
    }
    drawWater(mm);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers read refs only
  }, [mm]);

  useEffect(() => {
    selId.current = sel?.id ?? null;
    scheduleApply();
  }, [sel]);

  // the blinking buildings pulse
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || reducedMotion()) return;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!blinks.current.length || !map.getLayer("mb-blink")) return;
      const s = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 * 2.2);
      map.setPaintProperty("mb-blink", "fill-extrusion-opacity", 0.3 + 0.7 * s);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapReady]);

  useEffect(
    () => () => {
      clearTimeout(blinkTimer.current);
      clearTimeout(placesTimer.current);
      clearTimeout(rankTimer.current);
      cancelAnimationFrame(applyRaf.current);
    },
    [],
  );

  const stats = useMemo(() => {
    if (!centre) return null;
    const acil = countAtMost(centre.omSorted, mm);
    return {
      wet: countAtMost(centre.wmSorted, mm),
      acil,
      yuksek: countAtMost(centre.ymSorted, mm) - acil,
      crit: countAtMost(centre.critSorted, mm),
    };
  }, [centre, mm]);
  const area = centre?.name.split(" · ").slice(1).join(" · ") ?? "";
  const selDepth = sel && centre && sel.wm <= mm ? depthAt(sel.d, centre.levels, mm) : 0;
  const topMm = centre?.levels[centre.levels.length - 1] ?? MAX_MM;

  return (
    <div className="fixed inset-0 bg-ink">
      {/* maplibre-gl.css forces the map container to position:relative, so size it from a wrapper */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label="İzmir merkez sel haritası" />
      </div>
      <RainOverlay intensity={() => Math.sqrt(Math.min(1, mmRef.current / MAX_MM))} />

      <header className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
        <SiteNav />
        <Link
          href="/sinema"
          className="glass pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold text-fg-2 transition-colors duration-150 hover:text-fg"
        >
          <span aria-hidden="true">←</span>
          <span className="sm:hidden">14 Ekim, İstanbul</span>
          <span className="max-sm:hidden">İstanbul&rsquo;daki 14 Ekim seline dön</span>
        </Link>
      </header>

      <motion.aside
        initial={{ opacity: 0, x: -16, filter: "blur(6px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="glass absolute left-3 top-24 z-10 flex max-h-[calc(100dvh-280px)] w-[min(320px,calc(100vw-24px))] flex-col gap-4 overflow-y-auto overscroll-contain rounded-[22px] p-5 sm:left-5 max-sm:top-auto max-sm:bottom-44 max-sm:max-h-[calc(100dvh-330px)] max-sm:gap-3 max-sm:p-4"
      >
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold tracking-[-0.03em] max-sm:text-2xl">{CENTRE.name}</h1>
          <p className="text-sm text-fg-2">Ya bu yağış burada yağsaydı?</p>
          {area && <p className="text-xs text-fg-3">{area}</p>}
          <p className="text-xs leading-relaxed text-fg-3">
            Model, İstanbul&rsquo;daki 14 Ekim selinde sınandı: Sarıyer&rsquo;de 9 gözlem noktasının 7&rsquo;si tuttu.
          </p>
        </div>

        {sel && (
          <section aria-label="Seçili bina" className="flex flex-col gap-2 rounded-2xl bg-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 text-sm font-semibold">
                {sel.name ?? (sel.crit ? (CRIT_LABEL[sel.crit] ?? "Kritik tesis") : "Bina")}
                {sel.name && sel.crit && <span className="ml-1.5 font-normal text-fg-3">{CRIT_LABEL[sel.crit]}</span>}
              </h2>
              <button
                type="button"
                onClick={() => setSel(null)}
                aria-label="Seçimi kapat"
                className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-white/10 hover:text-fg"
              >
                ×
              </button>
            </div>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
              <dt className="text-fg-3">Bu yağışta duvar dibinde su</dt>
              <dd className={`font-mono tabular-nums ${selDepth >= 1.5 ? "text-ember" : ""}`}>
                {sel.wm <= mm ? `${fmtDec(selDepth)} m` : "yok"}
              </dd>
              <dt className="text-fg-3">Suyun ulaştığı yağış</dt>
              <dd className="font-mono tabular-nums">{sel.wm < NEVER ? (sel.wm < FIRST_LEVEL_MM ? `${FIRST_LEVEL_MM} mm'nin altında` : `~${fmtInt(Math.round(sel.wm / 5) * 5)} mm`) : `${fmtInt(topMm)} mm'ye kadar kuru`}</dd>
              <dt className="text-fg-3">Yükseklik</dt>
              <dd className="font-mono tabular-nums">{fmtInt(sel.h)} m</dd>
            </dl>
          </section>
        )}

        {status === "ready" && stats ? (
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Yağış" value={`${fmtInt(mm)} mm`} />
            <Stat label="Su altındaki alan" value={areaHa == null ? "…" : `${fmtInt(areaHa)} ha`} accent />
            <Stat label="Suya giren bina" value={fmtInt(stats.wet)} accent />
            <Stat label="Kritik tesis" value={fmtInt(stats.crit)} />
            <Stat label="Acil (≥1,5 m)" value={fmtInt(stats.acil)} ember />
            <Stat label="Yüksek (≥0,5 m)" value={fmtInt(stats.yuksek)} yellow />
          </dl>
        ) : (
          <p className="text-sm text-fg-3">
            {status === "loading"
              ? "Yükleniyor…"
              : status === "missing"
                ? "İzmir merkezinin bina bina analizi hazırlanıyor; birazdan burada."
                : "Veri yüklenemedi."}
          </p>
        )}

        {status === "ready" && (
          <div className="border-t border-line pt-3 lg:hidden">
            <Priorities rows={rank} selId={sel?.id ?? null} onPick={focusRow} />
          </div>
        )}

        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="min-h-9 self-start rounded-lg px-2 text-xs font-medium text-fg-3 transition-colors duration-150 hover:bg-white/10 hover:text-fg sm:hidden"
        >
          {more ? "Ayrıntıları gizle" : "Ayrıntılar"}
        </button>
        <div className={`flex flex-col gap-4 ${more ? "" : "max-sm:hidden"}`}>
          <ul className="flex flex-col gap-1.5 border-t border-line pt-3" aria-label="Merkezdeki koridorlar">
            <li className="text-[11px] uppercase tracking-[0.1em] text-fg-3">Merkezdeki koridorlar</li>
            {CORRIDOR_ORDER.map((k) => (
              <li key={k} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 text-sm">
                <svg aria-hidden="true" width="24" height="6" viewBox="0 0 24 6">
                  <line x1="1" y1="3" x2="23" y2="3" stroke={CORRIDOR_STYLE[k].color} strokeWidth="2.4" strokeLinecap="round"
                    strokeDasharray={CORRIDOR_STYLE[k].dash ? CORRIDOR_STYLE[k].dash!.map((d) => d * 2.4).join(" ") : undefined} />
                </svg>
                <span className={k === "derived" ? "font-medium" : "text-fg-2"}>{CORRIDOR_STYLE[k].label}</span>
                <span className={`font-mono tabular-nums ${k === "derived" ? "text-ember" : "text-fg-2"}`}>{fmtInt(corr[k])}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-fg-3">
            Merkezdeki her bina tek tek: 20 m&rsquo;lik ızgarada 2D sığ su modeli, binalar suyun etrafından dolaştığı
            duvarlar olarak. Model 14 Ekim İstanbul selinde kalibre edildi; seçtiğiniz yağış 14 Ekim&rsquo;in saatlik
            desenine göre dağıtılır. Duvar dibinde su 1,5 m&rsquo;yi geçen bina turuncu, 0,5 m&rsquo;yi geçen (ya da suyun
            ulaştığı hastane, okul, itfaiye, bakımevi) sarı yanar. Bir binaya tıklayın: o yağışta ne kadar su.
          </p>
        </div>
      </motion.aside>

      {status === "ready" && (
        <motion.aside
          initial={{ opacity: 0, x: 16, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="glass absolute right-5 top-24 z-10 hidden max-h-[calc(100dvh-300px)] w-[320px] flex-col overflow-y-auto overscroll-contain rounded-[22px] p-4 lg:flex"
        >
          <Priorities rows={rank} selId={sel?.id ?? null} onPick={focusRow} />
        </motion.aside>
      )}

      <div className="glass absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-[760px] flex-col gap-3 rounded-[22px] p-4 sm:bottom-5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="yagis" className="text-sm font-semibold">
            Günlük yağış
          </label>
          <span className="font-mono text-2xl font-medium tabular-nums">
            {fmtInt(mm)}
            <span className="ml-1 text-sm text-fg-3">mm</span>
          </span>
        </div>
        <input
          id="yagis"
          type="range"
          className="fg-range w-full"
          min={0}
          max={MAX_MM}
          step={5}
          value={mm}
          onChange={(e) => setMm(Number(e.target.value))}
          aria-valuetext={`${mm} milimetre`}
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.mm}
              type="button"
              onClick={() => setMm(p.mm)}
              aria-pressed={mm === p.mm}
              className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ${mm === p.mm ? "bg-white/15 text-fg" : "text-fg-3 hover:bg-white/10 hover:text-fg"}`}
            >
              {p.label} · {p.mm} mm
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Where first?": the model's answer at the current rain, most urgent first; a row flies the map to it. */
function Priorities({ rows, selId, onPick }: { rows: Row[]; selId: number | null; onPick: (r: Row) => void }) {
  return (
    <section aria-labelledby="oncelik" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 id="oncelik" className="text-sm font-semibold">
          Önce nereye müdahale edilmeli?
        </h2>
        <p className="text-xs text-fg-3">Model çıktısı, bu yağış için: önce kritik tesisler, sonra bilinen yerler, sonra suyun en derin olduğu noktalar.</p>
      </div>
      {rows.length ? (
        <ol className="flex flex-col gap-1">
          {rows.map((r, k) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                aria-current={r.id === selId ? "true" : undefined}
                className={`grid min-h-11 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/10 ${r.id === selId ? "bg-white/10" : ""}`}
              >
                <span className="font-mono text-xs tabular-nums text-fg-3">{k + 1}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="truncate text-xs text-fg-3">
                    {r.tag ? `${r.tag} · ` : ""}
                    {reachText(r.wm)}
                  </span>
                </span>
                <span
                  className={`font-mono text-sm tabular-nums ${r.depth >= 1.5 ? "text-ember" : r.depth >= 0.5 ? "text-[#ffc23a]" : "text-water"}`}
                >
                  {fmtDec(r.depth)} m
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-fg-3">Bu yağışta su hiçbir binaya ulaşmıyor.</p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  accent = false,
  ember = false,
  yellow = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  ember?: boolean;
  yellow?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] uppercase tracking-[0.1em] text-fg-3">{label}</dt>
      <dd
        className={`font-mono text-xl font-medium tabular-nums ${ember ? "text-ember" : yellow ? "text-[#ffc23a]" : accent ? "text-water" : "text-fg"}`}
      >
        {value}
      </dd>
    </div>
  );
}

"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type {
  Map as MlMap,
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
} from "maplibre-gl";
import { tierFromHand, type BuildingProps, type CorridorProps, type GridMeta, type Tier } from "@floodograph/core";
import { floodRepository } from "@/lib/repository";
import { CORRIDOR_STYLE, TIER_COLOR, TIER_ORDER, type CorridorKind } from "@/lib/tier-style";
import { usePlayback, type DemoMode } from "@/lib/playback-store";
import { AREA_THRESHOLD_M, SCENARIO_ID, countAtMost } from "@/lib/scenario";
import type { FrameStore } from "@/lib/water-frames";
import { Water3DLayer } from "./water-3d";
import { buildBaseStyle, CONTOUR_LAYERS } from "./map-style";
import { hideOwnBuildings } from "@/components/scene/scene-style";
import { CorridorTiles } from "@/lib/corridor-tiles";

type GeoData = GeoJSONSourceSpecification["data"];
type Feature = { type: "Feature"; id?: number; geometry: unknown; properties: BuildingProps & { ht?: Tier } };
type FC = { type: "FeatureCollection"; features: Feature[] };

/** Pilot area (Sarıyer, İstanbul): bbox [28.965, 41.090, 29.040, 41.145]. */
export const PILOT_CENTER: [number, number] = [29.0025, 41.1175];
/** Pan limit: the whole Istanbul urban area, where the city-wide stream corridors are. */
const BOUNDS: [[number, number], [number, number]] = [
  [28.5, 40.85],
  [29.5, 41.3],
];
/** Copied from maplibre-gl/dist by scripts/copy-maplibre-worker.mjs (pre-dev / pre-build). */
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";
const TERRARIUM = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const NEVER = 1e9;

export type MapStats = {
  /** static HAND tiers */
  tiers: Record<Tier, number>;
  corridors: Record<CorridorKind, number>;
  /** ascending first-wet minutes of every building that gets wet in the scenario */
  fwSorted: Float64Array;
  total: number;
};

export type MapPhase = "booting" | "basemap" | "ready" | "error";

export type ScenarioLayerInput = { grid: GridMeta | null; frames: FrameStore | null };

export type FloodMapProps = {
  cityId: string;
  mode: DemoMode;
  scenario: ScenarioLayerInput | null;
  showContours: boolean;
  showCorridors: boolean;
  tilted: boolean;
  activeTiers: readonly Tier[];
  selectedId: number | null;
  onStats: (s: MapStats) => void;
  onSelect: (b: BuildingProps | null) => void;
  onError: (message: string) => void;
  onPhase: (p: MapPhase) => void;
};

let protocolsReady: Promise<{ dem: string; contours: string }> | null = null;

/** maplibre-contour registers global protocols; do it once per page lifetime. */
function setupProtocols(): Promise<{ dem: string; contours: string }> {
  protocolsReady ??= (async () => {
    const [maplibre, contour] = await Promise.all([import("maplibre-gl"), import("maplibre-contour")]);
    maplibre.setWorkerUrl(WORKER_URL);
    const demSource = new contour.default.DemSource({ url: TERRARIUM, encoding: "terrarium", maxzoom: 15, worker: true });
    demSource.setupMaplibre(maplibre);
    return {
      dem: demSource.sharedDemProtocolUrl,
      contours: demSource.contourProtocolUrl({
        multiplier: 1,
        thresholds: { 11: [50, 200], 12: [20, 100], 13: [10, 50], 14: [5, 25], 15: [5, 25] },
        elevationKey: "ele",
        levelKey: "level",
        contourLayer: "contours",
      }),
    };
  })();
  return protocolsReady;
}

const withSelection = (expr: ExpressionSpecification, selectedId: number | null): ExpressionSpecification =>
  selectedId == null ? expr : ["case", ["==", ["get", "id"], selectedId], "#ffffff", expr];

/** Static mode: HAND tier computed client-side (`ht`), so one download serves both modes. */
const tierColor = (selectedId: number | null): ExpressionSpecification =>
  withSelection(
    ["match", ["get", "ht"], ...TIER_ORDER.flatMap((t) => [t, TIER_COLOR[t]]), TIER_COLOR.izle] as unknown as ExpressionSpecification,
    selectedId,
  );

const DRY = "#2c363b";
/** Scenario mode: a building turns water-blue once water reached it (fw <= t), darker for deeper water. */
const wetColor = (t: number, selectedId: number | null): ExpressionSpecification =>
  withSelection(
    [
      "case",
      ["<=", ["to-number", ["coalesce", ["get", "fw"], NEVER]], t],
      ["interpolate", ["linear"], ["to-number", ["get", "md"], 0], 0.15, "#9ad6f2", 0.5, "#4ea3d8", 1.5, "#2a6db3", 3, "#1c4f8f"],
      DRY,
    ],
    selectedId,
  );

/** Marked buildings stand LIFT m higher than unmarked ones: OSM has nested/overlapping footprints, and a grey
 * roof at the same height as an orange one flickers through it (z-fighting). */
const LIFT = 1.5;
const BASE_H: ExpressionSpecification = ["to-number", ["coalesce", ["get", "h"], 9]];
const tierHeight = (): ExpressionSpecification => ["+", BASE_H, ["case", ["==", ["get", "ht"], "izle"], 0, LIFT]];
const wetHeight = (t: number): ExpressionSpecification => [
  "+",
  BASE_H,
  ["case", ["<=", ["to-number", ["coalesce", ["get", "fw"], NEVER]], t], LIFT, 0],
];

/** Alarm: once the water has reached them, urgent (orange) and high-priority (yellow) buildings blink. */
const ALARM_TIERS = ["acil", "yuksek"] as const;
/** How long (simulated minutes) a building blinks after the water first reaches it; afterwards it stays lit. */
const BLINK_MIN = 40;
const NONE: ExpressionSpecification = ["==", ["get", "id"], -1];
/** Alarmed buildings are drawn ONLY by the alarm layer (taken out of "buildings"), so no wall is drawn twice
 * (coplanar walls z-fight). The selected building stays in "buildings" and keeps its white highlight. */
const FW: ExpressionSpecification = ["to-number", ["coalesce", ["get", "fw"], NEVER]];
const alarmFilter = (t: number, selectedId: number | null): ExpressionSpecification => [
  "all",
  ["<=", FW, t],
  ["in", ["get", "tier"], ["literal", [...ALARM_TIERS]]],
  ["!=", ["get", "id"], selectedId ?? -1],
];
/** Reached after `from` (exclusive) and by `to`: the buildings whose blink window is open right now. */
const blinkFilter = (from: number, to: number, selectedId: number | null): ExpressionSpecification => [
  "all",
  [">", FW, from],
  alarmFilter(to, selectedId),
];

const tierFilter = (tiers: readonly Tier[]): ExpressionSpecification => ["in", ["get", "ht"], ["literal", [...tiers]]];

/** City-wide stream corridors of every city, tiled, loaded only where the screen is (the pilot has its own). */
type CorridorBox = { kind: CorridorKind; x0: number; y0: number; x1: number; y1: number };
type ViewState = {
  boxes: CorridorBox[];
  last: MapStats | null;
  pilot: unknown[];
  tiles: CorridorTiles;
  emit: (s: MapStats) => void;
};
const VIEW = new WeakMap<MlMap, ViewState>();

/** The pilot's own (building-scored) corridors from the database. */
function loadCorridors(repo: ReturnType<typeof floodRepository>, cityId: string) {
  return repo.corridors(cityId);
}

/** Load the corridor tiles around the view, redraw pilot + city-wide corridors, recount what is on screen. */
async function refreshCorridors(map: MlMap) {
  const v = VIEW.get(map);
  if (!v) return;
  const b = map.getBounds();
  const city = await v.tiles.around(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
  if (VIEW.get(map) !== v || !map.getSource("corridors")) return;
  const features = [...v.pilot, ...city];
  (map.getSource("corridors") as GeoJSONSource).setData({ type: "FeatureCollection", features } as GeoData);
  v.boxes = [];
  for (const f of features as { properties: CorridorProps; geometry: { coordinates: unknown } }[]) {
    const box: CorridorBox = { kind: f.properties.kind, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    bboxOf(f.geometry.coordinates, box);
    v.boxes.push(box);
  }
  if (v.last) {
    v.last = { ...v.last, corridors: viewCounts(map) };
    v.emit(v.last);
  }
}

function bboxOf(coords: unknown, box: CorridorBox) {
  if (typeof (coords as number[])[0] === "number") {
    const [x, y] = coords as [number, number];
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
    return;
  }
  for (const c of coords as unknown[]) bboxOf(c, box);
}

/** Corridors whose extent intersects what is on screen, by kind ("count everything on the screen"). */
function viewCounts(map: MlMap): Record<CorridorKind, number> {
  const out = { derived: 0, buried_osm: 0, open: 0 } as Record<CorridorKind, number>;
  const v = VIEW.get(map);
  if (!v) return out;
  const b = map.getBounds();
  const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
  for (const c of v.boxes) if (c.x1 >= w && c.x0 <= e && c.y1 >= s && c.y0 <= n) out[c.kind]++;
  return out;
}

/** Push buildings and corridors into the map; returns the sorted first-wet minutes. */
function applyData(map: MlMap, b: FC, c: { features: unknown[] }, onStats: (s: MapStats) => void): Float64Array {
  const tiers = { acil: 0, yuksek: 0, orta: 0, izle: 0 } as Record<Tier, number>;
  const fws: number[] = [];
  for (const f of b.features) {
    const p = f.properties;
    const ht = tierFromHand(p.hand ?? Number.POSITIVE_INFINITY, p.crit ?? null);
    p.ht = ht;
    tiers[ht]++;
    if (p.fw != null) fws.push(p.fw);
  }
  const fwSorted = Float64Array.from(fws).sort();
  (map.getSource("buildings") as GeoJSONSource).setData(b as GeoData);
  hideOwnBuildings(map, b.features.map((f) => f.properties.id));
  const stats: MapStats = { tiers, corridors: { derived: 0, buried_osm: 0, open: 0 }, fwSorted, total: b.features.length };
  const prev = VIEW.get(map);
  VIEW.set(map, { boxes: [], last: stats, pilot: c.features, tiles: prev?.tiles ?? new CorridorTiles(), emit: onStats });
  onStats(stats);
  void refreshCorridors(map);
  return fwSorted;
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function FloodMap(props: FloodMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fwRef = useRef<Float64Array | null>(null);
  const latest = useRef(props);
  const [mapReady, setMapReady] = useState(false);
  /** bumps whenever building data is (re)loaded, so paint expressions are rebuilt */
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    latest.current = props;
  });

  // Create the map once. Buildings start downloading right away, in parallel with MapLibre and the style.
  useEffect(() => {
    let disposed = false;
    let map: MlMap | null = null;
    const repo = (() => {
      try {
        return floodRepository();
      } catch (err) {
        latest.current.onError(err instanceof Error ? err.message : "Veri kaynağı yok");
        latest.current.onPhase("error");
        return null;
      }
    })();
    const data = repo
      ? Promise.all([repo.buildings(latest.current.cityId, SCENARIO_ID) as Promise<unknown>, loadCorridors(repo, latest.current.cityId)])
      : null;
    data?.catch(() => {}); // handled below; avoid an unhandled rejection before the map is up

    (async () => {
      const [{ Map, AttributionControl, NavigationControl }, urls] = await Promise.all([
        import("maplibre-gl"),
        setupProtocols(),
      ]);
      if (disposed || !container.current) return;
      const narrow = window.matchMedia("(max-width: 640px)").matches;
      const reduce = prefersReducedMotion();
      map = new Map({
        container: container.current,
        style: buildBaseStyle({ demTiles: urls.dem, contourTiles: urls.contours }),
        center: PILOT_CENTER,
        zoom: narrow ? 13.1 : 14,
        pitch: latest.current.tilted ? 52 : 0,
        bearing: -18,
        maxBounds: BOUNDS,
        maxPitch: 70,
        attributionControl: false,
        fadeDuration: reduce ? 0 : 300,
      });
      mapRef.current = map;
      (window as unknown as { __floodMap?: MlMap }).__floodMap = map; // debugging handle
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");
      if (!narrow) map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");

      map.on("load", async () => {
        if (!map) return;
        latest.current.onPhase("basemap");
        map.addSource("corridors", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("buildings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

        map.addLayer({
          id: "corridor-glow",
          type: "line",
          source: "corridors",
          filter: ["==", ["get", "kind"], "derived"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ff5a2b", "line-opacity": 0.18, "line-width": 9, "line-blur": 6 },
        });
        for (const kind of Object.keys(CORRIDOR_STYLE) as CorridorKind[]) {
          const s = CORRIDOR_STYLE[kind];
          map.addLayer({
            id: `corridor-${kind}`,
            type: "line",
            source: "corridors",
            filter: ["==", ["get", "kind"], kind],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": s.color,
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.4, 16, 3.2],
              ...(s.dash ? { "line-dasharray": s.dash } : {}),
            },
          });
        }
        map.addLayer({
          id: "buildings",
          type: "fill-extrusion",
          source: "buildings",
          filter: tierFilter(latest.current.activeTiers),
          paint: {
            "fill-extrusion-color": tierColor(null),
            "fill-extrusion-height": tierHeight(),
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.92,
          },
        });
        // alarm: steady once the first-contact moment has passed, blinking during it (each building on its own clock)
        for (const id of ["alarm", "alarm-blink"]) {
          map.addLayer({
            id,
            type: "fill-extrusion",
            source: "buildings",
            filter: NONE,
            paint: {
              "fill-extrusion-color": ["match", ["get", "tier"], "acil", "#ff5a2b", "#ffc23a"],
              "fill-extrusion-height": ["+", BASE_H, LIFT],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.95,
            },
          });
        }
        map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.32, position: [1.3, 210, 35] });

        map.on("click", ["buildings", "alarm", "alarm-blink"], (e) => {
          const f = e.features?.[0];
          latest.current.onSelect(f ? (f.properties as BuildingProps) : null);
        });
        map.on("click", (e) => {
          if (!map?.queryRenderedFeatures(e.point, { layers: ["buildings", "alarm", "alarm-blink"] }).length) latest.current.onSelect(null);
        });
        map.on("mouseenter", ["buildings", "alarm", "alarm-blink"], () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", ["buildings", "alarm", "alarm-blink"], () => map && (map.getCanvas().style.cursor = ""));
        setMapReady(true);
        map.on("moveend", () => {
          if (map) void refreshCorridors(map);
        });

        if (!data) return;
        try {
          const [braw, c] = await data;
          if (disposed || !map) return;
          fwRef.current = applyData(map, braw as FC, c, latest.current.onStats);
          setDataVersion((v) => v + 1);
          map.once("idle", () => latest.current.onPhase("ready"));
        } catch (err) {
          latest.current.onError(err instanceof Error ? err.message : "Veri yüklenemedi");
          latest.current.onPhase("error");
        }
      });
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  const { mode, scenario, showContours, showCorridors, tilted, activeTiers, selectedId } = props;

  // The scenario can appear after the first building download (it is uploaded separately). Then the
  // buildings came without impacts: fetch them once more so fw/md are there for playback.
  const scenarioReady = scenario != null;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !scenarioReady || dataVersion === 0 || (fwRef.current?.length ?? 0) > 0) return;
    let cancelled = false;
    const repo = floodRepository();
    Promise.all([repo.buildings(latest.current.cityId, SCENARIO_ID), loadCorridors(repo, latest.current.cityId)])
      .then(([b, c]) => {
        if (cancelled || !mapRef.current) return;
        const fw = applyData(mapRef.current, b as unknown as FC, c, latest.current.onStats);
        if (fw.length) {
          fwRef.current = fw;
          setDataVersion((v) => v + 1);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mapReady, scenarioReady, dataVersion]);

  // Water: the /sinema 3D surface (waves along the modelled flow, foam, reflections) as a custom layer.
  const grid = scenario?.grid ?? null;
  const frames = scenario?.frames ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !grid || !frames) return;
    // a previous run of this effect (dev double-invoke, fast refresh) may have left it behind
    if (map.getLayer("flood-water")) map.removeLayer("flood-water");
    const lowPower = window.matchMedia("(pointer: coarse)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    const water = new Water3DLayer(grid, "flood-water", lowPower);
    map.addLayer(water, "corridor-glow");
    map.setLayoutProperty("flood-water", "visibility", usePlayback.getState().mode === "scenario" ? "visible" : "none");
    const cellHa = (grid.res_m * grid.res_m) / 10_000;

    let raf = 0;
    let drawnKey = "";
    const draw = () => {
      raf = 0;
      const { t, playing, mode: m } = usePlayback.getState();
      if (m !== "scenario") return;
      frames.want(t, playing ? 16 : 4);
      const br = frames.bracket(t);
      if (!br) return;
      let a = frames.get(br.a);
      let b = frames.get(br.b);
      let alpha = br.alpha;
      if (!a) {
        a = frames.nearestLoaded(t);
        b = a;
        alpha = 0;
      } else if (!b) {
        b = a;
        alpha = 0;
      }
      if (!a || !b) return; // nothing streamed in yet; keep the previous picture
      const key = `${a.tMin}|${b.tMin}|${alpha.toFixed(3)}`;
      if (key === drawnKey) return;
      drawnKey = key;
      water.setFrames(a, b, alpha);
      let wet = 0;
      const da = a.depth;
      const db = b.depth;
      for (let i = 0, n = da.length; i < n; i++) if (da[i]! * (1 - alpha) + db[i]! * alpha > AREA_THRESHOLD_M) wet++;
      usePlayback.getState().setLiveHa(wet * cellHa);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const unsubT = usePlayback.subscribe((s, prev) => {
      if (s.t !== prev.t || s.mode !== prev.mode) schedule();
    });
    const unsubLoad = frames.onLoad((tm) => {
      const br = frames.bracket(usePlayback.getState().t);
      if (br && (tm === br.a || tm === br.b)) {
        drawnKey = "";
        schedule();
      }
    });
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      unsubT();
      unsubLoad();
      if (map.getLayer("flood-water")) map.removeLayer("flood-water");
    };
  }, [mapReady, grid, frames]);

  // Buildings follow the playhead: repaint only when the wet count actually changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const sel = selectedId;
    if (mode === "static") {
      map.setFilter("alarm", NONE);
      map.setFilter("alarm-blink", NONE);
      map.setFilter("buildings", tierFilter(activeTiers));
      map.setPaintProperty("buildings", "fill-extrusion-color", tierColor(sel));
      map.setPaintProperty("buildings", "fill-extrusion-height", tierHeight());
      return;
    }
    let applied = "";
    const apply = (t: number) => {
      const fws = fwRef.current;
      const n = fws ? countAtMost(fws, t) : 0; // reached by now
      const m = fws ? countAtMost(fws, t - BLINK_MIN) : 0; // reached long enough ago to stop blinking
      const key = `${n}|${m}`;
      if (key === applied) return;
      applied = key;
      // pin thresholds to fw values actually crossed so equal counts give identical expressions
      const tt = n > 0 && fws ? fws[n - 1]! : -1;
      const tm = m > 0 && fws ? fws[m - 1]! : -1;
      map.setPaintProperty("buildings", "fill-extrusion-color", wetColor(tt, sel));
      map.setPaintProperty("buildings", "fill-extrusion-height", wetHeight(tt));
      if (n > 0) {
        map.setFilter("alarm", m > 0 ? alarmFilter(tm, sel) : NONE);
        map.setFilter("alarm-blink", blinkFilter(tm, tt, sel));
        map.setFilter("buildings", ["!", alarmFilter(tt, sel)]);
      } else {
        map.setFilter("alarm", NONE);
        map.setFilter("alarm-blink", NONE);
        map.setFilter("buildings", null);
      }
    };
    apply(usePlayback.getState().t);
    const unsub = usePlayback.subscribe((s) => apply(s.t));
    return unsub;
  }, [mapReady, mode, activeTiers, selectedId, dataVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer("alarm-blink") || mode !== "scenario") return;
    if (prefersReducedMotion()) {
      map.setPaintProperty("alarm-blink", "fill-extrusion-opacity", 0.95);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const pulse = (now: number) => {
      raf = requestAnimationFrame(pulse);
      const s = 0.5 + 0.5 * Math.sin(((now - t0) / 1000) * Math.PI * 2 * 2.2);
      map.setPaintProperty("alarm-blink", "fill-extrusion-opacity", 0.3 + 0.7 * s);
    };
    raf = requestAnimationFrame(pulse);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer("flood-water")) return;
    map.setLayoutProperty("flood-water", "visibility", mode === "scenario" ? "visible" : "none");
  }, [mapReady, mode, grid, frames]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const id of CONTOUR_LAYERS) map.setLayoutProperty(id, "visibility", showContours ? "visible" : "none");
  }, [mapReady, showContours]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer("corridor-glow")) return;
    for (const id of ["corridor-glow", ...Object.keys(CORRIDOR_STYLE).map((k) => `corridor-${k}`)])
      map.setLayoutProperty(id, "visibility", showCorridors ? "visible" : "none");
  }, [mapReady, showCorridors]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: tilted ? 52 : 0, duration: prefersReducedMotion() ? 0 : 700 });
  }, [tilted]);

  // maplibre-gl.css sets the container to position:relative, so size it from a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="region" aria-label="Sarıyer pilot alanı sel analiz haritası" />
    </div>
  );
}

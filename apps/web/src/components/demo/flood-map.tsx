"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type {
  Map as MlMap,
  CanvasSource,
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
} from "maplibre-gl";
import { tierFromHand, type BuildingProps, type CorridorProps, type GridMeta, type Tier } from "@floodograph/core";
import { floodRepository } from "@/lib/repository";
import { CORRIDOR_STYLE, TIER_COLOR, TIER_ORDER, type CorridorKind } from "@/lib/tier-style";
import { usePlayback, type DemoMode } from "@/lib/playback-store";
import { AREA_THRESHOLD_M, SCENARIO_ID, countAtMost } from "@/lib/scenario";
import { WaterPainter, type FrameStore } from "@/lib/water-frames";
import { buildBaseStyle, CONTOUR_LAYERS } from "./map-style";

type GeoData = GeoJSONSourceSpecification["data"];
type Feature = { type: "Feature"; id?: number; geometry: unknown; properties: BuildingProps & { ht?: Tier } };
type FC = { type: "FeatureCollection"; features: Feature[] };

export const AYAZAGA: [number, number] = [29.0175, 41.105];
const BOUNDS: [[number, number], [number, number]] = [
  [28.94, 41.05],
  [29.1, 41.16],
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

const tierFilter = (tiers: readonly Tier[]): ExpressionSpecification => ["in", ["get", "ht"], ["literal", [...tiers]]];

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function FloodMap(props: FloodMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fwRef = useRef<Float64Array | null>(null);
  const latest = useRef(props);
  const [mapReady, setMapReady] = useState(false);
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
      ? Promise.all([repo.buildings(latest.current.cityId, SCENARIO_ID) as Promise<unknown>, repo.corridors(latest.current.cityId)])
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
        center: AYAZAGA,
        zoom: narrow ? 13.2 : 14.2,
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
            "fill-extrusion-height": ["coalesce", ["get", "h"], 9],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.92,
          },
        });
        map.setLight({ anchor: "viewport", color: "#ffffff", intensity: 0.32, position: [1.3, 210, 35] });

        map.on("click", "buildings", (e) => {
          const f = e.features?.[0];
          latest.current.onSelect(f ? (f.properties as BuildingProps) : null);
        });
        map.on("click", (e) => {
          if (!map?.queryRenderedFeatures(e.point, { layers: ["buildings"] }).length) latest.current.onSelect(null);
        });
        map.on("mouseenter", "buildings", () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "buildings", () => map && (map.getCanvas().style.cursor = ""));
        setMapReady(true);

        if (!data) return;
        try {
          const [braw, c] = await data;
          if (disposed || !map) return;
          const b = braw as FC;
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
          fwRef.current = fwSorted;
          (map.getSource("buildings") as GeoJSONSource).setData(b as GeoData);
          (map.getSource("corridors") as GeoJSONSource).setData(c as GeoData);
          const corridors = { derived: 0, buried_osm: 0, open: 0 } as Record<CorridorKind, number>;
          for (const f of c.features as { properties: CorridorProps }[]) corridors[f.properties.kind]++;
          latest.current.onStats({ tiers, corridors, fwSorted, total: b.features.length });
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

  // Water: canvas source pinned to the simulation grid corners, painted from the frame store.
  const grid = scenario?.grid ?? null;
  const frames = scenario?.frames ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !grid || !frames) return;
    const painter = new WaterPainter(grid);
    // a previous run of this effect (dev double-invoke, fast refresh) may have left them behind
    if (map.getLayer("water")) map.removeLayer("water");
    if (map.getSource("water")) map.removeSource("water");
    map.addSource("water", { type: "canvas", canvas: painter.canvas, animate: false, coordinates: grid.corners_lonlat });
    map.addLayer(
      {
        id: "water",
        type: "raster",
        source: "water",
        layout: { visibility: usePlayback.getState().mode === "scenario" ? "visible" : "none" },
        paint: { "raster-opacity": 0.92, "raster-resampling": "linear", "raster-fade-duration": 0 },
      },
      "corridor-glow",
    );
    const source = map.getSource("water") as CanvasSource;

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
      const ha = painter.paint(a, b, alpha, AREA_THRESHOLD_M);
      usePlayback.getState().setLiveHa(ha);
      // copy the canvas into the GL texture once (play() then pause() uploads a single frame)
      source.play();
      source.pause();
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
      if (map.getLayer("water")) map.removeLayer("water");
      if (map.getSource("water")) map.removeSource("water");
    };
  }, [mapReady, grid, frames]);

  // Buildings follow the playhead: repaint only when the wet count actually changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const sel = selectedId;
    if (mode === "static") {
      map.setFilter("buildings", tierFilter(activeTiers));
      map.setPaintProperty("buildings", "fill-extrusion-color", tierColor(sel));
      return;
    }
    map.setFilter("buildings", null);
    let applied = -1;
    const apply = (t: number) => {
      const n = fwRef.current ? countAtMost(fwRef.current, t) : 0;
      if (n === applied) return;
      applied = n;
      // pin the threshold to the latest fw actually crossed so equal counts give identical expressions
      const tt = n > 0 && fwRef.current ? fwRef.current[n - 1]! : -1;
      map.setPaintProperty("buildings", "fill-extrusion-color", wetColor(tt, sel));
    };
    apply(usePlayback.getState().t);
    const unsub = usePlayback.subscribe((s) => apply(s.t));
    return unsub;
  }, [mapReady, mode, activeTiers, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer("water")) return;
    map.setLayoutProperty("water", "visibility", mode === "scenario" ? "visible" : "none");
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
      <div ref={container} className="h-full w-full" role="region" aria-label="Ayazağa sel analiz haritası" />
    </div>
  );
}

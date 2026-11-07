"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Map as MlMap, ExpressionSpecification, GeoJSONSource, GeoJSONSourceSpecification } from "maplibre-gl";

type GeoData = GeoJSONSourceSpecification["data"];
import type { BuildingProps, CorridorProps, Tier } from "@floodograph/core";
import { floodRepository } from "@/lib/repository";
import { CORRIDOR_STYLE, TIER_COLOR, TIER_ORDER, type CorridorKind } from "@/lib/tier-style";
import { buildBaseStyle, CONTOUR_LAYERS } from "./map-style";

export const AYAZAGA: [number, number] = [29.0175, 41.105];
const BOUNDS: [[number, number], [number, number]] = [
  [28.94, 41.05],
  [29.1, 41.16],
];
/** Copied from maplibre-gl/dist by scripts/copy-maplibre-worker.mjs (pre-dev / pre-build). */
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";
const TERRARIUM = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

export type MapStats = {
  tiers: Record<Tier, number>;
  corridors: Record<CorridorKind, number>;
};

export type FloodMapProps = {
  cityId: string;
  showContours: boolean;
  showCorridors: boolean;
  tilted: boolean;
  activeTiers: readonly Tier[];
  selectedId: number | null;
  onStats: (s: MapStats) => void;
  onSelect: (b: BuildingProps | null) => void;
  onError: (message: string) => void;
  /** Hook for later layers (3D flood scene, water frames). */
  onReady?: (map: MlMap) => void;
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

const tierColor = (selectedId: number | null): ExpressionSpecification => {
  const byTier: ExpressionSpecification = [
    "match",
    ["get", "tier"],
    ...TIER_ORDER.flatMap((t) => [t, TIER_COLOR[t]]),
    TIER_COLOR.izle,
  ] as unknown as ExpressionSpecification;
  return selectedId == null ? byTier : ["case", ["==", ["get", "id"], selectedId], "#ffffff", byTier];
};

const tierFilter = (tiers: readonly Tier[]): ExpressionSpecification => [
  "in",
  ["get", "tier"],
  ["literal", [...tiers]],
];

export function FloodMap(props: FloodMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let map: MlMap | null = null;
    (async () => {
      const [{ Map, AttributionControl, NavigationControl }, urls] = await Promise.all([
        import("maplibre-gl"),
        setupProtocols(),
      ]);
      if (disposed || !container.current) return;
      const narrow = window.matchMedia("(max-width: 640px)").matches;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      map = new Map({
        container: container.current,
        style: buildBaseStyle({ demTiles: urls.dem, contourTiles: urls.contours }),
        center: AYAZAGA,
        zoom: narrow ? 13.4 : 14.2,
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

        latest.current.onReady?.(map);

        try {
          const repo = floodRepository();
          const [b, c] = await Promise.all([
            repo.buildings(latest.current.cityId, null),
            repo.corridors(latest.current.cityId),
          ]);
          if (disposed || !map) return;
          (map.getSource("buildings") as GeoJSONSource).setData(b as GeoData);
          (map.getSource("corridors") as GeoJSONSource).setData(c as GeoData);
          const tiers = { acil: 0, yuksek: 0, orta: 0, izle: 0 } as Record<Tier, number>;
          for (const f of b.features as { properties: BuildingProps }[]) tiers[f.properties.tier]++;
          const corridors = { derived: 0, buried_osm: 0, open: 0 } as Record<CorridorKind, number>;
          for (const f of c.features as { properties: CorridorProps }[]) corridors[f.properties.kind]++;
          latest.current.onStats({ tiers, corridors });
        } catch (err) {
          latest.current.onError(err instanceof Error ? err.message : "Veri yüklenemedi");
        }
      });
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync props to the live map.
  const { showContours, showCorridors, tilted, activeTiers, selectedId } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const id of CONTOUR_LAYERS) map.setLayoutProperty(id, "visibility", showContours ? "visible" : "none");
  }, [showContours]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("corridor-glow")) return;
    for (const id of ["corridor-glow", ...Object.keys(CORRIDOR_STYLE).map((k) => `corridor-${k}`)])
      map.setLayoutProperty(id, "visibility", showCorridors ? "visible" : "none");
  }, [showCorridors]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({ pitch: tilted ? 52 : 0, duration: reduce ? 0 : 700 });
  }, [tilted]);
  useEffect(() => {
    if (mapRef.current?.getLayer("buildings")) mapRef.current.setFilter("buildings", tierFilter(activeTiers));
  }, [activeTiers]);
  useEffect(() => {
    if (mapRef.current?.getLayer("buildings"))
      mapRef.current.setPaintProperty("buildings", "fill-extrusion-color", tierColor(selectedId));
  }, [selectedId]);

  // maplibre-gl.css sets the container to position:relative, so size it from a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" role="region" aria-label="Ayazağa sel analiz haritası" />
    </div>
  );
}

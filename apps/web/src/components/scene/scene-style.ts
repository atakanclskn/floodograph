import type { ExpressionSpecification, Map as MlMap, StyleSpecification } from "maplibre-gl";
import { TERRARIUM_URL } from "./terrain";

/** Night-quiet base for the cinematic scene: terrain, water, a hint of roads. The flood carries the colour. */
export const FOG = "#0b1216";

/**
 * Every OSM building in the country as a 3D extrusion (OpenFreeMap). Where we draw our own analysed buildings,
 * the basemap copies are hidden by OSM id (see hideOwnBuildings), so no building is drawn twice.
 */
export function basemapBuildings(color = "#1d262b", windows = false): never {
  return {
    id: "basemap-buildings",
    type: "fill-extrusion",
    source: "omt",
    "source-layer": "building",
    minzoom: 13,
    paint: {
      "fill-extrusion-color": color,
      // night facades: a tiled pattern of lit / dark windows (installWindowPattern registers the image)
      ...(windows ? { "fill-extrusion-pattern": WINDOW_PATTERN } : {}),
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 9],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.95],
    },
  } as never;
}

/**
 * Hide the basemap copies of buildings we draw ourselves. OpenFreeMap (Planetiler/OpenMapTiles) feature ids are
 * OSM id x 10 + an element-type digit, and our building ids are OSM ids (negative for relations; ML footprints
 * use ids from 9e12 and have no basemap copy). A `match` over the id list is a hash lookup, cheap per feature.
 * (A location filter would not work: MapLibre's `within` is only defined for points and lines, not polygons.)
 */
export function hideOwnBuildings(map: MlMap, ids: Iterable<number>) {
  if (!map.getLayer("basemap-buildings")) return;
  const labels = [...new Set([...ids].filter((id) => Number.isFinite(id) && Math.abs(id) < 9e12).map((id) => Math.abs(id)))];
  if (!labels.length) return;
  const osmId: ExpressionSpecification = ["floor", ["/", ["to-number", ["coalesce", ["id"], 0]], 10]];
  map.setFilter("basemap-buildings", ["match", osmId, labels, false, true] as unknown as ExpressionSpecification);
}

export const WINDOW_PATTERN = "fg-windows";

/**
 * Register the night-window facade pattern used by basemapBuildings(.., true): a grid of windows on a dark wall,
 * about a third lit in warm tones, seeded so it is stable between visits. Decorative.
 */
export function installWindowPattern(map: MlMap) {
  const W = 48;
  const H = 48;
  const data = new Uint8Array(W * H * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wall = [27, 34, 39];
  for (let i = 0; i < W * H; i++) data.set([wall[0]!, wall[1]!, wall[2]!, 255], i * 4);
  const cell = 12;
  for (let cy = 0; cy < H / cell; cy++)
    for (let cx = 0; cx < W / cell; cx++) {
      const lit = rand() < 0.36;
      const warm = rand();
      const c = lit ? (warm < 0.7 ? [255, 196, 120] : [255, 226, 168]) : [14, 20, 24];
      for (let y = cy * cell + 3; y < cy * cell + 10; y++)
        for (let x = cx * cell + 3; x < cx * cell + 9; x++) data.set([c[0]!, c[1]!, c[2]!, 255], (y * W + x) * 4);
    }
  const add = () => {
    try {
      if (!map.hasImage(WINDOW_PATTERN)) map.addImage(WINDOW_PATTERN, { width: W, height: H, data });
    } catch {
      // style not ready yet: styleimagemissing below adds it when a tile first asks for it
    }
  };
  add();
  map.on("styleimagemissing", (e: { id: string }) => {
    if (e.id === WINDOW_PATTERN) add();
  });
}

export function sceneStyle(): StyleSpecification {
  const dem = { type: "raster-dem" as const, encoding: "terrarium" as const, tiles: [TERRARIUM_URL], tileSize: 256, maxzoom: 15 };
  const road = (classes: string[]) => ["match", ["get", "class"], classes, true, false] as never;
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      },
      terrain: { ...dem, attribution: "Mapzen Terrain" },
      hills: dem,
    },
    terrain: { source: "terrain", exaggeration: 1 },
    sky: {
      "sky-color": "#06090b",
      "horizon-color": "#1a2328",
      "fog-color": FOG,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": 0,
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0c1317" } },
      {
        id: "landcover",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "grass", "farmland"], true, false],
        paint: { "fill-color": "#0f1915", "fill-opacity": 0.85 },
      },
      {
        id: "park",
        type: "fill",
        source: "omt",
        "source-layer": "park",
        paint: { "fill-color": "#101b16", "fill-opacity": 0.7 },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "hills",
        paint: {
          "hillshade-exaggeration": 0.5,
          "hillshade-shadow-color": "#040607",
          "hillshade-highlight-color": "#26343b",
          "hillshade-accent-color": "#0c1317",
          "hillshade-illumination-direction": 315,
        },
      },
      {
        id: "water",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: { "fill-color": "#143f63" },
      },
      {
        id: "road-minor",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: road(["minor", "service"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1b2429", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 0.5, 18, 9] },
      },
      {
        id: "road-major",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: road(["motorway", "trunk", "primary", "secondary", "tertiary"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#2a3439",
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.8, 18, 18],
        },
      },
      {
        id: "road-glow",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: road(["motorway", "trunk", "primary"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#c98a4a",
          "line-opacity": 0.16,
          "line-blur": 2,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.6, 18, 6],
        },
      },
      basemapBuildings("#1d262b", true),
      {
        id: "place-label",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood", "town"], true, false],
        layout: {
          "text-field": ["coalesce", ["get", "name:tr"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
          "text-letter-spacing": 0.12,
          "text-transform": "uppercase",
        },
        paint: { "text-color": "#7f8d93", "text-halo-color": "#0b1115", "text-halo-width": 1.4, "text-opacity": 0.85 },
      },
    ],
  };
}

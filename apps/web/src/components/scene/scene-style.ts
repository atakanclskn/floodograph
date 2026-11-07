import type { StyleSpecification } from "maplibre-gl";
import { TERRARIUM_URL } from "./terrain";

/** Night-quiet base for the cinematic scene: terrain, water, a hint of roads. The flood carries the colour. */
export const FOG = "#0b1216";

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
        paint: { "fill-color": "#0e2029" },
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

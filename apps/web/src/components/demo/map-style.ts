import type { StyleSpecification } from "maplibre-gl";

/**
 * Our own minimal dark style over OpenFreeMap vector tiles (OpenMapTiles schema).
 * Kept quiet on purpose: terrain, water and roads only; our data carries the colour.
 */
export function buildBaseStyle(opts: { demTiles: string; contourTiles: string }): StyleSpecification {
  const road = (classes: string[]) => ["match", ["get", "class"], classes, true, false];
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
      dem: {
        type: "raster-dem",
        encoding: "terrarium",
        tiles: [opts.demTiles],
        tileSize: 256,
        maxzoom: 15,
        attribution: "Mapzen Terrain",
      },
      contours: { type: "vector", tiles: [opts.contourTiles], maxzoom: 15 },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b1115" } },
      {
        id: "park",
        type: "fill",
        source: "omt",
        "source-layer": "park",
        paint: { "fill-color": "#0f1a17", "fill-opacity": 0.8 },
      },
      {
        id: "landcover-wood",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "grass"], true, false],
        paint: { "fill-color": "#0e1816", "fill-opacity": 0.7 },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "dem",
        paint: {
          "hillshade-exaggeration": 0.35,
          "hillshade-shadow-color": "#05080a",
          "hillshade-highlight-color": "#1c2a31",
          "hillshade-accent-color": "#0b1115",
        },
      },
      {
        id: "water",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: { "fill-color": "#10232d" },
      },
      {
        id: "waterway",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        paint: { "line-color": "#1d3b4a", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 2] },
      },
      {
        id: "road-minor",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: road(["minor", "service", "track"]) as never,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#1a2328",
          "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 13, 0.4, 17, 5],
        },
      },
      {
        id: "road-major",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: road(["motorway", "trunk", "primary", "secondary", "tertiary"]) as never,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#253137",
          "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 11, 0.8, 17, 10],
        },
      },
      {
        id: "contour-minor",
        type: "line",
        source: "contours",
        "source-layer": "contours",
        filter: ["==", ["get", "level"], 0],
        paint: { "line-color": "rgba(111,168,201,0.16)", "line-width": 0.6 },
      },
      {
        id: "contour-major",
        type: "line",
        source: "contours",
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        paint: { "line-color": "rgba(111,168,201,0.38)", "line-width": 1.1 },
      },
      {
        id: "contour-label",
        type: "symbol",
        source: "contours",
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        layout: {
          "symbol-placement": "line",
          "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
        },
        paint: { "text-color": "rgba(150,190,212,0.75)", "text-halo-color": "#0b1115", "text-halo-width": 1.2 },
      },
      {
        id: "place-label",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood", "town", "village"], true, false],
        layout: {
          "text-field": ["coalesce", ["get", "name:tr"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 14],
          "text-letter-spacing": 0.04,
          "text-transform": "uppercase",
        },
        paint: { "text-color": "#8c999f", "text-halo-color": "#0b1115", "text-halo-width": 1.5 },
      },
    ],
  };
}

export const CONTOUR_LAYERS = ["contour-minor", "contour-major", "contour-label"] as const;

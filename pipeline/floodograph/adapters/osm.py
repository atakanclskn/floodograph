"""OpenStreetMap adapter (Overpass via osmnx). © OpenStreetMap contributors, ODbL."""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd

ox.settings.use_cache = True
ox.settings.log_console = False
ox.settings.requests_timeout = 180

CRITICAL_TAGS = {
    "amenity": ["hospital", "clinic", "school", "kindergarten", "university", "fire_station", "nursing_home"],
    "healthcare": ["hospital"],
    "social_facility": ["nursing_home", "assisted_living"],
}
CRITICAL_MAP = {
    "hospital": "hastane", "clinic": "hastane",
    "school": "okul", "kindergarten": "okul", "university": "okul",
    "fire_station": "itfaiye",
    "nursing_home": "bakimevi", "assisted_living": "bakimevi",
}
FLOOR_HEIGHT_M = 3.0
DEFAULT_HEIGHT_M = 9.0


def _bbox(b):  # osmnx 2.x expects (left, bottom, right, top)
    w, s, e, n = b
    return (w, s, e, n)


# Free public Overpass mirrors, tried in order with exponential backoff (the main one is often at capacity).
OVERPASS_URLS = [
    "https://overpass-api.de/api",
    "https://overpass.kumi.systems/api",
    "https://overpass.private.coffee/api",
]


def _features(bbox, tags) -> gpd.GeoDataFrame:
    import time

    last: Exception | None = None
    for attempt in range(6):
        ox.settings.overpass_url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        try:
            return ox.features.features_from_bbox(_bbox(bbox), tags=tags)
        except ox._errors.InsufficientResponseError:
            raise
        except Exception as e:  # 429/502/504 or timeouts: back off and try the next mirror
            last = e
            time.sleep(min(60, 5 * 2**attempt))
    raise RuntimeError(f"Overpass failed after retries: {last}")


def buildings(bbox) -> gpd.GeoDataFrame:
    """Building footprints with an estimated height (m). WGS84."""
    gdf = _features(bbox, {"building": True})
    gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    height = pd.to_numeric(gdf.get("height", pd.Series(index=gdf.index, dtype=float)), errors="coerce")
    levels = pd.to_numeric(gdf.get("building:levels", pd.Series(index=gdf.index, dtype=float)), errors="coerce")
    gdf["height_m"] = height.fillna(levels * FLOOR_HEIGHT_M).fillna(DEFAULT_HEIGHT_M).clip(3, 250)
    gdf = gdf.reset_index()
    gdf["osm_id"] = np.where(gdf["element"] == "way", gdf["id"], -gdf["id"])  # relations negative
    return gdf[["osm_id", "height_m", "geometry"]].set_crs(4326, allow_override=True)


def critical_facilities(bbox) -> gpd.GeoDataFrame:
    """Hospitals, schools, fire stations and care homes (points or polygons) with a Turkish category."""
    gdf = _features(bbox, CRITICAL_TAGS).reset_index()
    cat = pd.Series([None] * len(gdf), dtype=object)
    for col in ("amenity", "healthcare", "social_facility"):
        if col in gdf:
            cat = cat.fillna(gdf[col].map(CRITICAL_MAP))
    gdf["critical"] = cat
    return gdf.dropna(subset=["critical"])[["critical", "geometry"]].set_crs(4326, allow_override=True)


def waterways(bbox) -> gpd.GeoDataFrame:
    """Streams/rivers/drains; `buried` = culverted or tunnelled (the real buried streams in OSM)."""
    tags = {"waterway": ["river", "stream", "canal", "drain", "ditch", "brook"]}
    try:
        gdf = _features(bbox, tags).reset_index()
    except ox._errors.InsufficientResponseError:
        return gpd.GeoDataFrame({"name": [], "buried": [], "geometry": []}, crs=4326)
    gdf = gdf[gdf.geometry.geom_type.isin(["LineString", "MultiLineString"])].copy()
    tunnel = gdf.get("tunnel", pd.Series(index=gdf.index, dtype=object)).fillna("")
    layer = pd.to_numeric(gdf.get("layer", pd.Series(index=gdf.index, dtype=object)), errors="coerce").fillna(0)
    gdf["buried"] = tunnel.isin(["culvert", "yes", "flooded"]) | (layer < 0)
    gdf["name"] = gdf.get("name", pd.Series(index=gdf.index, dtype=object))
    return gdf[["name", "buried", "geometry"]].set_crs(4326, allow_override=True)

"""Overture Maps buildings: OpenStreetMap footprints plus Microsoft / Google ML footprints, ODbL.

In much of Türkiye OSM misses whole neighbourhoods (in the Sarıyer pilot ~30 % of buildings); Overture's
conflated layer fills them from satellite-derived footprints. OSM-sourced records keep their OSM id (ways
positive, relations negative, as in osm.py); ML footprints get synthetic ids from ML_ID_BASE up.
© OpenStreetMap contributors, © Microsoft, Overture Maps Foundation — ODbL.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

FLOOR_HEIGHT_M = 3.0
DEFAULT_HEIGHT_M = 9.0
ML_ID_BASE = 9_000_000_000_000  # far above any OSM id


def _download(bbox, path: Path, kind: str = "building") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    w, s, e, n = bbox
    exe = Path(sys.executable).with_name("overturemaps.exe" if sys.platform == "win32" else "overturemaps")
    subprocess.run([str(exe), "download", f"--bbox={w},{s},{e},{n}", "-f", "geoparquet", f"--type={kind}",
                    "-o", str(path)], check=True)


def waterways(bbox, cache_dir: Path) -> gpd.GeoDataFrame:
    """Streams/rivers/drains from Overture's water theme (OSM-derived), same columns as osm.waterways.
    Used when Overpass cannot serve a whole metropolitan area; `buried` from culvert/tunnel hints."""
    path = cache_dir / "overture_water.parquet"
    if not path.exists():
        _download(bbox, path, "water")
    g = gpd.read_parquet(path)
    g = g[g.geometry.geom_type.isin(["LineString", "MultiLineString"])].copy()
    cls = g.get("class", pd.Series(index=g.index, dtype=object)).fillna("").astype(str)
    sub = g.get("subtype", pd.Series(index=g.index, dtype=object)).fillna("").astype(str)
    g = g[sub.isin(["river", "stream", "canal", "water"]) | cls.isin(["river", "stream", "canal", "drain", "ditch", "brook"])]
    cls = cls.loc[g.index]
    level = pd.to_numeric(g.get("level", pd.Series(index=g.index, dtype=float)), errors="coerce").fillna(0)
    g["buried"] = cls.str.contains("culvert|tunnel") | (level < 0)
    names = g.get("names", pd.Series(index=g.index, dtype=object))
    g["name"] = names.apply(lambda d: d.get("primary") if isinstance(d, dict) else None)
    out = gpd.GeoDataFrame(pd.DataFrame({"name": g["name"].values, "buried": g["buried"].values}), geometry=list(g.geometry.values))
    return out.set_crs(4326, allow_override=True)


def _osm_id(rec: str | None) -> float:
    """OSM record ids look like "w123456789@4" (way) or "r42@1" (relation)."""
    if not rec:
        return np.nan
    num = rec.partition("@")[0][1:]
    if not num.isdigit():
        return np.nan
    return float(num) if rec[0] == "w" else -float(num) if rec[0] == "r" else np.nan


def buildings(bbox, cache_dir: Path, osm_heights: pd.Series | None = None) -> gpd.GeoDataFrame:
    """Footprints with an estimated height (m) and their source. WGS84.

    osm_heights: optional height_m indexed by osm_id (from osm.buildings) to keep OSM's levels/height tags.
    """
    path = cache_dir / "overture_buildings.parquet"
    if not path.exists():
        _download(bbox, path)
    g = gpd.read_parquet(path)
    g = g[g.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    first = g["sources"].apply(lambda s: s[0] if s is not None and len(s) else {})
    g["source"] = first.apply(lambda d: d.get("dataset") or "?")
    g["osm_id"] = first.apply(lambda d: _osm_id(d.get("record_id")) if d.get("dataset") == "OpenStreetMap" else np.nan)
    ml = g["osm_id"].isna().to_numpy()
    g.loc[ml, "osm_id"] = ML_ID_BASE + np.arange(int(ml.sum()))
    g = g.drop_duplicates("osm_id")

    height = pd.to_numeric(g["height"], errors="coerce")
    floors = pd.to_numeric(g["num_floors"], errors="coerce")
    est = height.fillna(floors * FLOOR_HEIGHT_M)
    if osm_heights is not None:
        est = est.fillna(g["osm_id"].map(osm_heights))
    g["height_m"] = est.fillna(DEFAULT_HEIGHT_M).clip(3, 250)
    g["osm_id"] = g["osm_id"].astype("int64")
    return g[["osm_id", "height_m", "source", "geometry"]].set_crs(4326, allow_override=True).reset_index(drop=True)


# Overture place categories -> our critical-facility classes
CRITICAL_CATEGORIES = {
    "hospital": "hastane", "emergency_room": "hastane", "medical_center": "hastane",
    "school": "okul", "elementary_school": "okul", "middle_school": "okul", "high_school": "okul",
    "public_school": "okul", "private_school": "okul", "preschool": "okul", "kindergarten": "okul",
    "fire_station": "itfaiye", "fire_department": "itfaiye",
    "retirement_home": "bakimevi", "nursing_home": "bakimevi", "assisted_living_facility": "bakimevi",
}


def critical_facilities(bbox, cache_dir: Path) -> gpd.GeoDataFrame:
    """Hospitals, schools, fire stations and care homes from Overture places (points), like osm.critical_facilities."""
    path = cache_dir / "overture_places.parquet"
    if not path.exists():
        _download(bbox, path, "place")
    g = gpd.read_parquet(path)
    def crit(row):
        tax = row.get("taxonomy")
        cands = [row.get("basic_category")]
        if isinstance(tax, dict):
            cands += [tax.get("primary"), *list(tax.get("hierarchy") if tax.get("hierarchy") is not None else [])]
        for c in cands:
            if c in CRITICAL_CATEGORIES:
                return CRITICAL_CATEGORIES[c]
        return None

    g["critical"] = g.apply(crit, axis=1)
    g = g[g["confidence"].fillna(0) >= 0.5]
    g = g.dropna(subset=["critical"])
    out = gpd.GeoDataFrame(pd.DataFrame({"critical": g["critical"].values}), geometry=list(g.geometry.values))
    return out.set_crs(4326, allow_override=True)

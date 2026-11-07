"""DEM adapters (Ports & Adapters). Each returns a Grid reprojected to the city's UTM zone.

FabdemSource   bare-earth (buildings + forest removed) Copernicus GLO-30, CC BY-NC-SA 4.0.
               Community mirror on Hugging Face (pavelzaitsau/fabdem-v12) of the University of Bristol release.
CopernicusSource  Copernicus GLO-30 DSM from the AWS open-data bucket (fallback; includes buildings).
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Protocol

import numpy as np
import rasterio
import requests
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds

from ..config import DATA_DIR
from ..domain import Grid

TILES_DIR = DATA_DIR / "_tiles"


class DemSource(Protocol):
    id: str

    def tile_paths(self, bbox: tuple[float, float, float, float]) -> list[Path]: ...


def _tile_names(bbox: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    w, s, e, n = bbox
    return [
        (lat, lon)
        for lat in range(math.floor(s), math.floor(n) + 1)
        for lon in range(math.floor(w), math.floor(e) + 1)
    ]


def _download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.replace(dest)
    return dest


def _ns(lat: int) -> str:
    return f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"


def _ew(lon: int, width: int = 3) -> str:
    return f"{'E' if lon >= 0 else 'W'}{abs(lon):0{width}d}"


class FabdemSource:
    id = "fabdem-v1-2"
    BASE = "https://huggingface.co/datasets/pavelzaitsau/fabdem-v12/resolve/main/tiles"

    def tile_paths(self, bbox):
        out = []
        for lat, lon in _tile_names(bbox):
            name = f"{_ns(lat)}{_ew(lon)}_FABDEM_V1-2.tif"
            # tiles are grouped in 10x10 degree packages named by their SW/NE corners
            la0, lo0 = math.floor(lat / 10) * 10, math.floor(lon / 10) * 10
            pkg = f"{_ns(la0)}{_ew(lo0)}-{_ns(la0 + 10)}{_ew(lo0 + 10)}_FABDEM_V1-2"
            out.append(_download(f"{self.BASE}/{pkg}/{name}", TILES_DIR / "fabdem" / name))
        return out


class CopernicusSource:
    id = "copernicus-glo30"
    BASE = "https://copernicus-dem-30m.s3.amazonaws.com"

    def tile_paths(self, bbox):
        out = []
        for lat, lon in _tile_names(bbox):
            stem = f"Copernicus_DSM_COG_10_{_ns(lat)}_00_{_ew(lon)}_00_DEM"
            out.append(_download(f"{self.BASE}/{stem}/{stem}.tif", TILES_DIR / "copernicus" / f"{stem}.tif"))
        return out


def load_dem(source: DemSource, bbox_wgs84, epsg: int, res_m: float) -> Grid:
    """Mosaic tiles, crop to bbox and reproject to UTM at res_m (bilinear)."""
    srcs = [rasterio.open(p) for p in source.tile_paths(bbox_wgs84)]
    try:
        mosaic, mtf = merge(srcs, bounds=bbox_wgs84)
        src_crs = srcs[0].crs
        nodata = srcs[0].nodata
    finally:
        for s in srcs:
            s.close()
    data = mosaic[0].astype(np.float32)
    if nodata is not None:
        data[data == nodata] = np.nan

    dst_crs = f"EPSG:{epsg}"
    left, bottom, right, top = transform_bounds("EPSG:4326", dst_crs, *bbox_wgs84)
    width = int(math.ceil((right - left) / res_m))
    height = int(math.ceil((top - bottom) / res_m))
    dst_tf = from_origin(left, top, res_m, res_m)
    out = np.full((height, width), np.nan, dtype=np.float32)
    reproject(
        source=data, destination=out,
        src_transform=mtf, src_crs=src_crs, src_nodata=np.nan,
        dst_transform=dst_tf, dst_crs=dst_crs, dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    return Grid(data=out, transform=dst_tf, epsg=epsg)

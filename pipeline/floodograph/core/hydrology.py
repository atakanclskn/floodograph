"""Terrain hydrology: conditioning, D8 flow direction, accumulation, HAND and the drainage network.

Pure computation on a projected Grid; pysheds needs a raster file, so we round-trip through a temp GeoTIFF.
HAND = Height Above Nearest Drainage (Rennó et al. 2008, Nobre et al. 2011): vertical distance from a cell
to the drainage cell it flows into.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import rasterio
from pysheds.grid import Grid as PyGrid
from scipy import ndimage

from ..domain import Grid, HydroResult

NODATA = -9999.0

# pysheds 0.5 still calls np.in1d, removed in NumPy 2.4+. Shim it instead of pinning an old NumPy.
if not hasattr(np, "in1d"):
    np.in1d = lambda ar1, ar2, assume_unique=False, invert=False: np.isin(  # type: ignore[attr-defined]
        np.ravel(ar1), ar2, assume_unique=assume_unique, invert=invert
    )


def fill_nodata_nearest(a: np.ndarray) -> np.ndarray:
    """Fill NaNs (reprojection corners, sea voids) with the nearest valid value."""
    mask = np.isnan(a)
    if not mask.any():
        return a
    idx = ndimage.distance_transform_edt(mask, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def drainage_network(dem: Grid, stream_threshold_km2: float = 0.25) -> tuple[HydroResult, dict]:
    """Return conditioned hydrology plus the stream network as GeoJSON (in the DEM's CRS)."""
    data = fill_nodata_nearest(dem.data.astype(np.float64))
    cell_area_km2 = (dem.cell**2) / 1e6
    thr_cells = max(1, int(round(stream_threshold_km2 / cell_area_km2)))

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "dem.tif"
        with rasterio.open(
            path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1], count=1,
            dtype="float64", crs=f"EPSG:{dem.epsg}", transform=dem.transform, nodata=NODATA,
        ) as dst:
            dst.write(data, 1)
        g = PyGrid.from_raster(str(path))
        raw = g.read_raster(str(path))

    pits = g.fill_pits(raw)
    flooded = g.fill_depressions(pits)
    inflated = g.resolve_flats(flooded)
    fdir = g.flowdir(inflated)
    acc = g.accumulation(fdir)
    streams = np.asarray(acc) > thr_cells
    hand = g.compute_hand(fdir, inflated, acc > thr_cells)
    network = g.extract_river_network(fdir, acc > thr_cells)

    hand_a = np.clip(np.asarray(hand, dtype=np.float64), 0, None)
    hand_a[~np.isfinite(hand_a)] = np.nan
    result = HydroResult(
        dem=dem.with_data(np.asarray(inflated, dtype=np.float32)),
        fdir=dem.with_data(np.asarray(fdir)),
        acc=dem.with_data(np.asarray(acc, dtype=np.float64)),
        hand=dem.with_data(hand_a.astype(np.float32)),
        streams_mask=streams,
        meta={"stream_threshold_km2": stream_threshold_km2, "threshold_cells": thr_cells,
              "cell_m": dem.cell, "depressions_filled_m3": float(np.nansum(np.asarray(flooded) - np.asarray(pits)) * dem.cell**2)},
    )
    return result, dict(network)


def sample(grid: Grid, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Nearest-cell lookup of projected coordinates; NaN outside the grid."""
    inv = ~grid.transform
    cols, rows = inv @ (xs, ys)
    r = np.floor(rows).astype(int)
    c = np.floor(cols).astype(int)
    h, w = grid.shape
    ok = (r >= 0) & (r < h) & (c >= 0) & (c < w)
    out = np.full(xs.shape, np.nan, dtype=np.float64)
    out[ok] = grid.data[r[ok], c[ok]]
    return out

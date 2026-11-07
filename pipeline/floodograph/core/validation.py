"""Validation against reported flood locations (news) and, when available, an observed flood extent.

Point check: a report is a "hit" if the simulated max depth within `radius_m` reaches `wet_m`.
This measures recall (did the model flood where people saw water). False-alarm rate and IoU need an
observed extent (e.g. International Charter / Sentinel-1 product) and are computed by `extent_scores`.
"""
from __future__ import annotations

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform


def point_hits(maxdepth_tif: str, points: list[dict], radius_m: float = 100.0, wet_m: float = 0.15) -> list[dict]:
    with rasterio.open(maxdepth_tif) as src:
        d = src.read(1)
        crs = src.crs
        inv = ~src.transform
        cell = abs(src.transform.a)
    r = max(1, int(round(radius_m / cell)))
    out = []
    for p in points:
        if p.get("lat") is None:
            out.append({**p, "inside": False, "hit": None, "max_depth_m": None})
            continue
        (x,), (y,) = warp_transform("EPSG:4326", crs, [p["lon"]], [p["lat"]])
        c, rw = inv * (x, y)
        i, j = int(rw), int(c)
        if not (0 <= i < d.shape[0] and 0 <= j < d.shape[1]):
            out.append({**p, "inside": False, "hit": None, "max_depth_m": None})
            continue
        win = d[max(0, i - r): i + r + 1, max(0, j - r): j + r + 1]
        md = float(np.nanmax(win)) if win.size else 0.0
        out.append({**p, "inside": True, "hit": md >= wet_m, "max_depth_m": round(md, 2)})
    return out


def extent_scores(pred_wet: np.ndarray, obs_wet: np.ndarray, valid: np.ndarray | None = None) -> dict:
    """IoU, hit rate (recall), false alarm ratio and critical success index on aligned boolean grids."""
    m = np.ones_like(pred_wet, bool) if valid is None else valid
    p, o = pred_wet[m], obs_wet[m]
    tp = int((p & o).sum())
    fp = int((p & ~o).sum())
    fn = int((~p & o).sum())
    return {
        "iou": tp / max(tp + fp + fn, 1),
        "hit_rate": tp / max(tp + fn, 1),
        "false_alarm_ratio": fp / max(tp + fp, 1),
    }

"""Scenario simulation: build the 2D domain for a city, run the shallow-water solver, write outputs.

Outputs (pipeline/data/<city>/scenarios/<scenario>/):
  frames/<t_min>.bin   zstd-compressed depth/u/v frames (format: packages/core/src/frames.ts)
  impacts.csv          per building: first wet minute (depth > WET_M next to the walls) and max depth
  culverts.csv         per culvert: capacity and first-overflow minute
  maxdepth.tif         maximum depth (m)
  summary.json         totals, mass balance, grid metadata for the web
"""
from __future__ import annotations

import json
import struct
import time
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import zstandard as zstd
from rasterio.features import rasterize
from rasterio.warp import transform as warp_transform

from ..adapters.dem import FabdemSource, load_dem
from ..adapters.open_meteo import RainSeries
from ..config import CityConfig
from ..core import swe2d
from ..core.hydrology import fill_nodata_nearest, sample
from . import steps

WET_M = 0.15  # water depth at a wall that counts as "water reached the building"
N_MANNING = 0.035  # urban mixed surface (no land-cover layer yet)
LOSS_MM_H = 15.0  # infiltration + storm-sewer capacity, uniform
Q_SPEC = 6.7  # m3/s per km2: rational method, C=0.8, 2-year i~30 mm/h -> culvert design capacity
DEPTH_SCALE = 0.001  # m per uint16 step
VEL_SCALE = 0.001  # m/s per int16 step


@dataclass
class SimDomain:
    domain: swe2d.Domain
    transform: rasterio.Affine
    epsg: int
    ring_bid: np.ndarray  # building index for each ring cell
    ring_cell: np.ndarray  # flat cell index adjacent to that building's walls
    buildings: gpd.GeoDataFrame
    culverts: gpd.GeoDataFrame


def build_domain(city: CityConfig, res_m: float = 20.0) -> SimDomain:
    dem = load_dem(FabdemSource(), city.hydro_bbox, city.epsg, res_m)
    z = fill_nodata_nearest(dem.data.astype(np.float64))
    shape = z.shape

    b = steps.buildings(city).to_crs(city.epsg).reset_index(drop=True)
    bid = rasterize(((g, i + 1) for i, g in enumerate(b.geometry)), out_shape=shape,
                    transform=dem.transform, fill=0, dtype="int32")
    wall = bid > 0

    # 4-neighbour ring: open cells touching each building's wall cells
    rb, rc = [], []
    flat = np.arange(z.size).reshape(shape)
    for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        src = bid[max(0, -dj):shape[0] - max(0, dj), max(0, -di):shape[1] - max(0, di)]
        dst_wall = wall[max(0, dj):shape[0] - max(0, -dj), max(0, di):shape[1] - max(0, -di)]
        dst_flat = flat[max(0, dj):shape[0] - max(0, -dj), max(0, di):shape[1] - max(0, -di)]
        m = (src > 0) & ~dst_wall
        rb.append(src[m] - 1)
        rc.append(dst_flat[m])
    ring_bid = np.concatenate(rb)
    ring_cell = np.concatenate(rc)

    sea = z <= 0.5
    # culverts = OSM buried stream pieces: inlet at the higher end, outlet at the lower end
    h, _ = steps.hydro(city)
    ww = steps.osm_layers(city)["waterways"]
    cul = ww[ww["buried"]].to_crs(city.epsg).explode(index_parts=False).reset_index(drop=True)
    inv = ~dem.transform
    inl, outl, qcap, keep = [], [], [], []
    for k, g in enumerate(cul.geometry):
        (x0, y0), (x1, y1) = g.coords[0], g.coords[-1]
        c0, r0 = inv * (x0, y0)
        c1, r1 = inv * (x1, y1)
        ij0 = (int(r0), int(c0))
        ij1 = (int(r1), int(c1))
        if not all(0 <= a < s for a, s in zip(ij0, shape)) or not all(0 <= a < s for a, s in zip(ij1, shape)):
            continue
        if ij0 == ij1 or wall[ij0] or wall[ij1] or sea[ij0]:
            continue
        hi, lo = (ij0, ij1) if z[ij0] >= z[ij1] else (ij1, ij0)
        acc = sample(h.acc, np.array([x0, x1]), np.array([y0, y1]))
        area_km2 = float(np.nanmax(acc)) * h.acc.cell**2 / 1e6 if np.isfinite(acc).any() else 0.1
        inl.append(hi)
        outl.append(lo)
        qcap.append(max(0.5, Q_SPEC * area_km2))
        keep.append(k)
    cul = cul.iloc[keep].reset_index(drop=True)
    cul["qcap_m3s"] = qcap

    d = swe2d.Domain(
        z=z, dx=res_m, wall=wall, sea=sea,
        n_manning=np.full(shape, N_MANNING),
        loss_mps=np.full(shape, LOSS_MM_H / 1000 / 3600),
        culvert_inlets=np.array(inl, dtype=np.int64).reshape(-1, 2),
        culvert_outlets=np.array(outl, dtype=np.int64).reshape(-1, 2),
        culvert_qcap=np.array(qcap, dtype=np.float64),
    )
    return SimDomain(d, dem.transform, city.epsg, ring_bid, ring_cell, b, cul)


def _aoi_window(city: CityConfig, sd: SimDomain) -> tuple[slice, slice]:
    xs, ys = warp_transform("EPSG:4326", f"EPSG:{sd.epsg}", [city.bbox[0], city.bbox[2], city.bbox[0], city.bbox[2]],
                            [city.bbox[1], city.bbox[1], city.bbox[3], city.bbox[3]])
    inv = ~sd.transform
    cols, rows = zip(*(inv * (x, y) for x, y in zip(xs, ys)))
    ny, nx = sd.domain.z.shape
    r0, r1 = max(0, int(min(rows))), min(ny, int(np.ceil(max(rows))))
    c0, c1 = max(0, int(min(cols))), min(nx, int(np.ceil(max(cols))))
    return slice(r0, r1), slice(c0, c1)


def _encode_frame(st: swe2d.State, t_min: int, win: tuple[slice, slice]) -> bytes:
    h = st.h[win]
    with np.errstate(divide="ignore", invalid="ignore"):
        u = np.where(h > swe2d.H_DRY, st.hu[win] / h, 0.0)
        v = np.where(h > swe2d.H_DRY, -st.hv[win] / h, 0.0)  # rows run south: flip so v is northward
    ny, nx = h.shape
    head = b"FLDG" + struct.pack("<HIIIff", 1, nx, ny, t_min, DEPTH_SCALE, VEL_SCALE)
    body = (
        np.clip(np.round(h / DEPTH_SCALE), 0, 65535).astype("<u2").tobytes()
        + np.clip(np.round(u / VEL_SCALE), -32767, 32767).astype("<i2").tobytes()
        + np.clip(np.round(v / VEL_SCALE), -32767, 32767).astype("<i2").tobytes()
    )
    return zstd.ZstdCompressor(level=10).compress(head + body)


def run_scenario(city: CityConfig, scenario_id: str, rain: RainSeries, res_m: float = 20.0,
                 hours: float | None = None, output_every_s: float = 300.0, write_frames: bool = True) -> dict:
    t0 = time.time()
    sd = build_domain(city, res_m)
    d = sd.domain
    st = swe2d.initial_state(d)
    out = city.data_dir / "scenarios" / scenario_id
    (out / "frames").mkdir(parents=True, exist_ok=True)

    win = _aoi_window(city, sd)
    nb = len(sd.buildings)
    first_wet = np.full(nb, np.nan)
    max_dep = np.zeros(nb)
    max_grid = np.zeros_like(d.z)
    timeline = []

    def on_output(s: swe2d.State, stats: dict) -> None:
        t_min = int(round(s.t / 60))
        dep = np.zeros(nb)
        np.maximum.at(dep, sd.ring_bid, s.h.ravel()[sd.ring_cell])
        newly = (dep > WET_M) & np.isnan(first_wet)
        first_wet[newly] = t_min
        np.maximum(max_dep, dep, out=max_dep)
        np.maximum(max_grid, s.h, out=max_grid)
        wet = s.h > 0.05
        timeline.append({"t_min": t_min, "wet_ha": float(wet.sum() * d.dx**2 / 1e4),
                         "max_depth": float(s.h.max()), "buildings_wet": int((~np.isnan(first_wet)).sum()),
                         "volume_m3": float(s.h.sum() * d.dx**2)})
        if write_frames:
            (out / "frames" / f"{t_min}.bin").write_bytes(_encode_frame(s, t_min, win))

    events = np.full(d.culvert_qcap.shape[0], np.nan)
    t_end = (hours if hours is not None else rain.mm.size * rain.step_min / 60) * 3600
    bal = swe2d.run(d, st, rain.intensity_mps, t_end, on_output=on_output,
                    output_every=output_every_s, culvert_events=events)

    stored = float(st.h.sum() * d.dx**2)
    err = (bal["rain_m3"] - bal["loss_m3"] - bal["sea_m3"] - stored) / max(bal["rain_m3"], 1.0)

    impacts = sd.buildings[["osm_id"]].copy()
    impacts["first_wet_min"] = first_wet
    impacts["max_depth_m"] = np.round(max_dep, 3)
    impacts.to_csv(out / "impacts.csv", index=False)
    cul = sd.culverts[["name", "qcap_m3s"]].copy()
    cul["overflow_min"] = np.round(events / 60)
    cul.to_csv(out / "culverts.csv", index=False)
    with rasterio.open(out / "maxdepth.tif", "w", driver="GTiff", height=max_grid.shape[0], width=max_grid.shape[1],
                       count=1, dtype="float32", crs=f"EPSG:{sd.epsg}", transform=sd.transform) as dst:
        dst.write(max_grid.astype("float32"), 1)

    ny, nx = max_grid[win].shape  # frames are cropped to the AOI window
    tf = sd.transform * rasterio.Affine.translation(win[1].start, win[0].start)
    cx = [tf.c, tf.c + tf.a * nx, tf.c + tf.a * nx, tf.c]
    cy = [tf.f, tf.f, tf.f + tf.e * ny, tf.f + tf.e * ny]
    lons, lats = warp_transform(f"EPSG:{sd.epsg}", "EPSG:4326", cx, cy)
    summary = {
        "scenario": scenario_id, "city": city.id, "rain_source": rain.source, "start": rain.start_iso,
        "total_mm": round(rain.total_mm, 1), "peak_mm_h": round(float(rain.mm.max()), 1),
        "grid": {"nx": nx, "ny": ny, "res_m": res_m, "epsg": sd.epsg,
                 "corners_lonlat": [[lo, la] for lo, la in zip(lons, lats)],  # NW, NE, SE, SW
                 "depthScale": DEPTH_SCALE, "velocityScale": VEL_SCALE},
        "params": {"manning_n": N_MANNING, "loss_mm_h": LOSS_MM_H, "q_spec_m3s_km2": Q_SPEC, "wet_threshold_m": WET_M},
        "mass_balance": {**{k: round(v, 1) if isinstance(v, float) else v for k, v in bal.items()},
                         "stored_m3": round(stored, 1), "relative_error": err},
        "results": {
            "buildings_total": nb,
            "buildings_wet": int((~np.isnan(first_wet)).sum()),
            "buildings_over_0_5m": int((max_dep > 0.5).sum()),
            "max_flooded_ha": round(max(x["wet_ha"] for x in timeline), 1) if timeline else 0,
            "culverts": int(len(cul)), "culverts_overflowed": int(np.isfinite(events).sum()),
            "first_overflow_min": None if not np.isfinite(events).any() else int(np.nanmin(events) / 60),
        },
        "timeline": timeline,
        "seconds": round(time.time() - t0, 1),
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary

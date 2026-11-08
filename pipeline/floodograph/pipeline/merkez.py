"""City-centre rain ladders for /sehirler ("what if this rain fell here?").

Each centre (~20 km2: istanbul-merkez, izmir-merkez, ankara-merkez) runs exactly like the Sarıyer pilot: 20 m
grid, buildings as walls, OSM culverts, the calibrated loss / roughness. For each rain total (25 ... 300 mm,
spread over the 14 Oct hourly pattern with the calibrated sharpening and shift) we keep:
  * per building, the deepest water next to its walls (the pilot's impact measure),
  * the water field at the moment of widest flooding, as the frame for that rain total (t_min = mm).
The web gets one static JSON per centre (buildings + depth per level + grid) and the frames from Supabase.
"""
from __future__ import annotations

import json
import time
import numpy as np
import shapely
from rasterio.warp import transform as warp_transform

from ..adapters.open_meteo import HistoricalRain
from ..config import ROOT, CityConfig
from ..core import swe2d, swe2d_gpu
from .calibrate import shape_rain
from .rain_ladder import LEVELS, WINDOW, frame_max_depth
from .simulate import (DEPTH_SCALE, RAIN_SHARPEN, RAIN_SHIFT_H, VEL_SCALE, WET_M, _aoi_window, _encode_frame,
                       build_domain)


def run_merkez(city: CityConfig, levels=LEVELS) -> dict:
    t0 = time.time()
    solve = swe2d_gpu.run if swe2d_gpu.available() else swe2d.run
    sd = build_domain(city, city.res_m)
    d = sd.domain
    win = _aoi_window(city, sd)
    nb = len(sd.buildings)
    base = HistoricalRain("2026-10-14T06:00", 30, station_total_mm=100.0).series(41.115, 29.0)
    out = city.data_dir / "merkez"
    (out / "frames").mkdir(parents=True, exist_ok=True)
    depth = np.zeros((nb, len(levels)))
    report = []
    aoi = np.zeros(d.z.shape, bool)
    aoi[win] = True
    for li, mm in enumerate(levels):
        rain = shape_rain(base, RAIN_SHIFT_H, RAIN_SHARPEN)
        rain.mm = rain.mm * (mm / rain.mm.sum())
        st = swe2d.initial_state(d)
        max_dep = np.zeros(nb)
        best = {"wet": -1.0, "st": None}

        def on_output(s: swe2d.State, _stats: dict) -> None:
            dep = np.zeros(nb)
            np.maximum.at(dep, sd.ring_bid, s.h.ravel()[sd.ring_cell])
            np.maximum(max_dep, dep, out=max_dep)
            wet = float(((s.h > 0.1) & aoi).sum())
            if wet > best["wet"]:
                best.update(wet=wet, st=swe2d.State(h=s.h.copy(), hu=s.hu.copy(), hv=s.hv.copy(), t=s.t))

        off = WINDOW[0] * 60
        solve(d, st, lambda t: rain.intensity_mps(t + off), (WINDOW[1] - WINDOW[0]) * 60, on_output=on_output,
              output_every=600.0, culvert_events=np.full(d.culvert_qcap.shape[0], np.nan))
        depth[:, li] = max_dep
        (out / "frames" / f"{mm}.bin").write_bytes(_encode_frame(best["st"], mm, win))
        rep = {"city": city.id, "mm": mm, "wet_ha": round(best["wet"] * d.dx**2 / 1e4, 1),
               "buildings_wet": int((max_dep > WET_M).sum()), "acil": int((max_dep >= 1.5).sum()),
               "seconds": round(time.time() - t0, 1)}
        report.append(rep)
        print(json.dumps(rep, ensure_ascii=False), flush=True)

    # rain total at which the water first reaches each building (depth > WET_M), linear between levels, 0 m at 0 mm
    xs = np.array([0.0, *levels])
    wet_mm = np.full(nb, np.nan)
    for i in range(nb):
        ys = np.concatenate([[0.0], depth[i]])
        k = np.flatnonzero(ys > WET_M)
        if len(k):
            j = k[0]
            y0, y1 = ys[j - 1], ys[j]
            wet_mm[i] = xs[j - 1] + (WET_M - y0) / max(y1 - y0, 1e-6) * (xs[j] - xs[j - 1])

    # grid of the analysed window (corners NW, NE, SE, SW)
    r, c = win
    tf = sd.transform
    x0 = tf.c + tf.a * c.start
    y0 = tf.f + tf.e * r.start
    w, h = c.stop - c.start, r.stop - r.start
    lons, lats = warp_transform(f"EPSG:{city.epsg}", "EPSG:4326", [x0, x0 + tf.a * w, x0 + tf.a * w, x0],
                                [y0, y0, y0 + tf.e * h, y0 + tf.e * h])
    grid = {"nx": int(w), "ny": int(h), "res_m": float(d.dx), "epsg": city.epsg,
            "corners_lonlat": [[lo, la] for lo, la in zip(lons, lats)], "depthScale": DEPTH_SCALE,
            "velocityScale": VEL_SCALE}

    b = sd.buildings.to_crs(4326)
    feats = []
    for i, row in enumerate(b.itertuples(index=False)):
        g = shapely.set_precision(row.geometry, 1e-6)
        if g.is_empty:
            continue
        crit = getattr(row, "critical", None)
        feats.append({
            "type": "Feature",
            "geometry": shapely.geometry.mapping(g),
            "properties": {
                "id": int(row.osm_id),
                "h": round(float(row.height_m), 1),
                "crit": crit if isinstance(crit, str) else None,
                "d": [round(float(v), 2) for v in depth[i]],
                "wet": None if np.isnan(wet_mm[i]) else round(float(wet_mm[i]), 1),
            },
        })
    doc = {"id": city.id, "name": city.name, "bbox": list(city.bbox), "levels": list(levels),
           "scenario": f"{city.id}-yagis", "grid": grid,
           "buildings": {"type": "FeatureCollection", "features": feats}}
    web = ROOT.parent / "apps" / "web" / "public" / "merkez"
    web.mkdir(parents=True, exist_ok=True)
    (web / f"{city.id}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = {"city": city.id, "levels": list(levels), "grid": grid, "report": report, "buildings": nb,
            "seconds": round(time.time() - t0, 1)}
    (out / "merkez.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def upload_merkez(city: CityConfig) -> dict:
    """Frames of the centre's ladder as scenario <id>-yagis (t_min = rain total in mm)."""
    import pandas as pd

    from ..adapters.postgis_store import PostgisStore

    out = city.data_dir / "merkez"
    meta = json.loads((out / "merkez.json").read_text(encoding="utf-8"))
    frames = out / "frames"
    summary = {
        "scenario": f"{city.id}-yagis", "rain_source": "design: 14 Oct 2026 hourly pattern, calibrated shape, scaled",
        "start": "design", "total_mm": float(max(meta["levels"])), "peak_mm_h": 0.0, "grid": meta["grid"],
        "params": {"res_m": meta["grid"]["res_m"], "walls": "buildings", "levels": meta["levels"]},
        "mass_balance": {"relative_error": 0.0},
        "results": {"levels": len(meta["levels"])},
        "timeline": [{"t_min": int(f.stem), "max_depth": frame_max_depth(f)} for f in frames.glob("*.bin")],
    }
    empty = pd.DataFrame({"osm_id": [], "first_wet_min": [], "max_depth_m": [], "tier": []})
    return PostgisStore().replace_scenario(city, summary, [], 60, empty, frames,
                                           label=f"Yağış senaryoları · {city.name}", kind="design", step_min=0)


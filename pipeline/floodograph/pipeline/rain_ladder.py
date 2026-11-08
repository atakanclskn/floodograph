"""'What if this rain fell here?' ladders for the whole-city view (/sehirler).

For each rain total (25 ... 300 mm, spread over the 14 Oct hourly pattern with the calibrated peak sharpening),
the 50 m city model runs on the GPU and the state at the moment of widest flooding is kept. The city grid is then
cut into ~13 km regions; each region is uploaded as its own scenario whose frames are keyed by the rain total
(t_min = mm), so the web map loads only the regions on screen and blends the two nearest rain levels.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from rasterio.warp import transform as warp_transform

from ..adapters.dem import FabdemSource, load_dem
from ..adapters.open_meteo import HistoricalRain
from ..config import CityConfig
from ..core import swe2d, swe2d_gpu
from ..core.hydrology import fill_nodata_nearest
from .calibrate import shape_rain
from .simulate import DEPTH_SCALE, VEL_SCALE, _encode_frame
from .simulate_city import N_URBAN

LEVELS = [25, 50, 100, 150, 200, 250, 300]
CHUNK = 256  # cells per region side (12.8 km at 50 m)
WINDOW = (240, 1080)  # 10:00-24:00, as in the pilot calibration


def run_ladder(city: CityConfig, loss_mm_h: float, sharpen: float, shift_h: float, levels=LEVELS,
               res_m: float | None = None) -> dict:
    res_m = res_m or city.res_m
    t0 = time.time()
    dem = load_dem(FabdemSource(), city.hydro_bbox, city.epsg, res_m)
    z = fill_nodata_nearest(dem.data.astype(np.float64))
    shape = z.shape
    sea = z <= 0.5
    land = ~sea
    base = HistoricalRain("2026-10-14T06:00", 30, station_total_mm=100.0).series(41.115, 29.0)
    out = city.data_dir / "ladder"
    out.mkdir(parents=True, exist_ok=True)
    states: dict[int, swe2d.State] = {}
    report = []
    for mm in levels:
        rain = shape_rain(base, shift_h, sharpen)
        rain.mm = rain.mm * (mm / rain.mm.sum())
        d = swe2d.Domain(z=z, dx=res_m, wall=np.zeros(shape, bool), sea=sea, n_manning=np.full(shape, N_URBAN),
                         loss_mps=np.full(shape, loss_mm_h / 1000 / 3600))
        st = swe2d.initial_state(d)
        best = {"ha": -1.0, "h": None, "hu": None, "hv": None, "t": 0}

        def on_output(s, _stats):
            wet = float(((s.h > 0.1) & land).sum())
            if wet > best["ha"]:
                best.update(ha=wet, h=s.h.copy(), hu=s.hu.copy(), hv=s.hv.copy(), t=s.t)

        off = WINDOW[0] * 60
        solve = swe2d_gpu.run if swe2d_gpu.available() else swe2d.run
        solve(d, st, lambda t: rain.intensity_mps(t + off), (WINDOW[1] - WINDOW[0]) * 60, on_output=on_output,
              output_every=900.0)
        states[mm] = swe2d.State(h=best["h"], hu=best["hu"], hv=best["hv"], t=best["t"])
        report.append({"mm": mm, "wet_ha": round(best["ha"] * res_m**2 / 1e4, 1),
                       "deep_ha": round(float(((best["h"] > 1.0) & land).sum() * res_m**2 / 1e4), 1),
                       "peak_at": f"{int((WINDOW[0] + best['t'] / 60) // 60 + 6):02d}:{int((WINDOW[0] + best['t'] / 60) % 60):02d}"})
        print(json.dumps({"city": city.id, **report[-1]}, ensure_ascii=False), flush=True)

    # regions: keep only those where some level floods something
    ny, nx = shape
    tf = dem.transform
    regions = []
    for r0 in range(0, ny, CHUNK):
        for c0 in range(0, nx, CHUNK):
            win = (slice(r0, min(ny, r0 + CHUNK)), slice(c0, min(nx, c0 + CHUNK)))
            if max(float(states[mm].h[win].max()) for mm in levels) < 0.1:
                continue
            rid = f"r{r0 // CHUNK}c{c0 // CHUNK}"
            rdir = out / rid
            (rdir / "frames").mkdir(parents=True, exist_ok=True)
            for mm in levels:
                (rdir / "frames" / f"{mm}.bin").write_bytes(_encode_frame(states[mm], mm, win))
            h, w = win[0].stop - win[0].start, win[1].stop - win[1].start
            x0 = tf.c + tf.a * win[1].start
            y0 = tf.f + tf.e * win[0].start
            cx = [x0, x0 + tf.a * w, x0 + tf.a * w, x0]
            cy = [y0, y0, y0 + tf.e * h, y0 + tf.e * h]
            lons, lats = warp_transform(f"EPSG:{city.epsg}", "EPSG:4326", cx, cy)
            regions.append({"id": rid, "nx": w, "ny": h,
                            "corners_lonlat": [[lo, la] for lo, la in zip(lons, lats)]})
    meta = {"city": city.id, "levels": levels, "res_m": res_m, "loss_mm_h": loss_mm_h, "sharpen": sharpen,
            "shift_h": shift_h, "regions": regions, "report": report, "seconds": round(time.time() - t0, 1)}
    (out / "ladder.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def frame_max_depth(path: Path) -> float:
    """Deepest water (m) in an encoded frame file (see simulate._encode_frame)."""
    import struct

    import zstandard as zstd

    raw = zstd.ZstdDecompressor().decompress(path.read_bytes())
    _, nx, ny, _, dscale, _ = struct.unpack("<HIIIff", raw[4:26])
    h = np.frombuffer(raw, dtype="<u2", count=nx * ny, offset=26)
    return float(h.max()) * dscale


def upload_ladder(city: CityConfig) -> dict:
    """One scenario per region: id <city>-yagis-<region>, frames keyed by rain total in mm."""
    import pandas as pd

    from ..adapters.postgis_store import PostgisStore

    out = city.data_dir / "ladder"
    meta = json.loads((out / "ladder.json").read_text(encoding="utf-8"))
    store = PostgisStore()
    empty = pd.DataFrame({"osm_id": [], "first_wet_min": [], "max_depth_m": [], "tier": []})
    n = 0
    for reg in meta["regions"]:
        sid = f"{city.id}-yagis-{reg['id']}"
        summary = {
            "scenario": sid, "rain_source": "design: 14 Oct 2026 hourly pattern, sharpened, scaled per level",
            "start": "design", "total_mm": float(max(meta["levels"])), "peak_mm_h": 0.0,
            "grid": {"nx": reg["nx"], "ny": reg["ny"], "res_m": meta["res_m"], "epsg": city.epsg,
                     "corners_lonlat": reg["corners_lonlat"], "depthScale": DEPTH_SCALE, "velocityScale": VEL_SCALE},
            "params": {"loss_mm_h": meta["loss_mm_h"], "sharpen": meta["sharpen"], "shift_h": meta["shift_h"],
                       "manning_n": N_URBAN},
            "mass_balance": {"relative_error": 0.0},
            "results": {"levels": len(meta["levels"])},
            # per-level deepest water: the web skips frames stored as 0 m (dry), so it must be the real value
            "timeline": [{"t_min": int(f.stem), "max_depth": frame_max_depth(f)}
                         for f in (out / reg["id"] / "frames").glob("*.bin")],
        }
        store.replace_scenario(city, summary, [], 60, empty, Path(out / reg["id"] / "frames"),
                               label=f"Yağış senaryoları · {city.name} · {reg['id']}", kind="design", step_min=0)
        n += 1
    return {"regions": n}

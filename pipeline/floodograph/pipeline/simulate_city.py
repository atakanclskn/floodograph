"""Whole-city flood simulation (coarse, 50 m): same 2D shallow-water solver, simpler domain.

At 50 m single buildings are not resolved, so they enter as surface roughness (urban Manning n) instead of
walls, and there are no culverts. The sea (and lagoons at sea level) is a sink. Frames are written every
30 minutes over the whole city so the web map can replay the event city-wide; the 20 m pilot runs keep the
building-level detail.
"""
from __future__ import annotations

import json
import time

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform

from ..adapters.dem import FabdemSource, load_dem
from ..adapters.open_meteo import RainSeries
from ..config import CityConfig
from ..core import swe2d, swe2d_gpu
from ..core.hydrology import fill_nodata_nearest
from .simulate import DEPTH_SCALE, LOSS_MM_H, VEL_SCALE, _encode_frame

N_URBAN = 0.06  # Manning n with buildings smeared into the surface (typical 0.05-0.1 for urban 2D at 25-100 m)


def run_city(city: CityConfig, scenario_id: str, rain: RainSeries, res_m: float = 50.0,
             output_every_s: float = 1800.0, backend: str = "auto") -> dict:
    t0 = time.time()
    dem = load_dem(FabdemSource(), city.hydro_bbox, city.epsg, res_m)
    z = fill_nodata_nearest(dem.data.astype(np.float64))
    shape = z.shape
    sea = z <= 0.5
    d = swe2d.Domain(
        z=z, dx=res_m, wall=np.zeros(shape, bool), sea=sea,
        n_manning=np.full(shape, N_URBAN),
        loss_mps=np.full(shape, LOSS_MM_H / 1000 / 3600),
    )
    st = swe2d.initial_state(d)
    out = city.data_dir / "scenarios" / scenario_id
    (out / "frames").mkdir(parents=True, exist_ok=True)
    for old in (out / "frames").glob("*.bin"):
        old.unlink()

    land = ~sea
    win = (slice(0, shape[0]), slice(0, shape[1]))
    max_grid = np.zeros(shape)
    first_wet = np.full(shape, np.nan)
    timeline = []
    cell_ha = res_m * res_m / 1e4

    def on_output(s: swe2d.State, stats: dict) -> None:
        t_min = int(round(s.t / 60))
        np.maximum(max_grid, s.h, out=max_grid)
        wet = (s.h > 0.1) & land
        newly = wet & np.isnan(first_wet)
        first_wet[newly] = t_min
        timeline.append({"t_min": t_min, "wet_ha": float(wet.sum() * cell_ha),
                         "deep_ha": float(((s.h > 0.5) & land).sum() * cell_ha),
                         "max_depth": float(np.percentile(s.h[wet], 99)) if wet.any() else 0.0})
        (out / "frames" / f"{t_min}.bin").write_bytes(_encode_frame(s, t_min, win))

    use_gpu = backend == "gpu" or (backend == "auto" and swe2d_gpu.available())
    solve = swe2d_gpu.run if use_gpu else swe2d.run
    t_end = rain.mm.size * rain.step_min * 60
    bal = solve(d, st, rain.intensity_mps, t_end, on_output=on_output, output_every=output_every_s)
    stored = float(st.h.sum() * res_m**2)
    err = (bal["rain_m3"] - bal["loss_m3"] - bal["sea_m3"] - bal["boundary_out_m3"] - stored) / max(bal["rain_m3"], 1.0)

    with rasterio.open(out / "maxdepth.tif", "w", driver="GTiff", height=shape[0], width=shape[1], count=1,
                       dtype="float32", crs=f"EPSG:{city.epsg}", transform=dem.transform, compress="deflate") as dst:
        dst.write(max_grid.astype("float32"), 1)

    tf = dem.transform
    ny, nx = shape
    cx = [tf.c, tf.c + tf.a * nx, tf.c + tf.a * nx, tf.c]
    cy = [tf.f, tf.f, tf.f + tf.e * ny, tf.f + tf.e * ny]
    lons, lats = warp_transform(f"EPSG:{city.epsg}", "EPSG:4326", cx, cy)
    summary = {
        "scenario": scenario_id, "city": city.id, "rain_source": rain.source, "start": rain.start_iso,
        "total_mm": round(rain.total_mm, 1), "peak_mm_h": round(float(rain.mm.max()), 1),
        "grid": {"nx": nx, "ny": ny, "res_m": res_m, "epsg": city.epsg,
                 "corners_lonlat": [[lo, la] for lo, la in zip(lons, lats)],
                 "depthScale": DEPTH_SCALE, "velocityScale": VEL_SCALE},
        "params": {"manning_n": N_URBAN, "loss_mm_h": LOSS_MM_H, "buildings": "roughness (50 m)", "culverts": None},
        "mass_balance": {**{k: round(v, 1) if isinstance(v, float) else v for k, v in bal.items()},
                         "stored_m3": round(stored, 1), "relative_error": err},
        "results": {
            "max_flooded_ha": round(max(x["wet_ha"] for x in timeline), 1) if timeline else 0,
            "max_deep_ha": round(max(x["deep_ha"] for x in timeline), 1) if timeline else 0,
            "ever_wet_ha": round(float((max_grid > 0.1)[land].sum() * cell_ha), 1),
            "ever_deep_ha": round(float((max_grid > 0.5)[land].sum() * cell_ha), 1),
            "land_ha": round(float(land.sum() * cell_ha), 1),
        },
        "timeline": timeline,
        "seconds": round(time.time() - t0, 1),
        "solver": swe2d_gpu.describe() if use_gpu else "cpu (numba)",
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary

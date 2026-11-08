"""Calibrate the pilot flood model against what was observed on 14 Oct 2026.

Free parameters (each with a physical range, not a free fudge):
  total_mm      event rainfall total: the hourly ERA5 pattern is scaled to it (Sarıyer ~150 mm reported early;
                272 mm in the minister's statement, 242 mm Beykoz).
  loss_mm_h     infiltration + storm-sewer capacity: 15 mm/h is a dry-soil, free-draining value; during a
                record storm soils saturate and inlets block, so 3-15 mm/h is plausible.
  manning_n     surface roughness: 0.02 (smooth asphalt) to 0.05 (cluttered urban floodplain).
  culvert_scale multiplier on the rational-method culvert capacities (debris-blocked culverts carry less).

Targets are the reported conditions (news, 14-15 Oct 2026), as depth intervals within 100 m of each place plus
"cars swept away in Ayazağa" as a speed condition. The event window 12:00-23:00 is simulated from a dry start.
Every run is written to calibration.csv so the choice is auditable.
"""
from __future__ import annotations

import itertools
import json
import math
import time

import numpy as np
import pandas as pd
from rasterio.warp import transform as warp_transform

from ..adapters.open_meteo import HistoricalRain
from ..config import CityConfig
from ..core import swe2d, swe2d_gpu
from .simulate import build_domain

# Observations compiled from 14-15 Oct 2026 reports (DHA, Evrensel, Gazete Oksijen, AA; see docs/VALIDATION.md).
# name, lat, lon, min depth (m), max depth (m) or None, what was reported
TARGETS = [
    ("Ayazağa Meydanı", 41.1153614, 28.9987033, 1.5, 2.5, "restoranda 1,5-2 m, su arabanın tavanını aştı (~20:00)"),
    ("Dereboyu Cd. (mağaza)", 41.1183410, 28.9967181, 1.0, None, "mağazada 1,70 m, sokakta bel üstü (~18:00)"),
    ("Atatürk Cd.", 41.1164298, 28.9979727, 0.7, None, "Dereboyu'ndan Atatürk Cd.'ye akan su kütlesi"),
    ("Kemerburgaz Cd.", 41.1124239, 28.9828745, 1.0, None, "iş yerlerinde mahsur ~200 kişi, botla/kepçeyle kurtarma"),
    ("Cendere Yolu", 41.1092353, 28.9888030, 1.0, None, "yollar ~2 m su altında (Phoenix Stüdyoları, 22:49)"),
    ("Cendere Cd.", 41.1108820, 28.9965240, 0.5, None, "~300 araç mahsur, araç 1 km sürüklendi"),
    ("201. Sokak", 41.1196274, 28.9969505, 0.3, None, "6-7 ev su altında, tahliye edildi"),
    ("Hacıosman Metro", 41.1397645, 29.0304548, 0.3, None, "istasyonu su bastı"),
    ("Haydar Aliyev Cd.", 41.1533074, 29.0386762, 0.1, 0.4, "su kaldırımlara kadar yükseldi"),
]
TIMING = (1, 0.5, 675, 765)  # Dereboyu: street depth first reaches 0.5 m between 17:15 and 18:45 (min from 06:00)
SWEPT = (41.1153614, 28.9987033, 600.0, 1.5)  # ~40 cars swept in Ayazağa: some street within 600 m reaches 1.5 m/s
RADIUS_M = 50.0
WINDOW = (240, 1080)  # minutes from 06:00: 10:00-24:00 (the day's earlier rain still soaks the ground)

# Rain is not a free parameter any more: 187.9 mm at the Sarıyer station on 14 Oct (İBB, 15 Oct 00:47).
# Round 1 (calibration_round1.csv): loss 2 mm/h >> 4 > 7 > 10; culvert scale made no difference; n=0.04 slightly
# deeper. Round 2: the peak sharpness / timing of the hourly ERA5 pattern, at the best loss/roughness.
GRID = {
    "total_mm": [188.0],
    "loss_mm_h": [1.0, 2.0],
    "manning_n": [0.04],
    "culvert_scale": [0.5],
    "sharpen": [1.5, 2.0],
    "shift_h": [0.0, 1.0],
}


def shape_rain(rain, shift_h: float = 0.0, sharpen: float = 1.0):
    """Re-time the hourly ERA5 pattern, keeping the daily total fixed.

    shift_h: move the pattern earlier by this many hours. ERA5 is a ~25 km cell; at Ayazağa the flood began ~17:30
    and İTÜ Maslak had 124.7 mm by 19:50, i.e. the local peak came earlier than ERA5's 19:00.
    sharpen: raise the hourly values to this power and renormalise, concentrating rain into the peak hours
    (hourly data smooths the 10-30 minute bursts that cause flash floods).
    """
    from dataclasses import replace

    mm = np.asarray(rain.mm, dtype=float)
    total = mm.sum()
    if shift_h:
        k = int(round(shift_h))
        mm = np.concatenate([mm[k:], np.zeros(k)]) if k > 0 else mm
    if sharpen != 1.0 and mm.sum() > 0:
        mm = mm**sharpen
    if mm.sum() > 0:
        mm *= total / mm.sum()
    return replace(rain, mm=mm)


def _street_depth(h, win, open_cells):
    """Street-level depth near a place: 75th percentile of the open (non-building) cells within RADIUS_M.
    The maximum would report the stream thalweg next door, not the street people stood in."""
    v = h[win][open_cells[win]]
    return float(np.percentile(v, 75)) if v.size else 0.0


def _cells(sd, lat, lon, radius_m):
    (x,), (y,) = warp_transform("EPSG:4326", f"EPSG:{sd.epsg}", [lon], [lat])
    inv = ~sd.transform
    c, r = inv * (x, y)
    k = max(1, int(round(radius_m / abs(sd.transform.a))))
    ny, nx = sd.domain.z.shape
    i, j = int(r), int(c)
    return slice(max(0, i - k), min(ny, i + k + 1)), slice(max(0, j - k), min(nx, j + k + 1))


def _miss(pred, lo, hi):
    """0 inside the target interval, else the log-distance to it (so 0.2 vs 1.0 m and 2 vs 10 m weigh alike)."""
    p = max(pred, 0.01)
    if p < lo:
        return math.log(lo / p)
    if hi is not None and p > hi:
        return math.log(p / hi)
    return 0.0


def calibrate(city: CityConfig, res_m: float = 20.0, grid: dict | None = None) -> pd.DataFrame:
    grid = grid or GRID
    sd = build_domain(city, res_m)
    d0 = sd.domain
    windows = [_cells(sd, lat, lon, RADIUS_M) for _, lat, lon, *_ in TARGETS]
    swept_win = _cells(sd, SWEPT[0], SWEPT[1], SWEPT[2])
    base_q = d0.culvert_qcap.copy()
    open_cells = ~d0.wall
    out = city.data_dir / "calibration.csv"
    rows = []
    rain_cache: dict[float, object] = {}
    combos = list(itertools.product(*grid.values()))
    for n, values in enumerate(combos, 1):
        p = dict(zip(grid.keys(), values))
        if p["total_mm"] not in rain_cache:
            rain_cache[p["total_mm"]] = HistoricalRain("2026-10-14T06:00", 30, station_total_mm=p["total_mm"],
                                                       station_note="calibration").series(*city.rain_point)
        rain = shape_rain(rain_cache[p["total_mm"]], p.get("shift_h", 0.0), p.get("sharpen", 1.0))
        off = WINDOW[0] * 60
        d = swe2d.Domain(
            z=d0.z, dx=d0.dx, wall=d0.wall, sea=d0.sea,
            n_manning=np.full(d0.z.shape, p["manning_n"]),
            loss_mps=np.full(d0.z.shape, p["loss_mm_h"] / 1000 / 3600),
            culvert_inlets=d0.culvert_inlets, culvert_outlets=d0.culvert_outlets,
            culvert_qcap=base_q * p["culvert_scale"],
        )
        st = swe2d.initial_state(d)
        maxd = np.zeros(d.z.shape)
        maxv = np.zeros(d.z.shape)
        street = np.zeros(len(TARGETS))
        first_t = [None]

        def on_output(s, _stats):
            np.maximum(maxd, s.h, out=maxd)
            for k, w in enumerate(windows):
                street[k] = max(street[k], _street_depth(s.h, w, open_cells))
            t_min = WINDOW[0] + s.t / 60
            if first_t[0] is None and _street_depth(s.h, windows[TIMING[0]], open_cells) >= TIMING[1]:
                first_t[0] = t_min
            with np.errstate(divide="ignore", invalid="ignore"):
                sp = np.where(s.h > 0.05, np.hypot(s.hu, s.hv) / s.h, 0.0)
            np.maximum(maxv, sp, out=maxv)

        t0 = time.time()
        solve = swe2d_gpu.run if swe2d_gpu.available() else swe2d.run
        solve(d, st, lambda t: rain.intensity_mps(t + off), (WINDOW[1] - WINDOW[0]) * 60,
              on_output=on_output, output_every=300.0)
        preds = [float(v) for v in street]
        misses = [_miss(pv, lo, hi) for pv, (_, _, _, lo, hi, _) in zip(preds, TARGETS)]
        tf = first_t[0]
        if tf is None:
            timing_miss = 1.0
        elif tf < TIMING[2]:
            timing_miss = (TIMING[2] - tf) / 60
        elif tf > TIMING[3]:
            timing_miss = (tf - TIMING[3]) / 60
        else:
            timing_miss = 0.0
        vmax = float(maxv[swept_win].max())
        swept_miss = 0.0 if vmax >= SWEPT[3] else math.log(SWEPT[3] / max(vmax, 0.05))
        wet = (maxd > 0.15) & open_cells
        row = {**p,
               **{f"d_{i}": round(v, 2) for i, v in enumerate(preds)},
               "v_ayazaga": round(vmax, 2),
               "t_dereboyu": None if tf is None else f"{int(tf // 60 + 6):02d}:{int(tf % 60):02d}",
               "hits": int(sum(m == 0 for m in misses)),
               "score": round(sum(misses) + swept_miss + timing_miss, 3),
               "wet_ha": round(float(wet.sum() * res_m**2 / 1e4), 1),
               "deep_ha": round(float(((maxd > 0.5) & open_cells).sum() * res_m**2 / 1e4), 1),
               "seconds": round(time.time() - t0, 1)}
        rows.append(row)
        pd.DataFrame(rows).to_csv(out, index=False)
        print(f"[{n}/{len(combos)}] {json.dumps(row, ensure_ascii=False)}", flush=True)
    return pd.DataFrame(rows)

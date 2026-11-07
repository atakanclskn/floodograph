"""Rain sources (Strategy). Open-Meteo is free and key-less.

HistoricalRain takes the *temporal pattern* from Open-Meteo's historical-forecast archive (best-match model)
and, when a station total is given, rescales the event so its total matches the observed gauge value.
Reanalysis/forecast grids (~10-25 km) smear convective peaks; on 14 Oct 2026 the grid gives ~60 mm at Ayazağa
while AKOM/MGM reports were 150-242 mm, so the pattern-from-model / magnitude-from-gauge split matters.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import requests

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
HIST_FORECAST = "https://historical-forecast-api.open-meteo.com/v1/forecast"


@dataclass
class RainSeries:
    start_iso: str  # local time (Europe/Istanbul) of the first hour
    step_min: int
    mm: np.ndarray  # depth per step
    source: str

    @property
    def total_mm(self) -> float:
        return float(self.mm.sum())

    def intensity_mps(self, t_s: float) -> float:
        """Piecewise-constant intensity (m/s) at simulation time t (seconds from start)."""
        k = int(t_s // (self.step_min * 60))
        if k < 0 or k >= self.mm.size:
            return 0.0
        return float(self.mm[k]) / 1000.0 / (self.step_min * 60)


def _hourly(url: str, lat: float, lon: float, start: str, end: str) -> tuple[list[str], np.ndarray]:
    r = requests.get(url, params={
        "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
        "hourly": "precipitation", "timezone": "Europe/Istanbul",
    }, timeout=60)
    r.raise_for_status()
    j = r.json()["hourly"]
    return j["time"], np.array([p or 0.0 for p in j["precipitation"]], dtype=np.float64)


class HistoricalRain:
    def __init__(self, start_local: str, hours: int, station_total_mm: float | None = None,
                 station_note: str = ""):
        self.start_local = start_local  # "2026-10-14T12:00"
        self.hours = hours
        self.station_total_mm = station_total_mm
        self.station_note = station_note

    def series(self, lat: float, lon: float) -> RainSeries:
        day0 = self.start_local[:10]
        end_day = np.datetime64(self.start_local) + np.timedelta64(self.hours, "h")
        end = str(end_day)[:10]
        best: tuple[str, list[str], np.ndarray] | None = None
        for name, url in (("historical-forecast", HIST_FORECAST), ("era5-archive", ARCHIVE)):
            try:
                times, mm = _hourly(url, lat, lon, day0, end)
            except Exception:
                continue
            if best is None or mm.max() > best[2].max():  # keep the sharper (less smeared) pattern
                best = (name, times, mm)
        if best is None:
            raise RuntimeError("Open-Meteo unavailable")
        name, times, mm = best
        i0 = times.index(self.start_local)
        window = mm[i0:i0 + self.hours].copy()
        source = f"open-meteo:{name}"
        if self.station_total_mm and window.sum() > 0:
            window *= self.station_total_mm / window.sum()
            source += f" scaled to {self.station_total_mm:.0f} mm ({self.station_note})"
        return RainSeries(start_iso=self.start_local, step_min=60, mm=window, source=source)


class DesignStorm:
    """Alternating-block hyetograph with a given total and duration (for the scenario ladder)."""

    def __init__(self, total_mm: float, hours: int = 6):
        self.total_mm = total_mm
        self.hours = hours

    def series(self, lat: float, lon: float) -> RainSeries:
        n = self.hours
        # IDF-like decay i ~ d^-0.7 -> block depths, then alternate around the peak
        d = np.arange(1, n + 1, dtype=np.float64)
        cum = d ** 0.3
        blocks = np.diff(np.concatenate([[0.0], cum]))
        order = np.argsort(-blocks)
        out = np.zeros(n)
        mid = n // 2
        for k, idx in enumerate(order):
            pos = mid + ((k + 1) // 2) * (1 if k % 2 else -1)
            out[min(max(pos, 0), n - 1)] += blocks[idx]
        out *= self.total_mm / out.sum()
        return RainSeries(start_iso="design", step_min=60, mm=out, source=f"design-storm {self.total_mm:.0f} mm/{n} h")

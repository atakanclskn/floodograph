"""Urgency tiers. Must match packages/core/src/tiers.ts and public.tier_from_hand() in SQL."""
from __future__ import annotations

import numpy as np

TIERS = ("acil", "yuksek", "orta", "izle")
HAND_THRESHOLDS = (1.0, 2.0, 3.0)  # metres; calibrated against the 14 Oct backtest


def tier_index(hand_m: np.ndarray, critical: np.ndarray) -> np.ndarray:
    """0=acil … 3=izle. Critical facilities move one tier up (never above acil)."""
    h = np.asarray(hand_m, dtype=np.float64)
    idx = np.full(h.shape, 3, dtype=np.int8)
    idx[h <= HAND_THRESHOLDS[2]] = 2
    idx[h <= HAND_THRESHOLDS[1]] = 1
    idx[h <= HAND_THRESHOLDS[0]] = 0
    idx[np.isnan(h)] = 3
    crit = np.asarray(critical, dtype=bool)
    idx[crit] = np.maximum(idx[crit] - 1, 0)
    return idx


def tier_names(idx: np.ndarray) -> np.ndarray:
    return np.asarray(TIERS, dtype=object)[idx]


def scenario_tier_index(max_depth_m: np.ndarray, critical: np.ndarray, static_idx: np.ndarray) -> np.ndarray:
    """Tier for a simulated event (depth at the building walls), falling back to the static HAND tier.

    acil   >= 0.5 m at the walls (ground floors flooded, cars float), or >= 0.15 m at a critical facility
    yuksek >= 0.15 m (water reached the building)
    orta   stayed dry this time, but HAND says acil/yuksek (exposed in a bigger event)
    izle   otherwise
    """
    md = np.nan_to_num(np.asarray(max_depth_m, dtype=np.float64))
    crit = np.asarray(critical, dtype=bool)
    idx = np.full(md.shape, 3, dtype=np.int8)
    idx[np.asarray(static_idx) <= 1] = 2
    idx[md >= 0.15] = 1
    idx[(md >= 0.5) | ((md >= 0.15) & crit)] = 0
    return idx

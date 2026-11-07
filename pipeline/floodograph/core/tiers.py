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

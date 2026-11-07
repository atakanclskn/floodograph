import numpy as np
from rasterio.transform import from_origin

from floodograph.core.hydrology import drainage_network, fill_nodata_nearest, sample
from floodograph.core.tiers import tier_index, tier_names
from floodograph.domain import Grid


def v_valley(n=60, cell=30.0, side_slope=0.05, down_slope=0.01):
    """Synthetic V-shaped valley draining south: the thalweg runs down the middle column."""
    y, x = np.mgrid[0:n, 0:n]
    z = 100 + side_slope * cell * np.abs(x - n // 2) + down_slope * cell * (n - y)
    return Grid(data=z.astype(np.float32), transform=from_origin(500000, 4500000, cell, cell), epsg=32635)


def test_hand_is_zero_on_thalweg_and_grows_with_distance():
    g = v_valley()
    h, net = drainage_network(g, stream_threshold_km2=0.05)
    mid = g.shape[1] // 2
    row = g.shape[0] - 10
    hand = h.hand.data
    assert hand[row, mid] < 0.5, "thalweg should be (near) drainage"
    # HAND rises monotonically away from the stream, ~ side_slope * cell per column
    assert hand[row, mid + 10] > hand[row, mid + 5] > hand[row, mid + 1]
    assert abs(hand[row, mid + 10] - 0.05 * 30 * 10) < 3.0
    assert len(net["features"]) >= 1


def test_fill_nodata_nearest():
    a = np.array([[1.0, np.nan], [np.nan, 4.0]])
    out = fill_nodata_nearest(a)
    assert not np.isnan(out).any()


def test_sample_outside_is_nan():
    g = v_valley(n=10)
    vals = sample(g, np.array([0.0, 500015.0]), np.array([0.0, 4499985.0]))
    assert np.isnan(vals[0]) and np.isfinite(vals[1])


def test_tiers_match_ts_and_sql_rules():
    hand = np.array([0.5, 1.5, 2.5, 5.0, 2.5, 0.5, np.nan])
    crit = np.array([0, 0, 0, 0, 1, 1, 0], dtype=bool)
    names = tier_names(tier_index(hand, crit)).tolist()
    # same cases as public.tier_from_hand() smoke test in Supabase
    assert names == ["acil", "yuksek", "orta", "izle", "yuksek", "acil", "izle"]

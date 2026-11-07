"""Analytic and conservation benchmarks for the 2D shallow-water solver."""
import math

import numpy as np

from floodograph.core.swe2d import Domain, State, initial_state, run


def make_domain(z, dx=1.0, wall=None, n=0.0, loss=0.0):
    z = np.asarray(z, dtype=np.float64)
    return Domain(
        z=z, dx=dx,
        wall=np.zeros(z.shape, bool) if wall is None else wall,
        sea=np.zeros(z.shape, bool),
        n_manning=np.full(z.shape, n),
        loss_mps=np.full(z.shape, loss),
    )


def boxed(shape):
    w = np.zeros(shape, bool)
    w[0, :] = w[-1, :] = w[:, 0] = w[:, -1] = True
    return w


def test_lake_at_rest_is_well_balanced():
    """A still lake over a bumpy bed must stay still (Audusse hydrostatic reconstruction)."""
    ny, nx = 40, 40
    y, x = np.mgrid[0:ny, 0:nx]
    z = 0.4 * np.exp(-((x - 20) ** 2 + (y - 20) ** 2) / 40.0) + 0.1 * np.sin(x / 3.0)
    d = make_domain(z, dx=1.0, wall=boxed((ny, nx)))
    st = initial_state(d)
    st.h[:] = np.where(d.wall, 0.0, np.maximum(0.0, 1.0 - z))
    h0 = st.h.copy()
    run(d, st, rain_at=lambda t: 0.0, t_end=30.0)
    speed = np.hypot(st.hu, st.hv) / np.maximum(st.h, 1e-9)
    assert speed[~d.wall].max() < 1e-6
    assert np.abs(st.h - h0).max() < 1e-9


def test_rain_mass_is_conserved_in_closed_basin():
    """Rain into a walled bowl with no losses: stored volume == rain volume."""
    ny, nx = 30, 30
    y, x = np.mgrid[0:ny, 0:nx]
    z = 0.002 * ((x - 15) ** 2 + (y - 15) ** 2)
    wall = boxed((ny, nx))
    wall[10:13, 10:13] = True  # a "building": roof rain must be redistributed, not lost
    d = make_domain(z, dx=2.0, wall=wall, n=0.03)
    st = initial_state(d)
    rate = 50e-3 / 3600  # 50 mm/h
    bal = run(d, st, rain_at=lambda t: rate, t_end=1800.0)
    stored = st.h[~wall].sum() * d.dx**2
    expected_total = rate * 1800.0 * ny * nx * d.dx**2  # rain on the whole area incl. roofs and edge walls
    assert abs(stored - bal["rain_m3"]) / bal["rain_m3"] < 1e-6
    assert abs(bal["rain_m3"] - expected_total) / expected_total < 1e-6


def test_dam_break_matches_ritter_solution():
    """1D dam break onto a dry bed (Ritter 1892): front at x0 + 2*c0*t, depth profile analytic."""
    nx, ny, dx = 800, 3, 0.5
    z = np.zeros((ny, nx))
    d = make_domain(z, dx=dx)
    st = initial_state(d)
    x = (np.arange(nx) + 0.5) * dx
    x0, h0 = 200.0, 1.0
    st.h[:, x < x0] = h0
    t_end = 20.0
    run(d, st, rain_at=lambda t: 0.0, t_end=t_end, cfl=0.45)
    c0 = math.sqrt(9.81 * h0)
    xi = (x - x0) / t_end
    exact = np.where(xi <= -c0, h0, np.where(xi >= 2 * c0, 0.0, (2 * c0 - xi) ** 2 / (9 * 9.81)))
    num = st.h[1]
    l1 = np.abs(num - exact).sum() / np.abs(exact).sum()
    assert l1 < 0.05, f"L1 relative error {l1:.3f}"
    wet = np.where(num > 1e-3)[0]
    front = x[wet.max()]
    # analytic position where the Ritter profile drops to the same 1 mm detection threshold
    exact_front = x0 + (2 * c0 - math.sqrt(9 * 9.81 * 1e-3)) * t_end
    # first-order schemes smear the thin dry-bed tip; 15 % on the front, 5 % L1 on the whole profile
    assert abs(front - exact_front) / (exact_front - x0) < 0.15

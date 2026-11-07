"""2D shallow-water solver (HEC-RAS-class core) on a structured grid.

Scheme
------
* Finite volume, first order in space, explicit in time (forward Euler), CFL-adaptive dt.
* HLL approximate Riemann solver with the hydrostatic reconstruction of Audusse et al. (2004):
  well-balanced (a lake at rest stays at rest over any bed) and positivity preserving (h >= 0),
  handles wet/dry fronts and supercritical flow on steep urban streets.
* Manning friction, semi-implicit (unconditionally stable for the friction term).
* Sources: rain-on-grid (m/s per cell), uniform loss (infiltration + storm sewer), sea sink.
* Buildings are solid walls (reflective faces); rain falling on roofs is redistributed to open cells
  so the total rain volume is conserved.
* Culverts (buried streams): an inlet cell drains up to Q_cap (m3/s) into a downstream outlet cell.
  When inflow exceeds capacity the water stays on the surface -> an "overflow" event is recorded.

All kernels are numba-compiled and parallel over rows. Units: SI.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numba as nb
import numpy as np

G = 9.81
H_DRY = 1e-4  # m; below this a cell is dry
U_MAX = 15.0  # m/s; physical cap against spurious velocities in nearly-dry cells


@nb.njit(cache=True, fastmath=True, inline="always")
def _hll(hl, ul, vl, hr, ur, vr):
    """HLL flux normal to an interface. Returns (F_h, F_hu_normal, F_hv_tangential)."""
    if hl < H_DRY and hr < H_DRY:
        return 0.0, 0.0, 0.0
    cl = math.sqrt(G * hl)
    cr = math.sqrt(G * hr)
    sl = min(ul - cl, ur - cr)
    sr = max(ul + cl, ur + cr)
    fl0 = hl * ul
    fl1 = hl * ul * ul + 0.5 * G * hl * hl
    fl2 = hl * ul * vl
    fr0 = hr * ur
    fr1 = hr * ur * ur + 0.5 * G * hr * hr
    fr2 = hr * ur * vr
    if sl >= 0.0:
        return fl0, fl1, fl2
    if sr <= 0.0:
        return fr0, fr1, fr2
    inv = 1.0 / (sr - sl)
    f0 = (sr * fl0 - sl * fr0 + sl * sr * (hr - hl)) * inv
    f1 = (sr * fl1 - sl * fr1 + sl * sr * (hr * ur - hl * ul)) * inv
    f2 = (sr * fl2 - sl * fr2 + sl * sr * (hr * vr - hl * vl)) * inv
    return f0, f1, f2


@nb.njit(cache=True, fastmath=True, inline="always")
def _vel(h, q):
    if h < H_DRY:
        return 0.0
    u = q / h
    return max(-U_MAX, min(U_MAX, u))


@nb.njit(parallel=True, cache=True, fastmath=True)
def _fluxes_x(h, hu, hv, z, wall, fx):
    """Interface fluxes. fx[j, i] is the x-face between cells (j, i-1) and (j, i); gy[j, i] the y-face
    between (j-1, i) and (j, i). Each stores 6 values: mass/normal/tangential flux for the left cell
    then the same for the right cell (they differ by the hydrostatic correction term)."""
    ny, nx = h.shape
    for j in nb.prange(ny):
        for i in range(nx + 1):
            il = max(i - 1, 0)
            ir = min(i, nx - 1)
            if wall[j, il] or wall[j, ir]:
                # reflective wall: no mass flux; pressure acts on the wet side only
                pl = 0.5 * G * h[j, il] * h[j, il] if not wall[j, il] else 0.0
                pr = 0.5 * G * h[j, ir] * h[j, ir] if not wall[j, ir] else 0.0
                fx[j, i, 0] = 0.0; fx[j, i, 1] = pl; fx[j, i, 2] = 0.0
                fx[j, i, 3] = 0.0; fx[j, i, 4] = pr; fx[j, i, 5] = 0.0
                continue
            hl = h[j, il]; hr = h[j, ir]
            zs = max(z[j, il], z[j, ir])
            hls = max(0.0, hl + z[j, il] - zs)
            hrs = max(0.0, hr + z[j, ir] - zs)
            ul = _vel(hl, hu[j, il]); vl = _vel(hl, hv[j, il])
            ur = _vel(hr, hu[j, ir]); vr = _vel(hr, hv[j, ir])
            f0, f1, f2 = _hll(hls, ul, vl, hrs, ur, vr)
            if (i == 0 and f0 > 0.0) or (i == nx and f0 < 0.0):
                # domain edge, flow pointing inward: close it (outflow-only boundary, no mass source)
                pb = 0.5 * G * hl * hl
                fx[j, i, 0] = 0.0; fx[j, i, 1] = pb; fx[j, i, 2] = 0.0
                fx[j, i, 3] = 0.0; fx[j, i, 4] = pb; fx[j, i, 5] = 0.0
                continue
            fx[j, i, 0] = f0; fx[j, i, 1] = f1 + 0.5 * G * (hl * hl - hls * hls); fx[j, i, 2] = f2
            fx[j, i, 3] = f0; fx[j, i, 4] = f1 + 0.5 * G * (hr * hr - hrs * hrs); fx[j, i, 5] = f2


@nb.njit(parallel=True, cache=True, fastmath=True)
def _fluxes_y(h, hu, hv, z, wall, gy):
    ny, nx = h.shape
    for jp in nb.prange(ny + 1):
        j = np.int64(jp)  # prange index is uint64; mixing with int64 would yield float64
        jl = max(j - 1, 0)
        jr = min(j, ny - 1)
        for i in range(nx):
            if wall[jl, i] or wall[jr, i]:
                pl = 0.5 * G * h[jl, i] * h[jl, i] if not wall[jl, i] else 0.0
                pr = 0.5 * G * h[jr, i] * h[jr, i] if not wall[jr, i] else 0.0
                gy[j, i, 0] = 0.0; gy[j, i, 1] = pl; gy[j, i, 2] = 0.0
                gy[j, i, 3] = 0.0; gy[j, i, 4] = pr; gy[j, i, 5] = 0.0
                continue
            hl = h[jl, i]; hr = h[jr, i]
            zs = max(z[jl, i], z[jr, i])
            hls = max(0.0, hl + z[jl, i] - zs)
            hrs = max(0.0, hr + z[jr, i] - zs)
            # rotate: normal = v (rows increase "down" = +y in array space), tangential = u
            vl = _vel(hl, hv[jl, i]); ul = _vel(hl, hu[jl, i])
            vr = _vel(hr, hv[jr, i]); ur = _vel(hr, hu[jr, i])
            f0, f1, f2 = _hll(hls, vl, ul, hrs, vr, ur)
            if (j == 0 and f0 > 0.0) or (j == ny and f0 < 0.0):
                pb = 0.5 * G * hl * hl
                gy[j, i, 0] = 0.0; gy[j, i, 1] = pb; gy[j, i, 2] = 0.0
                gy[j, i, 3] = 0.0; gy[j, i, 4] = pb; gy[j, i, 5] = 0.0
                continue
            gy[j, i, 0] = f0; gy[j, i, 1] = f1 + 0.5 * G * (hl * hl - hls * hls); gy[j, i, 2] = f2
            gy[j, i, 3] = f0; gy[j, i, 4] = f1 + 0.5 * G * (hr * hr - hrs * hrs); gy[j, i, 5] = f2


@nb.njit(parallel=True, cache=True, fastmath=True)
def _update(h, hu, hv, fx, gy, wall, sea, n2, rain, loss, dt, dx):
    """Conservative update + sources + semi-implicit Manning friction. Returns volume lost to the sea."""
    ny, nx = h.shape
    k = dt / dx
    sea_out = np.zeros(ny)
    for jp in nb.prange(ny):
        j = np.int64(jp)
        for i in range(nx):
            if wall[j, i]:
                continue
            # x faces: right face of this cell is fx[j, i+1] (we are its left side -> values 0..2),
            # left face is fx[j, i] (we are its right side -> values 3..5)
            dh = -(fx[j, i + 1, 0] - fx[j, i, 3])
            dhu = -(fx[j, i + 1, 1] - fx[j, i, 4])
            dhv = -(fx[j, i + 1, 2] - fx[j, i, 5])
            dh -= gy[j + 1, i, 0] - gy[j, i, 3]
            dhv -= gy[j + 1, i, 1] - gy[j, i, 4]
            dhu -= gy[j + 1, i, 2] - gy[j, i, 5]
            hn = h[j, i] + k * dh
            qx = hu[j, i] + k * dhu
            qy = hv[j, i] + k * dhv
            hn += dt * (rain[j, i] - loss[j, i])
            if hn < 0.0:
                hn = 0.0
            if sea[j, i]:
                sea_out[j] += hn * dx * dx
                hn = 0.0
            if hn < H_DRY:
                qx = 0.0
                qy = 0.0
            else:
                sp = math.sqrt(qx * qx + qy * qy) / hn
                fr = 1.0 + dt * G * n2[j, i] * sp / hn ** (4.0 / 3.0)
                qx /= fr
                qy /= fr
                lim = U_MAX * hn
                qx = max(-lim, min(lim, qx))
                qy = max(-lim, min(lim, qy))
            h[j, i] = hn
            hu[j, i] = qx
            hv[j, i] = qy
    return sea_out.sum()


@nb.njit(cache=True)
def _row_max_speed(h, hu, hv, j):
    mj = 0.0
    for i in range(h.shape[1]):
        hh = h[j, i]
        if hh > H_DRY:
            s = max(abs(hu[j, i]), abs(hv[j, i])) / hh + math.sqrt(G * hh)
            if s > mj:
                mj = s
    return mj


@nb.njit(parallel=True, cache=True)
def _max_wave_speed(h, hu, hv):
    ny = h.shape[0]
    m = np.zeros(ny)
    for j in nb.prange(ny):
        m[j] = _row_max_speed(h, hu, hv, j)
    return m.max()


@nb.njit(cache=True)
def _culverts(h, inlet_j, inlet_i, outlet_j, outlet_i, qcap, dt, dx, saturated):
    """Move up to qcap*dt m3 from each inlet cell to its outlet cell. Marks saturated culverts."""
    area = dx * dx
    moved = 0.0
    for c in range(inlet_j.shape[0]):
        vol = h[inlet_j[c], inlet_i[c]] * area
        cap = qcap[c] * dt
        take = min(vol, cap)
        saturated[c] = vol > cap and h[inlet_j[c], inlet_i[c]] > 0.05
        h[inlet_j[c], inlet_i[c]] -= take / area
        h[outlet_j[c], outlet_i[c]] += take / area
        moved += take
    return moved


@dataclass
class Domain:
    z: np.ndarray  # bed elevation (m), row 0 = north
    dx: float
    wall: np.ndarray  # bool, building cells
    sea: np.ndarray  # bool, sink cells
    n_manning: np.ndarray  # Manning n per cell
    loss_mps: np.ndarray  # infiltration + sewer capacity (m/s)
    culvert_inlets: np.ndarray = field(default_factory=lambda: np.zeros((0, 2), np.int64))
    culvert_outlets: np.ndarray = field(default_factory=lambda: np.zeros((0, 2), np.int64))
    culvert_qcap: np.ndarray = field(default_factory=lambda: np.zeros(0))


@dataclass
class State:
    h: np.ndarray
    hu: np.ndarray
    hv: np.ndarray
    t: float = 0.0


def initial_state(d: Domain) -> State:
    z = np.zeros_like(d.z, dtype=np.float64)
    return State(h=z.copy(), hu=z.copy(), hv=z.copy())


def run(d: Domain, st: State, rain_at, t_end: float, cfl: float = 0.45, dt_max: float = 5.0,
        on_output=None, output_every: float = 300.0, culvert_events=None):
    """Advance to t_end (s). rain_at(t) -> rain intensity in m/s (scalar or array).

    on_output(state, stats) is called every output_every seconds. Returns cumulative mass-balance terms (m3).
    """
    ny, nx = d.z.shape
    fx = np.zeros((ny, nx + 1, 6))
    gy = np.zeros((ny + 1, nx, 6))
    n2 = d.n_manning.astype(np.float64) ** 2
    open_frac = 1.0 - d.wall.mean()
    area = d.dx * d.dx
    sat = np.zeros(d.culvert_qcap.shape[0], dtype=np.bool_)
    first_sat = np.full(d.culvert_qcap.shape[0], np.nan)
    bal = {"rain_m3": 0.0, "loss_m3": 0.0, "sea_m3": 0.0, "boundary_out_m3": 0.0, "culvert_moved_m3": 0.0, "steps": 0}
    next_out = st.t + output_every
    if on_output is not None and st.t == 0.0:
        on_output(st, {"t": st.t, **bal})
    zz = d.z.astype(np.float64)
    while st.t < t_end - 1e-9:
        s = _max_wave_speed(st.h, st.hu, st.hv)
        dt = dt_max if s < 1e-9 else min(dt_max, cfl * d.dx / s)
        dt = min(dt, next_out - st.t, t_end - st.t)
        r = rain_at(st.t) / open_frac  # roof rain redistributed to open cells
        rain = np.where(d.wall, 0.0, r)
        loss = np.minimum(d.loss_mps, st.h / dt + rain)  # cannot lose more than is there
        before_loss = loss[~d.wall].sum() * dt * area
        _fluxes_x(st.h, st.hu, st.hv, zz, d.wall, fx)
        _fluxes_y(st.h, st.hu, st.hv, zz, d.wall, gy)
        bal["boundary_out_m3"] += dt * d.dx * float(
            fx[:, nx, 0].sum() - fx[:, 0, 0].sum() + gy[ny, :, 0].sum() - gy[0, :, 0].sum())
        bal["sea_m3"] += _update(st.h, st.hu, st.hv, fx, gy, d.wall, d.sea, n2, rain, loss, dt, d.dx)
        bal["rain_m3"] += float(rain[~d.wall].sum()) * dt * area
        bal["loss_m3"] += before_loss
        if d.culvert_qcap.size:
            bal["culvert_moved_m3"] += _culverts(
                st.h, d.culvert_inlets[:, 0], d.culvert_inlets[:, 1],
                d.culvert_outlets[:, 0], d.culvert_outlets[:, 1], d.culvert_qcap, dt, d.dx, sat)
            newly = sat & np.isnan(first_sat)
            first_sat[newly] = st.t
        st.t += dt
        bal["steps"] += 1
        if st.t >= next_out - 1e-9:
            if on_output is not None:
                on_output(st, {"t": st.t, "dt": dt, **bal})
            next_out += output_every
    if culvert_events is not None:
        culvert_events[:] = first_sat
    return bal

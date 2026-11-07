"""CUDA port of :mod:`floodograph.core.swe2d` (CuPy raw kernels).

Same scheme, same physics, same boundary handling as the numba reference solver: HLL + Audusse
hydrostatic reconstruction, semi-implicit Manning friction, rain-on-grid with roof redistribution,
outflow-only domain edges, sea sink and culverts. One GPU thread per interface / per cell.

The numba solver stays the tested reference; ``tests/test_swe2d.py`` runs every analytic benchmark
against both backends. Install with ``uv sync --extra gpu`` (CuPy for CUDA 13).

Only one value crosses the bus per time step (the max wave speed, needed for the CFL time step);
mass-balance terms are accumulated on the device and read back at output times.
"""
from __future__ import annotations


import numpy as np

from .swe2d import G, H_DRY, U_MAX, Domain, State

try:  # optional dependency
    import cupy as cp
except ImportError:  # pragma: no cover - exercised only on machines without CUDA
    cp = None

_SRC = r"""
#define G_ @G@
#define H_DRY_ @H_DRY@
#define U_MAX_ @U_MAX@
typedef @REAL@ real;

__device__ __forceinline__ void hll(real hl, real ul, real vl, real hr, real ur, real vr,
                                    real &f0, real &f1, real &f2) {
    if (hl < (real)H_DRY_ && hr < (real)H_DRY_) { f0 = 0; f1 = 0; f2 = 0; return; }
    real cl = sqrt((real)G_ * hl), cr = sqrt((real)G_ * hr);
    real sl = fmin(ul - cl, ur - cr), sr = fmax(ul + cl, ur + cr);
    real fl0 = hl * ul, fl1 = hl * ul * ul + (real)0.5 * (real)G_ * hl * hl, fl2 = hl * ul * vl;
    real fr0 = hr * ur, fr1 = hr * ur * ur + (real)0.5 * (real)G_ * hr * hr, fr2 = hr * ur * vr;
    if (sl >= 0) { f0 = fl0; f1 = fl1; f2 = fl2; return; }
    if (sr <= 0) { f0 = fr0; f1 = fr1; f2 = fr2; return; }
    real inv = (real)1 / (sr - sl);
    f0 = (sr * fl0 - sl * fr0 + sl * sr * (hr - hl)) * inv;
    f1 = (sr * fl1 - sl * fr1 + sl * sr * (hr * ur - hl * ul)) * inv;
    f2 = (sr * fl2 - sl * fr2 + sl * sr * (hr * vr - hl * vl)) * inv;
}

__device__ __forceinline__ real vel(real h, real q) {
    if (h < (real)H_DRY_) return 0;
    real u = q / h;
    return fmax(-(real)U_MAX_, fmin((real)U_MAX_, u));
}

/* One face, generic in direction. a = cell on the low side, b = cell on the high side.
   edge_lo / edge_hi: this face is the domain's first / last face along its axis. */
__device__ __forceinline__ void face(const real* h, const real* qn, const real* qt, const real* z,
                                     const unsigned char* wall, long long a, long long b, bool edge_lo, bool edge_hi,
                                     real* out) {
    if (wall[a] || wall[b]) {
        real pl = wall[a] ? (real)0 : (real)0.5 * (real)G_ * h[a] * h[a];
        real pr = wall[b] ? (real)0 : (real)0.5 * (real)G_ * h[b] * h[b];
        out[0] = 0; out[1] = pl; out[2] = 0; out[3] = 0; out[4] = pr; out[5] = 0;
        return;
    }
    real hl = h[a], hr = h[b];
    real zs = fmax(z[a], z[b]);
    real hls = fmax((real)0, hl + z[a] - zs), hrs = fmax((real)0, hr + z[b] - zs);
    real f0, f1, f2;
    hll(hls, vel(hl, qn[a]), vel(hl, qt[a]), hrs, vel(hr, qn[b]), vel(hr, qt[b]), f0, f1, f2);
    if ((edge_lo && f0 > 0) || (edge_hi && f0 < 0)) {
        real pb = (real)0.5 * (real)G_ * hl * hl;
        out[0] = 0; out[1] = pb; out[2] = 0; out[3] = 0; out[4] = pb; out[5] = 0;
        return;
    }
    out[0] = f0; out[1] = f1 + (real)0.5 * (real)G_ * (hl * hl - hls * hls); out[2] = f2;
    out[3] = f0; out[4] = f1 + (real)0.5 * (real)G_ * (hr * hr - hrs * hrs); out[5] = f2;
}

extern "C" __global__ void fluxes_x(const real* h, const real* hu, const real* hv, const real* z,
                                    const unsigned char* wall, real* fx, int ny, int nx) {
    long long n = (long long)ny * (nx + 1);
    for (long long k = blockIdx.x * (long long)blockDim.x + threadIdx.x; k < n; k += (long long)gridDim.x * blockDim.x) {
        int j = (int)(k / (nx + 1)), i = (int)(k % (nx + 1));
        int il = max(i - 1, 0), ir = min(i, nx - 1);
        face(h, hu, hv, z, wall, (long long)j * nx + il, (long long)j * nx + ir, i == 0, i == nx, fx + k * 6);
    }
}

extern "C" __global__ void fluxes_y(const real* h, const real* hu, const real* hv, const real* z,
                                    const unsigned char* wall, real* gy, int ny, int nx) {
    long long n = (long long)(ny + 1) * nx;
    for (long long k = blockIdx.x * (long long)blockDim.x + threadIdx.x; k < n; k += (long long)gridDim.x * blockDim.x) {
        int j = (int)(k / nx), i = (int)(k % nx);
        int jl = max(j - 1, 0), jr = min(j, ny - 1);
        /* rotated: normal = v (rows increase southward), tangential = u */
        face(h, hv, hu, z, wall, (long long)jl * nx + i, (long long)jr * nx + i, j == 0, j == ny, gy + k * 6);
    }
}

/* Max wave speed per cell (0 for dry / wall cells); the host takes the max. */
extern "C" __global__ void wave_speed(const real* h, const real* hu, const real* hv, real* s, long long n) {
    for (long long k = blockIdx.x * (long long)blockDim.x + threadIdx.x; k < n; k += (long long)gridDim.x * blockDim.x) {
        real hh = h[k];
        s[k] = hh > (real)H_DRY_ ? fmax(fabs(hu[k]), fabs(hv[k])) / hh + sqrt((real)G_ * hh) : (real)0;
    }
}

/* Conservative update + sources + friction. Writes per-cell lost-to-loss and lost-to-sea volumes
   (m3) so the host can reduce them on the device. */
extern "C" __global__ void update(real* h, real* hu, real* hv, const real* fx, const real* gy,
                                  const unsigned char* wall, const unsigned char* sea, const real* n2,
                                  const real* loss_mps, real rain_open, real dt, real dx, int ny, int nx,
                                  real* loss_vol, real* sea_vol) {
    long long n = (long long)ny * nx;
    real k_ = dt / dx, area = dx * dx;
    for (long long c = blockIdx.x * (long long)blockDim.x + threadIdx.x; c < n; c += (long long)gridDim.x * blockDim.x) {
        if (wall[c]) { loss_vol[c] = 0; sea_vol[c] = 0; continue; }
        int j = (int)(c / nx), i = (int)(c % nx);
        const real* fr = fx + ((long long)j * (nx + 1) + i + 1) * 6;  /* right face: we are its left side */
        const real* fl = fx + ((long long)j * (nx + 1) + i) * 6;      /* left face: we are its right side */
        const real* gs = gy + ((long long)(j + 1) * nx + i) * 6;      /* south face */
        const real* gn = gy + ((long long)j * nx + i) * 6;            /* north face */
        real h0 = h[c];
        real loss = fmin(loss_mps[c], h0 / dt + rain_open);  /* cannot lose more than is there */
        loss_vol[c] = loss * dt * area;
        real dh = -(fr[0] - fl[3]) - (gs[0] - gn[3]);
        real dhu = -(fr[1] - fl[4]) - (gs[2] - gn[5]);
        real dhv = -(fr[2] - fl[5]) - (gs[1] - gn[4]);
        real hn = h0 + k_ * dh;
        real qx = hu[c] + k_ * dhu;
        real qy = hv[c] + k_ * dhv;
        hn += dt * (rain_open - loss);
        if (hn < 0) hn = 0;
        real sv = 0;
        if (sea[c]) { sv = hn * area; hn = 0; }
        sea_vol[c] = sv;
        if (hn < (real)H_DRY_) { qx = 0; qy = 0; }
        else {
            real sp = sqrt(qx * qx + qy * qy) / hn;
            real f = (real)1 + dt * (real)G_ * n2[c] * sp / pow(hn, (real)(4.0 / 3.0));
            qx /= f; qy /= f;
            real lim = (real)U_MAX_ * hn;
            qx = fmax(-lim, fmin(lim, qx));
            qy = fmax(-lim, fmin(lim, qy));
        }
        h[c] = hn; hu[c] = qx; hv[c] = qy;
    }
}

/* Culverts, sequential in one thread so shared inlet/outlet cells behave exactly like the CPU loop. */
extern "C" __global__ void culverts(real* h, const long long* inlet, const long long* outlet, const real* qcap, int nc,
                                    real dt, real dx, real t, real* first_sat, real* moved) {
    if (blockIdx.x != 0 || threadIdx.x != 0) return;
    real area = dx * dx, m = 0;
    for (int c = 0; c < nc; ++c) {
        real hi = h[inlet[c]];
        real vol = hi * area, cap = qcap[c] * dt;
        real take = fmin(vol, cap);
        if (vol > cap && hi > (real)0.05 && isnan(first_sat[c])) first_sat[c] = t;
        h[inlet[c]] -= take / area;
        h[outlet[c]] += take / area;
        m += take;
    }
    moved[0] += m;
}
"""

_modules: dict[str, object] = {}


def available() -> bool:
    """True when CuPy is installed and a CUDA device is visible."""
    if cp is None:
        return False
    try:
        return cp.cuda.runtime.getDeviceCount() > 0
    except Exception:  # noqa: BLE001 - no driver / no device
        return False


def _module(real: str):
    if real not in _modules:
        src = (_SRC.replace("@G@", repr(G)).replace("@H_DRY@", repr(H_DRY))
               .replace("@U_MAX@", repr(U_MAX)).replace("@REAL@", real))
        _modules[real] = cp.RawModule(code=src, options=("--std=c++17",))
    return _modules[real]


def run(d: Domain, st: State, rain_at, t_end: float, cfl: float = 0.45, dt_max: float = 5.0,
        on_output=None, output_every: float = 300.0, culvert_events=None, dtype=np.float64):
    """Drop-in replacement for :func:`floodograph.core.swe2d.run` on the GPU.

    ``st`` is updated in place (host arrays are refreshed at every output and at the end).
    ``dtype=np.float32`` is ~2x faster on consumer GPUs but is not used for results we publish.
    """
    if not available():
        raise RuntimeError("CUDA/CuPy not available: install the 'gpu' extra or use swe2d.run")
    dtype = np.dtype(dtype)
    real = "double" if dtype == np.float64 else "float"
    mod = _module(real)
    k_fx, k_gy = mod.get_function("fluxes_x"), mod.get_function("fluxes_y")
    k_ws, k_up, k_cv = mod.get_function("wave_speed"), mod.get_function("update"), mod.get_function("culverts")

    ny, nx = d.z.shape
    n = ny * nx
    dev = lambda a, t=dtype: cp.asarray(np.ascontiguousarray(a, dtype=t))  # noqa: E731
    h, hu, hv = dev(st.h), dev(st.hu), dev(st.hv)
    z = dev(d.z)
    wall = dev(d.wall, np.uint8)
    sea = dev(d.sea, np.uint8)
    n2 = dev(np.asarray(d.n_manning, np.float64) ** 2)
    loss_mps = dev(d.loss_mps)
    fx = cp.zeros((ny, nx + 1, 6), dtype)
    gy = cp.zeros((ny + 1, nx, 6), dtype)
    speed = cp.empty(n, dtype)
    loss_vol = cp.zeros(n, dtype)
    sea_vol = cp.zeros(n, dtype)
    nc = int(d.culvert_qcap.shape[0])
    inlet = cp.asarray((d.culvert_inlets[:, 0] * nx + d.culvert_inlets[:, 1]).astype(np.int64))
    outlet = cp.asarray((d.culvert_outlets[:, 0] * nx + d.culvert_outlets[:, 1]).astype(np.int64))
    qcap = dev(d.culvert_qcap)
    first_sat = cp.full(max(nc, 1), np.nan, dtype)
    # device-side mass-balance accumulators (always float64 so float32 runs still balance well)
    acc = cp.zeros(4, np.float64)  # loss, sea, boundary_out, culvert_moved
    moved = cp.zeros(1, dtype)

    threads = 256
    blocks = lambda m: (min((m + threads - 1) // threads, 65535),)  # noqa: E731
    bx, by, bc = blocks(ny * (nx + 1)), blocks((ny + 1) * nx), blocks(n)
    open_frac = 1.0 - float(np.mean(d.wall))
    n_open = int((~d.wall).sum())
    area = d.dx * d.dx
    R = dtype.type
    bal = {"rain_m3": 0.0, "loss_m3": 0.0, "sea_m3": 0.0, "boundary_out_m3": 0.0, "culvert_moved_m3": 0.0, "steps": 0}

    def sync_to_host():
        st.h[:] = cp.asnumpy(h)
        st.hu[:] = cp.asnumpy(hu)
        st.hv[:] = cp.asnumpy(hv)
        a = cp.asnumpy(acc)
        bal["loss_m3"], bal["sea_m3"], bal["boundary_out_m3"] = float(a[0]), float(a[1]), float(a[2])
        bal["culvert_moved_m3"] = float(cp.asnumpy(moved)[0])

    next_out = st.t + output_every
    if on_output is not None and st.t == 0.0:
        on_output(st, {"t": st.t, **bal})
    while st.t < t_end - 1e-9:
        k_ws(bc, (threads,), (h, hu, hv, speed, np.int64(n)))
        s = float(speed.max())  # the one host sync per step
        dt = dt_max if s < 1e-9 else min(dt_max, cfl * d.dx / s)
        dt = min(dt, next_out - st.t, t_end - st.t)
        r = float(rain_at(st.t)) / open_frac  # roof rain redistributed to open cells
        k_fx(bx, (threads,), (h, hu, hv, z, wall, fx, np.int32(ny), np.int32(nx)))
        k_gy(by, (threads,), (h, hu, hv, z, wall, gy, np.int32(ny), np.int32(nx)))
        acc[2] += dt * d.dx * (fx[:, nx, 0].sum(dtype=np.float64) - fx[:, 0, 0].sum(dtype=np.float64)
                               + gy[ny, :, 0].sum(dtype=np.float64) - gy[0, :, 0].sum(dtype=np.float64))
        k_up(bc, (threads,), (h, hu, hv, fx, gy, wall, sea, n2, loss_mps, R(r), R(dt), R(d.dx),
                              np.int32(ny), np.int32(nx), loss_vol, sea_vol))
        acc[0] += loss_vol.sum(dtype=np.float64)
        acc[1] += sea_vol.sum(dtype=np.float64)
        bal["rain_m3"] += r * n_open * dt * area
        if nc:
            k_cv((1,), (1,), (h, inlet, outlet, qcap, np.int32(nc), R(dt), R(d.dx), R(st.t), first_sat, moved))
        st.t += dt
        bal["steps"] += 1
        if st.t >= next_out - 1e-9:
            if on_output is not None:
                sync_to_host()
                on_output(st, {"t": st.t, "dt": dt, **bal})
            next_out += output_every
    sync_to_host()
    if culvert_events is not None and nc:
        culvert_events[:] = cp.asnumpy(first_sat[:nc]).astype(np.float64)
    return bal


def describe() -> str:
    """Short device description for logs / summary.json."""
    if not available():
        return "cpu"
    props = cp.cuda.runtime.getDeviceProperties(0)
    name = props["name"].decode() if isinstance(props["name"], bytes) else props["name"]
    return f"{name} (CUDA {cp.cuda.runtime.runtimeGetVersion() // 1000}.{cp.cuda.runtime.runtimeGetVersion() % 1000 // 10})"


__all__ = ["available", "describe", "run"]

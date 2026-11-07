import * as THREE from "three";
import { decodeDepth, decodeVel, type FrameStore } from "./data";
import { gridTexture } from "./textures";

/** Depth (m) under which a cell counts as dry for drawing. */
export const DRAW_EPS = 0.03;
const NEAR_WET_R = Math.ceil(Math.sqrt(0.02 / 16) * 255);

/**
 * The two keyframes bracketing the playhead, as GPU textures plus their CPU copies.
 * The shaders blend them with `alpha`, so the water rises and recedes continuously between 5-minute frames.
 * Alpha channel = "near wet" mask (wet cells dilated by the mesh stride), used to collapse fully dry triangles.
 */
export class FloodField {
  readonly nx: number;
  readonly ny: number;
  readonly texA: THREE.DataTexture;
  readonly texB: THREE.DataTexture;
  private bufA: Uint8Array;
  private bufB: Uint8Array;
  private idxA = -2;
  private idxB = -2;
  alpha = 0;
  /** bumps whenever the bracketing keyframes change (consumers rebuild their spawn lists) */
  revision = 0;
  private readonly tmp: Uint8Array;

  constructor(
    private readonly store: FrameStore,
    nx: number,
    ny: number,
    private readonly dilate: number,
  ) {
    this.nx = nx;
    this.ny = ny;
    this.bufA = new Uint8Array(nx * ny * 4);
    this.bufB = new Uint8Array(nx * ny * 4);
    this.tmp = new Uint8Array(nx * ny);
    this.texA = gridTexture(nx, ny, this.bufA);
    this.texB = gridTexture(nx, ny, this.bufB);
  }

  /** Point the field at sim minute t. Cheap when the keyframes did not change. */
  update(t: number) {
    const [l0, l1, a] = this.store.locate(t);
    const i0 = this.store.has(l0) ? l0 : this.store.nearestLoaded(l0);
    const i1 = this.store.has(l1) ? l1 : i0;
    this.alpha = i0 === l0 && i1 === l1 ? a : 0;
    if (i0 === this.idxA && i1 === this.idxB) return;
    if (i0 < 0) return;
    if (i0 === this.idxB && i1 !== this.idxB) {
      // stepped forward by one frame: reuse B as the new A
      [this.bufA, this.bufB] = [this.bufB, this.bufA];
      this.store.expand(i1, this.bufB);
      this.markNearWet(this.bufB);
    } else {
      this.store.expand(i0, this.bufA);
      this.markNearWet(this.bufA);
      if (i1 === i0) this.bufB.set(this.bufA);
      else {
        this.store.expand(i1, this.bufB);
        this.markNearWet(this.bufB);
      }
    }
    this.idxA = i0;
    this.idxB = i1;
    this.texA.image.data = this.bufA;
    this.texB.image.data = this.bufB;
    this.texA.needsUpdate = true;
    this.texB.needsUpdate = true;
    this.revision++;
  }

  /** Force a re-expand (e.g. a missing frame just arrived). */
  invalidate() {
    this.idxA = this.idxB = -2;
  }

  private markNearWet(buf: Uint8Array) {
    const { nx, ny, dilate: r } = this;
    const m = this.tmp;
    for (let c = 0; c < nx * ny; c++) m[c] = buf[c * 4]! >= NEAR_WET_R ? 1 : 0;
    // separable max filter: rows into alpha, then columns back into tmp
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        let v = 0;
        for (let k = Math.max(0, i - r); k <= Math.min(nx - 1, i + r) && !v; k++) v = m[row + k]!;
        buf[(row + i) * 4 + 3] = v;
      }
    }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        let v = 0;
        for (let k = Math.max(0, j - r); k <= Math.min(ny - 1, j + r) && !v; k++) v = buf[(k * nx + i) * 4 + 3]!;
        m[j * nx + i] = v;
      }
    for (let c = 0; c < nx * ny; c++) buf[c * 4 + 3] = m[c]! ? 255 : 0;
  }

  /** Depth (m) and grid velocity (m/s) at fractional cell coords, blended between keyframes. */
  sample(fx: number, fy: number, out: { d: number; u: number; v: number }) {
    const { nx, ny } = this;
    const x = Math.min(Math.max(fx, 0), nx - 1);
    const y = Math.min(Math.max(fy, 0), ny - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, nx - 1);
    const y1 = Math.min(y0 + 1, ny - 1);
    const ax = x - x0;
    const ay = y - y0;
    const w00 = (1 - ax) * (1 - ay),
      w10 = ax * (1 - ay),
      w01 = (1 - ax) * ay,
      w11 = ax * ay;
    const k = this.alpha;
    let d = 0,
      u = 0,
      v = 0;
    for (const [buf, wt] of [
      [this.bufA, 1 - k],
      [this.bufB, k],
    ] as const) {
      if (wt === 0) continue;
      const c00 = (y0 * nx + x0) * 4,
        c10 = (y0 * nx + x1) * 4,
        c01 = (y1 * nx + x0) * 4,
        c11 = (y1 * nx + x1) * 4;
      const r = buf[c00]! * w00 + buf[c10]! * w10 + buf[c01]! * w01 + buf[c11]! * w11;
      d += decodeDepth(r) * wt;
      u += decodeVel(buf[c00 + 1]! * w00 + buf[c10 + 1]! * w10 + buf[c01 + 1]! * w01 + buf[c11 + 1]! * w11) * wt;
      v += decodeVel(buf[c00 + 2]! * w00 + buf[c10 + 2]! * w10 + buf[c01 + 2]! * w01 + buf[c11 + 2]! * w11) * wt;
    }
    out.d = d;
    out.u = u;
    out.v = v;
  }

  /** Depth/speed of one cell (no spatial interpolation), for spawn lists. */
  cell(c: number): [number, number] {
    const k = this.alpha;
    const a = this.bufA,
      b = this.bufB;
    const o = c * 4;
    const d = decodeDepth(a[o]! * (1 - k) + b[o]! * k);
    const u = decodeVel(a[o + 1]! * (1 - k) + b[o + 1]! * k);
    const v = decodeVel(a[o + 2]! * (1 - k) + b[o + 2]! * k);
    return [d, Math.hypot(u, v)];
  }

  dispose() {
    this.texA.dispose();
    this.texB.dispose();
  }
}

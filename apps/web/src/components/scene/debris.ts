import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FloodField } from "./field";
import { sampleField, type GridGeo } from "./geo";
import { rng } from "./textures";

/**
 * Drifting cars, logs and wreckage. A VISUAL REPRESENTATION tied to the model's depth and velocity fields:
 * each object lifts off once the local depth passes its threshold, is carried along the simulated velocity,
 * bobs and turns on the surface and settles where the water leaves it. No object physics is simulated.
 */
type Kind = { name: string; geom: THREE.BufferGeometry; lift: number; draft: number; drift: number; colors: number[]; spin: number };

function carGeometry() {
  const body = new THREE.BoxGeometry(4.3, 1.8, 0.75);
  body.translate(0, 0, 0.62);
  const cabin = new THREE.BoxGeometry(2.3, 1.62, 0.62);
  cabin.translate(-0.25, 0, 1.3);
  const g = mergeGeometries([body.toNonIndexed(), cabin.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}
function logGeometry() {
  const g = new THREE.CylinderGeometry(0.22, 0.3, 5.5, 6, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0, 0.25);
  return g.toNonIndexed();
}
function wreckGeometry() {
  const a = new THREE.BoxGeometry(2.2, 1.1, 0.16);
  a.rotateZ(0.4);
  const b = new THREE.DodecahedronGeometry(0.55, 0);
  b.scale(1.3, 0.9, 0.5);
  b.translate(0.7, -0.3, 0.15);
  const g = mergeGeometries([a.toNonIndexed(), b.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

type Obj = {
  kind: number;
  hx: number;
  hy: number;
  x: number;
  y: number;
  yaw: number;
  yawRate: number;
  phase: number;
  floating: boolean;
  scale: number;
};

const SCRATCH = { d: 0, u: 0, v: 0 };

export class Debris {
  readonly group = new THREE.Group();
  private kinds: Kind[];
  private meshes: THREE.InstancedMesh[] = [];
  private objs: Obj[] = [];
  private counts: number[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  floating = 0;

  constructor(
    private readonly geo: GridGeo,
    private readonly ground: Float32Array,
    private readonly field: FloodField,
    budget: number,
  ) {
    this.kinds = [
      { name: "araç", geom: carGeometry(), lift: 0.3, draft: 0.55, drift: 0.85, spin: 0.35, colors: [0xd9d6cf, 0x9aa3a8, 0x2a2f33, 0x6b1f1f, 0x1f3550, 0xe8b512, 0xe8b512, 0x4a4f45] },
      { name: "kütük", geom: logGeometry(), lift: 0.12, draft: 0.12, drift: 1.0, spin: 0.9, colors: [0x5a3f28, 0x6b4b30, 0x4a3422] },
      { name: "moloz", geom: wreckGeometry(), lift: 0.15, draft: 0.08, drift: 0.95, spin: 1.3, colors: [0x7d6d58, 0x5f5f58, 0x2f4f6f, 0x8a7a62] },
    ];
    this.counts = [Math.round(budget * 0.45), Math.round(budget * 0.2), Math.round(budget * 0.35)];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.kinds.forEach((k, i) => {
      const mesh = new THREE.InstancedMesh(k.geom, mat, this.counts[i]!);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 1;
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
  }

  /**
   * Scatter objects over cells that the flood will reach (max depth over the event), away from buildings.
   * Cars favour cells along the flow paths (deep at peak); logs and wreckage come from the upstream channels.
   */
  place(maxDepth: Float32Array, mask: Float32Array, seed = 14) {
    const { nx, ny } = this.geo;
    const rand = rng(seed);
    const cand: number[] = [];
    for (let c = 0; c < nx * ny; c++) if (maxDepth[c]! > 0.45 && mask[c]! < 0.2) cand.push(c);
    this.objs = [];
    if (!cand.length) return;
    this.kinds.forEach((k, ki) => {
      const mesh = this.meshes[ki]!;
      const color = new THREE.Color();
      for (let n = 0; n < this.counts[ki]!; n++) {
        const c = cand[Math.floor(rand() * cand.length)]!;
        const i = (c % nx) + (rand() - 0.5) * 0.8;
        const j = Math.floor(c / nx) + (rand() - 0.5) * 0.8;
        const [x, y] = this.geo.cellToLocal(i, j);
        this.objs.push({
          kind: ki,
          hx: x,
          hy: y,
          x,
          y,
          yaw: rand() * Math.PI * 2,
          yawRate: (rand() - 0.5) * k.spin,
          phase: rand() * 100,
          floating: false,
          scale: 1.25 + rand() * 0.25,
        });
        color.setHex(k.colors[Math.floor(rand() * k.colors.length)]!);
        mesh.setColorAt(n, color);
      }
      mesh.count = this.counts[ki]!;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  /** Send everything back to where it was parked (after seeking backwards). */
  reset() {
    for (const o of this.objs) {
      o.x = o.hx;
      o.y = o.hy;
      o.floating = false;
    }
  }

  /** dtVisual: real seconds scaled by playback rate (0 when paused). time: visual clock for bobbing. */
  update(dtVisual: number, time: number) {
    const { geo, ground, field } = this;
    const { nx, ny } = geo;
    const counters = [0, 0, 0];
    let floating = 0;
    for (const o of this.objs) {
      const k = this.kinds[o.kind]!;
      const [fx, fy] = geo.localToCell(o.x, o.y);
      field.sample(fx, fy, SCRATCH);
      const g = sampleField(ground, nx, ny, fx, fy);
      const d = SCRATCH.d;
      if (!o.floating && d > k.lift) o.floating = true;
      else if (o.floating && d < k.lift * 0.5) o.floating = false; // stranded where the water left it
      let z = g;
      let roll = 0,
        pitch = 0;
      if (o.floating) {
        floating++;
        const [vx, vy] = geo.velocityToLocal(SCRATCH.u, SCRATCH.v);
        const sp = Math.hypot(vx, vy);
        // visual drift: a few metres per real second per m/s of modelled flow
        const step = dtVisual * 3.2 * k.drift;
        const nxp = o.x + vx * step;
        const nyp = o.y + vy * step;
        if (this.free(nxp, nyp)) {
          o.x = nxp;
          o.y = nyp;
        } else if (this.free(nxp, o.y)) o.x = nxp;
        else if (this.free(o.x, nyp)) o.y = nyp;
        // turn toward the current, plus a slow tumble
        if (sp > 0.05) {
          const target = Math.atan2(vy, vx);
          let dy = target - o.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          o.yaw += dy * Math.min(1, dtVisual * 0.6) + o.yawRate * dtVisual * (0.3 + sp);
        }
        const bob = Math.sin(time * 1.7 + o.phase) * 0.09 + Math.sin(time * 2.9 + o.phase * 1.3) * 0.05;
        z = g + d + 0.35 - k.draft + bob;
        roll = Math.sin(time * 1.3 + o.phase) * 0.08 * (0.5 + Math.min(sp, 2));
        pitch = Math.cos(time * 1.1 + o.phase * 0.7) * 0.06 * (0.5 + Math.min(sp, 2));
      }
      const ki = o.kind;
      const n = counters[ki]!++;
      this.e.set(roll, pitch, o.yaw, "ZXY");
      this.q.setFromEuler(this.e);
      this.p.set(o.x, o.y, z);
      this.s.setScalar(o.scale);
      this.m.compose(this.p, this.q, this.s);
      this.meshes[ki]!.setMatrixAt(n, this.m);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    this.floating = floating;
  }

  private maskRef: Float32Array | null = null;
  setMask(mask: Float32Array) {
    this.maskRef = mask;
  }
  private free(x: number, y: number) {
    const [fx, fy] = this.geo.localToCell(x, y);
    const { nx, ny } = this.geo;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return false;
    if (!this.maskRef) return true;
    return this.maskRef[Math.round(fy) * nx + Math.round(fx)]! < 0.5;
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
  }
}

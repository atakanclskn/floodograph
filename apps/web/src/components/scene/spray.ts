import * as THREE from "three";
import type { FloodField } from "./field";
import { sampleField, type GridGeo } from "./geo";
import { FOG_GLSL, type SharedUniforms } from "./water";

/**
 * Spray and splash particles where the modelled flow is fast or strikes a building.
 * Visual representation only: spawn rate and launch direction follow the depth/velocity field.
 */
const vertex = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  uniform float uPx;
  varying float vLife;
  varying vec3 vPos;
  void main() {
    vLife = aLife;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aLife > 0.0 ? max(uPx * aSize / gl_Position.w, 1.5) : 0.0;
  }
`;
const fragment = /* glsl */ `
  ${FOG_GLSL}
  varying float vLife;
  varying vec3 vPos;
  void main() {
    if (vLife <= 0.0) discard;
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c) * 4.0;
    if (r > 1.0) discard;
    float a = (1.0 - r) * smoothstep(0.0, 0.25, vLife) * 0.7;
    vec3 col = applyFog(vec3(0.86, 0.84, 0.79), vPos);
    gl_FragColor = vec4(col, a);
  }
`;

const S = { d: 0, u: 0, v: 0 };

export class Spray {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private cursor = 0;
  /** cells (index) worth spraying from, with a weight */
  private sources: { c: number; w: number }[] = [];
  private totalW = 0;
  private builtRev = -1;
  private accum = 0;
  private readonly uPx = { value: 800 };

  constructor(
    private readonly geo: GridGeo,
    private readonly ground: Float32Array,
    private readonly field: FloodField,
    private readonly mask: () => Float32Array | null,
    private readonly n: number,
    shared: SharedUniforms,
  ) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { ...shared, uPx: this.uPx },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setViewportHeight(px: number, fov: number) {
    this.uPx.value = px / (2 * Math.tan(fov / 2));
  }

  private rebuild() {
    const { nx, ny } = this.geo;
    const mask = this.mask();
    this.sources = [];
    this.totalW = 0;
    for (let c = 0; c < nx * ny; c++) {
      const [d, sp] = this.field.cell(c);
      if (d < 0.08) continue;
      let w = Math.max(0, sp - 0.9) * 1.2;
      if (mask) {
        const i = c % nx;
        const j = (c - i) / nx;
        let near = 0;
        if (i > 0) near = Math.max(near, mask[c - 1]!);
        if (i < nx - 1) near = Math.max(near, mask[c + 1]!);
        if (j > 0) near = Math.max(near, mask[c - nx]!);
        if (j < ny - 1) near = Math.max(near, mask[c + nx]!);
        if (near > 0.5 && mask[c]! < 0.5) w += Math.max(0, sp - 0.25) * 2.0;
      }
      if (w > 0.02) {
        this.sources.push({ c, w });
        this.totalW += w;
      }
    }
    this.builtRev = this.field.revision;
  }

  private pick(r: number) {
    let acc = r * this.totalW;
    // linear walk is fine for a few thousand sources at <= a few hundred spawns per frame
    for (const s of this.sources) {
      acc -= s.w;
      if (acc <= 0) return s.c;
    }
    return this.sources[this.sources.length - 1]!.c;
  }

  update(dt: number, rate: number) {
    if (this.field.revision !== this.builtRev) this.rebuild();
    const { geo, ground, field } = this;
    const { nx, ny } = geo;
    // spawn
    if (this.sources.length && rate > 0) {
      this.accum += Math.min(this.totalW, 400) * dt * 18 * Math.min(rate, 2);
      let spawns = Math.min(Math.floor(this.accum), Math.floor(this.n / 12));
      this.accum -= spawns;
      while (spawns-- > 0) {
        const c = this.pick(Math.random());
        const fx = (c % nx) + (Math.random() - 0.5);
        const fy = Math.floor(c / nx) + (Math.random() - 0.5);
        field.sample(fx, fy, S);
        if (S.d < 0.05) continue;
        const [x, y] = geo.stToLocal((fx + 0.5) / nx, (fy + 0.5) / ny);
        const [vx, vy] = geo.velocityToLocal(S.u, S.v);
        const sp = Math.hypot(vx, vy);
        const k = this.cursor;
        this.cursor = (this.cursor + 1) % this.n;
        const g = sampleField(ground, nx, ny, fx, fy);
        this.pos[k * 3] = x;
        this.pos[k * 3 + 1] = y;
        this.pos[k * 3 + 2] = g + S.d + 0.4;
        this.vel[k * 3] = vx * 0.8 + (Math.random() - 0.5) * 1.2;
        this.vel[k * 3 + 1] = vy * 0.8 + (Math.random() - 0.5) * 1.2;
        this.vel[k * 3 + 2] = 0.8 + Math.random() * (1.2 + sp * 0.9);
        this.life[k] = 0.7 + Math.random() * 0.8;
        this.size[k] = 0.35 + Math.random() * 0.55;
      }
    }
    // integrate
    for (let k = 0; k < this.n; k++) {
      if (this.life[k]! <= 0) continue;
      this.life[k]! -= dt;
      this.vel[k * 3 + 2]! -= 9.81 * dt * 0.6;
      this.pos[k * 3]! += this.vel[k * 3]! * dt;
      this.pos[k * 3 + 1]! += this.vel[k * 3 + 1]! * dt;
      this.pos[k * 3 + 2]! += this.vel[k * 3 + 2]! * dt;
    }
    const geom = this.points.geometry;
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

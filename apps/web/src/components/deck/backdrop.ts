import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Live 3D backdrop for the landing deck, told as a flood: a valley drawn in glowing contour lines, a river that
 * swells and breaks its banks, a riverside town whose cars are swept away and whose houses give way, and rain.
 * Each slide sets a mood (where the camera is, how high the river runs, rain, glow of the buried stream); the
 * scene travels downstream from slide to slide and eases between moods continuously.
 * Decorative: the numbers on the slides come from the model; this landscape is not Sarıyer.
 */
export type Mood = {
  cam: [number, number, number];
  look: [number, number, number];
  /** water depth above the river bed (m): ~3 calm, ~6 in spate, 10+ out of its banks */
  depth: number;
  rain: number; // 0..1
  buried: number; // 0..1 glow of the buried stream seam
  contour: number; // 0..1 contour emphasis
  ember: number; // 0..1 warm alarm tint on the water's edge
};

const SIZE = 2600;
const SEG = 260;
const HALF = SIZE / 2;

// ------------------------------------------------------------------------------------------- terrain
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 5; i++) {
    s += a * noise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
/** River centreline: meanders along +x (downstream). */
export const channelY = (x: number) => 170 * Math.sin(x / 420) + 60 * Math.sin(x / 170 + 1.3);
/** The town sits on the flood plain between these x. */
const TOWN = [-260, 1080] as const;
const townK = (x: number) => smooth(TOWN[0] - 120, TOWN[0] + 60, x) * (1 - smooth(TOWN[1] - 60, TOWN[1] + 140, x));
function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
export function terrainHeight(x: number, y: number) {
  const d = y - channelY(x);
  const valley = Math.exp(-((d / 230) ** 2));
  const bed = Math.exp(-((d / 26) ** 2));
  // a wide, gently rising flood plain where the town is: banks ~6 m at 40 m, ~8 m at 80 m, ~11 m at 120 m
  const plain = townK(x) * Math.exp(-((d / 300) ** 2));
  const hills = 120 * fbm(x / 540 + 7, y / 540 + 3) + 26 * fbm(x / 150, y / 150);
  const k = 1 - 0.95 * plain;
  return hills * (1 - 0.8 * valley) * k - 6 * bed + Math.abs(d) * 0.045 * k - 0.022 * x;
}
/** River bed height under the centreline (water surface = bed + depth). */
const bedAt = (x: number) => terrainHeight(x, channelY(x));

// ------------------------------------------------------------------------------------------- shaders
const CH = /* glsl */ `float chY(float x) { return 170.0 * sin(x / 420.0) + 60.0 * sin(x / 170.0 + 1.3); }`;

const terrainVert = /* glsl */ `
  attribute float aH;
  varying float vH;
  varying vec3 vPos;
  void main() {
    vH = aH;
    vec3 p = vec3(position.xy, aH);
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const terrainFrag = /* glsl */ `
  uniform float uTime;
  uniform float uBuried;
  uniform float uContour;
  uniform vec3 uCam;
  varying float vH;
  varying vec3 vPos;
  ${CH}
  float townK(float x) { return smoothstep(-380.0, -200.0, x) * (1.0 - smoothstep(1020.0, 1220.0, x)); }
  void main() {
    float h = vH;
    float w = fwidth(h);
    float minor = 1.0 - smoothstep(0.0, w * 1.4, abs(fract(h / 6.0 + 0.5) - 0.5) * 6.0);
    float major = 1.0 - smoothstep(0.0, w * 1.6, abs(fract(h / 30.0 + 0.5) - 0.5) * 30.0);
    vec3 base = vec3(0.035, 0.05, 0.06) + vec3(0.02, 0.03, 0.035) * smoothstep(-40.0, 90.0, h);
    vec3 line = vec3(0.32, 0.42, 0.47);
    vec3 col = base + line * (minor * 0.2 + major * 0.5) * (0.55 + 0.8 * uContour);
    float d = vPos.y - chY(vPos.x);
    // riverside roads through the town (cars park on them)
    float tk = townK(vPos.x);
    float road = (1.0 - smoothstep(4.0, 6.0, abs(abs(d) - 92.0))) * tk;
    float lane = (1.0 - smoothstep(0.2, 0.6, abs(abs(d) - 92.0))) * step(0.5, fract(vPos.x / 14.0)) * tk;
    col = mix(col, vec3(0.12, 0.13, 0.14), road * 0.9) + vec3(0.55, 0.5, 0.35) * lane * 0.35;
    // the buried stream: an ember seam with pulses travelling downstream
    float ad = abs(d);
    float seam = exp(-pow(ad / 9.0, 2.0)) + 0.35 * exp(-pow(ad / 34.0, 2.0));
    float pulse = 0.55 + 0.45 * sin(vPos.x * 0.045 - uTime * 2.4);
    col += vec3(1.0, 0.36, 0.15) * seam * pulse * uBuried * 1.2;
    float fog = smoothstep(450.0, 2400.0, distance(uCam, vPos));
    col = mix(col, vec3(0.039, 0.059, 0.071), fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const waterVert = /* glsl */ `
  uniform float uDepth;
  uniform float uTime;
  uniform sampler2D uBed;
  attribute float aH;
  varying float vDepth;
  varying vec3 vPos;
  varying float vSpeed;
  ${CH}
  void main() {
    // the surface follows the river bed downstream, so the whole river rises and spills, not a flat lake
    float bed = texture2D(uBed, vec2((position.x + ${HALF.toFixed(1)}) / ${SIZE.toFixed(1)}, 0.5)).r;
    float surface = bed + uDepth;
    vDepth = surface - aH;
    float slope = (chY(position.x + 1.0) - chY(position.x - 1.0)) * 0.5;
    vec2 dir = normalize(vec2(1.0, slope));
    float s = dot(position.xy, dir);
    float dist = abs(position.y - chY(position.x));
    // fastest in the channel, slower over the flooded plain
    vSpeed = mix(1.0, 0.45, smoothstep(20.0, 160.0, dist)) * (0.4 + uDepth * 0.07);
    float amp = smoothstep(0.0, 4.0, vDepth) * (0.3 + 0.12 * uDepth) * vSpeed;
    float wave = sin(s * 0.08 - uTime * (2.5 + 2.0 * vSpeed)) * 0.9 + sin(s * 0.19 + position.y * 0.05 - uTime * 4.0) * 0.4;
    vPos = vec3(position.xy, surface + wave * amp);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`;
const waterFrag = /* glsl */ `
  uniform float uTime;
  uniform float uEmber;
  uniform vec3 uCam;
  varying float vDepth;
  varying vec3 vPos;
  varying float vSpeed;
  ${CH}
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    if (vDepth < 0.0) discard;
    float slope = (chY(vPos.x + 1.0) - chY(vPos.x - 1.0)) * 0.5;
    vec2 dir = normalize(vec2(1.0, slope));
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(vPos.xy, dir), dot(vPos.xy, nrm));
    float v = 30.0 + 90.0 * vSpeed;
    float s1 = vn(vec2((q.x - uTime * v) / 40.0, q.y / 4.5));
    float s2 = vn(vec2((q.x - uTime * v * 1.4) / 16.0, q.y / 2.2 + 9.0));
    float streak = smoothstep(0.6, 0.95, s1 * 0.6 + s2 * 0.5);
    vec3 Ng = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (Ng.z < 0.0) Ng = -Ng;
    vec3 V = normalize(uCam - vPos);
    float fres = pow(1.0 - max(dot(Ng, V), 0.0), 3.0);
    // flood water: bright blue when shallow, deep navy where deep
    vec3 shallow = vec3(0.38, 0.68, 0.86);
    vec3 deep = vec3(0.05, 0.2, 0.36);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 9.0, vDepth));
    col += vec3(0.8, 0.92, 1.0) * streak * (0.25 + 0.5 * vSpeed);
    col = mix(col, vec3(0.6, 0.78, 0.9), fres * 0.35);
    float edge = 1.0 - smoothstep(0.0, 2.2, vDepth);
    col = mix(col, mix(vec3(0.85, 0.94, 1.0), vec3(1.0, 0.45, 0.2), uEmber * 0.6), edge * 0.85);
    float fog = smoothstep(450.0, 2400.0, distance(uCam, vPos));
    col = mix(col, vec3(0.039, 0.059, 0.071), fog);
    gl_FragColor = vec4(col, smoothstep(0.0, 0.8, vDepth) * 0.95);
  }
`;

const rainVert = /* glsl */ `
  uniform float uTime;
  uniform float uRain;
  uniform vec3 uCenter;
  attribute vec3 aSeed;
  attribute float aEnd;
  varying float vA;
  void main() {
    float fall = 380.0;
    float y = mod(aSeed.z * fall - uTime * 280.0, fall);
    vec3 p = vec3(uCenter.xy + (aSeed.xy - 0.5) * 1200.0, uCenter.z + y - aEnd * 10.0);
    p.x += aEnd * 2.5;
    vA = uRain * (0.25 + 0.75 * aSeed.z) * (1.0 - aEnd * 0.6);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const rainFrag = /* glsl */ `
  varying float vA;
  void main() { gl_FragColor = vec4(0.7, 0.8, 0.9, vA * 0.5); }
`;

// ------------------------------------------------------------------------------------------- town
type House = { x: number; y: number; z: number; w: number; l: number; h: number; yaw: number; d: number; fall: number; side: number; spawned: boolean };
type Car = { hx: number; hy: number; x: number; y: number; z: number; yaw: number; spin: number; phase: number; floating: boolean };
type Chunk = { x: number; y: number; z: number; yaw: number; spin: number; s: number; alive: boolean; phase: number };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function carGeometry() {
  const body = new THREE.BoxGeometry(4.4, 1.9, 0.8).translate(0, 0, 0.6);
  const cabin = new THREE.BoxGeometry(2.4, 1.7, 0.7).translate(-0.3, 0, 1.35);
  const g = new THREE.BufferGeometry();
  const a = body.toNonIndexed();
  const b = cabin.toNonIndexed();
  const pos = new Float32Array([...(a.getAttribute("position").array as Float32Array), ...(b.getAttribute("position").array as Float32Array)]);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class Backdrop {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private uniforms = {
    uTime: { value: 0 },
    uBuried: { value: 0 },
    uContour: { value: 0.5 },
    uDepth: { value: 3 },
    uRain: { value: 0 },
    uEmber: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector3() },
    uBed: { value: null as unknown as THREE.DataTexture },
  };
  private cur: Mood;
  private target: Mood;
  private look = new THREE.Vector3();
  private raf = 0;
  private last = performance.now();
  private t = 0;
  private visible = true;

  private houses: House[] = [];
  private cars: Car[] = [];
  private chunks: Chunk[] = [];
  private houseMesh!: THREE.InstancedMesh;
  private carMesh!: THREE.InstancedMesh;
  private chunkMesh!: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    initial: Mood,
    private readonly reduce = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x0a0f12, 1);
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
    this.camera.up.set(0, 0, 1);
    this.scene.fog = new THREE.Fog(0x0a0f12, 500, 2500);
    this.cur = structuredClone(initial);
    this.target = structuredClone(initial);
    this.build();
    this.resize();
    document.addEventListener("visibilitychange", this.onVis);
    this.raf = requestAnimationFrame(this.tick);
  }

  private build() {
    // river bed profile along x, for the water surface
    const N = 1024;
    const bed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) bed[i * 4] = bedAt(-HALF + (i / (N - 1)) * SIZE);
    const bedTex = new THREE.DataTexture(bed, N, 1, THREE.RGBAFormat, THREE.FloatType);
    bedTex.magFilter = bedTex.minFilter = THREE.LinearFilter;
    bedTex.needsUpdate = true;
    this.uniforms.uBed.value = bedTex;

    const geom = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pos = geom.getAttribute("position");
    const hs = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) hs[i] = terrainHeight(pos.getX(i), pos.getY(i));
    geom.setAttribute("aH", new THREE.BufferAttribute(hs, 1));
    this.scene.add(new THREE.Mesh(geom, new THREE.ShaderMaterial({ vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms: this.uniforms })));

    const water = new THREE.Mesh(
      geom,
      new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: this.uniforms, transparent: true, depthWrite: false }),
    );
    water.renderOrder = 2;
    this.scene.add(water);

    // lights for the town
    this.scene.add(new THREE.HemisphereLight(0x9fb2bc, 0x0a0f12, 0.9));
    const sun = new THREE.DirectionalLight(0xffd9b0, 1.1);
    sun.position.set(-600, -400, 900);
    this.scene.add(sun);

    const rand = rng(14);
    // houses on both banks of the town reach, denser near the river
    for (let i = 0; i < 520 && this.houses.length < 340; i++) {
      const x = TOWN[0] + rand() * (TOWN[1] - TOWN[0]);
      const side = rand() < 0.5 ? -1 : 1;
      const d = side * (32 + Math.pow(rand(), 1.4) * 250);
      if (Math.abs(Math.abs(d) - 92) < 9) continue; // keep the road clear
      const y = channelY(x) + d;
      const w = 7 + rand() * 6;
      const l = 8 + rand() * 9;
      const h = 5 + rand() * (Math.abs(d) < 140 ? 7 : 14);
      const slope = (channelY(x + 1) - channelY(x - 1)) / 2;
      this.houses.push({ x, y, z: terrainHeight(x, y), w, l, h, yaw: Math.atan(slope) + (rand() - 0.5) * 0.3, d, fall: 0, side, spawned: false });
    }
    // a unit house: walls plus a hipped roof (scaled per instance)
    const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const roof = new THREE.ConeGeometry(0.72, 0.38, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, 1.19);
    const house = mergeGeometries([walls.toNonIndexed(), roof.toNonIndexed()])!;
    house.computeVertexNormals();
    this.houseMesh = new THREE.InstancedMesh(house, new THREE.MeshLambertMaterial({ color: 0xffffff }), this.houses.length);
    const c = new THREE.Color();
    this.houses.forEach((_, i) => this.houseMesh.setColorAt(i, c.setHSL(0.06 + rand() * 0.06, 0.06 + rand() * 0.1, 0.17 + rand() * 0.12)));
    this.houseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.houseMesh);

    // parked cars along the riverside roads
    for (let i = 0; i < 90; i++) {
      const x = TOWN[0] + 40 + rand() * (TOWN[1] - TOWN[0] - 80);
      const side = rand() < 0.5 ? -1 : 1;
      const y = channelY(x) + side * (92 + (rand() - 0.5) * 6);
      const slope = (channelY(x + 1) - channelY(x - 1)) / 2;
      this.cars.push({ hx: x, hy: y, x, y, z: terrainHeight(x, y), yaw: Math.atan(slope) + (rand() < 0.5 ? 0 : Math.PI), spin: (rand() - 0.5) * 1.6, phase: rand() * 10, floating: false });
    }
    this.carMesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.cars.length);
    const palette = [0xd9d6cf, 0x9aa3a8, 0x2a2f33, 0x8a2020, 0x1f3a60, 0xe8b512, 0xc9c4b8];
    this.cars.forEach((_, i) => this.carMesh.setColorAt(i, c.setHex(palette[Math.floor(rand() * palette.length)]!)));
    this.carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.carMesh);

    // wreckage pool for collapsing houses
    for (let i = 0; i < 700; i++) this.chunks.push({ x: 0, y: 0, z: 0, yaw: 0, spin: 0, s: 1, alive: false, phase: rand() * 10 });
    this.chunkMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x8a7a66 }), this.chunks.length);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.chunkMesh);

    // rain
    const R = 3600;
    const seeds = new Float32Array(R * 2 * 3);
    const ends = new Float32Array(R * 2);
    for (let i = 0; i < R; i++) {
      const a = rand();
      const b = rand();
      const cc = rand();
      seeds.set([a, b, cc, a, b, cc], i * 6);
      ends[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(R * 2 * 3), 3));
    rg.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    rg.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    const rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({ vertexShader: rainVert, fragmentShader: rainFrag, uniforms: this.uniforms, transparent: true, depthWrite: false }),
    );
    rain.frustumCulled = false;
    rain.renderOrder = 3;
    this.scene.add(rain);
  }

  /** Flood dynamics of the town: who is under water, which houses give way, what the current carries off. */
  private stepTown(dt: number) {
    const depth = this.cur.depth;
    const flow = 8 + depth * 4.5; // visual downstream speed (m/s of scene time)
    // houses: collapse once deep, fast water stands against them; rebuild when the water is gone
    this.houses.forEach((hs, i) => {
      const wd = bedAt(hs.x) + depth - hs.z;
      const exposed = wd > 2.6 && Math.abs(hs.d) < 150;
      if (exposed) hs.fall = Math.min(1, hs.fall + dt * (0.25 + wd * 0.05));
      else if (depth < 5) hs.fall = Math.max(0, hs.fall - dt * 0.6);
      if (hs.fall > 0.35 && !hs.spawned) {
        hs.spawned = true;
        this.spawnChunks(hs, 6);
      }
      if (hs.fall === 0) hs.spawned = false;
      const k = hs.fall;
      const shake = k > 0 && k < 0.35 ? Math.sin(this.t * 38 + i) * 0.04 : 0;
      // lean downstream about the base, then slump into a heap
      const tilt = Math.min(k * 1.4, 1) * 0.85;
      this.e.set(shake, tilt * hs.side * 0.35, hs.yaw + shake + k * 0.25, "ZYX");
      this.q.setFromEuler(this.e);
      const slump = 1 - 0.78 * smooth(0.25, 1, k);
      this.p.set(hs.x + k * 5, hs.y, hs.z - 1 - k * 1.5);
      this.s.set(hs.l, hs.w, hs.h * slump);
      this.m.compose(this.p, this.q, this.s);
      this.houseMesh.setMatrixAt(i, this.m);
    });
    this.houseMesh.instanceMatrix.needsUpdate = true;

    // cars: float off once the water is ~0.6 m deep where they stand, ride the current downstream
    this.cars.forEach((cr, i) => {
      const ground = terrainHeight(cr.x, cr.y);
      const surface = bedAt(cr.x) + depth;
      const wd = surface - ground;
      if (!cr.floating && wd > 0.6) cr.floating = true;
      if (cr.floating && wd < 0.25) cr.floating = false;
      if (depth < 4.2 && !cr.floating && (cr.x !== cr.hx || cr.y !== cr.hy)) {
        // back to the calm river: cars return to where they were parked
        cr.x += (cr.hx - cr.x) * Math.min(1, dt * 1.5);
        cr.y += (cr.hy - cr.y) * Math.min(1, dt * 1.5);
      }
      let roll = 0;
      let pitch = 0;
      if (cr.floating) {
        const dist = cr.y - channelY(cr.x);
        const v = flow * (Math.abs(dist) < 40 ? 1.4 : 0.8);
        cr.x += v * dt;
        // follow the meander, drifting slowly toward the fast water in the channel
        cr.y = channelY(cr.x) + dist * (1 - Math.min(0.5, dt * 0.35));
        cr.yaw += cr.spin * dt;
        if (cr.x > TOWN[1] + 380) {
          // carried out of sight: the river keeps bringing more from upstream
          cr.x = TOWN[0] - 200 + Math.random() * 60;
          cr.y = channelY(cr.x) + (Math.random() - 0.5) * 40;
        }
        cr.z = surface - 0.45 + Math.sin(this.t * 2.1 + cr.phase) * 0.25;
        roll = Math.sin(this.t * 1.5 + cr.phase) * 0.18;
        pitch = Math.cos(this.t * 1.2 + cr.phase) * 0.12;
      } else cr.z = terrainHeight(cr.x, cr.y);
      this.e.set(roll, pitch, cr.yaw, "ZYX");
      this.q.setFromEuler(this.e);
      this.p.set(cr.x, cr.y, cr.z);
      this.s.setScalar(1.6);
      this.m.compose(this.p, this.q, this.s);
      this.carMesh.setMatrixAt(i, this.m);
    });
    this.carMesh.instanceMatrix.needsUpdate = true;

    // wreckage: rides the current, sinks out of view after a while
    this.chunks.forEach((ch, i) => {
      if (ch.alive) {
        const surface = bedAt(ch.x) + depth;
        const dist = ch.y - channelY(ch.x);
        ch.x += flow * 1.1 * dt;
        ch.y += channelY(ch.x) + dist * 0.99 - ch.y;
        ch.yaw += ch.spin * dt;
        ch.z = surface - 0.3 + Math.sin(this.t * 2.6 + ch.phase) * 0.3;
        if (ch.x > TOWN[1] + 450 || depth < 3.5) ch.alive = false;
      }
      this.e.set(ch.yaw * 0.7, ch.yaw * 0.4, ch.yaw, "ZYX");
      this.q.setFromEuler(this.e);
      this.p.set(ch.x, ch.y, ch.z);
      this.s.set(ch.s * 2.2, ch.s * 1.4, ch.s * 0.8).multiplyScalar(ch.alive ? 1 : 0);
      this.m.compose(this.p, this.q, this.s);
      this.chunkMesh.setMatrixAt(i, this.m);
    });
    this.chunkMesh.instanceMatrix.needsUpdate = true;
  }

  private spawnChunks(h: House, n: number) {
    let made = 0;
    for (const ch of this.chunks) {
      if (made >= n) break;
      if (ch.alive) continue;
      ch.alive = true;
      ch.x = h.x + (Math.random() - 0.5) * h.l;
      ch.y = h.y + (Math.random() - 0.5) * h.w;
      ch.z = h.z;
      ch.s = 0.8 + Math.random() * 1.6;
      ch.spin = (Math.random() - 0.5) * 3;
      ch.yaw = Math.random() * 6.28;
      made++;
    }
  }

  setMood(m: Mood) {
    this.target = structuredClone(m);
    if (this.reduce) this.cur = structuredClone(m);
  }

  resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onVis = () => {
    this.visible = document.visibilityState === "visible";
    if (this.visible) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private tick = (now: number) => {
    if (!this.visible) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.t += this.reduce ? dt * 0.15 : dt;
    // ease toward the slide's mood: the camera glides (~1.8 s), the river rises and falls more slowly
    const kc = 1 - Math.exp(-dt * 1.7);
    const kw = 1 - Math.exp(-dt * 0.9);
    const c = this.cur;
    const g = this.target;
    for (let i = 0; i < 3; i++) {
      c.cam[i] = c.cam[i]! + (g.cam[i]! - c.cam[i]!) * kc;
      c.look[i] = c.look[i]! + (g.look[i]! - c.look[i]!) * kc;
    }
    c.depth += (g.depth - c.depth) * kw;
    c.rain += (g.rain - c.rain) * kc;
    c.buried += (g.buried - c.buried) * kc;
    c.contour += (g.contour - c.contour) * kc;
    c.ember += (g.ember - c.ember) * kc;

    this.stepTown(this.reduce ? 0 : dt);

    // a slow orbit around the point of interest keeps every slide alive
    const drift = this.reduce ? 0 : 1;
    const ang = Math.sin(this.t * 0.07) * 0.22 * drift;
    const ox = c.cam[0] - c.look[0];
    const oy = c.cam[1] - c.look[1];
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    this.camera.position.set(
      c.look[0] + ox * ca - oy * sa,
      c.look[1] + ox * sa + oy * ca,
      c.cam[2] + Math.sin(this.t * 0.13) * 10 * drift,
    );
    this.look.set(c.look[0], c.look[1], c.look[2]);
    this.camera.lookAt(this.look);

    const u = this.uniforms;
    u.uTime.value = this.t;
    u.uDepth.value = c.depth;
    u.uRain.value = c.rain;
    u.uBuried.value = c.buried;
    u.uContour.value = c.contour;
    u.uEmber.value = c.ember;
    u.uCam.value.copy(this.camera.position);
    u.uCenter.value.set(c.look[0], c.look[1], c.look[2] + 60);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.dispose();
  }
}

/** Camera helper for slide moods: look at a point on the river `x`, from `back` metres upstream-ish. */
export function riverShot(x: number, opts: { dx: number; dy: number; dz: number; side?: number; lookZ?: number }): Pick<Mood, "cam" | "look"> {
  const y = channelY(x);
  const z = bedAt(x);
  return {
    cam: [x + opts.dx, y + opts.dy * (opts.side ?? 1), z + opts.dz],
    look: [x, y, z + (opts.lookZ ?? 0)],
  };
}

import * as THREE from "three";

/**
 * Live 3D backdrop for the landing deck: a procedural valley drawn as glowing contour lines, the buried stream
 * glowing under its floor, flood water that rises and flows down the valley, and rain. Each slide sets a mood
 * (camera, water level, rain, buried-stream glow); the scene eases between moods continuously.
 * Decorative: the numbers on the slides come from the model, this landscape is not Sarıyer.
 */
export type Mood = {
  cam: [number, number, number];
  look: [number, number, number];
  water: number; // water level (m)
  rain: number; // 0..1
  buried: number; // 0..1 glow of the buried stream
  contour: number; // 0..1 contour emphasis
  ember: number; // 0..1 warm alarm tint on the water's edge
};

const SIZE = 2400;
const SEG = 220;

// ---- terrain height (JS mirror of nothing: heights are baked into the mesh) ----
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
/** Valley centreline: a meander along +x. */
export const channelY = (x: number) => 170 * Math.sin(x / 420) + 60 * Math.sin(x / 170 + 1.3);
function terrainHeight(x: number, y: number) {
  const d = y - channelY(x);
  const valley = Math.exp(-((d / 210) ** 2));
  const floor = Math.exp(-((d / 55) ** 2));
  const hills = 110 * fbm(x / 520 + 7, y / 520 + 3) + 28 * fbm(x / 140, y / 140);
  return hills * (1 - 0.75 * valley) - 38 * floor - 0.02 * x + Math.abs(d) * 0.05;
}

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
  float chY(float x) { return 170.0 * sin(x / 420.0) + 60.0 * sin(x / 170.0 + 1.3); }
  void main() {
    // contour lines every 6 m, a stronger one every 30 m (anti-aliased with fwidth)
    float h = vH;
    float w = fwidth(h);
    float minor = 1.0 - smoothstep(0.0, w * 1.4, abs(fract(h / 6.0 + 0.5) - 0.5) * 6.0);
    float major = 1.0 - smoothstep(0.0, w * 1.6, abs(fract(h / 30.0 + 0.5) - 0.5) * 30.0);
    vec3 base = vec3(0.035, 0.05, 0.06) + vec3(0.02, 0.03, 0.035) * smoothstep(-40.0, 90.0, h);
    vec3 line = vec3(0.32, 0.42, 0.47);
    vec3 col = base + line * (minor * 0.22 + major * 0.55) * (0.6 + 0.8 * uContour);
    // the buried stream: an ember seam under the valley floor, with pulses travelling downstream
    float d = abs(vPos.y - chY(vPos.x));
    float seam = exp(-pow(d / 9.0, 2.0)) + 0.35 * exp(-pow(d / 34.0, 2.0));
    float pulse = 0.55 + 0.45 * sin(vPos.x * 0.045 - uTime * 2.4);
    col += vec3(1.0, 0.36, 0.15) * seam * pulse * uBuried * 1.25;
    float fog = smoothstep(500.0, 2300.0, distance(uCam, vPos));
    col = mix(col, vec3(0.039, 0.059, 0.071), fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const waterVert = /* glsl */ `
  uniform float uLevel;
  uniform float uTime;
  attribute float aH;
  varying float vDepth;
  varying vec3 vPos;
  float chY(float x) { return 170.0 * sin(x / 420.0) + 60.0 * sin(x / 170.0 + 1.3); }
  void main() {
    vDepth = uLevel - aH;
    // follow the valley's local direction for the travelling waves
    float slope = (chY(position.x + 1.0) - chY(position.x - 1.0)) * 0.5;
    vec2 dir = normalize(vec2(1.0, slope));
    float s = dot(position.xy, dir);
    float wave = sin(s * 0.09 - uTime * 3.2) * 0.9 + sin(s * 0.21 + position.y * 0.05 - uTime * 4.5) * 0.35;
    float z = uLevel + wave * smoothstep(0.0, 6.0, vDepth);
    vPos = vec3(position.xy, z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPos, 1.0);
  }
`;
const waterFrag = /* glsl */ `
  uniform float uTime;
  uniform float uEmber;
  uniform vec3 uCam;
  varying float vDepth;
  varying vec3 vPos;
  float chY(float x) { return 170.0 * sin(x / 420.0) + 60.0 * sin(x / 170.0 + 1.3); }
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
    // fast, stretched streaks travelling downstream: the water reads as a torrent
    float t = uTime;
    float s1 = vn(vec2((q.x - t * 55.0) / 38.0, q.y / 4.0));
    float s2 = vn(vec2((q.x - t * 80.0) / 17.0, q.y / 2.2 + 9.0));
    float streak = smoothstep(0.62, 0.95, s1 * 0.6 + s2 * 0.5);
    vec3 Ng = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (Ng.z < 0.0) Ng = -Ng;
    vec3 V = normalize(uCam - vPos);
    float fres = pow(1.0 - max(dot(Ng, V), 0.0), 3.0);
    vec3 shallow = vec3(0.30, 0.55, 0.68);
    vec3 deep = vec3(0.05, 0.16, 0.24);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 22.0, vDepth));
    col += vec3(0.75, 0.88, 0.95) * streak * 0.55;
    col = mix(col, vec3(0.62, 0.8, 0.9), fres * 0.45);
    // foam line at the advancing edge, warmed to ember on alarm slides
    float edge = 1.0 - smoothstep(0.0, 3.5, vDepth);
    col = mix(col, mix(vec3(0.85, 0.93, 0.97), vec3(1.0, 0.45, 0.2), uEmber), edge * 0.85);
    float fog = smoothstep(500.0, 2300.0, distance(uCam, vPos));
    col = mix(col, vec3(0.039, 0.059, 0.071), fog);
    float a = smoothstep(0.0, 1.2, vDepth) * 0.92;
    gl_FragColor = vec4(col, a);
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
    float fall = 420.0;
    float y = mod(aSeed.z * fall - uTime * 260.0, fall);
    vec3 p = vec3(uCenter.xy + (aSeed.xy - 0.5) * 1400.0, 40.0 + y - aEnd * 9.0);
    p.x += aEnd * 2.0; // slight wind slant
    vA = uRain * (0.25 + 0.75 * aSeed.z) * (1.0 - aEnd * 0.6);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const rainFrag = /* glsl */ `
  varying float vA;
  void main() { gl_FragColor = vec4(0.68, 0.82, 0.92, vA * 0.55); }
`;

export class Backdrop {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private uniforms = {
    uTime: { value: 0 },
    uBuried: { value: 0 },
    uContour: { value: 0.5 },
    uLevel: { value: -40 },
    uRain: { value: 0 },
    uEmber: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uCenter: { value: new THREE.Vector3() },
  };
  private cur: Mood;
  private target: Mood;
  private look = new THREE.Vector3();
  private raf = 0;
  private last = performance.now();
  private t = 0;
  private visible = true;

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
    this.cur = structuredClone(initial);
    this.target = structuredClone(initial);
    this.build();
    this.resize();
    document.addEventListener("visibilitychange", this.onVis);
    this.raf = requestAnimationFrame(this.tick);
  }

  private build() {
    const geom = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    const pos = geom.getAttribute("position");
    const hs = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) hs[i] = terrainHeight(pos.getX(i), pos.getY(i));
    geom.setAttribute("aH", new THREE.BufferAttribute(hs, 1));
    const terrain = new THREE.Mesh(
      geom,
      new THREE.ShaderMaterial({ vertexShader: terrainVert, fragmentShader: terrainFrag, uniforms: this.uniforms }),
    );
    this.scene.add(terrain);

    const water = new THREE.Mesh(
      geom,
      new THREE.ShaderMaterial({
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
      }),
    );
    water.renderOrder = 2;
    this.scene.add(water);

    // rain: line segments (two vertices per drop), animated entirely on the GPU
    const N = 3600;
    const seeds = new Float32Array(N * 2 * 3);
    const ends = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const a = Math.random();
      const b = Math.random();
      const c = Math.random();
      seeds.set([a, b, c, a, b, c], i * 6);
      ends[i * 2] = 0;
      ends[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    rg.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    rg.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));
    const rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({
        vertexShader: rainVert,
        fragmentShader: rainFrag,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
      }),
    );
    rain.frustumCulled = false;
    rain.renderOrder = 3;
    this.scene.add(rain);
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
    // critically damped ease toward the slide's mood (~1.2 s)
    const k = 1 - Math.exp(-dt * 2.6);
    const c = this.cur;
    const g = this.target;
    for (let i = 0; i < 3; i++) {
      c.cam[i] = c.cam[i]! + (g.cam[i]! - c.cam[i]!) * k;
      c.look[i] = c.look[i]! + (g.look[i]! - c.look[i]!) * k;
    }
    c.water += (g.water - c.water) * k * 0.7;
    c.rain += (g.rain - c.rain) * k;
    c.buried += (g.buried - c.buried) * k;
    c.contour += (g.contour - c.contour) * k;
    c.ember += (g.ember - c.ember) * k;

    // slow drift so the scene is alive even on a still slide
    const drift = this.reduce ? 0 : 1;
    const ox = Math.sin(this.t * 0.11) * 60 * drift;
    const oy = Math.cos(this.t * 0.09) * 45 * drift;
    this.camera.position.set(c.cam[0] + ox, c.cam[1] + oy, c.cam[2] + Math.sin(this.t * 0.13) * 12 * drift);
    this.look.set(c.look[0], c.look[1], c.look[2]);
    this.camera.lookAt(this.look);

    const u = this.uniforms;
    u.uTime.value = this.t;
    u.uLevel.value = c.water;
    u.uRain.value = c.rain;
    u.uBuried.value = c.buried;
    u.uContour.value = c.contour;
    u.uEmber.value = c.ember;
    u.uCam.value.copy(this.camera.position);
    u.uCenter.value.set(c.look[0], c.look[1], 0);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVis);
    this.renderer.dispose();
  }
}

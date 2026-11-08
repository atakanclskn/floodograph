import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";

/**
 * A storm cell over the city, ray-marched as a volume: a slab of fbm-noise cloud between CLOUD_BASE and
 * CLOUD_TOP km, densest over the city and fading out with distance, lit by the sun with a short shadow march
 * (dark, heavy bellies, bright tops), drifting with the wind and lit from inside by lightning in a cloudburst.
 * Seen from high up (zoomed out); it thins away as you zoom in and the screen rain takes over (you descend
 * below the cloud). Heights are exaggerated a little so the cell reads as a cumulonimbus from orbit-ish views.
 */
const CLOUD_BASE = 1.6; // km
const CLOUD_TOP = 10; // km
const RADIUS = 75; // km of cloud around the storm centre

/** Zoom at which the clouds are gone and the rain has fully taken over (see RainOverlay). */
export const CLOUDS_GONE_ZOOM = 10.6;
export const CLOUDS_FULL_ZOOM = 9.0;

const VS = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = (steps: number) => `#version 300 es
precision highp float;
in vec2 vNdc;
out vec4 frag;
uniform mat4 uInv;
uniform vec2 uCenter;
uniform float uKm;
uniform float uCover;
uniform float uTime;
uniform float uFade;
uniform float uFlash;
uniform vec2 uFlashAt;
const float BASE = ${CLOUD_BASE.toFixed(2)};
const float TOP = ${CLOUD_TOP.toFixed(2)};
const float RADIUS = ${RADIUS.toFixed(1)};
const vec3 SUN = normalize(vec3(-0.5, 0.35, 0.8));

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
// q: km from the storm centre (x east, y north), z altitude km
float density(vec3 q, int oct) {
  float h = (q.z - BASE) / (TOP - BASE);
  float r = length(q.xy) / RADIUS;
  if (h < 0.0 || h > 1.0 || r > 1.0) return 0.0;
  vec3 w = q + vec3(uTime * 0.35, uTime * 0.12, 0.0);
  // towers: big cells, taller near the centre; flat dark base, cauliflower tops
  float big = fbm(w * vec3(0.045, 0.045, 0.09), oct);
  float tower = smoothstep(1.0, 0.25, r) * (0.55 + 0.45 * uCover);
  float top = mix(0.35, 1.0, tower * big * 1.6);
  float shape = smoothstep(0.0, 0.06, h) * smoothstep(top, top * 0.55, h);
  float cov = mix(0.58, 0.30, uCover);
  float d = (big * smoothstep(1.0, 0.45, r) - cov) * 4.0 * shape;
  if (d <= 0.0) return 0.0;
  if (oct > 3) d -= fbm(w * 0.32, 2) * 0.45 * (1.0 - d);
  return clamp(d, 0.0, 1.0);
}
void main() {
  vec4 a = uInv * vec4(vNdc, -1.0, 1.0); a /= a.w;
  vec4 b = uInv * vec4(vNdc, 1.0, 1.0); b /= b.w;
  vec3 A = vec3((a.x - uCenter.x) / uKm, -(a.y - uCenter.y) / uKm, a.z / uKm);
  vec3 B = vec3((b.x - uCenter.x) / uKm, -(b.y - uCenter.y) / uKm, b.z / uKm);
  vec3 dir = B - A;
  if (abs(dir.z) < 1e-7) discard;
  float t0 = (TOP - A.z) / dir.z;
  float t1 = (BASE - A.z) / dir.z;
  float tn = max(min(t0, t1), 0.0);
  float tf = min(max(t0, t1), 1.0);
  if (tf <= tn) discard;
  // skip rays that never come near the storm
  vec3 pn = A + dir * tn; vec3 pf = A + dir * tf;
  vec2 seg = pf.xy - pn.xy;
  float k = clamp(-dot(pn.xy, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
  if (length(pn.xy + seg * k) > RADIUS) discard;

  float len = (tf - tn) * length(dir);
  float dt = len / float(${steps});
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float T = 1.0;
  vec3 C = vec3(0.0);
  for (int i = 0; i < ${steps}; i++) {
    vec3 p = A + dir * (tn + (tf - tn) * (float(i) + jit) / float(${steps}));
    float d = density(p, 4);
    if (d < 0.01) continue;
    float h = (p.z - BASE) / (TOP - BASE);
    // light: two samples toward the sun
    float s1 = density(p + SUN * 0.8, 3);
    float s2 = density(p + SUN * 2.4, 3);
    float lit = exp(-(s1 * 1.4 + s2 * 1.1) * 1.6);
    // heavier storm: darker bellies, greyer tops
    vec3 belly = mix(vec3(0.20, 0.22, 0.26), vec3(0.13, 0.15, 0.18), uCover);
    vec3 sunlit = mix(vec3(0.86, 0.88, 0.92), vec3(0.58, 0.61, 0.66), uCover);
    vec3 col = mix(belly, sunlit, lit * (0.35 + 0.65 * h)) + vec3(0.05, 0.06, 0.08) * h;
    // lightning: a flash inside the cell, strongest near its point
    float fd = length(p.xy - uFlashAt);
    col += vec3(0.75, 0.8, 1.0) * uFlash * exp(-fd * fd / 90.0) * (1.0 - 0.5 * h);
    float al = 1.0 - exp(-d * dt * 1.15);
    C += T * al * col;
    T *= 1.0 - al;
    if (T < 0.03) break;
  }
  // never a solid lid: the city should still glow through the thickest part
  float A_ = (1.0 - T) * uFade * 0.9;
  C *= 0.9;
  if (A_ < 0.004) discard;
  frag = vec4(C * uFade, A_);
}`;

export class StormCloudsLayer implements CustomLayerInterface {
  readonly id = "storm-clouds";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  private map: MlMap | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private center: [number, number] = [29, 41];
  private cover = 0.5;
  private t0 = performance.now();
  private flash = 0;
  private flashAt: [number, number] = [0, 0];
  private nextFlash = 0;
  private last = performance.now();
  private readonly inv = new Float64Array(16);

  constructor(private readonly lowPower = false) {}

  /** Storm centre (the city) and how heavy it is (0..1, from the rain slider). */
  set(center: [number, number], cover: number) {
    this.center = center;
    this.cover = Math.min(Math.max(cover, 0), 1);
    this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    const g = gl as WebGL2RenderingContext;
    const sh = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) console.warn("storm-clouds shader:", g.getShaderInfoLog(s));
      return s;
    };
    const p = g.createProgram()!;
    g.attachShader(p, sh(g.VERTEX_SHADER, VS));
    g.attachShader(p, sh(g.FRAGMENT_SHADER, FS(this.lowPower ? 18 : 34)));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      console.warn("storm-clouds link:", g.getProgramInfoLog(p));
      return;
    }
    this.prog = p;
    for (const n of ["uInv", "uCenter", "uKm", "uCover", "uTime", "uFade", "uFlash", "uFlashAt"]) this.u[n] = g.getUniformLocation(p, n);
    this.vao = g.createVertexArray();
    g.bindVertexArray(this.vao);
    this.buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, this.buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(p, "aPos");
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    g.bindVertexArray(null);
  }

  onRemove(_map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    const g = gl as WebGL2RenderingContext;
    if (this.prog) g.deleteProgram(this.prog);
    if (this.vao) g.deleteVertexArray(this.vao);
    if (this.buf) g.deleteBuffer(this.buf);
    this.map = null;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.prog) return;
    const z = map.getZoom();
    const fade = 1 - smooth(CLOUDS_FULL_ZOOM, CLOUDS_GONE_ZOOM, z);
    if (fade <= 0.001 || this.cover <= 0.01) return;
    const g = gl as WebGL2RenderingContext;
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    // lightning: only in a heavy storm, every few seconds, a double flicker that dies away
    this.flash = Math.max(0, this.flash - dt * 3.2);
    if (this.cover > 0.55 && now > this.nextFlash) {
      this.flash = 1;
      this.flashAt = [(Math.random() - 0.5) * RADIUS, (Math.random() - 0.5) * RADIUS];
      this.nextFlash = now + 2500 + Math.random() * 6000 * (1.6 - this.cover);
      setTimeout(() => (this.flash = Math.max(this.flash, 0.7)), 140);
    }
    if (!invert(opts.defaultProjectionData.mainMatrix as ArrayLike<number>, this.inv)) return;
    const c = MercatorCoordinate.fromLngLat(this.center, 0);
    g.useProgram(this.prog);
    g.uniformMatrix4fv(this.u.uInv!, false, Float32Array.from(this.inv));
    g.uniform2f(this.u.uCenter!, c.x, c.y);
    g.uniform1f(this.u.uKm!, c.meterInMercatorCoordinateUnits() * 1000);
    g.uniform1f(this.u.uCover!, this.cover);
    g.uniform1f(this.u.uTime!, (now - this.t0) / 1000);
    g.uniform1f(this.u.uFade!, fade);
    g.uniform1f(this.u.uFlash!, this.flash * this.cover);
    g.uniform2f(this.u.uFlashAt!, this.flashAt[0], this.flashAt[1]);
    g.bindVertexArray(this.vao);
    g.disable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.drawArrays(g.TRIANGLES, 0, 3);
    g.bindVertexArray(null);
    map.triggerRepaint(); // the cell drifts
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 4x4 column-major inverse (float64). */
function invert(m: ArrayLike<number>, out: Float64Array): boolean {
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

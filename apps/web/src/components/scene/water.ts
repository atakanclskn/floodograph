import * as THREE from "three";
import { D_MAX, V_MAX } from "./data";
import { DRAW_EPS } from "./field";
import type { GridGeo } from "./geo";

/** Shared uniforms (camera, light, fog) every scene material reads. */
export type SharedUniforms = {
  uTime: { value: number };
  uSimT: { value: number };
  uCam: { value: THREE.Vector3 };
  uSun: { value: THREE.Vector3 };
  uFogColor: { value: THREE.Color };
  uFogRange: { value: THREE.Vector2 };
  uA: { value: THREE.Texture };
  uB: { value: THREE.Texture };
  uAlpha: { value: number };
  uMask: { value: THREE.Texture };
  uEast: { value: THREE.Vector2 };
  uNorth: { value: THREE.Vector2 };
};

export const FIELD_GLSL = /* glsl */ `
  uniform sampler2D uA;
  uniform sampler2D uB;
  uniform float uAlpha;
  uniform vec2 uEast;
  uniform vec2 uNorth;
  const float D_MAX = ${D_MAX.toFixed(1)};
  const float V_MAX = ${V_MAX.toFixed(1)};
  const float DRAW_EPS = ${DRAW_EPS};
  float fieldDepth(vec2 uv) {
    vec4 a = texture2D(uA, uv);
    vec4 b = texture2D(uB, uv);
    return mix(a.r * a.r, b.r * b.r, uAlpha) * D_MAX;
  }
  vec2 fieldVel(vec2 uv) {
    vec2 g = (mix(texture2D(uA, uv).gb, texture2D(uB, uv).gb, uAlpha) * 2.0 - 1.0) * V_MAX;
    return g.x * uEast + g.y * uNorth;
  }
`;

export const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform vec2 uFogRange;
  uniform vec3 uCam;
  vec3 applyFog(vec3 c, vec3 p) {
    float f = smoothstep(uFogRange.x, uFogRange.y, distance(uCam, p));
    return mix(c, uFogColor, f * 0.85);
  }
`;

const vertex = /* glsl */ `
  ${FIELD_GLSL}
  uniform float uLift;
  attribute float aGround;
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vec4 a = texture2D(uA, uv);
    vec4 b = texture2D(uB, uv);
    if (max(a.a, b.a) < 0.5) {
      // no wet cell within one mesh step: collapse, the whole triangle becomes degenerate
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      vUv = uv;
      vPos = vec3(0.0);
      return;
    }
    float d = mix(a.r * a.r, b.r * b.r, uAlpha) * D_MAX;
    vec3 p = vec3(position.xy, aGround + (d > DRAW_EPS ? d + uLift : -0.8));
    vUv = uv;
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${FIELD_GLSL}
  ${FOG_GLSL}
  uniform sampler2D uNormalTex;
  uniform sampler2D uFoamTex;
  uniform sampler2D uMask;
  uniform float uTime;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vPos;

  vec3 sampleNormal(vec2 p, float scale, vec2 off) {
    vec3 n = texture2D(uNormalTex, (p - off) / scale).xyz * 2.0 - 1.0;
    return n;
  }

  void main() {
    float d = fieldDepth(vUv);
    if (d < DRAW_EPS) discard;
    vec2 vel = fieldVel(vUv);
    float speed = length(vel);

    // flow map: two half-period phases sliding along the velocity field, cross-faded to hide the reset
    const float PERIOD = 3.0;
    float t = uTime / PERIOD;
    float ph0 = fract(t);
    float ph1 = fract(t + 0.5);
    float w0 = 1.0 - abs(1.0 - 2.0 * ph0);
    float w1 = 1.0 - w0;
    vec2 drift = vel * PERIOD * 1.1;
    vec2 p = vPos.xy;
    vec3 n0 = sampleNormal(p, 11.0, drift * ph0) + sampleNormal(p + 37.0, 4.3, drift * ph0 * 1.3);
    vec3 n1 = sampleNormal(p + 13.0, 11.0, drift * ph1) + sampleNormal(p + 71.0, 4.3, drift * ph1 * 1.3);
    // a slow, unflowing swell breaks the tiling on still water
    vec3 sw = sampleNormal(p * 0.23 + vec2(uTime * 0.6, uTime * 0.35), 9.0, vec2(0.0));
    vec2 nxy = (n0.xy * w0 + n1.xy * w1) * 0.5;
    float rough = clamp(0.28 + speed * 0.45, 0.28, 1.25);
    vec3 N = normalize(vec3(nxy * rough + sw.xy * 0.18, 1.0));

    vec3 V = normalize(uCam - vPos);
    vec3 L = normalize(uSun);
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(vec3(0.16, 0.19, 0.21), vec3(0.035, 0.05, 0.065), clamp(R.z * 1.6, 0.0, 1.0));
    float spec = pow(max(dot(R, L), 0.0), 220.0) * 2.2 + pow(max(dot(R, L), 0.0), 18.0) * 0.08;

    // turbid flood water: muddy brown when shallow, dark silty olive when deep
    vec3 shallow = vec3(0.46, 0.34, 0.21);
    vec3 mid = vec3(0.27, 0.21, 0.14);
    vec3 deep = vec3(0.075, 0.085, 0.072);
    vec3 base = mix(shallow, mid, smoothstep(0.03, 0.6, d));
    base = mix(base, deep, smoothstep(0.5, 3.5, d));
    float diff = 0.45 + 0.55 * max(dot(N, L), 0.0);
    vec3 col = base * diff;

    // foam: fast flow, building edges and the advancing front
    vec2 fo0 = (p - drift * ph0 * 1.4) / 7.0;
    vec2 fo1 = (p + 5.0 - drift * ph1 * 1.4) / 7.0;
    float pattern = texture2D(uFoamTex, fo0).r * w0 + texture2D(uFoamTex, fo1).r * w1;
    pattern = pattern * 0.7 + texture2D(uFoamTex, p / 23.0 - drift * 0.01).r * 0.3;
    float m = texture2D(uMask, vUv).r;
    float edge = smoothstep(0.04, 0.3, m) * (1.0 - smoothstep(0.55, 0.95, m));
    float amount = smoothstep(0.7, 2.6, speed)
      + edge * smoothstep(0.12, 0.9, speed) * 0.9
      + (1.0 - smoothstep(DRAW_EPS, 0.14, d)) * smoothstep(0.08, 0.6, speed) * 0.6;
    amount = clamp(amount, 0.0, 1.0);
    float foam = smoothstep(1.0 - amount, 1.12 - amount * 0.7, pattern) * amount;
    col = mix(col, vec3(0.80, 0.77, 0.70) * (0.55 + 0.45 * diff), foam * 0.85);

    col = mix(col, sky, fres * (1.0 - foam)) + spec * vec3(1.0, 0.93, 0.82) * (1.0 - foam);
    col = applyFog(col, vPos);
    float alpha = smoothstep(DRAW_EPS, 0.16, d) * (0.84 + 0.12 * smoothstep(0.2, 2.0, d)) + fres * 0.1 + foam * 0.2;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/** Height-field water surface over the simulation grid (one vertex per `stride` cells). */
export function createWater(geo: GridGeo, ground: Float32Array, stride: number, shared: SharedUniforms, tex: { normal: THREE.Texture; foam: THREE.Texture }) {
  const { nx, ny } = geo;
  const cols: number[] = [];
  for (let i = 0; i < nx; i += stride) cols.push(i);
  if (cols[cols.length - 1] !== nx - 1) cols.push(nx - 1);
  const rows: number[] = [];
  for (let j = 0; j < ny; j += stride) rows.push(j);
  if (rows[rows.length - 1] !== ny - 1) rows.push(ny - 1);
  const W = cols.length;
  const H = rows.length;
  const pos = new Float32Array(W * H * 3);
  const uv = new Float32Array(W * H * 2);
  const g = new Float32Array(W * H);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = cols[c]!;
      const j = rows[r]!;
      const k = r * W + c;
      const [x, y] = geo.cellToLocal(i, j);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      uv[k * 2] = (i + 0.5) / nx;
      uv[k * 2 + 1] = (j + 0.5) / ny;
      g[k] = ground[j * nx + i]!;
    }
  const index = new Uint32Array((W - 1) * (H - 1) * 6);
  let q = 0;
  for (let r = 0; r < H - 1; r++)
    for (let c = 0; c < W - 1; c++) {
      const a = r * W + c;
      const b = a + 1;
      const d = a + W;
      const e = d + 1;
      index.set([a, d, b, b, d, e], q);
      q += 6;
    }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geom.setAttribute("aGround", new THREE.BufferAttribute(g, 1));
  geom.setIndex(new THREE.BufferAttribute(index, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      ...shared,
      uLift: { value: 0.35 },
      uNormalTex: { value: tex.normal },
      uFoamTex: { value: tex.foam },
    },
    transparent: true,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}


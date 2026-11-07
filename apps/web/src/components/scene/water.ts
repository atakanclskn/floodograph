import * as THREE from "three";
import { D_MAX, V_MAX } from "./data";
import { DRAW_EPS } from "./field";
import { sampleField, type GridGeo } from "./geo";

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
  uniform float uTime;
  uniform sampler2D uMask;
  attribute float aGround;
  varying vec2 vUv;
  varying vec3 vPos;
  varying float vCrest;
  varying float vHeap;

  void main() {
    vec4 a = texture2D(uA, uv);
    vec4 b = texture2D(uB, uv);
    if (mix(a.a, b.a, uAlpha) < 0.02) {
      // no wet cell nearby: collapse, the whole triangle becomes degenerate
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      vUv = uv; vPos = vec3(0.0); vCrest = 0.0; vHeap = 0.0;
      return;
    }
    float d = fieldDepth(uv);
    vec2 vel = fieldVel(uv);
    float sp = length(vel);
    vec2 dir = sp > 1e-3 ? vel / sp : vec2(0.7071, 0.7071);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 p = position.xy;

    // Surface waves travelling WITH the modelled current (visual detail the 20 m model does not resolve):
    // wavelength and celerity grow with local speed, crests are sharpened so fast water reads as a torrent.
    float wet = smoothstep(DRAW_EPS, 0.4, d);
    float lam = 6.0 + 2.6 * sp;
    float ph = dot(p, dir) * 6.2832 / lam - uTime * (1.4 + 1.25 * sp) + 0.8 * sin(dot(p, nrm) * 0.17 + uTime * 0.5);
    float crest = pow(0.5 + 0.5 * sin(ph), 3.0);
    float xw = sin(dot(p, nrm) * 0.55 + dot(p, dir) * 0.21 - uTime * 1.7);
    float amp = wet * min(0.04 + 0.17 * sp, 0.65) * min(d * 1.3, 1.0);
    // stagnation head where the current runs into a wall: v^2 / 2g, the height moving water piles up to
    float m = texture2D(uMask, uv).r;
    float heap = smoothstep(0.04, 0.4, m) * (1.0 - smoothstep(0.6, 0.95, m)) * min(sp * sp / 19.62, 1.4) * wet;
    float surf = d + uLift + amp * (crest * 1.7 - 0.45) + amp * 0.3 * xw + heap;
    vec3 pos = vec3(p, aGround + (d > DRAW_EPS ? surf : -0.9));
    vUv = uv;
    vPos = pos;
    vCrest = crest * smoothstep(0.6, 2.2, sp);
    vHeap = heap;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
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
  varying float vCrest;
  varying float vHeap;

  void main() {
    float d = fieldDepth(vUv);
    if (d < DRAW_EPS) discard;
    vec2 vel = fieldVel(vUv);
    float sp = length(vel);
    vec2 dir = sp > 1e-3 ? vel / sp : vec2(0.7071, 0.7071);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 p = vPos.xy;
    // flow-aligned coordinates: along / across the current
    vec2 q = vec2(dot(p, dir), dot(p, nrm));

    // geometric normal of the displaced surface (the 3D waves) ...
    vec3 Ng = normalize(cross(dFdx(vPos), dFdy(vPos)));
    if (Ng.z < 0.0) Ng = -Ng;
    // ... plus broad ripples stretched along the flow and scrolling with it (no fine glitter)
    float stretch = 1.0 + sp * 0.9;
    float scroll = uTime * (0.25 + sp * 0.9);
    vec2 r1 = texture2D(uNormalTex, vec2((q.x - scroll) / (16.0 * stretch), q.y / 16.0)).xy * 2.0 - 1.0;
    vec2 r2 = texture2D(uNormalTex, vec2((q.x - scroll * 1.6) / (6.5 * stretch), q.y / 6.5 + 0.37)).xy * 2.0 - 1.0;
    vec2 rip = (r1 * 0.6 + r2 * 0.4) * (0.35 + min(sp, 3.0) * 0.25);
    vec2 ripW = rip.x * dir + rip.y * nrm;
    vec3 N = normalize(vec3(Ng.xy + ripW * 0.55, Ng.z));

    vec3 V = normalize(uCam - vPos);
    vec3 L = normalize(uSun);
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(vec3(0.34, 0.37, 0.42), vec3(0.08, 0.10, 0.13), clamp(R.z * 1.3, 0.0, 1.0));
    sky += vec3(0.42, 0.22, 0.08) * pow(1.0 - clamp(R.z, 0.0, 1.0), 6.0); // warm street-light glow on the horizon
    float spec = pow(max(dot(R, L), 0.0), 70.0) * 0.55 + pow(max(dot(R, L), 0.0), 8.0) * 0.06;

    // turbid flood water: milky clay-brown when shallow, dark chocolate when deep
    vec3 shallow = vec3(0.47, 0.36, 0.23);
    vec3 mid = vec3(0.31, 0.22, 0.13);
    vec3 deep = vec3(0.14, 0.10, 0.065);
    vec3 base = mix(shallow, mid, smoothstep(0.05, 0.8, d));
    base = mix(base, deep, smoothstep(0.8, 4.0, d));
    float diff = 0.5 + 0.5 * max(dot(N, L), 0.0);
    vec3 col = base * diff;

    // foam streaks drawn out along the current, travelling with it
    float sAlong = (q.x - uTime * (0.6 + sp * 2.2)) / (10.0 + sp * 7.0);
    float streak = texture2D(uFoamTex, vec2(sAlong, q.y / 2.6)).r;
    streak = streak * 0.65 + texture2D(uFoamTex, vec2(sAlong * 0.43 + 0.5, q.y / 6.0 + 0.2)).r * 0.35;
    // whitewater: fast flow, wave crests, water piling against walls, and the thin advancing front
    float m = texture2D(uMask, vUv).r;
    float edge = smoothstep(0.04, 0.3, m) * (1.0 - smoothstep(0.55, 0.95, m));
    float amount = smoothstep(1.0, 3.2, sp) * 0.75
      + vCrest * 0.8
      + clamp(vHeap * 1.6, 0.0, 1.0) * 0.8
      + edge * smoothstep(0.2, 1.2, sp) * 0.5
      + (1.0 - smoothstep(DRAW_EPS, 0.12, d)) * smoothstep(0.1, 0.7, sp) * 0.5;
    amount = clamp(amount, 0.0, 1.0);
    float foam = smoothstep(1.0 - amount, 1.15 - amount * 0.6, streak) * amount;
    // a faint grain of silt so even calm-looking water shows which way it moves
    float silt = smoothstep(0.55, 0.9, streak) * 0.12 * smoothstep(0.1, 0.8, sp);
    col = mix(col, vec3(0.86, 0.82, 0.74) * (0.6 + 0.4 * diff), clamp(foam * 0.92 + silt, 0.0, 1.0));

    float rim = 1.0 - smoothstep(DRAW_EPS, 0.1, d);
    col = mix(col, vec3(0.40, 0.31, 0.2), rim * 0.5);
    col = mix(col, sky, clamp(fres * 1.1, 0.0, 0.7) * (1.0 - foam)) + spec * vec3(1.0, 0.9, 0.75) * (1.0 - foam);
    col = applyFog(col, vPos);
    float alpha = smoothstep(DRAW_EPS, 0.1, d) * 0.94 + fres * 0.05 + foam * 0.1;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * Height-field water surface over the simulation grid: one vertex step every `stride` cells, split into `sub`
 * vertices. sub > 1 gives the 3D waves geometry to live on and rounds off the 20 m stair-steps of the model grid.
 */
export function createWater(
  geo: GridGeo,
  ground: Float32Array,
  stride: number,
  shared: SharedUniforms,
  tex: { normal: THREE.Texture; foam: THREE.Texture },
  sub = 1,
) {
  const { nx, ny } = geo;
  const step = stride / Math.max(1, sub);
  const xs: number[] = [];
  for (let f = 0; f < nx - 1; f += step) xs.push(f);
  xs.push(nx - 1);
  const ys: number[] = [];
  for (let f = 0; f < ny - 1; f += step) ys.push(f);
  ys.push(ny - 1);
  const W = xs.length;
  const H = ys.length;
  const pos = new Float32Array(W * H * 3);
  const uv = new Float32Array(W * H * 2);
  const g = new Float32Array(W * H);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const fi = xs[c]!;
      const fj = ys[r]!;
      const k = r * W + c;
      const [x, y] = geo.cellToLocal(fi, fj);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      uv[k * 2] = (fi + 0.5) / nx;
      uv[k * 2 + 1] = (fj + 0.5) / ny;
      g[k] = sampleField(ground, nx, ny, fi, fj);
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
      uLift: { value: 0.3 },
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

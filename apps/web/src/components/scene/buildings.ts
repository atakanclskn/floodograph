import * as THREE from "three";
import type { BuildingCollection } from "./data";
import { sampleField, type GridGeo } from "./geo";
import { gridTexture } from "./textures";
import { FIELD_GLSL, FOG_GLSL, type SharedUniforms } from "./water";

const TIER_INDEX: Record<string, number> = { acil: 3, yuksek: 2, orta: 1, izle: 0 };
export const NEVER = 1e6;

export type BuildingIndex = {
  /** cell mask: 255 inside a footprint, blurred edge; RGBA texture for the water shader */
  maskTex: THREE.DataTexture;
  /** raw mask (0..1) per cell for CPU collision tests */
  mask: Float32Array;
  /** first-wet minutes, sorted, for the live "wet buildings" counter */
  wetTimes: Float64Array;
  /** footprint centres of buildings with fw (local xy) and their fw, for spray at walls */
  wetEdges: { x: number; y: number; fw: number }[];
  mesh: THREE.Mesh;
};

const vertex = /* glsl */ `
  ${FIELD_GLSL}
  uniform float uSimT;
  attribute vec4 aInfo;   // fw, md, ground (m), tier
  attribute vec2 aUv;
  varying vec3 vPos;
  varying float vAbove;
  varying float vWetLine;
  varying float vWetK;
  varying float vFlash;
  varying float vTier;
  void main() {
    float since = uSimT - aInfo.x;
    float here = fieldDepth(aUv);
    vWetK = smoothstep(0.0, 20.0, since);
    // wet line: the water standing against the walls now, plus a damp band once the building has been reached
    vWetLine = max(here > DRAW_EPS ? here + 0.25 : 0.0, 0.7 * vWetK);
    vFlash = since >= 0.0 ? exp(-since / 14.0) : 0.0;
    vTier = aInfo.w;
    vPos = position;
    vAbove = position.z - aInfo.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${FOG_GLSL}
  uniform vec3 uSun;
  uniform float uSimT;
  uniform float uNight;
  varying vec3 vPos;
  varying float vAbove;
  varying float vWetLine;
  varying float vWetK;
  varying float vFlash;
  varying float vTier;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 N = normalize(cross(dFdx(vPos), dFdy(vPos)));
    vec3 V = normalize(uCam - vPos);
    if (dot(N, V) < 0.0) N = -N;
    vec3 L = normalize(uSun);
    float roof = step(0.7, N.z);
    vec3 base = mix(vec3(0.135, 0.155, 0.17), vec3(0.19, 0.215, 0.23), roof);
    float diff = 0.42 + 0.58 * max(dot(N, L), 0.0) + 0.08 * N.z;
    vec3 col = base * diff;

    // lit windows after dusk; dark below the water line (decorative, not data)
    if (roof < 0.5) {
      vec2 t = normalize(vec2(-N.y, N.x));
      float s = dot(vPos.xy, t);
      vec2 cell = vec2(floor(s / 3.4), floor(vAbove / 3.0));
      float inWin = step(0.3, fract(s / 3.4)) * step(fract(s / 3.4), 0.75) * step(0.35, fract(vAbove / 3.0)) * step(fract(vAbove / 3.0), 0.8);
      float on = step(0.62, hash(cell + floor(vPos.xy / 200.0))) * step(1.2, vAbove);
      float dry = step(vWetLine + 0.6, vAbove);
      col += vec3(1.0, 0.72, 0.42) * inWin * on * dry * uNight * 0.55;
    }

    // ground-level wetness: darker, warmer, slightly glossy below the wet line
    float band = 1.0 - smoothstep(vWetLine - 0.12, vWetLine + 0.12, vAbove);
    vec3 wet = vec3(0.10, 0.075, 0.05) + pow(max(dot(reflect(-V, N), L), 0.0), 40.0) * 0.25;
    col = mix(col, wet, band * (roof < 0.5 ? 0.9 : 0.0));

    // reached by water: roof warms toward ember by urgency tier, with a pulse at first contact
    vec3 ember = vec3(1.0, 0.353, 0.169);
    float tierW = 0.08 + 0.08 * vTier;
    col = mix(col, col * 0.6 + ember * 0.22, vWetK * roof * tierW);
    col += ember * vFlash * (0.25 + 0.5 * roof);

    col = applyFog(col, vPos);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function pointInRing(x: number, y: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createBuildings(
  fc: BuildingCollection,
  geo: GridGeo,
  ground: Float32Array,
  shared: SharedUniforms,
  night: { value: number },
): BuildingIndex {
  const { nx, ny } = geo;
  const pos: number[] = [];
  const info: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const maskRaw = new Float32Array(nx * ny);
  const wetTimes: number[] = [];
  const wetEdges: BuildingIndex["wetEdges"] = [];

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
    const { h, fw, md, tier } = f.properties;
    let counted = false;
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      const ring: [number, number][] = [];
      for (let k = 0; k < outer.length - 1; k++) ring.push(geo.lngLatToLocal([outer[k]![0]!, outer[k]![1]!]));
      let cx = 0,
        cy = 0;
      for (const [x, y] of ring) {
        cx += x;
        cy += y;
      }
      cx /= ring.length;
      cy /= ring.length;
      const [s, t] = geo.localToST(cx, cy);
      if (s < 0 || s > 1 || t < 0 || t > 1) continue;

      let gMin = Infinity,
        gSum = 0;
      for (const [x, y] of ring) {
        const [fx, fy] = geo.localToCell(x, y);
        const e = sampleField(ground, nx, ny, fx, fy);
        if (e < gMin) gMin = e;
        gSum += e;
      }
      const gMean = gSum / ring.length;
      const base = gMin - 0.8;
      const roofZ = gMean + Math.max(h || 0, 3);
      const fwv = fw == null ? 1e6 : fw;
      const tierI = TIER_INDEX[tier] ?? 0;
      const u = s,
        v = t;

      const start = pos.length / 3;
      for (const [x, y] of ring) {
        pos.push(x, y, base, x, y, roofZ);
        info.push(fwv, md || 0, gMean, tierI, fwv, md || 0, gMean, tierI);
        uvs.push(u, v, u, v);
      }
      const n = ring.length;
      for (let k = 0; k < n; k++) {
        const b0 = start + k * 2;
        const b1 = start + ((k + 1) % n) * 2;
        idx.push(b0, b1, b1 + 1, b0, b1 + 1, b0 + 1);
      }
      const tris = THREE.ShapeUtils.triangulateShape(
        ring.map(([x, y]) => new THREE.Vector2(x, y)),
        [],
      );
      for (const [a, b, c] of tris) idx.push(start + a! * 2 + 1, start + b! * 2 + 1, start + c! * 2 + 1);

      // rasterise into the cell mask (cell centres inside the footprint; tiny footprints mark their centre cell)
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const [x, y] of ring) {
        const [fx, fy] = geo.localToCell(x, y);
        minX = Math.min(minX, fx);
        maxX = Math.max(maxX, fx);
        minY = Math.min(minY, fy);
        maxY = Math.max(maxY, fy);
      }
      let hit = false;
      for (let j = Math.max(0, Math.ceil(minY)); j <= Math.min(ny - 1, Math.floor(maxY)); j++)
        for (let i = Math.max(0, Math.ceil(minX)); i <= Math.min(nx - 1, Math.floor(maxX)); i++) {
          const [px, py] = geo.cellToLocal(i, j);
          if (pointInRing(px, py, ring)) {
            maskRaw[j * nx + i] = 1;
            hit = true;
          }
        }
      if (!hit) {
        const [fx, fy] = geo.localToCell(cx, cy);
        const c = Math.round(Math.min(Math.max(fy, 0), ny - 1)) * nx + Math.round(Math.min(Math.max(fx, 0), nx - 1));
        maskRaw[c] = Math.max(maskRaw[c]!, 0.6);
      }
      if (!counted && fw != null) {
        wetTimes.push(fw);
        wetEdges.push({ x: cx, y: cy, fw });
        counted = true;
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("aInfo", new THREE.Float32BufferAttribute(info, 4));
  geom.setAttribute("aUv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { ...shared, uNight: night },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  // soft edge: 3x3 box blur of the mask
  const blurred = new Float32Array(nx * ny);
  const tex = new Uint8Array(nx * ny * 4);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let s = 0,
        n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di,
            jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          s += maskRaw[jj * nx + ii]!;
          n++;
        }
      const c = j * nx + i;
      blurred[c] = s / n;
      tex[c * 4] = tex[c * 4 + 1] = tex[c * 4 + 2] = Math.round((s / n) * 255);
      tex[c * 4 + 3] = 255;
    }

  return {
    maskTex: gridTexture(nx, ny, tex),
    mask: maskRaw,
    wetTimes: Float64Array.from(wetTimes).sort(),
    wetEdges,
    mesh,
  };
}

/** Number of buildings reached by water by minute t (binary search over sorted first-wet times). */
export function wetCount(sorted: Float64Array, t: number) {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

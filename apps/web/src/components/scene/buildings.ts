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
  /** one record per footprint polygon: its vertex range, centre and the water cells around it */
  parts: { start: number; end: number; feature: number; cx: number; cy: number; ring: number[] }[];
};

/**
 * Structural failure thresholds (Clausen & Clark 1990, masonry and concrete buildings): with flow speed >= 2 m/s,
 * depth x speed >= 3 m2/s causes partial damage and >= 7 m2/s total destruction. The scene animates the
 * consequence; it does not model the structure.
 */
export const FAIL_V_MIN = 2;
export const FAIL_DV_DAMAGE = 3;
export const FAIL_DV_DESTROY = 7;
type Exceed = { t: Float32Array; u: Float32Array; v: Float32Array };


const vertex = /* glsl */ `
  ${FIELD_GLSL}
  uniform float uSimT;
  uniform float uTime;
  attribute vec4 aInfo;   // fw, md, ground (m), tier
  attribute vec2 aUv;
  attribute vec4 aFail;   // failure onset (sim min), push direction (local xy), severity (1 destroyed, 0.3 damaged, 0 none)
  attribute float aHeight; // roof height above ground (m)
  varying float vRuin;
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
    vec3 p = position;
    float sev = aFail.w;
    float k = sev > 0.0 ? smoothstep(aFail.x, aFail.x + 1.5 + 5.0 * sev, uSimT) : 0.0;
    float pre = sev > 0.0 ? smoothstep(aFail.x - 4.0, aFail.x, uSimT) * (1.0 - k) : 0.0;
    float hAbove = max(p.z - aInfo.z, 0.0);
    float rel = hAbove / max(aHeight, 1.0);
    if (k > 0.0 || pre > 0.0) {
      vec2 dir = aFail.yz;
      float jit = fract(sin(dot(floor(position * 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453) - 0.5;
      // shudder as the water load builds up
      p.xy += vec2(sin(uTime * 41.0 + jit * 9.0), cos(uTime * 37.0 + jit * 5.0)) * 0.12 * pre * rel;
      // lean into the current (shear growing with height), then the destroyed ones pancake to a rubble heap
      p.xy += dir * hAbove * k * sev * 0.5;
      float keep = sev > 0.99 ? mix(1.0, 0.1 + 0.16 * fract(jit * 17.0 + 0.5), smoothstep(0.15, 1.0, k)) : mix(1.0, 0.93, k);
      p.z = aInfo.z + hAbove * keep;
      p.xy += (dir * (0.6 + jit) + vec2(jit, -jit) * 0.8) * k * sev * 3.0 * rel;
    }
    vRuin = k * sev;
    vPos = p;
    vAbove = p.z - aInfo.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${FOG_GLSL}
  uniform vec3 uSun;
  uniform float uSimT;
  uniform float uNight;
  uniform float uTime;
  uniform float uBlink; // 1 = blink, 0 = steady (prefers-reduced-motion)
  varying vec3 vPos;
  varying float vAbove;
  varying float vWetLine;
  varying float vWetK;
  varying float vFlash;
  varying float vTier;
  varying float vRuin;

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
      col += vec3(1.0, 0.72, 0.42) * inWin * on * dry * uNight * 0.55 * (1.0 - step(0.05, vRuin));
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

    // alarm: once the water reaches an urgent (orange) or high-priority (yellow) building, it keeps blinking
    float isAcil = step(2.5, vTier);
    float isHigh = step(1.5, vTier) * (1.0 - isAcil);
    float alarmOn = step(0.0001, vWetK) * (isAcil + isHigh);
    float blink = mix(0.6, 0.5 + 0.5 * sin(uTime * 8.2), uBlink);
    vec3 alarmCol = mix(vec3(1.0, 0.78, 0.22), vec3(1.0, 0.36, 0.14), isAcil);
    col = mix(col, alarmCol * (0.55 + 0.45 * diff), alarmOn * (0.3 + 0.6 * blink));
    col += alarmCol * alarmOn * blink * 0.35;

    // damaged / destroyed: broken concrete and mud, a few cracks catching the ember light
    float grit = hash(floor(vPos.xy * 1.3) + floor(vPos.z * 1.3));
    vec3 rubble = mix(vec3(0.30, 0.27, 0.23), vec3(0.20, 0.16, 0.12), grit) * (0.55 + 0.45 * diff);
    col = mix(col, rubble, smoothstep(0.0, 0.6, vRuin));
    col += ember * 0.18 * vRuin * step(0.93, grit);

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
  const height: number[] = [];
  const parts: BuildingIndex["parts"] = [];
  let featureNo = -1;

  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
    const { h, fw, md, tier } = f.properties;
    featureNo++;
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
      // buildings the water reaches, and higher tiers, stand a little taller: overlapping OSM footprints
      // would otherwise share a roof height and flicker (z-fighting)
      const lift = (fw != null ? 1.2 : 0) + (TIER_INDEX[tier] ?? 0) * 0.3;
      const roofZ = gMean + Math.max(h || 0, 3) + lift;
      const fwv = fw == null ? 1e6 : fw;
      const tierI = TIER_INDEX[tier] ?? 0;
      const u = s,
        v = t;

      const start = pos.length / 3;
      for (const [x, y] of ring) {
        pos.push(x, y, base, x, y, roofZ);
        info.push(fwv, md || 0, gMean, tierI, fwv, md || 0, gMean, tierI);
        uvs.push(u, v, u, v);
        height.push(roofZ - gMean, roofZ - gMean);
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
      const around: number[] = [];
      for (let j = Math.max(0, Math.floor(minY) - 1); j <= Math.min(ny - 1, Math.ceil(maxY) + 1); j++)
        for (let i = Math.max(0, Math.floor(minX) - 1); i <= Math.min(nx - 1, Math.ceil(maxX) + 1); i++) {
          const [px, py] = geo.cellToLocal(i, j);
          if (pointInRing(px, py, ring)) {
            maskRaw[j * nx + i] = 1;
            hit = true;
          } else around.push(j * nx + i);
        }
      parts.push({ start, end: pos.length / 3, feature: featureNo, cx, cy, ring: around });
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
  const fail = new Float32Array((pos.length / 3) * 4);
  for (let k = 0; k < fail.length; k += 4) fail[k] = 1e6;
  geom.setAttribute("aFail", new THREE.BufferAttribute(fail, 4));
  geom.setAttribute("aHeight", new THREE.Float32BufferAttribute(height, 1));
  geom.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      ...shared,
      uNight: night,
      uBlink: { value: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1 },
    },
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
    parts,
  };
}

/**
 * Give every footprint its failure onset from the simulated flow around it (the water cells bordering the
 * footprint, since building cells are walls in the model). Returns the destroyed footprints, for rubble.
 */
export function applyFailures(b: BuildingIndex, geo: GridGeo, destroy: Exceed, damage: Exceed) {
  const attr = b.mesh.geometry.getAttribute("aFail") as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const destroyed: { x: number; y: number; t: number; dx: number; dy: number }[] = [];
  const featDestroyed = new Set<number>();
  const featDamaged = new Set<number>();
  for (const p of b.parts) {
    let best = -1;
    let sev = 0;
    for (const [ex, s] of [
      [destroy, 1],
      [damage, 0.3],
    ] as const) {
      let tMin = Infinity;
      for (const c of p.ring)
        if (ex.t[c]! < tMin) {
          tMin = ex.t[c]!;
          best = c;
        }
      if (Number.isFinite(tMin)) {
        sev = s;
        break;
      }
    }
    if (!sev || best < 0) continue;
    const ex = sev === 1 ? destroy : damage;
    const [vx, vy] = geo.velocityToLocal(ex.u[best]!, ex.v[best]!);
    const l = Math.hypot(vx, vy) || 1;
    const t = ex.t[best]!;
    for (let k = p.start; k < p.end; k++) arr.set([t, vx / l, vy / l, sev], k * 4);
    if (sev === 1) {
      featDestroyed.add(p.feature);
      destroyed.push({ x: p.cx, y: p.cy, t, dx: vx / l, dy: vy / l });
    } else featDamaged.add(p.feature);
  }
  attr.needsUpdate = true;
  for (const f of featDestroyed) featDamaged.delete(f);
  return { destroyed, destroyedCount: featDestroyed.size, damagedCount: featDamaged.size };
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

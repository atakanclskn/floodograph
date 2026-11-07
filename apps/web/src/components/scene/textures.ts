import * as THREE from "three";

/** Small seeded PRNG (mulberry32) so procedural textures and object placement are stable between visits. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable ripple normal map: a sum of plane waves with integer wave numbers, so it wraps seamlessly.
 * Analytic gradient, no image assets. RG = normal.xy * 0.5 + 0.5, B = normal.z, A = height.
 */
export function rippleNormalTexture(size = 256, seed = 7): THREE.DataTexture {
  const rand = rng(seed);
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const k = 2 + Math.floor(rand() * 13);
    const ang = rand() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * k);
    const ky = Math.round(Math.sin(ang) * k);
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 1 / Math.hypot(kx, ky) ** 1.15, p: rand() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  const tau = Math.PI * 2;
  let hMin = Infinity,
    hMax = -Infinity;
  const hs = new Float32Array(size * size);
  const gx = new Float32Array(size * size);
  const gy = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = 0,
        dx = 0,
        dy = 0;
      for (const w of waves) {
        const ph = tau * (w.kx * u + w.ky * v) + w.p;
        h += w.a * Math.sin(ph);
        const c = w.a * Math.cos(ph) * tau;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const i = y * size + x;
      hs[i] = h;
      gx[i] = dx;
      gy[i] = dy;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  const strength = 0.045;
  for (let i = 0; i < size * size; i++) {
    const nx = -gx[i]! * strength;
    const ny = -gy[i]! * strength;
    const inv = 1 / Math.hypot(nx, ny, 1);
    data[i * 4] = Math.round((nx * inv * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(inv * 255);
    data[i * 4 + 3] = Math.round(((hs[i]! - hMin) / (hMax - hMin)) * 255);
  }
  return finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat));
}

/** Tileable cellular (Worley) noise for foam: bright cell borders, dark pockets. */
export function foamTexture(size = 256, cells = 9, seed = 21): THREE.DataTexture {
  const rand = rng(seed);
  const pts: [number, number][] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rand()) / cells, (j + rand()) / cells]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let d1 = 9,
        d2 = 9;
      const ci = Math.floor(u * cells);
      const cj = Math.floor(v * cells);
      for (let oj = -1; oj <= 1; oj++)
        for (let oi = -1; oi <= 1; oi++) {
          const ii = (ci + oi + cells) % cells;
          const jj = (cj + oj + cells) % cells;
          const p = pts[jj * cells + ii]!;
          const px = p[0] + (ci + oi - ii) / cells;
          const py = p[1] + (cj + oj - jj) / cells;
          const dx = u - px;
          const dy = v - py;
          const d = Math.hypot(dx, dy) * cells;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      const edge = Math.min(Math.max((d2 - d1) * 1.6, 0), 1);
      const val = Math.round((1 - edge) ** 2.2 * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = val;
      data[i + 3] = Math.round(Math.min(d1, 1) * 255);
    }
  return finish(new THREE.DataTexture(data, size, size, THREE.RGBAFormat));
}

function finish(t: THREE.DataTexture): THREE.DataTexture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Dense RGBA8 grid texture (row 0 = north = v 0), linear filtered, clamped. */
export function gridTexture(nx: number, ny: number, data: Uint8Array, filter: THREE.MagnificationTextureFilter = THREE.LinearFilter) {
  const t = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = filter;
  t.minFilter = filter === THREE.LinearFilter ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

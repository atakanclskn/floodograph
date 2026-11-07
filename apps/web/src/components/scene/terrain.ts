import type { GridGeo } from "./geo";

export const TERRARIUM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const TILE = 256;

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function loadTile(z: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array> {
  const url = TERRARIUM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  const res = await fetch(url, { signal, mode: "cors" });
  if (!res.ok) throw new Error(`terrarium ${z}/${x}/${y}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, TILE, TILE).data;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4]! * 256 + px[i * 4 + 1]! + px[i * 4 + 2]! / 256 - 32768;
  return out;
}

/**
 * Ground elevation (m) at every grid cell centre, from the same Terrarium tiles MapLibre drapes its 3D terrain with.
 * map.queryTerrainElevation only answers for tiles currently on screen, so the whole grid is decoded here once,
 * at z14 (~7 m/px, finer than the 20 m grid), which keeps water and buildings seated on the rendered terrain.
 */
export async function groundForGrid(geo: GridGeo, signal: AbortSignal, z = 14): Promise<Float32Array> {
  const { nx, ny } = geo;
  const lls = new Float64Array(nx * ny * 2);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [lon, lat] = geo.cellToLngLat(i, j);
      const k = (j * nx + i) * 2;
      const px = lon2x(lon, z) * TILE;
      const py = lat2y(lat, z) * TILE;
      lls[k] = px;
      lls[k + 1] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  const tx0 = Math.floor((minX - 1) / TILE);
  const tx1 = Math.floor((maxX + 1) / TILE);
  const ty0 = Math.floor((minY - 1) / TILE);
  const ty1 = Math.floor((maxY + 1) / TILE);
  const tiles = new Map<string, Float32Array>();
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      jobs.push(loadTile(z, tx, ty, signal).then((t) => void tiles.set(`${tx}/${ty}`, t)));
  await Promise.all(jobs);

  const at = (gx: number, gy: number) => {
    const tx = Math.floor(gx / TILE);
    const ty = Math.floor(gy / TILE);
    const t = tiles.get(`${tx}/${ty}`);
    if (!t) return 0;
    return t[(gy - ty * TILE) * TILE + (gx - tx * TILE)]!;
  };
  const out = new Float32Array(nx * ny);
  for (let c = 0; c < nx * ny; c++) {
    const px = lls[c * 2]! - 0.5;
    const py = lls[c * 2 + 1]! - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const ax = px - x0;
    const ay = py - y0;
    out[c] =
      (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
  }
  return out;
}

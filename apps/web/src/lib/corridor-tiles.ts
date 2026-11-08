/**
 * Viewport loading of the city-wide stream corridors (pipeline `corridor-tiles`, served from /corridors).
 * Only the tiles under the screen plus a one-tile margin are fetched; fetched tiles stay cached.
 */
export type CorridorFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  /** up: upstream area in km² (bigger = larger stream) */
  properties: { id: string | number; kind: "derived" | "buried_osm" | "open"; up?: number };
};

/**
 * Smallest stream (upstream km²) worth drawing at a zoom: zoomed out, thousands of hairline gullies turn into
 * noise, so only the main valleys stay; every corridor is back from zoom 13.
 */
export function minUpstreamKm2(zoom: number): number {
  if (zoom < 10.5) return 40;
  if (zoom < 11.5) return 12;
  if (zoom < 12.3) return 4;
  if (zoom < 13) return 1.2;
  return 0;
}

type Index = { z: number; v: string; tiles: Set<string> };

const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

export class CorridorTiles {
  private index: Promise<Index | null>;
  private cache = new Map<string, CorridorFeature[]>();
  private inflight = new Map<string, Promise<void>>();

  constructor(private readonly base = "/corridors") {
    // the index is always revalidated; tiles carry its version, so a re-run never shows stale corridors
    this.index = fetch(`${base}/index.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { z: number; v?: string; tiles: string[] } | null) => (j ? { z: j.z, v: j.v ?? "0", tiles: new Set(j.tiles) } : null))
      .catch(() => null);
  }

  /** Every cached corridor after making sure the tiles around [west, south, east, north] are loaded. */
  async around(west: number, south: number, east: number, north: number): Promise<CorridorFeature[]> {
    const idx = await this.index;
    if (!idx) return [];
    const { z, tiles } = idx;
    const x0 = lon2x(west, z) - 1;
    const x1 = lon2x(east, z) + 1;
    const y0 = lat2y(north, z) - 1;
    const y1 = lat2y(south, z) + 1;
    // a zoomed-out view of a whole province would mean hundreds of tiles: cap the work, nearest first
    const want: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (tiles.has(`${x}/${y}`)) want.push(`${x}/${y}`);
    await Promise.all(want.slice(0, 80).map((k) => this.load(z, k, idx.v)));
    const out: CorridorFeature[] = [];
    for (const feats of this.cache.values()) out.push(...feats);
    return out;
  }

  private load(z: number, key: string, v: string): Promise<void> {
    if (this.cache.has(key)) return Promise.resolve();
    let p = this.inflight.get(key);
    if (!p) {
      p = fetch(`${this.base}/${z}/${key}.json?v=${v}`)
        .then((r) => (r.ok ? r.json() : { features: [] }))
        .then((fc: { features: CorridorFeature[] }) => void this.cache.set(key, fc.features))
        .catch(() => void this.cache.set(key, []))
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }
}

import type { addProtocol as AddProtocol, ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import type { Protocol } from "pmtiles";
import type { BuildingSource } from "@/components/scene/scene-style";

/**
 * Overture Maps buildings (OSM + Microsoft ML footprints) as one planet-wide PMTiles archive, read by HTTP range
 * requests: only the tiles on screen are fetched. Same data the Sarıyer pilot builds from (see pipeline overture.py).
 * Overture keeps a release's tiles for ~60 days: when this one disappears, bump the release (list the bucket under
 * `tiles/`, or see docs.overturemaps.org/examples/overture-tiles).
 */
export const OVERTURE_RELEASE = "2026-10-21.0";
export const OVERTURE_BUILDINGS_URL = `https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/${OVERTURE_RELEASE}/buildings.pmtiles`;
export const OVERTURE_SOURCE = "overture";
export const OVERTURE_LAYER = "building";

/** As in the pipeline: 3 m per floor. */
const FLOOR_M = 3;

/**
 * Most footprints in Turkish cities carry no height or floor count (Ankara ~25 %, İstanbul / İzmir ~2 %). Instead of
 * one flat 9 m slab everywhere, an unknown building gets 3-6 floors, picked from its feature id so it stays the
 * same between tiles and zooms. Ids are 64-bit (beyond exact doubles), so the id is scaled down before the modulo.
 * Visual only: the flood numbers do not use building heights.
 */
export function defaultFloors(id: number) {
  return 3 + (Math.floor(Math.abs(id) / 1e9) % 4);
}

/**
 * Height (m) of a building piece from Overture's properties, as in the pipeline: height, else floors x 3 m, else
 * defaultFloors. `areaM2` (footprint, when known): a kiosk / shed / garage under 30 m² gets one floor by default.
 */
export function overtureHeight(props: Record<string, unknown> | null | undefined, id: number, areaM2 = Infinity) {
  const h = Number(props?.height);
  if (Number.isFinite(h) && h > 0) return Math.min(h, 400);
  const floors = Number(props?.num_floors);
  if (Number.isFinite(floors) && floors > 0) return floors * FLOOR_M;
  return (areaM2 < 30 ? 1 : defaultFloors(id)) * FLOOR_M;
}

export function overtureMinHeight(props: Record<string, unknown> | null | undefined) {
  const h = Number(props?.min_height);
  if (Number.isFinite(h) && h > 0) return h;
  const f = Number(props?.min_floor);
  return Number.isFinite(f) && f > 0 ? f * FLOOR_M : 0;
}

/** Underground structures (car parks, metro halls) are not drawn. */
export const OVERTURE_FILTER: FilterSpecification = ["!=", ["get", "is_underground"], true];

// the same rules as MapLibre expressions, for the fill-extrusion layer (keep in step with the functions above)
const num = (key: string): ExpressionSpecification => ["to-number", ["get", key], 0];
const HEIGHT: ExpressionSpecification = [
  "case",
  [">", num("height"), 0],
  ["min", num("height"), 400],
  [">", num("num_floors"), 0],
  ["*", num("num_floors"), FLOOR_M],
  ["*", FLOOR_M, ["+", 3, ["%", ["floor", ["/", ["abs", ["to-number", ["id"], 0]], 1e9]], 4]]],
];
const BASE: ExpressionSpecification = [
  "case",
  [">", num("min_height"), 0],
  num("min_height"),
  ["*", num("min_floor"), FLOOR_M],
];

/** The /sehirler buildings: Overture instead of OpenFreeMap's OSM buildings (see sceneStyle). */
export const OVERTURE_BUILDINGS: BuildingSource = {
  source: OVERTURE_SOURCE,
  spec: {
    type: "vector",
    url: `pmtiles://${OVERTURE_BUILDINGS_URL}`,
    attribution:
      '<a href="https://docs.overturemaps.org/attribution" target="_blank" rel="noreferrer">© Overture Maps Foundation</a>',
  },
  sourceLayer: OVERTURE_LAYER,
  height: HEIGHT,
  base: BASE,
  filter: OVERTURE_FILTER,
};

let protocol: Protocol | null = null;

/** Let MapLibre read `pmtiles://` URLs (once per page; the archive's header and directories are cached). */
export async function registerPmtiles(addProtocol: typeof AddProtocol) {
  if (protocol) return;
  const { Protocol } = await import("pmtiles");
  if (protocol) return;
  protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
}

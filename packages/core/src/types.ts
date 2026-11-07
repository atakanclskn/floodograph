// Domain types shared by web and mobile. Mirrors the data contract in docs/ARCHITECTURE.md §6.

export type CityId = "istanbul" | "izmir" | "ankara" | (string & {});
export type ScenarioKind = "historical" | "design" | "live";
export type Tier = "acil" | "yuksek" | "orta" | "izle";
export type CriticalFacility = "hastane" | "okul" | "itfaiye" | "bakimevi";

export interface City {
  id: CityId;
  name: string;
  epsg: number;
  bbox: [west: number, south: number, east: number, north: number];
  center: [lon: number, lat: number];
  resM: number;
}

/** Grid metadata for binary frames (scenarios.params.grid, written by pipeline/floodograph/pipeline/simulate.py).
 * The grid is regular in UTM (epsg); corners are its WGS84 projection. Over a few km the UTM->WGS84 mapping is
 * affine to sub-metre accuracy, so a cell centre can be placed by bilinear interpolation of the 4 corners. */
export interface GridMeta {
  nx: number;
  ny: number;
  res_m: number;
  epsg: number;
  /** [lon, lat] of the grid corners in order NW, NE, SE, SW. Row 0 is the northern edge. */
  corners_lonlat: [[number, number], [number, number], [number, number], [number, number]];
  /** uint16/int16 value -> metres (depth) and m/s (u east, v north) */
  depthScale: number;
  velocityScale: number;
}

export interface Scenario {
  id: string;
  cityId: CityId;
  kind: ScenarioKind;
  label: string;
  rainSource: string;
  startTs: string;
  stepMin: number;
  durationMin: number;
  totalMm: number;
  totalM3: number;
  grid?: GridMeta;
  metrics?: Record<string, number>;
}

export interface RainPoint {
  tMin: number;
  mm: number;
}

/** Properties carried by each building feature (RPC get_buildings). */
export interface BuildingProps {
  id: number;
  h: number;
  hand: number;
  crit: CriticalFacility | null;
  /** first wet minute, null = stays dry */
  fw: number | null;
  /** max depth in metres */
  md: number;
  tier: Tier;
}

/** Properties carried by each corridor feature (repository.corridors). */
export interface CorridorProps {
  id: number;
  kind: "buried_osm" | "derived" | "open";
  tier: Tier;
  upstreamKm2: number;
  buildingsAtRisk: number;
  criticalCount: number;
}

export interface WaterBandProps {
  t: number;
  band: number;
  dmin: number;
  dmax: number;
}

export interface CorridorSummary {
  id: number;
  kind: "buried_osm" | "derived" | "open";
  tier: Tier;
  upstreamKm2: number;
  buildingsAtRisk: number;
  criticalCount: number;
  overflowStartMin: number | null;
}

export interface ScenarioSummary {
  scenario: Scenario;
  tierCounts: Record<Tier, number>;
  corridors: CorridorSummary[];
}

export interface GridFrameRef {
  tMin: number;
  path: string;
  maxDepth: number;
}

/** Decoded frame: depth (m), u and v (m/s), row-major from the top-left. */
export interface GridFrame {
  tMin: number;
  nx: number;
  ny: number;
  depth: Float32Array;
  u: Float32Array;
  v: Float32Array;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeFrame } from "./frames";
import type {
  City,
  CorridorProps,
  GridFrame,
  GridFrameRef,
  RainPoint,
  Scenario,
  ScenarioSummary,
} from "./types";

type FeatureCollection = { type: "FeatureCollection"; features: unknown[] };

/** Repository port: the only way web and mobile read flood data. Swap implementations freely. */
export interface FloodRepository {
  listCities(): Promise<City[]>;
  listScenarios(cityId: string): Promise<Scenario[]>;
  rainSeries(scenarioId: string): Promise<RainPoint[]>;
  /** Buildings with tier; scenarioId null = static HAND-based tier (no simulation impacts). */
  buildings(cityId: string, scenarioId: string | null): Promise<FeatureCollection>;
  /** Flow corridors (buried in OSM, open, or derived = on no map) as LineString features. */
  corridors(cityId: string): Promise<FeatureCollection>;
  waterBands(scenarioId: string, tFrom: number, tTo: number): Promise<FeatureCollection>;
  gridFrames(scenarioId: string): Promise<GridFrameRef[]>;
  /** Binary depth/velocity frame (see frames.ts) at minute tMin of a scenario. */
  loadGridFrame(scenarioId: string, tMin: number): Promise<GridFrame>;
  summary(scenarioId: string): Promise<ScenarioSummary>;
}

/** Adapter over Supabase (PostgREST + RPC + Storage). Only ever uses the public anon key. */
export class SupabaseFloodRepository implements FloodRepository {
  constructor(
    private readonly db: SupabaseClient,
    /** Needed for raw-binary RPC calls (PostgREST returns bytea as octet-stream). */
    private readonly rest: { url: string; key: string },
  ) {}

  async listCities(): Promise<City[]> {
    const { data, error } = await this.db.rpc("get_cities");
    if (error) throw error;
    return data as City[];
  }

  async listScenarios(cityId: string): Promise<Scenario[]> {
    const { data, error } = await this.db.rpc("get_scenarios", { p_city: cityId });
    if (error) throw error;
    return data as Scenario[];
  }

  async rainSeries(scenarioId: string): Promise<RainPoint[]> {
    const { data, error } = await this.db
      .from("rain_series")
      .select("t_min, mm")
      .eq("scenario_id", scenarioId)
      .order("t_min");
    if (error) throw error;
    return (data ?? []).map((r) => ({ tMin: r.t_min as number, mm: r.mm as number }));
  }

  async buildings(cityId: string, scenarioId: string | null): Promise<FeatureCollection> {
    const { data, error } = await this.db.rpc("get_buildings", { p_city: cityId, p_scenario: scenarioId });
    if (error) throw error;
    return data as FeatureCollection;
  }

  async corridors(cityId: string): Promise<FeatureCollection> {
    const { data, error } = await this.db
      .from("corridors")
      .select("id, kind, tier, upstream_km2, buildings_at_risk, critical_count, geom")
      .eq("city_id", cityId);
    if (error) throw error;
    return {
      type: "FeatureCollection",
      features: (data ?? []).map((r) => ({
        type: "Feature",
        id: r.id as number,
        geometry: r.geom,
        properties: {
          id: r.id,
          kind: r.kind,
          tier: r.tier,
          upstreamKm2: r.upstream_km2,
          buildingsAtRisk: r.buildings_at_risk,
          criticalCount: r.critical_count,
        } satisfies CorridorProps,
      })),
    };
  }

  async waterBands(scenarioId: string, tFrom: number, tTo: number): Promise<FeatureCollection> {
    const { data, error } = await this.db.rpc("get_water_frames", {
      p_scenario: scenarioId,
      p_t_from: tFrom,
      p_t_to: tTo,
    });
    if (error) throw error;
    return data as FeatureCollection;
  }

  async gridFrames(scenarioId: string): Promise<GridFrameRef[]> {
    const { data, error } = await this.db.rpc("get_grid_frames", { p_scenario: scenarioId });
    if (error) throw error;
    return data as GridFrameRef[];
  }

  async loadGridFrame(scenarioId: string, tMin: number): Promise<GridFrame> {
    // Frames live in Postgres (bytea). PostgREST only serves raw bytes for functions that return an
    // "application/octet-stream" domain (it answers 406 otherwise), so we take the default JSON form:
    // a "\x…" hex string. gzip on the wire keeps it within ~15 % of the binary size.
    const res = await fetch(`${this.rest.url}/rest/v1/rpc/get_grid_frame`, {
      method: "POST",
      headers: { apikey: this.rest.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_scenario: scenarioId, p_t: tMin }),
    });
    if (!res.ok) throw new Error(`frame ${scenarioId}@${tMin}: HTTP ${res.status}`);
    const hex = (await res.json()) as string | null;
    if (!hex) throw new Error(`frame ${scenarioId}@${tMin}: missing`);
    return decodeFrame(hexToBytes(hex));
  }

  async summary(scenarioId: string): Promise<ScenarioSummary> {
    const { data, error } = await this.db.rpc("get_scenario_summary", { p_scenario: scenarioId });
    if (error) throw error;
    return data as ScenarioSummary;
  }
}

/** Decode PostgREST's JSON form of bytea ("\x0a1b…") into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const start = hex.startsWith("\\x") ? 2 : 0;
  const out = new Uint8Array((hex.length - start) >> 1);
  for (let i = 0, j = start; i < out.length; i++, j += 2) {
    const hi = hex.charCodeAt(j), lo = hex.charCodeAt(j + 1);
    out[i] = (((hi & 0xf) + (hi > 57 ? 9 : 0)) << 4) | ((lo & 0xf) + (lo > 57 ? 9 : 0));
  }
  return out;
}

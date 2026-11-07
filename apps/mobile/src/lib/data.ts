import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  HAND_THRESHOLDS,
  SupabaseFloodRepository,
  TIER_ORDER,
  type City,
  type Tier,
} from "@floodograph/core";

// Publishable key: designed to ship in clients, RLS keeps every table read-only for it.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://bzohunvpkzjidqzydwmr.supabase.co";
const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_qozDXBFBgLo-QAfTIcwa4w_8wkGawV5";

export const PILOT_CITY = "istanbul";

let client: SupabaseClient | null = null;
let repo: SupabaseFloodRepository | null = null;

function db(): SupabaseClient {
  // Read-only, no sign-in: skip session storage so no AsyncStorage native module is needed (Expo Go safe).
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

export function repository(): SupabaseFloodRepository {
  repo ??= new SupabaseFloodRepository(db(), { url: SUPABASE_URL, key: SUPABASE_KEY });
  return repo;
}

export type TierCounts = Record<Tier, number>;

export interface Overview {
  city: City;
  counts: TierCounts;
  total: number;
  /** Where the tiers come from: a simulated scenario's impacts, or the static HAND rule. */
  source: { kind: "scenario"; label: string } | { kind: "hand" };
}

const { acil: T1, yuksek: T2, orta: T3 } = HAND_THRESHOLDS;

/**
 * PostgREST filters equivalent to core's tierFromHand (critical facilities move up one tier,
 * a building without HAND counts as "izle"). Built from HAND_THRESHOLDS so it follows core.
 * Each tier is one HEAD request that returns only a count, instead of ~20k GeoJSON polygons.
 */
const HAND_TIER_FILTER: Record<Tier, string> = {
  acil: `hand_m.lte.${T1},and(hand_m.lte.${T2},critical.not.is.null)`,
  yuksek: `and(hand_m.gt.${T1},hand_m.lte.${T2},critical.is.null),and(hand_m.gt.${T2},hand_m.lte.${T3},critical.not.is.null)`,
  orta: `and(hand_m.gt.${T2},hand_m.lte.${T3},critical.is.null),and(or(hand_m.gt.${T3},hand_m.is.null),critical.not.is.null)`,
  izle: `and(or(hand_m.gt.${T3},hand_m.is.null),critical.is.null)`,
};

async function handTierCounts(cityId: string): Promise<TierCounts> {
  const counts = await Promise.all(
    TIER_ORDER.map(async (tier) => {
      const { count, error } = await db()
        .from("buildings")
        .select("id", { count: "exact", head: true })
        .eq("city_id", cityId)
        .or(HAND_TIER_FILTER[tier]);
      if (error) throw error;
      return [tier, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as TierCounts;
}

const sum = (c: TierCounts) => TIER_ORDER.reduce((n, t) => n + c[t], 0);

export async function loadOverview(): Promise<Overview> {
  const r = repository();
  const cities = await r.listCities();
  const city = cities.find((c) => c.id === PILOT_CITY) ?? cities[0];
  if (!city) throw new Error("Veritabanında şehir bulunamadı.");

  // Prefer the 14 October simulation once it is loaded; its summary RPC already counts tiers server-side.
  const scenarios = await r.listScenarios(city.id).catch(() => []);
  const historical = scenarios.find((s) => s.kind === "historical");
  if (historical) {
    try {
      const s = await r.summary(historical.id);
      const total = sum(s.tierCounts);
      if (total > 0) return { city, counts: s.tierCounts, total, source: { kind: "scenario", label: historical.label } };
    } catch {
      // fall through to the static HAND tiers
    }
  }

  const counts = await handTierCounts(city.id);
  return { city, counts, total: sum(counts), source: { kind: "hand" } };
}

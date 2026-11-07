import type { CriticalFacility, Tier } from "./types";

// Single source of truth for urgency tiers. pipeline/floodograph/core/tiers.py must match.
export const TIER_ORDER: readonly Tier[] = ["acil", "yuksek", "orta", "izle"];

/** Upper HAND bound (metres) for each tier; calibrated against the 14 Oct backtest. */
export const HAND_THRESHOLDS: Readonly<Record<Exclude<Tier, "izle">, number>> = {
  acil: 1,
  yuksek: 2,
  orta: 3,
};

export const TIER_LABEL: Readonly<Record<Tier, string>> = {
  acil: "Acil müdahale",
  yuksek: "Yüksek öncelik",
  orta: "Orta öncelik",
  izle: "İzle",
};

export function tierFromHand(handM: number, critical: CriticalFacility | null = null): Tier {
  let idx: number;
  if (handM <= HAND_THRESHOLDS.acil) idx = 0;
  else if (handM <= HAND_THRESHOLDS.yuksek) idx = 1;
  else if (handM <= HAND_THRESHOLDS.orta) idx = 2;
  else idx = 3;
  // A critical facility (hospital, school, fire station, care home) raises the tier by one.
  if (critical && idx > 0) idx -= 1;
  return TIER_ORDER[idx] ?? "izle";
}

import { TIER_ORDER, type Tier } from "@floodograph/core";

/** Tier colours. Differ in lightness too, not only hue, so they survive colour-blindness. */
export const TIER_COLOR: Readonly<Record<Tier, string>> = {
  acil: "#ff4a2b",
  yuksek: "#ff8f4f",
  orta: "#f4c27a",
  izle: "#3a464c",
};

/** Swatch shown in legends for "izle" (the map colour is darker so tiers pop). */
export const TIER_SWATCH: Readonly<Record<Tier, string>> = { ...TIER_COLOR, izle: "#5b666c" };

export const TIER_SHORT: Readonly<Record<Tier, string>> = {
  acil: "Acil",
  yuksek: "Yüksek",
  orta: "Orta",
  izle: "İzle",
};

export type CorridorKind = "derived" | "buried_osm" | "open";

export const CORRIDOR_STYLE: Readonly<Record<CorridorKind, { label: string; color: string; dash: number[] | null }>> = {
  derived: { label: "Hiçbir haritada yok", color: "#ff5a2b", dash: [1.2, 1.6] },
  buried_osm: { label: "OSM'de gömülü dere", color: "#6fa8c9", dash: [3, 2] },
  open: { label: "Açık dere", color: "#6fa8c9", dash: null },
};

export const CORRIDOR_ORDER: readonly CorridorKind[] = ["derived", "buried_osm", "open"];

export { TIER_ORDER };

"use client";

import { motion } from "motion/react";
import type { Scenario } from "@floodograph/core";
import { usePlayback } from "@/lib/playback-store";
import { RAIN_SOURCE_NOTE, clockAt, countAtMost, fmtDec, fmtInt } from "@/lib/scenario";
import { WATER_LEGEND } from "@/lib/water-frames";
import { AnimatedNumber } from "./animated-number";

const spring = { type: "spring", stiffness: 380, damping: 30 } as const;

/** Live counters driven by the playhead: wet buildings (fw <= t) and flooded area of the frame on screen. */
export function LiveCounters({
  fwSorted,
  hasFrames,
  compact = false,
}: {
  fwSorted: Float64Array | null;
  hasFrames: boolean;
  compact?: boolean;
}) {
  const wet = usePlayback((s) => (fwSorted ? countAtMost(fwSorted, s.t) : 0));
  const ha = usePlayback((s) => s.liveHa);
  // progress toward the final count, so the bar fills as the event unfolds
  const share = fwSorted?.length ? wet / fwSorted.length : 0;
  const big = compact ? "text-xl" : "text-[28px]";
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className={`relative overflow-hidden rounded-2xl bg-white/5 ${compact ? "px-3 py-2" : "p-3"}`}>
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-water"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: share }}
          transition={spring}
        />
        <div className="text-xs text-fg-3">Islanan bina</div>
        {fwSorted ? (
          <AnimatedNumber value={wet} className={`font-mono ${big} font-medium tracking-[-0.03em] text-fg`} />
        ) : (
          <span className="fg-shimmer mt-1.5 block h-6 w-16 rounded-md" />
        )}
      </div>
      <div className={`rounded-2xl bg-white/5 ${compact ? "px-3 py-2" : "p-3"}`}>
        <div className="text-xs text-fg-3">Su altında (&gt;15 cm)</div>
        {hasFrames ? (
          <span className={`font-mono ${big} font-medium tracking-[-0.03em]`}>
            <AnimatedNumber value={ha} digits={0} />
            <span className="ml-1 text-sm text-fg-3">ha</span>
          </span>
        ) : (
          <span className="mt-1.5 block text-sm text-fg-3">Su kareleri yok</span>
        )}
      </div>
    </div>
  );
}

export function WaterLegend() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-fg-3" aria-label="Su derinliği lejantı">
      <span>Su derinliği</span>
      <span
        aria-hidden="true"
        className="h-2 flex-1 rounded-full"
        style={{ background: `linear-gradient(90deg, ${WATER_LEGEND.map((s) => s.color).join(", ")})` }}
      />
      <span className="font-mono">
        {WATER_LEGEND[0]!.depth * 100} cm – {WATER_LEGEND.at(-1)!.depth} m+
      </span>
    </div>
  );
}

type Metric = { label: string; value: string; unit?: string; hint?: string; accent?: boolean };

/** Final scenario outcome (metrics written by the simulator). */
export function ImpactCard({ scenario }: { scenario: Scenario }) {
  const m = scenario.metrics ?? {};
  const has = (k: string) => typeof m[k] === "number" && Number.isFinite(m[k]);
  const items: Metric[] = [];
  if (has("buildings_wet"))
    items.push({
      label: "Islanan bina",
      value: fmtInt(m.buildings_wet!),
      hint: has("buildings_total") ? `${fmtInt(m.buildings_total!)} binadan` : undefined,
      accent: true,
    });
  if (has("buildings_over_0_5m")) items.push({ label: "0,5 m'yi aşan", value: fmtInt(m.buildings_over_0_5m!), unit: "bina" });
  if (has("max_flooded_ha")) items.push({ label: "En büyük su altı alanı", value: fmtInt(m.max_flooded_ha!), unit: "ha" });
  if (has("culverts_overflowed"))
    items.push({
      label: "Taşan menfez",
      value: fmtInt(m.culverts_overflowed!),
      hint: has("culverts") ? `${fmtInt(m.culverts!)} menfezden` : undefined,
    });
  if (has("first_overflow_min"))
    items.push({ label: "İlk taşma", value: clockAt(scenario.startTs, m.first_overflow_min!).time });
  if (has("peak_mm_h")) items.push({ label: "Zirve yağış", value: fmtDec(m.peak_mm_h!), unit: "mm/sa" });

  return (
    <section aria-label="Senaryo etkisi" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Selin bıraktığı iz</h2>
      {items.length ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
          {items.map((it, i) => (
            <motion.div
              key={it.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.03 * i }}
              className="flex flex-col gap-0.5"
            >
              <dt className="text-xs text-fg-3">{it.label}</dt>
              <dd className={`font-mono text-lg tabular-nums ${it.accent ? "text-[var(--water)]" : ""}`}>
                {it.value}
                {it.unit && <span className="ml-1 text-xs text-fg-3">{it.unit}</span>}
              </dd>
              {it.hint && <dd className="text-[11px] text-fg-3">{it.hint}</dd>}
            </motion.div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-fg-3">Bu senaryo için özet metrik yok.</p>
      )}
      <p className="text-[11px] leading-snug text-fg-3">{RAIN_SOURCE_NOTE}.</p>
    </section>
  );
}

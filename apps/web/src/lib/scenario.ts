import type { RainPoint, Scenario } from "@floodograph/core";

/** The historical event the demo replays. */
export const SCENARIO_ID = "istanbul-2026-10-14";
export const CITY_ID = "istanbul";

export const RAIN_SOURCE_NOTE = "Yağış: Open-Meteo zamansal deseni, Sarıyer ~150 mm istasyon toplamına ölçekli";

/** Building wet threshold used by the simulator (summary.params.wet_threshold_m). */
export const WET_THRESHOLD_M = 0.15;

const clockFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", weekday: "long" });
const shortDayFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short" });

const pad = (n: number) => String(n).padStart(2, "0");

/** "+hh:mm" from a minute offset; used when the scenario has no absolute start. */
export function offsetLabel(tMin: number): string {
  const m = Math.max(0, Math.floor(tMin));
  return `+${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export type Clock = { time: string; day: string; shortDay: string };

/** Wall-clock (Europe/Istanbul) for minute tMin of the scenario. */
export function clockAt(startTs: string | null | undefined, tMin: number): Clock {
  const start = startTs ? Date.parse(startTs) : NaN;
  if (Number.isNaN(start)) return { time: offsetLabel(tMin), day: "Senaryo saati", shortDay: "" };
  const d = new Date(start + Math.floor(tMin) * 60_000);
  return { time: clockFmt.format(d), day: dayFmt.format(d), shortDay: shortDayFmt.format(d) };
}

/** Number of values in an ascending array that are <= x (binary search). */
export function countAtMost(sorted: Float64Array | readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Where playback starts: an hour before the first meaningful rain, so the viewer sees the build-up. */
export function playbackStart(rain: readonly RainPoint[]): number {
  const first = rain.find((r) => r.mm >= 0.5);
  return first ? Math.max(0, first.tMin - 60) : 0;
}

export function scenarioEnd(scenario: Scenario, lastFrameMin: number | null): number {
  return Math.max(scenario.durationMin || 0, lastFrameMin ?? 0);
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("tr-TR");
export const fmtDec = (n: number, digits = 1) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

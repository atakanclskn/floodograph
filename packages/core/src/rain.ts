import type { RainPoint } from "./types";

/** Strategy: anything that can produce a rainfall series for a point. */
export interface RainSource {
  readonly id: string;
  series(lat: number, lon: number): Promise<RainPoint[]>;
}

const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Live forecast for the next 24 h from Open-Meteo (free, no key). 15-min where the model offers it. */
export class LiveRain implements RainSource {
  readonly id = "open-meteo-live";
  constructor(private readonly hours = 24) {}

  async series(lat: number, lon: number): Promise<RainPoint[]> {
    const url =
      `${OPEN_METEO_FORECAST}?latitude=${lat}&longitude=${lon}` +
      `&hourly=precipitation&forecast_hours=${this.hours}&timezone=Europe%2FIstanbul`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
    const json = (await res.json()) as { hourly?: { precipitation?: (number | null)[] } };
    const p = json.hourly?.precipitation ?? [];
    return p.map((mm, i) => ({ tMin: i * 60, mm: mm ?? 0 }));
  }
}

export function totalMm(series: RainPoint[]): number {
  return series.reduce((s, r) => s + r.mm, 0);
}

/** Pick the precomputed design-storm scenario whose total is closest to a live total. */
export function nearestDesignTotal(live: number, ladder: readonly number[]): number {
  return ladder.reduce((best, x) => (Math.abs(x - live) < Math.abs(best - live) ? x : best), ladder[0] ?? live);
}

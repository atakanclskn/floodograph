"use client";

import { memo, useMemo } from "react";
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { RainPoint } from "@floodograph/core";
import { usePlayback } from "@/lib/playback-store";
import { clockAt, fmtDec } from "@/lib/scenario";

const PAST = "#6fa8c9"; // --water
const NOW = "#e9eef0"; // --fg
const FUTURE = "rgb(233 238 240 / 0.16)";

type Row = { i: number; tMin: number; mm: number };

function RainTooltip({ active, payload, startTs }: { active?: boolean; payload?: { payload: Row }[]; startTs: string | null }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const a = clockAt(startTs, row.tMin).time;
  const b = clockAt(startTs, row.tMin + 60).time;
  return (
    <div className="glass rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-fg-3">
        {a}–{b}
      </div>
      <div className="font-mono text-sm text-fg tabular-nums">{fmtDec(row.mm)} mm</div>
    </div>
  );
}

/** Bars re-render only when the playhead enters a new hour; the cursor line is a cheap overlay. */
const Bars = memo(function Bars({
  rows,
  hour,
  startTs,
  onSeek,
}: {
  rows: Row[];
  hour: number;
  startTs: string | null;
  onSeek: (t: number) => void;
}) {
  return (
    <BarChart
      responsive
      style={{ width: "100%", height: 88 }}
      data={rows}
      margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
      barCategoryGap={2}
      accessibilityLayer={false}
    >
      <XAxis dataKey="i" hide />
      <YAxis hide domain={[0, "dataMax"]} />
      <Tooltip
        cursor={{ fill: "rgb(233 238 240 / 0.06)" }}
        content={(p) => <RainTooltip active={p.active} payload={p.payload as unknown as { payload: Row }[]} startTs={startTs} />}
        isAnimationActive={false}
      />
      <Bar
        dataKey="mm"
        radius={[3, 3, 0, 0]}
        minPointSize={1}
        isAnimationActive
        animationDuration={500}
        onClick={(d) => onSeek((d.payload as Row).tMin)}
        className="cursor-pointer"
      >
        {rows.map((r) => (
          <Cell key={r.i} fill={r.i < hour ? PAST : r.i === hour ? NOW : FUTURE} />
        ))}
      </Bar>
    </BarChart>
  );
});

function Cursor({ spanMin }: { spanMin: number }) {
  const t = usePlayback((s) => s.t);
  const p = spanMin > 0 ? Math.min(100, (t / spanMin) * 100) : 0;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px bg-fg/80 shadow-[0_0_8px_rgb(233_238_240/0.6)]"
      style={{ left: `${p}%` }}
    />
  );
}

/** Hourly rainfall (mm) with the playback cursor; total and peak in the header. */
export function RainChart({ rain, startTs }: { rain: RainPoint[]; startTs: string | null }) {
  const rows = useMemo(() => rain.map((r, i) => ({ i, tMin: r.tMin, mm: r.mm })), [rain]);
  const hour = usePlayback((s) => Math.floor(s.t / 60));
  const seek = usePlayback((s) => s.seek);
  const total = rain.reduce((s, r) => s + r.mm, 0);
  const peak = rows.reduce((best, r) => (r.mm > best.mm ? r : best), rows[0] ?? { i: 0, tMin: 0, mm: 0 });
  const spanMin = rows.length * 60;
  const ticks = useMemo(() => {
    const out: { p: number; label: string }[] = [];
    for (let m = 0; m <= spanMin; m += 360) out.push({ p: (m / spanMin) * 100, label: clockAt(startTs, m).time });
    return out;
  }, [spanMin, startTs]);

  if (!rows.length) return <p className="text-sm text-fg-3">Yağış serisi bulunamadı.</p>;

  return (
    <figure className="flex flex-col gap-2" aria-label="Saatlik yağış">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="shrink-0 text-sm font-medium">Saatlik yağış</span>
        <span className="font-mono text-xs text-fg-3 tabular-nums">
          toplam <span className="text-fg">{fmtDec(total, 0)} mm</span> · zirve{" "}
          <span className="text-fg">{fmtDec(peak.mm)} mm/sa</span> ({clockAt(startTs, peak.tMin).time})
        </span>
      </figcaption>
      <div className="relative">
        <Bars rows={rows} hour={hour} startTs={startTs} onSeek={seek} />
        <Cursor spanMin={spanMin} />
      </div>
      <div className="relative h-3 font-mono text-[10px] text-fg-3" aria-hidden="true">
        {ticks.map((tk, i) => (
          <span
            key={tk.p}
            className="absolute top-0"
            style={{ left: `${tk.p}%`, transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {tk.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Saatlik yağış (mm)</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.i}>
              <th scope="row">{clockAt(startTs, r.tMin).time}</th>
              <td>{fmtDec(r.mm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

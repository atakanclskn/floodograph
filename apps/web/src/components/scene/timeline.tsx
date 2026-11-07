"use client";

import { motion } from "motion/react";
import { useId, useMemo, useRef, useState } from "react";
import type { EngineState } from "./engine";

const W = 600;
const H = 40;

/** Scrubber over the deepest-water curve of the event; marks the tour's start and the peak. */
export function Timeline({ state, onSeek }: { state: EngineState; onSeek: (t: number) => void }) {
  const { series, t0, t1, t, tourMarks } = state;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const clip = useId();
  const span = Math.max(t1 - t0, 1);
  const x = (tt: number) => ((tt - t0) / span) * W;

  const { area, line } = useMemo(() => {
    const max = Math.max(0.5, ...series.map((p) => p.d));
    const pts = series.map((p) => [x(p.t), H - 3 - (Math.sqrt(p.d / max) * (H - 8))] as const);
    if (!pts.length) return { area: "", line: "" };
    const l = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
    return { line: l, area: `${l}L${W},${H}L0,${H}Z` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, t0, t1]);

  const ticks = useMemo(() => {
    const out: { t: number; label: string }[] = [];
    // 06:00 + t; label every 6 h
    for (let m = Math.ceil((t0 + 360) / 360) * 360; m - 360 <= t1; m += 360) {
      const hh = (m / 60) % 24;
      out.push({ t: m - 360, label: `${String(hh).padStart(2, "0")}:00` });
    }
    return out;
  }, [t0, t1]);

  const seekAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const k = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    onSeek(t0 + k * span);
  };
  const pct = ((t - t0) / span) * 100;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Zaman çizelgesi"
      aria-valuemin={t0}
      aria-valuemax={t1}
      aria-valuenow={Math.round(t)}
      aria-valuetext={`${Math.round(t)}. dakika`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setDrag(true);
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => drag && seekAt(e.clientX)}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(t + (e.shiftKey ? 30 : 5));
        else if (e.key === "ArrowLeft") onSeek(t - (e.shiftKey ? 30 : 5));
        else if (e.key === "Home") onSeek(t0);
        else if (e.key === "End") onSeek(t1);
        else return;
        e.preventDefault();
      }}
      className="group relative h-[52px] w-full cursor-pointer touch-none select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-water/60"
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-10 w-full overflow-visible" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width={(pct / 100) * W} height={H} />
          </clipPath>
          <linearGradient id={`${clip}-g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--water)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--water)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d={area} fill="rgb(233 238 240 / 0.05)" />
        <path d={line} fill="none" stroke="rgb(233 238 240 / 0.18)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <g clipPath={`url(#${clip})`}>
          <path d={area} fill={`url(#${clip}-g)`} />
          <path d={line} fill="none" stroke="var(--water)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </g>
        {ticks.map((k) => (
          <line key={k.t} x1={x(k.t)} x2={x(k.t)} y1={H - 4} y2={H} stroke="rgb(233 238 240 / 0.25)" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {ticks.map((k) => (
        <span
          key={k.t}
          className="pointer-events-none absolute bottom-0 -translate-x-1/2 font-mono text-[10px] tabular-nums text-fg-3"
          style={{ left: `${((k.t - t0) / span) * 100}%` }}
        >
          {k.label}
        </span>
      ))}
      {tourMarks[1] != null && (
        <span
          className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${((tourMarks[1] - t0) / span) * 100}%` }}
          title="En derin su"
        >
          <span className="size-1.5 rounded-full bg-ember shadow-[0_0_8px_2px_rgb(255_90_43/0.6)]" />
        </span>
      )}
      <motion.div
        className="pointer-events-none absolute top-0 h-10 w-px bg-fg"
        style={{ left: `${pct}%` }}
        animate={{ opacity: 1 }}
      >
        <motion.span
          className="absolute -left-[5px] top-[34px] size-[11px] rounded-full bg-fg shadow-[0_0_0_4px_rgb(233_238_240/0.12)]"
          animate={{ scale: drag ? 1.35 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
        />
      </motion.div>
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import { BASE_MIN_PER_SEC, SPEEDS, usePlayback } from "@/lib/playback-store";
import { clockAt } from "@/lib/scenario";

const spring = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 } as const;

export type TimelineMarker = { tMin: number; label: string };

function PlayButton({ disabled }: { disabled: boolean }) {
  const playing = usePlayback((s) => s.playing);
  const toggle = usePlayback((s) => s.toggle);
  return (
    <motion.button
      type="button"
      onClick={toggle}
      disabled={disabled}
      whileTap={{ scale: 0.9 }}
      transition={spring}
      aria-label={playing ? "Duraklat" : "Oynat"}
      aria-keyshortcuts="Space"
      className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-fg text-ink shadow-[0_6px_24px_-6px_rgb(111_168_201/0.6)] transition-[background-color,opacity] duration-150 hover:bg-white disabled:opacity-40"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {playing ? (
          <motion.svg
            key="pause"
            initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
            transition={spring}
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <rect x="3.5" y="2.5" width="4" height="13" rx="1.4" fill="currentColor" />
            <rect x="10.5" y="2.5" width="4" height="13" rx="1.4" fill="currentColor" />
          </motion.svg>
        ) : (
          <motion.svg
            key="play"
            initial={{ opacity: 0, scale: 0.6, rotate: 30 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, rotate: -30 }}
            transition={spring}
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <path d="M5 3.2v11.6a1 1 0 0 0 1.52.85l9.3-5.8a1 1 0 0 0 0-1.7l-9.3-5.8A1 1 0 0 0 5 3.2Z" fill="currentColor" />
          </motion.svg>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function ClockReadout({ startTs }: { startTs: string | null }) {
  const t = usePlayback((s) => s.t);
  const c = clockAt(startTs, t);
  return (
    <div className="flex min-w-[84px] flex-col leading-none" aria-live="off">
      <span className="font-mono text-[26px] font-medium tracking-[-0.03em] tabular-nums">{c.time}</span>
      <span className="mt-1 truncate text-[11px] text-fg-3">{c.day}</span>
    </div>
  );
}

function SpeedPicker({ disabled }: { disabled: boolean }) {
  const speed = usePlayback((s) => s.speed);
  const setSpeed = usePlayback((s) => s.setSpeed);
  return (
    <div role="radiogroup" aria-label="Oynatma hızı" className="flex shrink-0 rounded-xl bg-white/6 p-0.5">
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={speed === s}
          disabled={disabled}
          title={`Saniyede ${BASE_MIN_PER_SEC * s} dakika`}
          onClick={() => setSpeed(s)}
          className="relative min-h-9 min-w-9 rounded-[10px] px-1.5 font-mono text-xs text-fg-3 transition-colors duration-150 hover:text-fg aria-checked:text-fg disabled:opacity-40"
        >
          {speed === s && (
            <motion.span
              layoutId="speed-pill"
              className="absolute inset-0 rounded-[10px] bg-white/14"
              transition={spring}
              aria-hidden="true"
            />
          )}
          <span className="relative">{s}×</span>
        </button>
      ))}
    </div>
  );
}

function Scrubber({ startTs, markers, disabled }: { startTs: string | null; markers: TimelineMarker[]; disabled: boolean }) {
  const t = usePlayback((s) => s.t);
  const tEnd = usePlayback((s) => s.tEnd);
  const seek = usePlayback((s) => s.seek);
  const setPlaying = usePlayback((s) => s.setPlaying);
  const p = tEnd > 0 ? (t / tEnd) * 100 : 0;
  const c = clockAt(startTs, t);
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <input
        type="range"
        min={0}
        max={Math.max(1, tEnd)}
        step={5}
        value={Math.round(t)}
        disabled={disabled}
        onPointerDown={() => setPlaying(false)}
        onChange={(e) => seek(Number(e.currentTarget.value))}
        aria-label="Zaman"
        aria-valuetext={`${c.shortDay} ${c.time}`.trim()}
        className="fg-range w-full"
        style={{ "--p": `${p}%` } as React.CSSProperties}
      />
      {tEnd > 0 &&
        markers.map((m) => (
          <span
            key={m.label}
            className="group pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(m.tMin / tEnd) * 100}%` }}
          >
            <span className="block h-3.5 w-0.5 rounded-full bg-ember" aria-hidden="true" />
            <span className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink/80 px-1.5 py-0.5 text-[10px] text-fg-2">
              {m.label}
            </span>
          </span>
        ))}
    </div>
  );
}

/** Play/pause, clock, scrubber, speed. `compact` stacks it for the mobile sheet. */
export function Timeline({
  startTs,
  markers,
  disabled = false,
  compact = false,
}: {
  startTs: string | null;
  markers: TimelineMarker[];
  disabled?: boolean;
  compact?: boolean;
}) {
  if (compact)
    return (
      <div className="flex flex-col gap-3" role="group" aria-label="Zaman çizelgesi">
        <div className="flex items-center gap-3">
          <PlayButton disabled={disabled} />
          <ClockReadout startTs={startTs} />
          <div className="ml-auto">
            <SpeedPicker disabled={disabled} />
          </div>
        </div>
        <div className="px-1 pt-3">
          <Scrubber startTs={startTs} markers={markers} disabled={disabled} />
        </div>
      </div>
    );
  return (
    <div className="flex items-center gap-4" role="group" aria-label="Zaman çizelgesi">
      <PlayButton disabled={disabled} />
      <ClockReadout startTs={startTs} />
      <div className="flex min-w-0 flex-1 pt-3">
        <Scrubber startTs={startTs} markers={markers} disabled={disabled} />
      </div>
      <SpeedPicker disabled={disabled} />
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "motion/react";
import type { MapPhase } from "./flood-map";

const STEPS: { phase: Exclude<MapPhase, "error" | "booting">; label: string }[] = [
  { phase: "basemap", label: "Altlık harita ve izohipsler" },
  { phase: "ready", label: "19.763 bina ve akış koridorları" },
];
const ORDER: MapPhase[] = ["booting", "basemap", "ready"];

/**
 * First-load state: a quiet topographic skeleton under the map (so the screen is never blank) and a
 * step list that ticks off as the basemap and the ~1 MB building layer arrive.
 */
export function MapLoading({ phase }: { phase: MapPhase }) {
  const done = phase === "ready" || phase === "error";
  const at = ORDER.indexOf(phase);
  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          key="loading"
          className="pointer-events-none absolute inset-0 z-[1]"
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] } }}
        >
          {/* skeleton terrain: fades away once the basemap paints */}
          <motion.div
            aria-hidden="true"
            className="fg-skeleton-terrain absolute inset-0"
            animate={{ opacity: phase === "booting" ? 1 : 0 }}
            transition={{ duration: 0.4 }}
          />
          <div className="absolute inset-x-0 top-[38%] flex justify-center px-6 sm:top-1/2 sm:pl-[380px]">
            <div
              role="status"
              aria-live="polite"
              className="glass fg-rise flex w-full max-w-[300px] flex-col gap-3 rounded-2xl p-4"
            >
              <div className="flex items-center gap-2.5">
                <span className="fg-spinner" aria-hidden="true" />
                <span className="text-sm font-medium">Ayazağa hazırlanıyor</span>
              </div>
              <ol className="flex flex-col gap-1.5">
                {STEPS.map((s) => {
                  const ok = ORDER.indexOf(s.phase) <= at;
                  return (
                    <li key={s.phase} className="flex items-center gap-2 text-[13px]">
                      <span
                        aria-hidden="true"
                        className={`inline-flex size-4 items-center justify-center rounded-full border transition-colors duration-200 ${
                          ok ? "border-water bg-water text-ink" : "border-line"
                        }`}
                      >
                        {ok && (
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 5.2l2 2L8 3" />
                          </svg>
                        )}
                      </span>
                      <span className={ok ? "text-fg-2" : "text-fg-3"}>{s.label}</span>
                      <span className="sr-only">{ok ? "hazır" : "yükleniyor"}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="fg-indeterminate h-0.5 overflow-hidden rounded-full bg-white/8" aria-hidden="true" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

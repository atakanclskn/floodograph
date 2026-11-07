"use client";

import { useEffect } from "react";
import { BASE_MIN_PER_SEC, usePlayback } from "@/lib/playback-store";

/** Advances the clock while playing (rAF) and wires keyboard control: space, arrows, Home/End. */
export function usePlaybackLoop(enabled: boolean): void {
  const playing = usePlayback((s) => s.playing);

  useEffect(() => {
    if (!enabled || !playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.5, (now - last) / 1000); // a throttled tab must not jump hours ahead
      last = now;
      const s = usePlayback.getState();
      const next = s.t + dt * BASE_MIN_PER_SEC * s.speed;
      if (next >= s.tEnd) {
        usePlayback.setState({ t: s.tEnd, playing: false });
        return;
      }
      usePlayback.setState({ t: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, playing]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const isInput = tag === "INPUT";
      const s = usePlayback.getState();
      switch (e.key) {
        case " ":
        case "k":
          // a focused button or the slider already reacts to space on its own
          if (tag === "BUTTON" || isInput) return;
          e.preventDefault();
          s.toggle();
          break;
        case "ArrowRight":
        case "ArrowLeft":
          // the range input steps itself; a focused map pans with arrows
          if (isInput || el?.closest(".maplibregl-map")) return;
          e.preventDefault();
          s.step((e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 60 : 5));
          break;
        case "Home":
          if (isInput) return;
          e.preventDefault();
          s.seek(s.tStart);
          break;
        case "End":
          if (isInput) return;
          e.preventDefault();
          s.seek(s.tEnd);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

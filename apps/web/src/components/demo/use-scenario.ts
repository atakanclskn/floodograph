"use client";

import { useCallback, useEffect, useState } from "react";
import type { RainPoint, Scenario } from "@floodograph/core";
import { floodRepository } from "@/lib/repository";
import { CITY_ID, SCENARIO_ID, playbackStart, scenarioEnd } from "@/lib/scenario";
import { FrameStore } from "@/lib/water-frames";
import { usePlayback } from "@/lib/playback-store";

const RECHECK_MS = 60_000;

export type ScenarioData = {
  scenario: Scenario;
  rain: RainPoint[];
  frames: FrameStore | null;
  tEnd: number;
  tStart: number;
};

export type ScenarioState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & ScenarioData);

/** Loads the 14 Oct scenario (metadata, hourly rain, frame index). Frames themselves stream on demand. */
export function useScenario(): { state: ScenarioState; retry: () => void } {
  const [state, setState] = useState<ScenarioState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let frames: FrameStore | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const repo = floodRepository();
        const list = await repo.listScenarios(CITY_ID);
        const scenario = list.find((s) => s.id === SCENARIO_ID);
        if (!scenario) {
          if (cancelled) return;
          setState({ status: "missing" });
          // the scenario may be mid-upload: look again in a minute without flashing a loader
          retryTimer = setTimeout(() => setAttempt((a) => a + 1), RECHECK_MS);
          return;
        }
        const [rain, refs] = await Promise.all([
          repo.rainSeries(scenario.id),
          repo.gridFrames(scenario.id).catch(() => []),
        ]);
        if (cancelled) return;
        frames = scenario.grid && refs.length ? new FrameStore(repo, scenario.id, refs, scenario.grid) : null;
        const tEnd = scenarioEnd(scenario, frames?.times.at(-1) ?? null);
        const tStart = playbackStart(rain);
        usePlayback.getState().setRange(tEnd, tStart);
        setState({ status: "ready", scenario, rain, frames, tEnd, tStart });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : "Senaryo yüklenemedi" });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      frames?.dispose();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  return { state, retry };
}

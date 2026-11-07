import { create } from "zustand";

/** Simulated minutes per real second at 1x. */
export const BASE_MIN_PER_SEC = 15;
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export type DemoMode = "static" | "scenario";

type PlaybackState = {
  mode: DemoMode;
  /** current scenario minute (fractional while playing) */
  t: number;
  tEnd: number;
  /** where playback starts and restarts (an hour before the rain) */
  tStart: number;
  playing: boolean;
  speed: Speed;
  /** live flooded area (ha, depth > AREA_THRESHOLD_M) of the frame on screen */
  liveHa: number;
  setMode: (m: DemoMode) => void;
  setRange: (tEnd: number, tStart: number) => void;
  seek: (t: number) => void;
  step: (dMin: number) => void;
  setPlaying: (p: boolean) => void;
  toggle: () => void;
  setSpeed: (s: Speed) => void;
  setLiveHa: (ha: number) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Playback clock lives outside React: the map and canvas subscribe without re-rendering the page,
 * and only the widgets that show the time re-render.
 */
export const usePlayback = create<PlaybackState>()((set, get) => ({
  mode: "static",
  t: 0,
  tEnd: 0,
  tStart: 0,
  playing: false,
  speed: 2,
  liveHa: 0,
  setMode: (mode) => set({ mode, playing: false }),
  setRange: (tEnd, tStart) => set({ tEnd, tStart: clamp(tStart, 0, tEnd), t: clamp(tStart, 0, tEnd) }),
  seek: (t) => set({ t: clamp(t, 0, get().tEnd) }),
  step: (d) => {
    const { t, tEnd } = get();
    // snap to the 5-minute frame grid so arrow keys land on real frames
    const next = d > 0 ? Math.floor(t / 5) * 5 + d : Math.ceil(t / 5) * 5 + d;
    set({ t: clamp(next, 0, tEnd), playing: false });
  },
  setPlaying: (playing) => {
    const { t, tEnd } = get();
    if (tEnd <= 0) return;
    // pressing play at the end restarts from the start of the storm
    set(playing && t >= tEnd ? { playing, t: get().tStart } : { playing });
  },
  toggle: () => get().setPlaying(!get().playing),
  setSpeed: (speed) => set({ speed }),
  setLiveHa: (liveHa) => set({ liveHa: Math.round(liveHa * 10) / 10 }),
}));

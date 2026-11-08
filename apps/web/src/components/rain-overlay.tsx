"use client";

import { useEffect, useRef } from "react";

/** Camera pitch (degrees from straight down) of the map under the rain; maps report it with trackPitch(). */
let viewPitch = 50;
/** Map zoom: far out (looking at the region from high up) there is no rain on the screen, only the clouds. */
let viewZoom = 15;
/** Keep the rain's perspective in step with a map's camera (call once per map). */
export function trackPitch(map: { getPitch(): number; getZoom(): number; on(ev: "move", fn: () => void): unknown }) {
  viewPitch = map.getPitch();
  viewZoom = map.getZoom();
  map.on("move", () => {
    viewPitch = map.getPitch();
    viewZoom = map.getZoom();
  });
}

/**
 * Rain over a map, in the camera's perspective. Drops fall along vertical lines, and vertical lines meet at the
 * nadir's vanishing point: straight below the screen centre, at f / tan(pitch). So looking straight down the
 * streaks point into the centre (the drops fall away from you), and towards the horizon they turn into near-
 * parallel falling lines. Each drop lives a fraction of a second and fades in and out where it is, so the screen
 * fills evenly without a curtain sweeping down it. Kept sparse and soft: it should read as weather, not flicker.
 * `intensity()` is read every frame (0 = dry, 1 = cloudburst). Off for prefers-reduced-motion. Decorative.
 */
export function RainOverlay({ intensity }: { intensity: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const read = useRef(intensity);
  useEffect(() => {
    read.current = intensity;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const lite = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    const MAX = lite ? 220 : 520;
    // x, y: screen fraction; z: depth (near drops longer, brighter); life: 0..1; span: lifetime in s
    const drops = Array.from({ length: MAX }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() ** 1.8, life: Math.random(), span: 0.35 + Math.random() * 0.35 }));
    let raf = 0;
    let last = performance.now();
    let level = 0;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    size();
    window.addEventListener("resize", size);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      // below zoom ~9 you are above the storm (see StormCloudsLayer): no rain on the lens
      const above = Math.min(Math.max((viewZoom - 9.0) / 1.6, 0), 1);
      const target = Math.min(Math.max(read.current() || 0, 0), 1) * above * above * (3 - 2 * above);
      level += (target - level) * Math.min(1, dt * 2.5);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const n = Math.round(MAX * level);
      if (n === 0) return;
      // vanishing point of vertical lines (MapLibre's vertical field of view is ~36.9 deg: f = 1.5 h)
      const p = (Math.min(Math.max(viewPitch, 0), 85) * Math.PI) / 180;
      const vx = w / 2;
      const vy = h / 2 + (1.5 * h) / Math.max(Math.tan(p), 1e-3);
      const reach = Math.hypot(w, h);
      ctx.lineCap = "round";
      const thin = Math.max(0.7, w / 2600);
      for (let i = 0; i < n; i++) {
        const d = drops[i]!;
        d.life += dt / d.span;
        if (d.life >= 1) {
          d.life = 0;
          d.x = Math.random();
          d.y = Math.random();
          d.z = Math.random() ** 1.8;
        }
        const x = d.x * w;
        const y = d.y * h;
        const dx = vx - x;
        const dy = vy - y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        // perspective: streaks shrink toward the vanishing point (far below you when looking down)
        const persp = Math.min(1, 0.25 + dist / reach);
        const len = h * (0.018 + 0.05 * d.z) * persp * (0.7 + 0.3 * level);
        // the drop slides along its line while it lives
        const travel = len * 2.2 * d.life;
        const sx = x + ux * travel;
        const sy = y + uy * travel;
        const fade = Math.sin(Math.PI * d.life);
        const alpha = (0.05 + 0.22 * d.z) * fade * (0.5 + 0.5 * level);
        ctx.lineWidth = thin * (0.6 + 0.8 * d.z);
        ctx.strokeStyle = `rgba(190, 212, 232, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + ux * len, sy + uy * len);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] h-full w-full" />;
}

/** mm in the hour around minute t of an hourly rain series -> overlay intensity (30 mm/h = full cloudburst). */
export function rainIntensityAt(rain: readonly { tMin: number; mm: number }[], t: number, stepMin = 60): number {
  if (!rain.length) return 0;
  let mm = 0;
  for (const r of rain) {
    if (t >= r.tMin && t < r.tMin + stepMin) {
      mm = r.mm;
      break;
    }
  }
  return Math.min(1, mm / 30);
}

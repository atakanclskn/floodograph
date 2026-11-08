"use client";

import { useEffect, useRef } from "react";

/**
 * Screen-space rain over any map: thin slanted streaks on a canvas, drawn every frame.
 * `intensity()` is read each frame (0 = dry, 1 = cloudburst), so callers can tie it to the playhead or a slider
 * without re-rendering React. Off for prefers-reduced-motion. Decorative (aria-hidden), never blocks input.
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
    const MAX = lite ? 260 : 700;
    const drops = Array.from({ length: MAX }, () => ({ x: Math.random(), y: Math.random(), l: 0.5 + Math.random(), v: 0.75 + Math.random() * 0.5, a: 0.25 + Math.random() * 0.6 }));
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
      // ease toward the target so rain swells and fades instead of switching
      const target = Math.min(Math.max(read.current() || 0, 0), 1);
      level += (target - level) * Math.min(1, dt * 2.5);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const n = Math.round(MAX * level);
      if (n === 0) return;
      const len = h * (0.025 + 0.035 * level);
      const slant = 0.18;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, w / 1400);
      for (let i = 0; i < n; i++) {
        const d = drops[i]!;
        d.y += dt * d.v * (1.6 + 1.4 * level);
        d.x += dt * d.v * slant * 0.6;
        if (d.y > 1.05) {
          d.y = -0.05;
          d.x = Math.random() * 1.1 - 0.05;
        }
        if (d.x > 1.05) d.x -= 1.1;
        const x = d.x * w;
        const y = d.y * h;
        const l = len * d.l;
        ctx.strokeStyle = `rgba(190, 215, 235, ${(d.a * (0.35 + 0.5 * level)).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + l * slant, y + l);
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

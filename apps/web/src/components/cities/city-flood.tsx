"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap, StyleSpecification } from "maplibre-gl";
import type { RainPoint, Scenario } from "@floodograph/core";
import { sceneStyle } from "@/components/scene/scene-style";
import { Water3DLayer } from "@/components/demo/water-3d";
import { floodRepository } from "@/lib/repository";
import { clockAt, fmtInt, playbackStart } from "@/lib/scenario";
import { FrameStore } from "@/lib/water-frames";

const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";
/** Simulation minutes per real second at x1. */
const RATE = 20;

type City = { id: string; name: string; sub: string; center: [number, number]; zoom: number };
const CITIES: City[] = [
  { id: "istanbul-kent", name: "İstanbul", sub: "14 Ekim'de yaşanan yağış", center: [28.98, 41.06], zoom: 10.4 },
  { id: "izmir-kent", name: "İzmir", sub: "Aynı yağış İzmir'e düşseydi", center: [27.14, 38.43], zoom: 11.2 },
  { id: "ankara-kent", name: "Ankara", sub: "Aynı yağış Ankara'ya düşseydi", center: [32.82, 39.93], zoom: 11.1 },
];

type Loaded = { scenario: Scenario; rain: RainPoint[]; frames: FrameStore };

/** Flat night base (no 3D terrain: the water sits on z = 0) with every OSM building extruded. */
function cityStyle(): StyleSpecification {
  const s = sceneStyle();
  delete (s as { terrain?: unknown }).terrain;
  return s;
}

export function CityFlood() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const waterRef = useRef<Water3DLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [cityIdx, setCityIdx] = useState(0);
  const [data, setData] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [wetHa, setWetHa] = useState(0);
  const tRef = useRef(0);
  const city = CITIES[cityIdx]!;

  // map
  useEffect(() => {
    let map: MlMap | null = null;
    let disposed = false;
    (async () => {
      const { Map, AttributionControl, NavigationControl, setWorkerUrl } = await import("maplibre-gl");
      if (disposed || !container.current) return;
      setWorkerUrl(WORKER_URL);
      map = new Map({
        container: container.current,
        style: cityStyle(),
        center: CITIES[0]!.center,
        zoom: CITIES[0]!.zoom,
        pitch: 55,
        bearing: -20,
        maxPitch: 75,
        attributionControl: false,
      });
      mapRef.current = map;
      (window as unknown as { __cityMap?: MlMap }).__cityMap = map;
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
      map.on("load", () => setMapReady(true));
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // scenario of the selected city
  useEffect(() => {
    let cancelled = false;
    let frames: FrameStore | null = null;
    (async () => {
      setStatus("loading");
      setData(null);
      try {
        const repo = floodRepository();
        const list = await repo.listScenarios(city.id);
        const scenario = list.find((s) => s.id === `${city.id}-2026-10-14`);
        if (!scenario?.grid) {
          if (!cancelled) setStatus("missing");
          return;
        }
        const [rain, refs] = await Promise.all([repo.rainSeries(scenario.id), repo.gridFrames(scenario.id)]);
        if (cancelled) return;
        frames = new FrameStore(repo, scenario.id, refs, scenario.grid);
        const start = playbackStart(rain);
        tRef.current = start;
        setT(start);
        setData({ scenario, rain, frames });
        setStatus("ready");
        setPlaying(true);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      frames?.dispose();
    };
  }, [city.id]);

  // fly to the city
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.flyTo({ center: city.center, zoom: city.zoom, pitch: 55, bearing: -20, duration: 2600, essential: true });
  }, [mapReady, city]);

  // water layer for the loaded scenario
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !data) return;
    if (map.getLayer("flood-water")) map.removeLayer("flood-water");
    const water = new Water3DLayer(data.scenario.grid!, "flood-water", false, 1);
    map.addLayer(water, "basemap-buildings");
    waterRef.current = water;
    return () => {
      if (map.getLayer("flood-water")) map.removeLayer("flood-water");
      waterRef.current = null;
    };
  }, [mapReady, data]);

  // draw the frame pair around t
  const draw = useCallback(
    (tt: number) => {
      const water = waterRef.current;
      if (!water || !data) return;
      const fs = data.frames;
      fs.want(tt, 6, 1);
      const br = fs.bracket(tt);
      if (!br) return;
      let a = fs.get(br.a);
      let b = fs.get(br.b);
      let alpha = br.alpha;
      if (!a) {
        a = fs.nearestLoaded(tt);
        b = a;
        alpha = 0;
      } else if (!b) {
        b = a;
        alpha = 0;
      }
      if (!a || !b) return;
      water.setFrames(a, b, alpha);
      const cellHa = (data.scenario.grid!.res_m ** 2) / 1e4;
      let wet = 0;
      for (let i = 0, n = a.depth.length; i < n; i++) if (a.depth[i]! * (1 - alpha) + b.depth[i]! * alpha > 0.1) wet++;
      setWetHa(wet * cellHa);
    },
    [data],
  );

  useEffect(() => {
    if (!data) return;
    return data.frames.onLoad(() => draw(tRef.current));
  }, [data, draw]);

  // playback loop
  useEffect(() => {
    if (!data) return;
    const end = data.frames.times.at(-1) ?? data.scenario.durationMin;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (playing) {
        const nt = Math.min(tRef.current + dt * RATE, end);
        tRef.current = nt;
        if (nt >= end) setPlaying(false);
      }
      acc += dt;
      if (acc > 0.12) {
        acc = 0;
        setT(tRef.current);
        draw(tRef.current);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data, playing, draw]);

  const m = data?.scenario.metrics ?? {};
  const end = data?.frames.times.at(-1) ?? 1800;
  const clock = clockAt(data?.scenario.startTs, t);

  return (
    <div className="fixed inset-0 bg-ink">
      {/* maplibre-gl.css forces the map container to position:relative, so size it from a wrapper */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label={`${city.name} sel haritası`} />
      </div>

      <header className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
        <div className="glass pointer-events-auto flex items-center gap-1.5 rounded-2xl p-1.5">
          <Link href="/" aria-label="Ana sayfaya dön" className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-white/10">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8H3M7 4L3 8l4 4" />
            </svg>
          </Link>
          <span className="pr-3 font-display text-[17px] font-bold tracking-[-0.02em]">floodograph</span>
        </div>
        <nav aria-label="Şehir" className="glass pointer-events-auto flex gap-1 rounded-2xl p-1.5">
          {CITIES.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCityIdx(i)}
              aria-pressed={i === cityIdx}
              className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors duration-150 ${i === cityIdx ? "bg-water text-ink" : "text-fg-2 hover:bg-white/10"}`}
            >
              {c.name}
            </button>
          ))}
          <Link href="/demo" className="min-h-11 content-center rounded-xl px-4 text-sm text-fg-3 hover:bg-white/10 hover:text-fg">
            Sarıyer pilotu
          </Link>
        </nav>
      </header>

      <AnimatePresence mode="wait">
        <motion.aside
          key={city.id}
          initial={{ opacity: 0, x: -16, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -10, filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="glass absolute left-3 top-24 z-10 flex w-[min(320px,calc(100vw-24px))] flex-col gap-4 rounded-[22px] p-5 sm:left-5"
        >
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">{city.name}</h1>
            <p className="text-sm text-fg-2">{city.sub}</p>
          </div>
          {status === "ready" ? (
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Şu an su altında" value={`${fmtInt(wetHa)} ha`} accent />
              <Stat label="Toplam ıslanan alan" value={`${fmtInt(m.ever_wet_ha ?? 0)} ha`} />
              <Stat label="0,5 m'den derin" value={`${fmtInt(m.ever_deep_ha ?? 0)} ha`} />
              <Stat label="Yağış" value={`${fmtInt(data?.scenario.totalMm ?? 0)} mm`} />
            </dl>
          ) : (
            <p className="text-sm text-fg-3">
              {status === "loading" ? "Senaryo yükleniyor…" : status === "missing" ? "Bu şehrin simülasyonu henüz yüklenmedi." : "Bağlantı kurulamadı."}
            </p>
          )}
          <p className="text-xs leading-relaxed text-fg-3">
            50 m ızgara, 2D sığ su modeli (GPU). Binalar bu ölçekte tek tek değil, yüzey pürüzlülüğü olarak hesapta. Bina
            bazında analiz Sarıyer pilotunda (20 m).
          </p>
        </motion.aside>
      </AnimatePresence>

      <div className="glass absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-[820px] items-center gap-4 rounded-[22px] p-3 sm:bottom-5">
        <button
          type="button"
          onClick={() => {
            if (!playing && tRef.current >= end) tRef.current = data ? playbackStart(data.rain) : 0;
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Duraklat" : "Oynat"}
          className="btn-ember flex size-12 shrink-0 items-center justify-center rounded-full bg-ember text-ink"
        >
          {playing ? (
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
              <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
            </svg>
          ) : (
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z" />
            </svg>
          )}
        </button>
        <div className="flex min-w-[96px] flex-col leading-tight">
          <span className="font-mono text-2xl font-medium tabular-nums">{clock.time}</span>
          <span className="text-xs text-fg-3">{clock.day}</span>
        </div>
        <input
          type="range"
          className="fg-range min-w-0 flex-1"
          min={0}
          max={end}
          step={1}
          value={Math.round(t)}
          aria-label="Zaman"
          disabled={!data}
          onChange={(e) => {
            tRef.current = Number(e.target.value);
            setT(tRef.current);
            draw(tRef.current);
          }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] uppercase tracking-[0.1em] text-fg-3">{label}</dt>
      <dd className={`font-mono text-xl font-medium tabular-nums ${accent ? "text-water" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from "maplibre-gl";
import type { GridFrame, GridMeta, Scenario } from "@floodograph/core";
import { RainOverlay } from "@/components/rain-overlay";
import { installWindowPattern, sceneStyle } from "@/components/scene/scene-style";
import { SiteNav } from "@/components/site-nav";
import { Water3DLayer } from "@/components/demo/water-3d";
import { floodRepository } from "@/lib/repository";
import { fmtInt } from "@/lib/scenario";
import { FrameStore } from "@/lib/water-frames";
import { CorridorTiles } from "@/lib/corridor-tiles";
import { CORRIDOR_ORDER, CORRIDOR_STYLE, type CorridorKind } from "@/lib/tier-style";

const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

type City = { id: string; name: string; center: [number, number]; zoom: number };
const CITIES: City[] = [
  { id: "istanbul-kent", name: "İstanbul", center: [28.98, 41.06], zoom: 10.4 },
  { id: "izmir-kent", name: "İzmir", center: [27.14, 38.43], zoom: 11.2 },
  { id: "ankara-kent", name: "Ankara", center: [32.82, 39.93], zoom: 11.1 },
];
const MAX_MM = 300;
const PRESETS = [
  { mm: 40, label: "Kuvvetli yağmur" },
  { mm: 100, label: "Sağanak" },
  { mm: 188, label: "14 Ekim (Sarıyer)" },
  { mm: 280, label: "Aşırı" },
];
/** Urgent spots: blocks of 4 x 4 cells (200 m) whose deepest water passes these depths. */
const BLOCK = 4;
const DEEP_M = 1.0;
const VERY_DEEP_M = 1.5;
const PULSE_MS = 2600;

type Region = {
  id: string;
  scenario: Scenario;
  grid: GridMeta;
  box: readonly [number, number, number, number];
  frames: FrameStore | null;
  layer: Water3DLayer | null;
  zero: GridFrame;
};
/** At most this many regions drawn at once (each is its own 3D water mesh). */
const MAX_REGIONS = 10;

/** Flat night base (no 3D terrain: the water sits on z = 0) with every OSM building lit at night. */
function cityStyle(): StyleSpecification {
  const s = sceneStyle();
  delete (s as { terrain?: unknown }).terrain;
  return s;
}

/** lon/lat of a fractional grid position, from the grid's corner quad (NW, NE, SE, SW). */
function gridToLngLat(grid: GridMeta, s: number, t: number): [number, number] {
  const [nw, ne, se, sw] = grid.corners_lonlat;
  const top = [nw[0] + (ne[0] - nw[0]) * s, nw[1] + (ne[1] - nw[1]) * s];
  const bot = [sw[0] + (se[0] - sw[0]) * s, sw[1] + (se[1] - sw[1]) * s];
  return [top[0]! + (bot[0]! - top[0]!) * t, top[1]! + (bot[1]! - top[1]!) * t];
}

export function CityFlood() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [cityIdx, setCityIdx] = useState(0);
  const regionsRef = useRef<Region[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [mm, setMm] = useState(100);
  const mmRef = useRef(mm);
  const [stats, setStats] = useState({ wetHa: 0, urgent: 0, veryUrgent: 0 });
  const seen = useRef(new Map<string, number>()); // block key -> when it first became urgent (for the pulse)
  const [corr, setCorr] = useState<Record<CorridorKind, number>>({ derived: 0, buried_osm: 0, open: 0 });
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
      installWindowPattern(map);
      (window as unknown as { __cityMap?: MlMap }).__cityMap = map;
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
      map.on("load", () => {
        if (!map) return;
        // stream corridors of every city, loaded tile by tile only where the screen is
        map.addSource("corridors", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        for (const kind of CORRIDOR_ORDER) {
          const st = CORRIDOR_STYLE[kind];
          map.addLayer(
            {
              id: `corridor-${kind}`,
              type: "line",
              source: "corridors",
              minzoom: 10,
              filter: ["==", ["get", "kind"], kind],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": st.color,
                "line-opacity": kind === "derived" ? 0.85 : 0.6,
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 2.6],
                ...(st.dash ? { "line-dasharray": st.dash } : {}),
              },
            },
            "basemap-buildings",
          );
        }
        const tiles = new CorridorTiles();
        const refresh = async () => {
          if (!map) return;
          const b = map.getBounds();
          if (map.getZoom() < 10) {
            setCorr({ derived: 0, buried_osm: 0, open: 0 });
            return;
          }
          const feats = await tiles.around(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
          if (!map?.getSource("corridors")) return;
          (map.getSource("corridors") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats } as never);
          const w = b.getWest(), e = b.getEast(), so = b.getSouth(), n = b.getNorth();
          const counts = { derived: 0, buried_osm: 0, open: 0 } as Record<CorridorKind, number>;
          for (const f of feats) {
            const box = [Infinity, Infinity, -Infinity, -Infinity];
            const walk = (c: unknown): void => {
              if (typeof (c as number[])[0] === "number") {
                const [x, y] = c as [number, number];
                box[0] = Math.min(box[0]!, x);
                box[1] = Math.min(box[1]!, y);
                box[2] = Math.max(box[2]!, x);
                box[3] = Math.max(box[3]!, y);
              } else for (const k of c as unknown[]) walk(k);
            };
            walk(f.geometry.coordinates);
            if (box[2]! >= w && box[0]! <= e && box[3]! >= so && box[1]! <= n) counts[f.properties.kind]++;
          }
          setCorr(counts);
        };
        map.on("moveend", () => void refresh());
        void refresh();
        map.addSource("urgent", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "urgent-glow",
          type: "circle",
          source: "urgent",
          paint: {
            "circle-color": ["case", [">=", ["get", "d"], VERY_DEEP_M], "#ff5a2b", "#ffc23a"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 12, 7, 15, 18],
            "circle-blur": 0.6,
            "circle-opacity": 0.55,
          },
        });
        map.addLayer({
          id: "urgent-pulse",
          type: "circle",
          source: "urgent",
          filter: ["==", ["get", "fresh"], 1],
          paint: {
            "circle-color": ["case", [">=", ["get", "d"], VERY_DEEP_M], "#ff5a2b", "#ffc23a"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 12, 14, 15, 34],
            "circle-opacity": 0.9,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fff3e0",
          },
        });
        setMapReady(true);
      });
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // rain ladders of the selected city, one per ~13 km region; frames are keyed by rain total (mm), not by time
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      clearRegions();
      try {
        const repo = floodRepository();
        const list = await repo.listScenarios(city.id);
        if (cancelled) return;
        const prefix = `${city.id}-yagis-`;
        regionsRef.current = list
          .filter((s) => s.id.startsWith(prefix) && s.grid)
          .map((s) => {
            const g = s.grid!;
            const lons = g.corners_lonlat.map((c) => c[0]);
            const lats = g.corners_lonlat.map((c) => c[1]);
            const n = g.nx * g.ny;
            return {
              id: s.id,
              scenario: s,
              grid: g,
              box: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] as const,
              frames: null,
              layer: null,
              zero: { tMin: 0, nx: g.nx, ny: g.ny, depth: new Float32Array(n), u: new Float32Array(n), v: new Float32Array(n) },
            };
          });
        if (!regionsRef.current.length) {
          setStatus("missing");
          return;
        }
        setStatus("ready");
        syncRegions();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      clearRegions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- region helpers read refs only
  }, [city.id]);

  // fly to the city
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.flyTo({ center: city.center, zoom: city.zoom, pitch: 55, bearing: -20, duration: 2600, essential: true });
  }, [mapReady, city]);

  /** Drop every region of the previous city (layers off the map, frame caches released). */
  function clearRegions() {
    const map = mapRef.current;
    for (const r of regionsRef.current) {
      if (map && r.layer && map.getLayer(r.layer.id)) map.removeLayer(r.layer.id);
      r.frames?.dispose();
    }
    regionsRef.current = [];
    seen.current.clear();
  }

  /** Load and draw only the regions on screen; regions that leave the screen lose their 3D layer. */
  function syncRegions() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const b = map.getBounds();
    const padX = (b.getEast() - b.getWest()) * 0.1;
    const padY = (b.getNorth() - b.getSouth()) * 0.1;
    const [w, s, e, n] = [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
    let active = 0;
    const repo = floodRepository();
    for (const r of regionsRef.current) {
      const visible = r.box[2] >= w && r.box[0] <= e && r.box[3] >= s && r.box[1] <= n && active < MAX_REGIONS;
      if (visible) {
        active++;
        if (!r.frames) {
          r.frames = new FrameStore(repo, r.id, [], r.grid);
          void repo.gridFrames(r.id).then((refs) => {
            if (!r.frames) return;
            r.frames.dispose();
            r.frames = new FrameStore(repo, r.id, refs, r.grid);
            r.frames.onLoad(() => draw(mmRef.current));
            r.frames.want(mmRef.current, refs.length, 0); // a ladder is short: fetch every level
          });
        }
        if (!r.layer) {
          r.layer = new Water3DLayer(r.grid, `flood-water-${r.id}`, false, 1);
          map.addLayer(r.layer, "basemap-buildings");
        }
      } else if (r.layer) {
        if (map.getLayer(r.layer.id)) map.removeLayer(r.layer.id);
        r.layer = null;
      }
    }
    draw(mmRef.current);
  }

  /** Show the water for `total` mm of rain in every region on screen: blend the two nearest ladder levels. */
  function draw(total: number) {
    const map = mapRef.current;
    if (!map) return;
    const now = performance.now();
    const features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { d: number; fresh: number } }[] = [];
    const live = new Set<string>();
    let wetHa = 0;
    let veryUrgent = 0;
    for (const r of regionsRef.current) {
      if (!r.layer || !r.frames) continue;
      const fs = r.frames;
      const first = fs.times[0];
      if (first == null) continue;
      let a: GridFrame | undefined;
      let b: GridFrame | undefined;
      let alpha = 0;
      if (total <= first) {
        a = r.zero;
        b = fs.get(first);
        alpha = first > 0 ? total / first : 1;
      } else {
        const br = fs.bracket(total);
        if (!br) continue;
        a = fs.get(br.a);
        b = fs.get(br.b);
        alpha = br.alpha;
      }
      if (!a || !b) continue; // still streaming
      r.layer.setFrames(a, b, alpha);

      const { nx, ny } = r.grid;
      const cellHa = r.grid.res_m ** 2 / 1e4;
      const da = a.depth;
      const db = b.depth;
      let wet = 0;
      for (let i = 0; i < da.length; i++) if (da[i]! * (1 - alpha) + db[i]! * alpha > 0.1) wet++;
      wetHa += wet * cellHa;
      for (let bj = 0; bj < ny; bj += BLOCK)
        for (let bi = 0; bi < nx; bi += BLOCK) {
          let dmax = 0;
          for (let j = bj; j < Math.min(ny, bj + BLOCK); j++)
            for (let i = bi; i < Math.min(nx, bi + BLOCK); i++) {
              const c = j * nx + i;
              const d = da[c]! * (1 - alpha) + db[c]! * alpha;
              if (d > dmax) dmax = d;
            }
          if (dmax < DEEP_M) continue;
          const key = `${r.id}:${bi},${bj}`;
          live.add(key);
          if (!seen.current.has(key)) seen.current.set(key, now);
          if (dmax >= VERY_DEEP_M) veryUrgent++;
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: gridToLngLat(r.grid, (bi + BLOCK / 2) / nx, (bj + BLOCK / 2) / ny) },
            properties: { d: Math.round(dmax * 100) / 100, fresh: now - seen.current.get(key)! < PULSE_MS ? 1 : 0 },
          });
        }
    }
    // a block that dried out may pulse again when the rain is raised back
    for (const k of [...seen.current.keys()]) if (!live.has(k)) seen.current.delete(k);
    (map.getSource("urgent") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
    setStats({ wetHa, urgent: features.length, veryUrgent });
  }

  useEffect(() => {
    mmRef.current = mm;
    draw(mm);
     
  }, [mm]);
  // follow the screen: load / drop regions when the view settles
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const onMove = () => syncRegions();
    map.on("moveend", onMove);
    syncRegions();
    return () => {
      map.off("moveend", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- region helpers read refs only
  }, [mapReady]);
  // keep the pulse ticking: fresh flags expire after PULSE_MS
  useEffect(() => {
    const id = setInterval(() => draw(mmRef.current), 700);
    return () => clearInterval(id);
     
  }, []);
  // the pulse ring breathes
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 * 2.2);
      if (map.getLayer("urgent-pulse")) map.setPaintProperty("urgent-pulse", "circle-opacity", 0.25 + 0.7 * s);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapReady]);

  return (
    <div className="fixed inset-0 bg-ink">
      {/* maplibre-gl.css forces the map container to position:relative, so size it from a wrapper */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label={`${city.name} sel haritası`} />
      </div>
      <RainOverlay intensity={() => Math.sqrt(Math.min(1, mmRef.current / MAX_MM))} />

      <header className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
        <SiteNav />
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
        </nav>
      </header>

      <AnimatePresence mode="wait">
        <motion.aside
          key={city.id}
          initial={{ opacity: 0, x: -16, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -10, filter: "blur(6px)" }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="glass absolute left-3 top-24 z-10 flex w-[min(300px,calc(100vw-24px))] flex-col gap-4 rounded-[22px] p-5 sm:left-5 max-sm:top-auto max-sm:bottom-40"
        >
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-3xl font-semibold tracking-[-0.03em]">{city.name}</h1>
            <p className="text-sm text-fg-2">Bu yağış burada olsaydı?</p>
          </div>
          {status === "ready" ? (
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Su altında" value={`${fmtInt(stats.wetHa)} ha`} accent />
              <Stat label="Acil nokta" value={fmtInt(stats.urgent)} ember />
              <Stat label="1,5 m'den derin" value={fmtInt(stats.veryUrgent)} />
              <Stat label="Yağış" value={`${fmtInt(mm)} mm`} />
            </dl>
          ) : (
            <p className="text-sm text-fg-3">
              {status === "loading"
                ? "Yükleniyor…"
                : status === "missing"
                  ? "Bu şehrin yağış senaryoları hesaplanıyor; birazdan burada."
                  : "Bağlantı kurulamadı."}
            </p>
          )}
          <ul className="flex flex-col gap-1.5 border-t border-line pt-3" aria-label="Ekranda görünen koridorlar">
            <li className="text-[11px] uppercase tracking-[0.1em] text-fg-3">Ekranda görünen koridorlar</li>
            {CORRIDOR_ORDER.map((k) => (
              <li key={k} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 text-sm">
                <svg aria-hidden="true" width="24" height="6" viewBox="0 0 24 6">
                  <line x1="1" y1="3" x2="23" y2="3" stroke={CORRIDOR_STYLE[k].color} strokeWidth="2.4" strokeLinecap="round"
                    strokeDasharray={CORRIDOR_STYLE[k].dash ? CORRIDOR_STYLE[k].dash!.map((d) => d * 2.4).join(" ") : undefined} />
                </svg>
                <span className={k === "derived" ? "font-medium" : "text-fg-2"}>{CORRIDOR_STYLE[k].label}</span>
                <span className={`font-mono tabular-nums ${k === "derived" ? "text-ember" : "text-fg-2"}`}>{fmtInt(corr[k])}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-fg-3">
            Turuncu: suyun 1,5 m&rsquo;yi geçtiği, sarı: 1 m&rsquo;yi geçtiği 200 m&rsquo;lik bloklar. 50 m ızgara, 2D sığ su
            modeli; yağış 14 Ekim&rsquo;in saatlik desenine göre dağıtılır. Bina bazında analiz Sarıyer pilotunda.
          </p>
        </motion.aside>
      </AnimatePresence>

      <div className="glass absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-[760px] flex-col gap-3 rounded-[22px] p-4 sm:bottom-5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="yagis" className="text-sm font-semibold">
            Günlük yağış
          </label>
          <span className="font-mono text-2xl font-medium tabular-nums">
            {fmtInt(mm)}
            <span className="ml-1 text-sm text-fg-3">mm</span>
          </span>
        </div>
        <input
          id="yagis"
          type="range"
          className="fg-range w-full"
          min={0}
          max={MAX_MM}
          step={5}
          value={mm}
          onChange={(e) => setMm(Number(e.target.value))}
          aria-valuetext={`${mm} milimetre`}
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.mm}
              type="button"
              onClick={() => setMm(p.mm)}
              aria-pressed={mm === p.mm}
              className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ${mm === p.mm ? "bg-white/15 text-fg" : "text-fg-3 hover:bg-white/10 hover:text-fg"}`}
            >
              {p.label} · {p.mm} mm
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false, ember = false }: { label: string; value: string; accent?: boolean; ember?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] uppercase tracking-[0.1em] text-fg-3">{label}</dt>
      <dd className={`font-mono text-xl font-medium tabular-nums ${ember ? "text-ember" : accent ? "text-water" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

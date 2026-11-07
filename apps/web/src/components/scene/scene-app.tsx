"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, animate, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EngineState, FloodEngine, Mode } from "./engine";
import { Timeline } from "./timeline";

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const RATES = [0.5, 1, 2, 4] as const;
const DAYS = ["Çarşamba", "Perşembe"];

/** 14 Ekim 2026 06:00 + t minutes */
export function clock(t: number) {
  const total = 360 + Math.floor(t);
  const day = Math.floor(total / 1440);
  const m = total % 1440;
  return {
    time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    date: `${14 + day} Ekim`,
    weekday: DAYS[day] ?? "",
  };
}

const EMPTY: EngineState = {
  phase: "hazirlaniyor",
  step: "Harita hazırlanıyor",
  error: null,
  source: null,
  t: 0,
  t0: 0,
  t1: 1800,
  playing: false,
  rate: 1,
  mode: "tur",
  tourReady: false,
  chapter: null,
  loaded: 0,
  total: 0,
  series: [],
  tourMarks: [],
  stats: { wetBuildings: 0, totalWet: 0, maxDepth: 0, wetHa: 0, floating: 0, destroyed: 0, damaged: 0, totalDestroyed: 0 },
  fps: 0,
};
const noop = () => () => {};

function useEngine(container: React.RefObject<HTMLDivElement | null>, attempt: number) {
  const [engine, setEngine] = useState<FloodEngine | null>(null);
  useEffect(() => {
    let disposed = false;
    let e: FloodEngine | null = null;
    (async () => {
      const { FloodEngine } = await import("./engine");
      if (disposed || !container.current) return;
      e = new FloodEngine(container.current);
      setEngine(e);
      await e.init();
    })();
    return () => {
      disposed = true;
      e?.dispose();
      setEngine(null);
    };
  }, [container, attempt]);
  const state = useSyncExternalStore(engine?.subscribe ?? noop, engine?.getState ?? (() => EMPTY), () => EMPTY);
  return [engine, state] as const;
}

/** Number that glides to its new value instead of jumping. */
function Rolling({ value, format }: { value: number; format: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    const ctl = animate(from, value, {
      duration: 0.45,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => ctl.stop();
  }, [value, format]);
  return (
    <span ref={ref} className="tabular-nums">
      {format(value)}
    </span>
  );
}

const fmtInt = (v: number) => Math.round(v).toLocaleString("tr-TR");
const fmtM = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Icon({ name }: { name: "play" | "pause" | "route" | "hand" | "info" | "replay" }) {
  const p = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "play":
      return (
        <svg {...p} stroke="none" fill="currentColor">
          <path d="M5.5 3.3v11.4a.9.9 0 0 0 1.37.77l9.1-5.7a.9.9 0 0 0 0-1.54l-9.1-5.7a.9.9 0 0 0-1.37.77Z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...p} stroke="none" fill="currentColor">
          <rect x="4" y="3" width="3.6" height="12" rx="1.1" />
          <rect x="10.4" y="3" width="3.6" height="12" rx="1.1" />
        </svg>
      );
    case "route":
      return (
        <svg {...p}>
          <circle cx="4" cy="14" r="1.8" />
          <circle cx="14" cy="4" r="1.8" />
          <path d="M5.6 13.2c3-1 1.2-4.6 4-5.6 1.4-.5 2.4-1.2 2.9-2" />
        </svg>
      );
    case "hand":
      return (
        <svg {...p}>
          <path d="M9 2.5v13M2.5 9h13M9 2.5 7.2 4.3M9 2.5l1.8 1.8M9 15.5l-1.8-1.8M9 15.5l1.8-1.8M2.5 9l1.8-1.8M2.5 9l1.8 1.8M15.5 9l-1.8-1.8M15.5 9l-1.8 1.8" />
        </svg>
      );
    case "replay":
      return (
        <svg {...p}>
          <path d="M3.5 9a5.5 5.5 0 1 0 1.7-4" />
          <path d="M3.2 2.8v2.6h2.6" />
        </svg>
      );
    case "info":
      return (
        <svg {...p} width={14} height={14} viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="7" />
          <path d="M9 8.2v4.3M9 5.6v.1" />
        </svg>
      );
  }
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  id,
  label,
}: {
  value: T;
  options: { id: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  id: string;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[14px] bg-white/5 p-1 ring-1 ring-white/6">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className="relative min-h-9 min-w-10 rounded-[10px] px-2.5 text-[13px] font-medium text-fg-3 transition-colors duration-150 hover:text-fg active:scale-[0.97] aria-checked:text-fg"
        >
          {value === o.id && (
            <motion.span layoutId={`${id}-pill`} className="absolute inset-0 rounded-[10px] bg-white/12 ring-1 ring-white/10" transition={spring} aria-hidden="true" />
          )}
          <span className="relative flex items-center justify-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Stat({ label, children, accent }: { label: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-fg-3">{label}</dt>
      <dd className={`font-display text-[26px] font-semibold leading-none tracking-[-0.02em] ${accent ? "text-ember" : "text-fg"}`}>{children}</dd>
    </div>
  );
}

export function SceneApp() {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [engine, s] = useEngine(container, attempt);
  const [noteOpen, setNoteOpen] = useState(false);
  const c = clock(s.t);

  const setMode = useCallback(
    (m: Mode) => {
      if (!engine) return;
      if (m === "tur") engine.startTour();
      else engine.freeMode();
    },
    [engine],
  );

  // keyboard: space plays/pauses, arrows step five minutes
  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) engine.seek(engine.state.t + 30);
      else if (e.key === "ArrowLeft" && e.shiftKey) engine.seek(engine.state.t - 30);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  const loading = s.phase !== "hata" && (s.phase === "hazirlaniyor" || (s.total > 0 && s.loaded < s.total && !s.tourReady));
  const pct = s.total ? s.loaded / s.total : 0;
  const ended = s.mode === "serbest" && !s.playing && s.t >= s.t1;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink text-fg">
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" aria-label="Sel sahnesi, 3B harita" role="application" />
      </div>

      {/* soft vignette keeps the glass legible over bright water */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_55%,rgb(5_8_10/0.55)_100%)]" />

      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
        <motion.div
          initial={{ opacity: 0, y: -8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="glass pointer-events-auto flex items-center gap-3 rounded-2xl py-2 pl-3 pr-4"
        >
          <span aria-hidden="true" className="relative flex size-7 items-center justify-center rounded-[9px] bg-ember/15 ring-1 ring-ember/35">
            <span className="size-2 rounded-full bg-ember shadow-[0_0_12px_2px_rgb(255_90_43/0.6)]" />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              Floodograph <span className="font-normal text-fg-3">· Sinema</span>
            </span>
            <span className="text-xs text-fg-3">14 Ekim 2026 selinin 2B sığ su modeli · Sarıyer–Ayazağa</span>
          </div>
        </motion.div>

        <div className="pointer-events-auto relative">
          <button
            type="button"
            aria-expanded={noteOpen}
            aria-controls="temsil-notu"
            onClick={() => setNoteOpen((v) => !v)}
            className="glass inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-xs font-medium text-fg-2 transition-colors hover:text-fg"
          >
            <Icon name="info" />
            Görsel temsil
          </button>
          <AnimatePresence>
            {noteOpen && (
              <motion.p
                id="temsil-notu"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
                transition={spring}
                className="glass absolute right-0 top-12 w-[min(320px,calc(100vw-24px))] origin-top-right rounded-2xl p-4 text-[13px] leading-relaxed text-fg-2"
              >
                Su yüzeyi, derinlik ve akış modelin 5 dakikalık karelerinden gelir; aradaki anlar doğrusal geçişle
                gösterilir. <span className="text-fg">Yıkılan binalar:</span> bina çevresindeki akışta hız × derinlik
                7 m²/s&rsquo;yi (hız ≥ 2 m/s) geçince yıkılmış, 3 m²/s&rsquo;yi geçince hasarlı sayılır (Clausen &amp; Clark 1990).{" "}
                <span className="text-fg">Araçlar</span> hız × derinlik 0,45 m²/s&rsquo;de ya da 0,55 m derinlikte sürüklenir.
                Yıkılma ve sürüklenme <span className="text-fg">görsel temsildir:</span> eşikler modelin hız ve derinlik
                alanından gelir, ama yapı ve nesne fiziği simüle edilmez. Dalgalar ve köpük 20 m&rsquo;lik modelin
                çözmediği ayrıntıdır. Pencere ışıkları atmosfer içindir.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* chapter caption during the tour */}
      <div className="pointer-events-none absolute inset-x-0 top-[18%] z-10 flex justify-center px-6">
        <AnimatePresence mode="wait">
          {s.chapter && (
            <motion.div
              key={s.chapter.key}
              initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.35 } }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center gap-2 text-center"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-ember-2">Sinematik tur</span>
              <h2 className="font-display text-[clamp(30px,5vw,58px)] font-semibold leading-none tracking-[-0.035em] [text-shadow:0_2px_30px_rgb(0_0_0/0.6)]">
                {s.chapter.title}
              </h2>
              <p className="max-w-md text-sm text-fg-2 [text-shadow:0_1px_12px_rgb(0_0_0/0.8)] sm:text-base">{s.chapter.sub}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* live counters */}
      <AnimatePresence>
        {s.phase === "hazir" && (
          <motion.dl
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ ...spring, delay: 0.15 }}
            className="glass absolute right-5 top-24 z-20 hidden w-[232px] flex-col gap-4 rounded-[22px] p-5 md:flex"
            aria-live="off"
          >
            <Stat label="Su ulaşan bina" accent>
              <Rolling value={s.stats.wetBuildings} format={fmtInt} />
              <span className="ml-1.5 text-sm font-normal tracking-normal text-fg-3">/ {fmtInt(s.stats.totalWet)}</span>
            </Stat>
            <Stat label="Derin su · üst %1">
              <Rolling value={s.stats.maxDepth} format={fmtM} />
              <span className="ml-1 text-sm font-normal text-fg-3">m</span>
            </Stat>
            <Stat label="Su altındaki alan">
              <Rolling value={s.stats.wetHa} format={fmtInt} />
              <span className="ml-1 text-sm font-normal text-fg-3">ha</span>
            </Stat>
            <Stat label="Yıkılan bina" accent={s.stats.destroyed > 0}>
              <Rolling value={s.stats.destroyed} format={fmtInt} />
              <span className="ml-1.5 text-sm font-normal tracking-normal text-fg-3">/ {fmtInt(s.stats.totalDestroyed)}</span>
            </Stat>
            <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-xs text-fg-3">
              <div className="flex items-center justify-between">
                <span>Hasarlı bina</span>
                <span className="font-mono tabular-nums text-fg-2">{s.stats.damaged}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Sürüklenen nesne</span>
                <span className="font-mono tabular-nums text-fg-2">{s.stats.floating}</span>
              </div>
            </div>
          </motion.dl>
        )}
      </AnimatePresence>

      {/* bottom dock */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.1 }}
        className="glass absolute inset-x-3 bottom-3 z-20 flex flex-col gap-3 rounded-[24px] p-3 sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:w-[min(880px,calc(100vw-40px))] sm:-translate-x-1/2 sm:p-4"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => engine?.toggle()}
            disabled={!engine || s.phase !== "hazir"}
            aria-label={s.playing ? "Duraklat" : "Oynat"}
            className="btn-ember relative inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-ember text-ink shadow-[0_6px_24px_-6px_rgb(255_90_43/0.7)] disabled:opacity-40"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={s.playing ? "p" : ended ? "r" : "o"}
                initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
                transition={{ duration: 0.18 }}
                className="flex"
              >
                <Icon name={s.playing ? "pause" : ended ? "replay" : "play"} />
              </motion.span>
            </AnimatePresence>
          </motion.button>

          <div className="flex min-w-[92px] flex-col leading-none">
            <span className="font-display text-[28px] font-semibold tabular-nums tracking-[-0.03em] sm:text-[32px]">{c.time}</span>
            <span className="mt-1 text-xs text-fg-3">
              {c.date} {c.weekday}
            </span>
          </div>

          <div className="hidden flex-1 sm:block">
            <Timeline state={s} onSeek={(t) => engine?.seek(t)} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Segmented
              id="rate"
              label="Oynatma hızı"
              value={s.rate}
              onChange={(r) => engine?.setRate(r)}
              options={RATES.map((r) => ({ id: r, label: `${String(r).replace(".", ",")}×`, title: `${r * 8} dakika / saniye` }))}
            />
          </div>
        </div>

        <div className="sm:hidden">
          <Timeline state={s} onSeek={(t) => engine?.seek(t)} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <Segmented
            id="mode"
            label="Kamera"
            value={s.mode}
            onChange={setMode}
            options={[
              { id: "tur", label: (<><Icon name="route" /> Sinematik tur</>) },
              { id: "serbest", label: (<><Icon name="hand" /> Serbest gezinme</>) },
            ]}
          />
          <p className="hidden text-xs text-fg-3 lg:block">
            Sürükle: kaydır · Sağ tık / iki parmak: döndür ve eğ · Boşluk: oynat
          </p>
          <span className="font-mono text-[11px] tabular-nums text-fg-3" title="Kare hızı">
            {s.fps ? `${s.fps} fps` : ""}
            {s.source === "yerel" ? " · yerel veri" : ""}
          </span>
        </div>
      </motion.div>

      {/* loading veil */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-ink/55 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={spring}
              className="glass flex w-[min(340px,calc(100vw-32px))] flex-col gap-4 rounded-[24px] p-6"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-lg font-semibold tracking-[-0.02em]">Sahne kuruluyor</span>
                <span className="font-mono text-xs tabular-nums text-fg-3">
                  {s.total ? `${s.loaded}/${s.total}` : ""}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-water/70 to-water"
                  animate={{ width: `${Math.max(4, pct * 100)}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
              <span className="text-[13px] text-fg-3">
                {s.step || (s.total ? "Sel kareleri indiriliyor" : "Hazırlanıyor")}
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* error */}
      <AnimatePresence>
        {s.phase === "hata" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-ink/70 px-4"
          >
            <div role="alert" className="glass flex w-[min(380px,100%)] flex-col gap-3 rounded-[24px] p-6">
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-ember-2" aria-hidden="true" />
                <h2 className="font-display text-lg font-semibold">Sahne açılamadı</h2>
              </div>
              <p className="text-[13px] leading-relaxed text-fg-3">{s.error}</p>
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="btn-ember inline-flex min-h-11 items-center justify-center self-start rounded-xl bg-ember px-4 text-sm font-medium text-ink"
              >
                Tekrar dene
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TIER_LABEL, type BuildingProps, type CriticalFacility, type Tier } from "@floodograph/core";
import { CORRIDOR_ORDER, CORRIDOR_STYLE, TIER_ORDER, TIER_SHORT, TIER_SWATCH } from "@/lib/tier-style";
import { usePlayback, type DemoMode } from "@/lib/playback-store";
import { WET_THRESHOLD_M, clockAt, fmtInt } from "@/lib/scenario";
import { FloodMap, type MapPhase, type MapStats, type ScenarioLayerInput } from "./flood-map";
import { MapLoading } from "./map-loading";
import { MobileSheet } from "./mobile-sheet";
import { RainChart } from "./rain-chart";
import { ImpactCard, LiveCounters, WaterLegend } from "./scenario-panel";
import { Timeline, type TimelineMarker } from "./timeline";
import { usePlaybackLoop } from "./use-playback-loop";
import { useScenario, type ScenarioState } from "./use-scenario";
import { SiteNav } from "@/components/site-nav";
import { RainOverlay, rainIntensityAt } from "@/components/rain-overlay";

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const fmt = (n: number) => n.toLocaleString("tr-TR");

const CRIT_LABEL: Record<CriticalFacility, string> = {
  hastane: "Hastane",
  okul: "Okul",
  itfaiye: "İtfaiye",
  bakimevi: "Bakımevi",
};

type SelectedBuilding = BuildingProps & { ht?: Tier };

const DESKTOP_QUERY = "(min-width: 640px)";
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="relative min-h-11 rounded-xl px-3 text-sm font-medium text-fg-3 transition-colors duration-150 hover:text-fg active:scale-[0.97] aria-pressed:text-fg sm:px-3.5"
    >
      <AnimatePresence initial={false}>
        {pressed && (
          <motion.span
            className="absolute inset-0 rounded-xl bg-white/12"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={spring}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
      <span className="relative">{children}</span>
    </button>
  );
}

/** Segmented switch between the static analysis and the 14 Oct replay. */
function ModeSwitch({ mode, onChange }: { mode: DemoMode; onChange: (m: DemoMode) => void }) {
  const options: { id: DemoMode; label: string; short: string }[] = [
    { id: "static", label: "Statik analiz", short: "Statik analiz" },
    { id: "scenario", label: "14 Ekim selini oynat", short: "14 Ekim seli" },
  ];
  return (
    <div role="radiogroup" aria-label="Görünüm" className="grid grid-cols-2 gap-1 rounded-2xl bg-white/6 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          onClick={() => onChange(o.id)}
          className="relative min-h-11 whitespace-nowrap rounded-xl px-2 text-[13px] font-medium leading-none text-fg-3 transition-colors duration-150 hover:text-fg active:scale-[0.98] aria-checked:text-fg"
        >
          {mode === o.id && (
            <motion.span
              layoutId="mode-pill"
              className={`absolute inset-0 rounded-xl ${o.id === "scenario" ? "bg-water/22 ring-1 ring-water/40" : "bg-white/12"}`}
              transition={spring}
              aria-hidden="true"
            />
          )}
          <span className="relative flex items-center justify-center gap-1.5">
            {o.id === "scenario" && (
              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
                <path d="M2 1.3v7.4a.6.6 0 0 0 .9.5l5.9-3.7a.6.6 0 0 0 0-1L2.9.8a.6.6 0 0 0-.9.5Z" fill="currentColor" />
              </svg>
            )}
            <span className="hidden sm:inline">{o.label}</span>
            <span className="sm:hidden">{o.short}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** On-screen corridor counts by kind; shown in both modes while the corridor layer is on. */
function CorridorList({ stats, show }: { stats: MapStats | null; show: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
          <motion.ul
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-col gap-1.5 overflow-hidden border-t border-line pt-3.5"
            aria-label="Akış koridorları"
          >
            <li className="text-[11px] uppercase tracking-[0.1em] text-fg-3">Ekranda görünen koridorlar</li>
            {CORRIDOR_ORDER.map((k) => (
              <li key={k} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <svg aria-hidden="true" width="28" height="6" viewBox="0 0 28 6">
                  <line
                    x1="1"
                    y1="3"
                    x2="27"
                    y2="3"
                    stroke={CORRIDOR_STYLE[k].color}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeDasharray={CORRIDOR_STYLE[k].dash ? CORRIDOR_STYLE[k].dash!.map((d) => d * 2.4).join(" ") : undefined}
                  />
                </svg>
                <span className={k === "derived" ? "font-medium" : "text-fg-2"}>{CORRIDOR_STYLE[k].label}</span>
                <span className={`font-mono tabular-nums ${k === "derived" ? "text-ember" : "text-fg-2"}`}>
                  {stats ? stats.corridors[k] : "–"}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
  );
}

function StaticLegend({
  stats,
  error,
  activeTiers,
  toggleTier,
  showCorridors,
  compact,
}: {
  stats: MapStats | null;
  error: string | null;
  activeTiers: readonly Tier[];
  toggleTier: (t: Tier) => void;
  showCorridors: boolean;
  compact: boolean;
}) {
  return (
    <div className="flex flex-col gap-3.5 sm:gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-lg font-semibold tracking-[-0.02em] sm:text-xl">Bina kademeleri</h1>
        <span className="font-mono text-xs text-fg-3">{stats ? fmt(stats.total) : error ? "—" : "yükleniyor"}</span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--tier-yuksek)]">
          Veri yüklenemedi. Bağlantını kontrol edip sayfayı yenile.
        </p>
      ) : (
        <ul className={compact ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-1 gap-0.5"}>
          {TIER_ORDER.map((t) => {
            const on = activeTiers.includes(t);
            return (
              <li key={t}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTier(t)}
                  className={
                    compact
                      ? "flex min-h-11 w-full flex-col items-start gap-1 rounded-xl px-1.5 py-1.5 text-left transition-[background-color,opacity] duration-150 hover:bg-white/6 active:scale-[0.98] aria-[pressed=false]:opacity-45"
                      : "grid min-h-11 w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-[background-color,opacity] duration-150 hover:bg-white/6 active:scale-[0.98] aria-[pressed=false]:opacity-45"
                  }
                >
                  <span className={compact ? "h-1 w-full rounded-full" : "size-3 rounded-[3px]"} style={{ background: TIER_SWATCH[t] }} />
                  <span className={compact ? "order-3 text-xs text-fg-2" : "text-sm"}>{compact ? TIER_SHORT[t] : TIER_LABEL[t]}</span>
                  <span className={`font-mono tabular-nums ${compact ? "text-[15px]" : "text-sm"}`}>
                    {stats ? fmt(stats.tiers[t]) : <span className="fg-shimmer inline-block h-3.5 w-8 rounded align-middle" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <CorridorList stats={stats} show={showCorridors && !compact} />
      {!compact && (
        <p className="border-t border-line pt-3.5 text-[13px] leading-normal text-fg-3">
          Bir binaya dokun: akış çizgisine yüksekliği ve kademesi. 14 Ekim selini saat saat görmek için üstteki
          oynatma moduna geç.
        </p>
      )}
    </div>
  );
}

function ScenarioNotice({ state, onRetry, compact = false }: { state: ScenarioState; onRetry: () => void; compact?: boolean }) {
  if (state.status === "loading" && compact)
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Senaryo yükleniyor">
        <div className="fg-shimmer h-12 rounded-2xl" />
        <div className="fg-shimmer h-7 rounded-xl" />
      </div>
    );
  if (state.status === "loading")
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Senaryo yükleniyor">
        <div className="grid grid-cols-2 gap-2">
          <div className="fg-shimmer h-[74px] rounded-2xl" />
          <div className="fg-shimmer h-[74px] rounded-2xl" />
        </div>
        <div className="fg-shimmer h-[110px] rounded-2xl" />
        <div className="fg-shimmer h-[120px] rounded-2xl" />
      </div>
    );
  const missing = state.status === "missing";
  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl border border-line bg-white/4 p-4">
      <div className="flex items-center gap-2.5">
        <span className="size-2 rounded-full bg-ember-2" aria-hidden="true" />
        <h2 className="text-sm font-medium">{missing ? "Sel kayıtları henüz yüklenmedi" : "Senaryo açılamadı"}</h2>
      </div>
      <p className="text-[13px] leading-normal text-fg-3">
        {missing
          ? "14 Ekim 2026 simülasyonunun kareleri sunucuya aktarılıyor. Sayfa her dakika kendiliğinden yeniden bakıyor; statik analiz bu sırada kullanılabilir."
          : "Bağlantı kurulamadı. Ağını kontrol edip tekrar dene."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="btn-ember inline-flex min-h-11 items-center justify-center self-start rounded-xl bg-ember px-4 text-sm font-medium text-ink"
      >
        Tekrar dene
      </button>
    </div>
  );
}

function BuildingCard({
  b,
  mode,
  startTs,
  onClose,
}: {
  b: SelectedBuilding;
  mode: DemoMode;
  startTs: string | null;
  onClose: () => void;
}) {
  const fw = typeof b.fw === "number" ? b.fw : null;
  const md = typeof b.md === "number" ? b.md : 0;
  const wetNow = usePlayback((s) => fw != null && s.t >= fw);
  const tier = mode === "scenario" ? b.tier : (b.ht ?? b.tier);
  return (
    <motion.section
      key={b.id}
      aria-label="Seçili bina"
      aria-live="polite"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.15 } }}
      transition={spring}
      className="glass absolute inset-x-3 bottom-[calc(var(--map-ctrl-bottom,160px)+8px)] z-30 flex flex-col gap-3 rounded-[22px] p-4 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[76px] sm:w-[300px] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="size-3 rounded-[3px]" style={{ background: TIER_SWATCH[tier] }} />
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">{TIER_LABEL[tier]}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Kapat"
          className="-mr-2 -mt-2 inline-flex size-11 items-center justify-center rounded-xl text-fg-3 transition-colors hover:bg-white/10 hover:text-fg"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {mode === "scenario" && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          {fw != null ? (
            <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-water/10 p-3 ring-1 ring-water/25">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-fg-3">Su buraya geldi</dt>
                <dd className="font-mono text-xl">{clockAt(startTs, fw).time}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-fg-3">En yüksek su</dt>
                <dd className="font-mono text-xl">{fmtInt(md * 100)} cm</dd>
              </div>
              <div className="col-span-2 flex items-center gap-2 text-[13px]">
                <motion.span
                  className="size-2 rounded-full"
                  animate={{ backgroundColor: wetNow ? "#6fa8c9" : "#5b666c", scale: wetNow ? [1, 1.5, 1] : 1 }}
                  transition={{ duration: 0.3 }}
                  aria-hidden="true"
                />
                <span className="text-fg-2">{wetNow ? "Şu an suyun içinde" : "Bu saatte henüz kuru"}</span>
              </div>
            </dl>
          ) : (
            <p className="rounded-2xl bg-white/5 p-3 text-[13px] leading-normal text-fg-2">
              Bu senaryoda binaya {WET_THRESHOLD_M * 100} cm&apos;yi aşan su ulaşmadı
              {md > 0.01 ? `; en yüksek su ${fmtInt(md * 100)} cm` : ""}.
            </p>
          )}
        </motion.div>
      )}
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-fg-3">Akış çizgisine yükseklik</dt>
          <dd className="font-mono text-xl">{b.hand != null ? `${b.hand.toFixed(1)} m` : "—"}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-fg-3">Bina yüksekliği</dt>
          <dd className="font-mono text-xl">{Math.round(b.h)} m</dd>
        </div>
        {b.crit && (
          <div className="col-span-2 flex flex-col gap-0.5">
            <dt className="text-xs text-fg-3">Kritik tesis</dt>
            <dd className="text-sm">{CRIT_LABEL[b.crit]} · bir kademe yukarı alındı</dd>
          </div>
        )}
      </dl>
    </motion.section>
  );
}

export function DemoApp() {
  const [showContours, setShowContours] = useState(true);
  const [showCorridors, setShowCorridors] = useState(true);
  const [tilted, setTilted] = useState(true);
  const [activeTiers, setActiveTiers] = useState<readonly Tier[]>(TIER_ORDER);
  const [stats, setStats] = useState<MapStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedBuilding | null>(null);
  const [phase, setPhase] = useState<MapPhase>("booting");
  const [sheetPeek, setSheetPeek] = useState(160);
  const [autoplayed, setAutoplayed] = useState(false);
  const isDesktop = useIsDesktop();

  const mode = usePlayback((s) => s.mode);
  const setModeRaw = usePlayback((s) => s.setMode);
  const { state: scenarioState, retry } = useScenario();
  const ready = scenarioState.status === "ready" ? scenarioState : null;
  usePlaybackLoop(mode === "scenario" && ready != null);

  const setMode = useCallback(
    (m: DemoMode) => {
      setModeRaw(m);
      // first visit to the replay starts it, unless the user prefers reduced motion
      if (m === "scenario" && ready && !autoplayed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setAutoplayed(true);
        usePlayback.getState().setPlaying(true);
      }
    },
    [setModeRaw, ready, autoplayed],
  );

  const toggleTier = useCallback(
    (t: Tier) =>
      setActiveTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : TIER_ORDER.filter((x) => x === t || cur.includes(x)))),
    [],
  );

  const scenarioLayer = useMemo<ScenarioLayerInput | null>(
    () => (ready ? { grid: ready.scenario.grid ?? null, frames: ready.frames } : null),
    [ready],
  );
  const startTs = ready?.scenario.startTs ?? null;
  const markers = useMemo<TimelineMarker[]>(() => {
    const fo = ready?.scenario.metrics?.first_overflow_min;
    return typeof fo === "number" ? [{ tMin: fo, label: "İlk taşma" }] : [];
  }, [ready]);

  const scenarioBody =
    ready == null ? (
      <ScenarioNotice state={scenarioState} onRetry={retry} />
    ) : (
      <div className="flex flex-col gap-5">
        {isDesktop && <LiveCounters fwSorted={stats?.fwSorted ?? null} hasFrames={ready.frames != null} />}
        {ready.frames && <WaterLegend />}
        <RainChart rain={ready.rain} startTs={startTs} />
        <div className="border-t border-line pt-4">
          <ImpactCard scenario={ready.scenario} />
        </div>
      </div>
    );

  const scenarioHeader = (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="font-display text-lg font-semibold tracking-[-0.02em] sm:text-xl">14 Ekim 2026 seli</h1>
      <span className="font-mono text-xs text-fg-3">Sarıyer pilot alanı</span>
    </div>
  );

  // map controls sit above whatever covers the bottom edge
  const ctrlBottom = isDesktop ? (mode === "scenario" ? 112 : 0) : sheetPeek;

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-ink"
      style={{ "--map-ctrl-bottom": `${ctrlBottom}px` } as React.CSSProperties}
    >
      <RainOverlay
        intensity={() => {
          const p = usePlayback.getState();
          // replay: the hour's real 14 Oct rain; static analysis: a steady light rain for atmosphere
          return p.mode === "scenario" && ready ? rainIntensityAt(ready.rain, p.t) : 0.25;
        }}
      />
      <FloodMap
        cityId="istanbul"
        mode={mode}
        scenario={scenarioLayer}
        showContours={showContours}
        showCorridors={showCorridors}
        tilted={tilted}
        activeTiers={activeTiers}
        selectedId={selected?.id ?? null}
        onStats={setStats}
        onSelect={setSelected}
        onError={setError}
        onPhase={setPhase}
      />
      <MapLoading phase={phase} />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
        <header className="fg-rise">
          <SiteNav />
        </header>
        <div
          className="glass fg-rise pointer-events-auto flex gap-1 rounded-2xl p-1.5"
          style={{ "--fg-delay": "50ms" } as React.CSSProperties}
          role="group"
          aria-label="Katmanlar"
        >
          <Toggle pressed={showCorridors} onClick={() => setShowCorridors((v) => !v)}>
            Koridorlar
          </Toggle>
          <Toggle pressed={showContours} onClick={() => setShowContours((v) => !v)}>
            İzohips
          </Toggle>
          <Toggle pressed={tilted} onClick={() => setTilted((v) => !v)}>
            3B
          </Toggle>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <BuildingCard key={selected.id} b={selected} mode={mode} startTs={startTs} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>

      {isDesktop ? (
        <>
          <aside
            aria-label="Panel"
            className="glass fg-rise absolute bottom-4 left-4 z-10 hidden max-h-[calc(100dvh-92px)] w-[360px] flex-col gap-4 overflow-y-auto sm:flex overscroll-contain rounded-3xl p-5"
            style={{ "--fg-delay": "100ms" } as React.CSSProperties}
          >
            <ModeSwitch mode={mode} onChange={setMode} />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)", transition: { duration: 0.12 } }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="flex flex-col gap-4"
              >
                {mode === "static" ? (
                  <StaticLegend
                    stats={stats}
                    error={error}
                    activeTiers={activeTiers}
                    toggleTier={toggleTier}
                    showCorridors={showCorridors}
                    compact={false}
                  />
                ) : (
                  <>
                    {scenarioHeader}
                    {scenarioBody}
                    <CorridorList stats={stats} show={showCorridors} />
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </aside>
          <AnimatePresence>
            {mode === "scenario" && (
              <motion.div
                key="timeline"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24, transition: { duration: 0.15 } }}
                transition={spring}
                className="glass absolute bottom-4 left-[392px] right-4 z-10 rounded-3xl px-4 py-3.5"
              >
                <Timeline startTs={startTs} markers={markers} disabled={!ready} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <MobileSheet
          label="Panel"
          onPeekHeight={setSheetPeek}
          peek={
            <div className="flex flex-col gap-3">
              <ModeSwitch mode={mode} onChange={setMode} />
              {mode === "static" ? (
                <StaticLegend
                  stats={stats}
                  error={error}
                  activeTiers={activeTiers}
                  toggleTier={toggleTier}
                  showCorridors={showCorridors}
                  compact
                />
              ) : ready ? (
                <>
                  <Timeline startTs={startTs} markers={markers} compact />
                  <LiveCounters fwSorted={stats?.fwSorted ?? null} hasFrames={ready.frames != null} compact />
                </>
              ) : (
                <ScenarioNotice state={scenarioState} onRetry={retry} compact />
              )}
            </div>
          }
        >
          {mode === "static" ? (
            <StaticLegend
              stats={stats}
              error={error}
              activeTiers={activeTiers}
              toggleTier={toggleTier}
              showCorridors={showCorridors}
              compact={false}
            />
          ) : ready ? (
            <div className="flex flex-col gap-5">
              {scenarioHeader}
              {scenarioBody}
            </div>
          ) : (
            <p className="text-sm text-fg-3">Senaryo verisi geldiğinde yağış grafiği ve etki özeti burada görünecek.</p>
          )}
        </MobileSheet>
      )}
    </div>
  );
}

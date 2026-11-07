"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TIER_LABEL, type BuildingProps, type CriticalFacility, type Tier } from "@floodograph/core";
import { CORRIDOR_ORDER, CORRIDOR_STYLE, TIER_ORDER, TIER_SHORT, TIER_SWATCH } from "@/lib/tier-style";
import { FloodMap, type MapStats } from "./flood-map";

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const fmt = (n: number) => n.toLocaleString("tr-TR");

const CRIT_LABEL: Record<CriticalFacility, string> = {
  hastane: "Hastane",
  okul: "Okul",
  itfaiye: "İtfaiye",
  bakimevi: "Bakımevi",
};

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="relative min-h-11 rounded-xl px-3 text-sm font-medium text-fg-3 transition-colors duration-150 hover:text-fg aria-pressed:text-fg sm:px-3.5"
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

function ToggleGroup({ children }: { children: React.ReactNode }) {
  return <div className="glass flex gap-1 rounded-2xl p-1.5">{children}</div>;
}

export function DemoApp() {
  const [showContours, setShowContours] = useState(true);
  const [showCorridors, setShowCorridors] = useState(true);
  const [tilted, setTilted] = useState(true);
  const [activeTiers, setActiveTiers] = useState<readonly Tier[]>(TIER_ORDER);
  const [stats, setStats] = useState<MapStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BuildingProps | null>(null);

  const toggleTier = useCallback(
    (t: Tier) =>
      setActiveTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : TIER_ORDER.filter((x) => x === t || cur.includes(x)))),
    [],
  );
  const total = stats ? Object.values(stats.tiers).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink">
      <FloodMap
        cityId="istanbul"
        showContours={showContours}
        showCorridors={showCorridors}
        tilted={tilted}
        activeTiers={activeTiers}
        selectedId={selected?.id ?? null}
        onStats={setStats}
        onSelect={setSelected}
        onError={setError}
      />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="glass pointer-events-auto flex items-center gap-1.5 rounded-2xl p-1.5"
        >
          <Link
            href="/"
            transitionTypes={["nav-back"]}
            aria-label="Ana sayfaya dön"
            className="inline-flex size-11 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-white/10 active:scale-95"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8H3M7 4L3 8l4 4" />
            </svg>
          </Link>
          <span className="pr-2 font-display text-[17px] font-bold tracking-[-0.02em]">floodograph</span>
          <span className="hidden border-l border-line px-2.5 py-1.5 font-mono text-xs text-fg-3 sm:inline">İstanbul · Ayazağa</span>
        </motion.header>
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.05 }}
          className="pointer-events-auto"
          role="group"
          aria-label="Katmanlar"
        >
          <ToggleGroup>
            <Toggle pressed={showCorridors} onClick={() => setShowCorridors((v) => !v)}>
              Koridorlar
            </Toggle>
            <Toggle pressed={showContours} onClick={() => setShowContours((v) => !v)}>
              İzohips
            </Toggle>
            <Toggle pressed={tilted} onClick={() => setTilted((v) => !v)}>
              3B
            </Toggle>
          </ToggleGroup>
        </motion.div>
      </div>

      {/* selected building */}
      <AnimatePresence>
        {selected && (
          <motion.section
            key={selected.id}
            aria-label="Seçili bina"
            aria-live="polite"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.15 } }}
            transition={spring}
            className="glass absolute inset-x-3 bottom-[164px] z-10 flex flex-col gap-3 rounded-[22px] p-4 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[76px] sm:w-[300px] sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="size-3 rounded-[3px]" style={{ background: TIER_SWATCH[selected.tier] }} />
                <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">{TIER_LABEL[selected.tier]}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Kapat"
                className="-mr-2 -mt-2 inline-flex size-11 items-center justify-center rounded-xl text-fg-3 transition-colors hover:bg-white/10 hover:text-fg"
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-fg-3">Akış çizgisine yükseklik</dt>
                <dd className="font-mono text-xl">{selected.hand.toFixed(1)} m</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-fg-3">Bina yüksekliği</dt>
                <dd className="font-mono text-xl">{Math.round(selected.h)} m</dd>
              </div>
              {selected.crit && (
                <div className="col-span-2 flex flex-col gap-0.5">
                  <dt className="text-xs text-fg-3">Kritik tesis</dt>
                  <dd className="text-sm">{CRIT_LABEL[selected.crit]} · bir kademe yukarı alındı</dd>
                </div>
              )}
            </dl>
          </motion.section>
        )}
      </AnimatePresence>

      {/* legend / bottom sheet */}
      <motion.aside
        aria-label="Lejant"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.1 }}
        className="glass absolute inset-x-2 bottom-2 flex flex-col gap-3.5 rounded-3xl p-4 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[340px] sm:gap-4 sm:p-5"
      >
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-lg font-semibold tracking-[-0.02em] sm:text-xl">Bina kademeleri</h1>
          <span className="font-mono text-xs text-fg-3">{total != null ? fmt(total) : error ? "—" : "yükleniyor"}</span>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--tier-yuksek)]">
            Veri yüklenemedi. Bağlantını kontrol edip sayfayı yenile.
          </p>
        ) : (
          <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-1 sm:gap-0.5">
            {TIER_ORDER.map((t) => {
              const on = activeTiers.includes(t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTier(t)}
                    className="group flex min-h-11 w-full flex-col items-start gap-1 rounded-xl px-1.5 py-1.5 text-left transition-[background-color,opacity] duration-150 hover:bg-white/6 active:scale-[0.98] aria-[pressed=false]:opacity-45 sm:grid sm:grid-cols-[12px_minmax(0,1fr)_auto] sm:items-center sm:gap-3 sm:px-2"
                  >
                    <span className="h-1 w-full rounded-full sm:size-3 sm:rounded-[3px]" style={{ background: TIER_SWATCH[t] }} />
                    <span className="order-3 text-xs text-fg-2 sm:order-none sm:text-sm sm:text-fg">
                      <span className="sm:hidden">{TIER_SHORT[t]}</span>
                      <span className="hidden sm:inline">{TIER_LABEL[t]}</span>
                    </span>
                    <span className="font-mono text-[15px] tabular-nums sm:text-sm">
                      {stats ? (
                        fmt(stats.tiers[t])
                      ) : (
                        <span className="inline-block h-3.5 w-8 animate-pulse rounded bg-white/10 align-middle" />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <AnimatePresence initial={false}>
          {showCorridors && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="hidden flex-col gap-1.5 overflow-hidden border-t border-line pt-3.5 sm:flex"
              aria-label="Akış koridorları"
            >
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
        <p className="hidden border-t border-line pt-3.5 text-[13px] leading-normal text-fg-3 sm:block">
          Bir binaya dokun: akış çizgisine yüksekliği ve kademesi. Sel oynatma ve 3D sahne buraya eklenecek.
        </p>
      </motion.aside>
    </div>
  );
}

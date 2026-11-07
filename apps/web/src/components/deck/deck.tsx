"use client";

import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CountUp } from "@/components/count-up";
import { Backdrop, riverShot, type Mood } from "./backdrop";

/* ------------------------------------------------------------------------------------------------ content */

type Slide = { id: string; nav: string; mood: Mood; body: () => React.ReactNode };

const ease = [0.16, 1, 0.3, 1] as const;
const item: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(10px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.75, ease } },
};
const group: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.18 } } };

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <motion.p variants={item} className="flex items-center gap-3 font-mono text-[13px] tracking-[0.08em] text-fg-3">
      <span className="text-ember">{n}</span>
      <span className="h-px w-8 bg-line" />
      {children}
    </motion.p>
  );
}
function Title({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.h2
      variants={item}
      className={`font-display text-[clamp(38px,6vw,88px)] font-semibold leading-[0.95] tracking-[-0.035em] [text-wrap:balance] ${className}`}
    >
      {children}
    </motion.h2>
  );
}
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <motion.p variants={item} className="max-w-[620px] text-[clamp(16px,1.5vw,20px)] leading-relaxed text-fg-2">
      {children}
    </motion.p>
  );
}
function Stat({ value, unit, label, ember = false, raw }: { value?: number; unit?: string; label: string; ember?: boolean; raw?: string }) {
  return (
    <motion.div variants={item} className="glass flex flex-col gap-2 rounded-2xl p-5">
      <p className={`font-mono text-[clamp(30px,3.4vw,48px)] font-medium leading-none tracking-[-0.04em] ${ember ? "text-ember" : "text-fg"}`}>
        {raw ?? <CountUp value={value ?? 0} />}
        {unit && <span className="ml-1.5 text-[0.45em] font-normal tracking-normal text-fg-3">{unit}</span>}
      </p>
      <p className="text-sm leading-snug text-fg-2">{label}</p>
    </motion.div>
  );
}
function Play() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
function Ctas() {
  return (
    <motion.div variants={item} className="flex flex-wrap gap-3">
      <Link
        href="/demo"
        transitionTypes={["nav-forward"]}
        className="btn-ember group inline-flex min-h-14 items-center gap-2.5 rounded-2xl bg-ember px-7 text-[17px] font-semibold text-ink"
      >
        Analiz haritası
        <span className="transition-transform duration-200 group-hover:translate-x-0.5">
          <Arrow />
        </span>
      </Link>
      <Link
        href="/sinema"
        transitionTypes={["nav-forward"]}
        className="glass inline-flex min-h-14 items-center gap-2.5 rounded-2xl px-6 text-[17px] font-semibold transition-colors duration-150 hover:bg-white/10"
      >
        <Play />
        3B sinema
      </Link>
    </motion.div>
  );
}

const SLIDES: Slide[] = [
  {
    id: "kapak",
    nav: "Floodograph",
    mood: { ...riverShot(-700, { dx: -650, dy: -700, dz: 520 }), depth: 3, rain: 0.1, buried: 0.5, contour: 0.6, ember: 0 },
    body: () => (
      <>
        <motion.div variants={item} className="flex items-center gap-3">
          <Image src="/icon.png" alt="" width={40} height={40} priority />
          <span className="font-display text-2xl font-bold tracking-[-0.02em]">floodograph</span>
        </motion.div>
        <Title className="text-[clamp(44px,7.4vw,112px)]">
          Su yolunu her zaman bulur. <span className="text-ember">Biz önce buluruz.</span>
        </Title>
        <Lead>
          Şehrin altına gömülen dereleri açık yükseklik verisinden yeniden bulur, seli fiziğiyle saat saat hesaplar ve hangi
          binaya önce müdahale edilmesi gerektiğini sıralar.
        </Lead>
        <Ctas />
        <motion.p variants={item} className="font-mono text-xs text-fg-3">
          EkoZeka 2026 · Takım SALU · İstanbul, Sarıyer pilotu
        </motion.p>
      </>
    ),
  },
  {
    id: "14-ekim",
    nav: "14 Ekim",
    mood: { ...riverShot(-420, { dx: -260, dy: -320, dz: 150, lookZ: 20 }), depth: 5.5, rain: 1, buried: 0.15, contour: 0.35, ember: 0.15 },
    body: () => (
      <>
        <Eyebrow n="01">14 Ekim 2026 · İstanbul</Eyebrow>
        <Title>Bir günde, bir mevsimin yağmuru.</Title>
        <Lead>
          Ayazağa’da dere taştı, caddeler nehre döndü, araçlar ve bir İETT otobüsü sürüklendi. Suyun hangi sokaktan geçeceğini
          gösteren güncel bir harita yoktu.
        </Lead>
        <motion.div variants={group} className="grid max-w-[760px] grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat raw="1985" label="İBB'ye göre o yıldan beri en yoğun gün" />
          <Stat value={150} unit="mm" label="Sarıyer istasyon toplamı" />
          <Stat raw="29,2" unit="mm/sa" label="Zirve yoğunluk, saat 19:00" />
          <Stat raw="≥3" label="Can kaybı; kesin sayı netleşmedi" ember />
        </motion.div>
      </>
    ),
  },
  {
    id: "problem",
    nav: "Gömülü dereler",
    mood: { ...riverShot(-120, { dx: -40, dy: -120, dz: 850 }), depth: 3, rain: 0, buried: 1, contour: 0.85, ember: 0 },
    body: () => (
      <>
        <Eyebrow n="02">Problem</Eyebrow>
        <Title>
          Şehir dereleri kapattı. <span className="text-ember">Su unutmadı.</span>
        </Title>
        <Lead>
          Üstü betonla örtülen dere haritadan silinir, ama arazinin şekli değişmez. Kuvvetli yağışta su eski yatağını bulur ve
          o yatağın üstündeki binaları basar.
        </Lead>
        <motion.div variants={group} className="grid max-w-[700px] grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat value={59} label="Hiçbir haritada olmayan akış koridoru (32,5 km)" ember />
          <Stat value={4} label="OSM'de kayıtlı gömülü dere parçası" />
          <Stat value={22} label="Açık dere" />
        </motion.div>
      </>
    ),
  },
  {
    id: "yontem",
    nav: "Yöntem",
    mood: { ...riverShot(150, { dx: -260, dy: 420, dz: 360 }), depth: 4.5, rain: 0.3, buried: 0.5, contour: 1, ember: 0 },
    body: () => (
      <>
        <Eyebrow n="03">Yöntem</Eyebrow>
        <Title>Yükseklikten dereye, dereden kapıya.</Title>
        <motion.ol variants={group} className="grid max-w-[980px] gap-3 sm:grid-cols-5">
          {[
            ["FABDEM", "Binalardan ve ağaçlardan arındırılmış 30 m yükseklik modeli."],
            ["Dere ağı + HAND", "Akış yönü ve birikim; her binanın en yakın dereden yüksekliği."],
            ["16.787 bina", "Overture: OpenStreetMap ve Microsoft'un uydu bina izleri."],
            ["Sığ su çözücüsü", "2D, HEC-RAS sınıfı denklemler; gerçek yağış, 73 menfez, ekran kartında."],
            ["Aciliyet", "Acil, yüksek, orta, izle. Okul ve hastaneler bir kademe yukarı."],
          ].map(([h, p], i) => (
            <motion.li key={h} variants={item} className="glass flex flex-col gap-2 rounded-2xl p-4">
              <span className="font-mono text-xs text-ember">0{i + 1}</span>
              <span className="font-display text-lg font-semibold leading-tight">{h}</span>
              <span className="text-[13px] leading-snug text-fg-2">{p}</span>
            </motion.li>
          ))}
        </motion.ol>
      </>
    ),
  },
  {
    id: "sonuc",
    nav: "Sonuçlar",
    mood: { ...riverShot(420, { dx: -260, dy: -260, dz: 110, lookZ: 4 }), depth: 11, rain: 0.6, buried: 0.15, contour: 0.4, ember: 0.8 },
    body: () => (
      <>
        <Eyebrow n="04">14 Ekim simülasyonu · Sarıyer pilotu</Eyebrow>
        <Title>Su, 1.427 binanın kapısına geldi.</Title>
        <motion.div variants={group} className="grid max-w-[860px] grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat value={1427} label="Suyun ulaştığı bina (16.787 bina içinde)" ember />
          <Stat value={408} label="Suyun 0,5 m'yi aştığı bina" ember />
          <Stat value={1366} unit="ha" label="En geniş anda su altındaki alan" />
          <Stat raw="15/73" label="Taşan menfez; ilki 14 Ekim 18:32" />
        </motion.div>
        <Lead>Binaların çoğu dere yataklarının ve haritada olmayan koridorların üstünde. Aciliyet listesi buradan çıkıyor.</Lead>
      </>
    ),
  },
  {
    id: "dogrulama",
    nav: "Doğrulama",
    mood: { ...riverShot(650, { dx: 220, dy: -420, dz: 260 }), depth: 10, rain: 0.4, buried: 0.2, contour: 0.5, ember: 0.4 },
    body: () => (
      <>
        <Eyebrow n="05">Doğrulama</Eyebrow>
        <Title>Haberlerde su basan yerler, modelde de ıslak.</Title>
        <motion.div variants={item} className="glass max-w-[640px] overflow-hidden rounded-2xl">
          <table className="w-full text-left text-sm">
            <tbody>
              {[
                ["Hacıosman Metro İstasyonu", "1,91 m"],
                ["Ayazağa Deresi", "1,42 m"],
                ["Kemerburgaz Caddesi", "0,66 m"],
                ["Ayazağa Meydanı", "0,21 m"],
                ["Haydar Aliyev Caddesi", "0,06 m · kaçırıldı"],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 text-fg-2">{k}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        <Lead>
          0,5 m eşiğinde 5 noktanın 3’ü isabet; rastgele bir nokta için bu olasılık %22. Beş nokta az: yanlış alarm oranı ve
          IoU için uydu taşkın haritası gerekiyor.
        </Lead>
      </>
    ),
  },
  {
    id: "cozucu",
    nav: "Çözücü",
    mood: { ...riverShot(500, { dx: 0, dy: -60, dz: 1100 }), depth: 9, rain: 0, buried: 0.3, contour: 1, ember: 0.2 },
    body: () => (
      <>
        <Eyebrow n="06">Fizik</Eyebrow>
        <Title>HEC-RAS sınıfı denklemler, ekran kartında.</Title>
        <motion.div variants={group} className="grid max-w-[860px] grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat raw="10×" label="GPU hızlanması: 30 dk yerine 3 dk" ember />
          <Stat raw="1:1" label="CPU ve GPU sonuçları birebir aynı" />
          <Stat raw="10⁻¹⁴" label="Kütle dengesi hatası" />
          <Stat raw="8/8" label="Analitik test: durgun göl, kütle, baraj yıkılması" />
        </motion.div>
        <Lead>HEC-RAS’ın tamamı değiliz: çekirdek denklemler aynı sınıftan. Farkımız, Türkiye’nin her yerinde açık veriden kendiliğinden kurulması.</Lead>
      </>
    ),
  },
  {
    id: "kullanici",
    nav: "Kim kullanır",
    mood: { ...riverShot(800, { dx: 380, dy: 320, dz: 300 }), depth: 8, rain: 0.2, buried: 0.3, contour: 0.6, ember: 0.3 },
    body: () => (
      <>
        <Eyebrow n="07">Kim kullanır</Eyebrow>
        <Title>Haritadan karara.</Title>
        <motion.div variants={group} className="grid max-w-[960px] gap-3 md:grid-cols-3">
          {[
            ["Belediyeler", "İBB AKOM, İZSU: sınırlı bütçeyle önce hangi koridora, hangi okula müdahale edilmeli."],
            ["Şirketler ve bankalar", "TSRS 2, sel dahil fiziksel iklim riskinin raporlanmasını istiyor."],
            ["Afet hazırlığı", "Suyun hangi saatte nereye geleceği: tahliye ve ekip planlaması."],
          ].map(([h, p]) => (
            <motion.div key={h} variants={item} className="glass flex flex-col gap-2 rounded-2xl p-5">
              <span className="font-display text-xl font-semibold">{h}</span>
              <span className="text-sm leading-relaxed text-fg-2">{p}</span>
            </motion.div>
          ))}
        </motion.div>
      </>
    ),
  },
  {
    id: "demo",
    nav: "Demo",
    mood: { ...riverShot(620, { dx: -160, dy: -120, dz: 45, lookZ: 6 }), depth: 13, rain: 0.8, buried: 0.2, contour: 0.4, ember: 1 },
    body: () => (
      <>
        <Eyebrow n="08">Canlı</Eyebrow>
        <Title>Kendiniz görün.</Title>
        <Lead>
          Analiz haritasında binalara dokunun, 14 Ekim’i saat saat oynatın. Sinemada selin dere yataklarından taşışını 3B izleyin.
        </Lead>
        <Ctas />
      </>
    ),
  },
  {
    id: "ekip",
    nav: "Ekip",
    mood: { ...riverShot(300, { dx: -900, dy: -1100, dz: 950 }), depth: 2.5, rain: 0, buried: 0.7, contour: 0.7, ember: 0 },
    body: () => (
      <>
        <Eyebrow n="09">Takım SALU</Eyebrow>
        <Title>Adımızı kedilerimizden aldık: Salep ve Luna.</Title>
        <motion.ul variants={group} className="flex flex-wrap gap-3">
          {["Atakan Çalışkan", "Meriç Özkaya", "Funda Zeynep Şarkışla"].map((n) => (
            <motion.li key={n} variants={item} className="glass rounded-2xl px-5 py-3 font-display text-lg font-semibold">
              {n}
            </motion.li>
          ))}
        </motion.ul>
        <motion.div variants={item} className="max-w-[640px] text-sm leading-relaxed text-fg-3">
          <span className="text-fg-2">Bilmediklerimiz:</span> 20 m ızgara dar sokakları çözmez; menfez kapasiteleri tahmini;
          yağış istasyon toplamına ölçekli. Resmi risk haritası değildir. FABDEM CC BY-NC-SA, OSM ve Overture ODbL.
        </motion.div>
        <motion.a
          variants={item}
          href="https://github.com/atakanclskn/floodograph"
          className="font-mono text-sm text-fg-2 underline decoration-line underline-offset-4 hover:text-fg"
        >
          github.com/atakanclskn/floodograph
        </motion.a>
      </>
    ),
  },
];

/* ------------------------------------------------------------------------------------------------ deck */

export function Deck() {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backdrop = useRef<Backdrop | null>(null);
  const lock = useRef(0);
  const reduce = useReducedMotion() ?? false;
  const n = SLIDES.length;

  const go = useCallback(
    (to: number) => {
      const t = Math.max(0, Math.min(n - 1, to));
      setIdx((cur) => {
        if (t === cur) return cur;
        setDir(t > cur ? 1 : -1);
        return t;
      });
    },
    [n],
  );
  const step = useCallback(
    (d: number) => {
      const now = performance.now();
      if (now < lock.current) return;
      lock.current = now + 750;
      setIdx((cur) => {
        const t = Math.max(0, Math.min(n - 1, cur + d));
        if (t !== cur) setDir(d);
        return t;
      });
    },
    [n],
  );

  // 3D backdrop
  useEffect(() => {
    if (!canvas.current) return;
    let b: Backdrop | null = null;
    try {
      b = new Backdrop(canvas.current, SLIDES[0]!.mood, reduce);
    } catch {
      return; // no WebGL: the slides still work on the plain background
    }
    backdrop.current = b;
    const onResize = () => b?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      b?.dispose();
      backdrop.current = null;
    };
  }, [reduce]);
  useEffect(() => {
    backdrop.current?.setMood(SLIDES[idx]!.mood);
    const id = SLIDES[idx]!.id;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", idx === 0 ? location.pathname : `#${id}`);
  }, [idx]);

  // deep link
  useEffect(() => {
    const i = SLIDES.findIndex((s) => s.id === location.hash.slice(1));
    if (i <= 0) return;
    const r = requestAnimationFrame(() => go(i)); // after hydration, so server and client markup match
    return () => cancelAnimationFrame(r);
  }, [go]);

  // keyboard, wheel, touch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (["ArrowDown", "PageDown", "ArrowRight"].includes(e.key) || (e.key === " " && !e.shiftKey)) {
        e.preventDefault();
        step(1);
      } else if (["ArrowUp", "PageUp", "ArrowLeft"].includes(e.key) || (e.key === " " && e.shiftKey)) {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n - 1);
    };
    let acc = 0;
    let accT = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - accT > 220) acc = 0;
      accT = now;
      acc += e.deltaY;
      if (Math.abs(acc) > 60) {
        step(acc > 0 ? 1 : -1);
        acc = 0;
      }
    };
    let y0: number | null = null;
    const onStart = (e: TouchEvent) => (y0 = e.touches[0]?.clientY ?? null);
    const onEnd = (e: TouchEvent) => {
      if (y0 == null) return;
      const dy = y0 - (e.changedTouches[0]?.clientY ?? y0);
      if (Math.abs(dy) > 50) step(dy > 0 ? 1 : -1);
      y0 = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [go, step, n]);

  const slide = SLIDES[idx]!;
  const last = idx === n - 1;

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {/* legibility scrim: content sits on the left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(10_15_18/0.92)_0%,rgb(10_15_18/0.7)_38%,rgb(10_15_18/0.05)_75%)] max-md:bg-[linear-gradient(180deg,rgb(10_15_18/0.35)_0%,rgb(10_15_18/0.9)_55%)]"
      />

      <header className="absolute inset-x-4 top-4 z-20 flex items-center justify-between sm:inset-x-8">
        <button type="button" onClick={() => go(0)} className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2.5 pr-4">
          <Image src="/icon.png" alt="" width={26} height={26} />
          <span className="font-display text-[17px] font-bold tracking-[-0.02em]">floodograph</span>
        </button>
        <div className="flex items-center gap-2">
          <Link href="/sinema" transitionTypes={["nav-forward"]} className="glass hidden min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold sm:inline-flex">
            <Play />
            Sinema
          </Link>
          <Link href="/demo" transitionTypes={["nav-forward"]} className="btn-ember inline-flex min-h-11 items-center rounded-xl bg-ember px-4 text-sm font-semibold text-ink">
            Demoyu aç
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex h-full items-center px-5 sm:px-10 lg:px-20 max-md:items-end max-md:pb-28">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.section
            key={slide.id}
            custom={dir}
            aria-roledescription="slayt"
            aria-label={`${idx + 1} / ${n}: ${slide.nav}`}
            initial="enter"
            animate="show"
            exit="exit"
            variants={{
              enter: (d: number) => ({ opacity: 0, y: reduce ? 0 : d * 60, filter: "blur(14px)" }),
              show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease } },
              exit: (d: number) => ({
                opacity: 0,
                y: reduce ? 0 : d * -60,
                filter: "blur(14px)",
                transition: { duration: 0.35, ease: [0.4, 0, 1, 1] },
              }),
            }}
            className="flex w-full max-w-[1100px] flex-col gap-6"
          >
            <motion.div variants={group} initial="hidden" animate="show" className="flex flex-col gap-6">
              {slide.body()}
            </motion.div>
          </motion.section>
        </AnimatePresence>
      </main>

      {/* progress */}
      <nav aria-label="Slaytlar" className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2.5 sm:right-8 max-md:hidden">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(i)}
            aria-label={s.nav}
            aria-current={i === idx ? "step" : undefined}
            className="group flex items-center justify-end gap-3"
          >
            <span className={`font-mono text-xs transition-opacity duration-200 ${i === idx ? "text-fg opacity-100" : "text-fg-3 opacity-0 group-hover:opacity-100"}`}>
              {s.nav}
            </span>
            <span
              className={`block rounded-full transition-all duration-300 ${i === idx ? "h-6 w-1.5 bg-ember" : "h-1.5 w-1.5 bg-fg-3/60 group-hover:bg-fg-2"}`}
            />
          </button>
        ))}
      </nav>

      <div className="absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => (last ? go(0) : step(1))}
          aria-label={last ? "Başa dön" : "Sonraki slayt"}
          className="glass flex size-12 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105 active:scale-95"
        >
          <motion.svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={reduce ? undefined : { y: last ? [0, -3, 0] : [0, 3, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{ rotate: last ? 180 : 0 }}
          >
            <path d="M8 3v10M4 9l4 4 4-4" />
          </motion.svg>
        </button>
        <span className="font-mono text-[11px] text-fg-3">
          {String(idx + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

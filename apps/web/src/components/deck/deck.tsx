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

/*
 * Presentation scale. Every size is clamp(mobile min, min(vw, vh) term, 1080p cap): at 1920x1080 the cap is what you
 * get, at 1366x768 the vh term keeps it from overflowing. Nothing below 14px on any screen, 16px+ at 1080p.
 */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      variants={item}
      className="flex items-center gap-3 text-[clamp(14px,min(1.05vw,1.9vh),20px)] font-semibold tracking-[0.04em] text-fg-3"
    >
      <span className="h-0.5 w-8 shrink-0 bg-ember" />
      {children}
    </motion.p>
  );
}
function Title({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.h2
      variants={item}
      className={`font-display text-[clamp(30px,min(4.6vw,8vh),84px)] font-extrabold leading-[1.02] tracking-[-0.02em] [text-wrap:balance] ${className}`}
    >
      {children}
    </motion.h2>
  );
}
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <motion.p variants={item} className="max-w-[52ch] text-[clamp(16px,min(1.5vw,2.7vh),30px)] leading-[1.5] text-fg-2">
      {children}
    </motion.p>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <motion.p variants={item} className="max-w-[62ch] text-[clamp(15px,min(1.05vw,1.9vh),20px)] leading-snug text-fg-3">
      {children}
    </motion.p>
  );
}
function Stat({
  value,
  unit,
  label,
  ember = false,
  raw,
  small = false,
}: {
  value?: number;
  unit?: string;
  label: string;
  ember?: boolean;
  raw?: string;
  /** value <= 56 px at 1080p, tighter padding: for slides that share the row with a table or video */
  small?: boolean;
}) {
  return (
    <motion.div variants={item} className={`glass flex flex-col gap-2 rounded-2xl ${small ? "p-3 sm:p-4" : "p-4 sm:gap-3 sm:p-6"}`}>
      <p
        className={`font-mono font-semibold leading-none tracking-[-0.04em] [font-variant-numeric:tabular-nums] ${small ? "text-[clamp(26px,min(2.8vw,4.6vh),56px)]" : "text-[clamp(28px,min(3.4vw,5.6vh),68px)]"} ${ember ? "text-ember" : "text-fg"}`}
      >
        {raw ?? <CountUp value={value ?? 0} />}
        {unit && <span className="ml-2 text-[0.45em] font-normal tracking-normal text-fg-3">{unit}</span>}
      </p>
      <p className="text-[clamp(14px,min(1.1vw,2vh),20px)] leading-snug text-fg-2">{label}</p>
    </motion.div>
  );
}
function Cards({ items, numbered = false, cols = 3 }: { items: string[][]; numbered?: boolean; cols?: 2 | 3 }) {
  return (
    <motion.div
      variants={group}
      className={`grid max-w-[1200px] gap-3 md:gap-4 ${cols === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}
    >
      {items.map(([h, p], i) => (
        <motion.div key={h} variants={item} className="glass flex flex-col gap-2 rounded-2xl p-4 sm:gap-3 sm:p-6">
          {numbered && (
            <span className="font-mono text-[clamp(15px,min(1.05vw,1.9vh),20px)] font-semibold text-ember">0{i + 1}</span>
          )}
          <span className="font-display text-[clamp(18px,min(1.35vw,2.4vh),26px)] font-bold leading-tight">{h}</span>
          <span className="text-[clamp(15px,min(1.05vw,1.85vh),20px)] leading-relaxed text-fg-2">{p}</span>
        </motion.div>
      ))}
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
const ctaBase =
  "inline-flex min-h-14 items-center gap-2.5 rounded-2xl px-7 text-[clamp(17px,1.15vw,22px)] font-semibold lg:min-h-16";
function Ctas() {
  return (
    <motion.div variants={item} className="flex flex-wrap gap-3">
      <Link href="/sinema" transitionTypes={["nav-forward"]} className={`btn-ember group bg-ember text-ink ${ctaBase}`}>
        İstanbul: 14 Ekim seli
        <span className="transition-transform duration-200 group-hover:translate-x-0.5">
          <Arrow />
        </span>
      </Link>
      <Link
        href="/izmir"
        transitionTypes={["nav-forward"]}
        className={`glass transition-colors duration-150 hover:bg-white/10 ${ctaBase}`}
      >
        İzmir&rsquo;de olsaydı?
      </Link>
    </motion.div>
  );
}
/** Nested boxes: each level sits inside the previous one, so the sizes read as a funnel. */
type Level = { value: string; unit?: string; label: string; ember?: boolean };
function Nest({ levels }: { levels: Level[] }) {
  const [top, ...rest] = levels;
  if (!top) return null;
  return (
    <motion.div variants={item} className="glass flex max-w-[1100px] flex-col gap-3 rounded-2xl p-3 sm:p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-5">
        <p
          className={`shrink-0 font-mono text-[clamp(26px,min(3vw,5vh),60px)] font-semibold leading-none tracking-[-0.04em] [font-variant-numeric:tabular-nums] ${top.ember ? "text-ember" : "text-fg"}`}
        >
          {top.value}
          {top.unit && <span className="ml-2 text-[0.45em] font-normal tracking-normal text-fg-3">{top.unit}</span>}
        </p>
        <p className="text-[clamp(14px,min(1.1vw,2vh),20px)] leading-snug text-fg-2">{top.label}</p>
      </div>
      {rest.length > 0 && <Nest levels={rest} />}
    </motion.div>
  );
}
function DataTable({ head, rows, numericLast = false }: { head: string[]; rows: string[][]; numericLast?: boolean }) {
  const last = head.length - 1;
  return (
    <motion.div variants={item} className="glass max-w-[1100px] overflow-hidden rounded-2xl">
      <table className="w-full text-left text-[clamp(15px,min(1.1vw,2vh),22px)] leading-snug">
        <thead>
          <tr className="border-b border-line text-[0.85em] text-fg-3">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2 font-semibold sm:px-5 ${numericLast && i === last ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-line align-top last:border-0">
              {r.map((c, i) => (
                <td
                  key={i}
                  className={`px-4 py-2 sm:px-5 sm:py-2.5 ${
                    i === 0
                      ? "font-semibold"
                      : numericLast && i === last
                        ? "whitespace-nowrap text-right font-mono font-semibold [font-variant-numeric:tabular-nums]"
                        : "text-fg-2"
                  }`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  );
}

/*
 * Footage. Third-party videos are never copied or hosted: YouTube plays only through the official nocookie embed.
 * Every clip sits inline in its slide (see LiveVideo); nothing opens in a modal or a new tab.
 */
const VIDEO_AYAZAGA = "o5S9h2StcDE";
const VIDEO_IHA = "8dZj6plWY2E";

/**
 * Inline player (14-ekim: 16:9, problem: 9:16 Shorts). It is only in the DOM while the slide is mounted (Deck renders one slide at a
 * time), so leaving the slide removes the iframe and the video stops. Underneath the iframe sits a thumbnail + play
 * link; with no network the iframe is not rendered at all and that fallback shows. Always muted autoplay (the deck
 * is presented without sound).
 */
type LiveVideoProps = {
  id: string;
  title: string;
  caption: string;
  /** "16/9" (default) fills the column width; "9/16" is a tall Shorts box sized by viewport height. */
  aspect?: "16/9" | "9/16";
  /** Extra embed query params appended to the base ones (e.g. loop). */
  extra?: string;
};
function LiveVideo({ id, title, caption, aspect = "16/9", extra = "" }: LiveVideoProps) {
  const tall = aspect === "9/16";
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return (
    <motion.figure variants={item} className={`flex min-w-0 flex-col gap-3 ${tall ? "w-fit max-w-full" : "w-full"}`}>
      <div
        className={`relative overflow-hidden rounded-2xl bg-[#141d22] shadow-2xl ring-1 ring-white/10 ${
          tall ? "aspect-[9/16] h-[60vh] max-w-full md:h-[70vh]" : "aspect-video w-full"
        }`}
      >
        {/* fallback layer under the iframe: thumbnail + play, what stays when there is no network */}
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            className="absolute inset-0 size-full object-cover"
          />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-ember text-ink shadow-lg">
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z" />
            </svg>
          </span>
        </div>
        {online && (
          <>
            {/* no pointer events: a click on the video is a click on the slide (advances), and YouTube's title link and
                controls can't be hit by accident; always muted (the deck is presented without sound) */}
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&rel=0&playsinline=1${extra}`}
              title={title}
              tabIndex={-1}
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              className="pointer-events-none absolute inset-0 size-full border-0 bg-black"
            />
          </>
        )}
      </div>
      {/* source credit only, one line: w-0 + min-w-full keeps it to the video's width, truncate never wraps it */}
      <figcaption className="w-0 min-w-full truncate text-[clamp(12px,min(0.8vw,1.5vh),15px)] text-fg-3/80">{caption}</figcaption>
    </motion.figure>
  );
}

/** Closing slide actions: one big primary (straight into the simulation, Q&A happens there), a smaller secondary. */
function FinalCtas() {
  return (
    <motion.div variants={item} className="flex flex-wrap items-center gap-3 sm:gap-4">
      <Link
        href="/sinema"
        transitionTypes={["nav-forward"]}
        className="btn-ember group inline-flex min-h-16 items-center gap-3 rounded-2xl bg-ember px-8 text-[clamp(20px,min(1.7vw,3vh),32px)] font-extrabold text-ink shadow-lg lg:min-h-20 lg:px-10"
      >
        Tam simülasyonu izleyin
        <span className="transition-transform duration-200 group-hover:translate-x-1">
          <Arrow />
        </span>
      </Link>
      <Link
        href="/izmir?yagis=188"
        transitionTypes={["nav-forward"]}
        className={`glass transition-colors duration-150 hover:bg-white/10 ${ctaBase}`}
      >
        İzmir · 188 kg/m²
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
        {/* the cover carries the brand big; the top bar stays hidden here and appears from slide 2 */}
        <motion.div variants={item} className="flex items-center gap-[clamp(12px,1.1vw,22px)]">
          <Image src="/icon.png" alt="" width={96} height={96} priority className="size-[clamp(52px,min(4.6vw,8vh),96px)]" />
          <span className="font-display text-[clamp(38px,min(3.6vw,6.4vh),72px)] font-extrabold leading-none tracking-[-0.03em]">
            floodograph
          </span>
        </motion.div>
        <Title className="text-[clamp(32px,min(6vw,9vh),104px)]">
          Su yolunu her zaman bulur. <span className="text-ember">Biz ondan önce buluruz.</span>
        </Title>
        <Lead>Gömülü dereleri açık veriden yeniden çizer, seli saat saat simüle eder, önce hangi binaya gidileceğini söyler.</Lead>
        <Ctas />
        <motion.p variants={item} className="text-[clamp(16px,min(1.2vw,2.1vh),22px)] font-medium text-fg-3">
          EkoZeka 2026 · Takım SALU
        </motion.p>
      </>
    ),
  },
  {
    id: "14-ekim",
    nav: "14 Ekim",
    mood: { ...riverShot(-420, { dx: -260, dy: -320, dz: 150, lookZ: 20 }), depth: 5.5, rain: 1, buried: 0.15, contour: 0.35, ember: 0.15 },
    body: () => (
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-10">
        <motion.div variants={group} className="flex flex-col gap-4 sm:gap-6 [@media(max-height:720px)]:gap-3">
          <Eyebrow>14 Ekim 2026 · İstanbul</Eyebrow>
          <Title className="text-[clamp(30px,min(3.5vw,6.4vh),64px)]">Saat 17:30. Ayazağa&rsquo;da cadde bir nehre döndü.</Title>
          <Lead>
            Tek günde 188 kg/m² yağmur. 200 kişi mahsur kaldı, araçlar ve bir İETT otobüsü sürüklendi. Suyun nereden geçeceğini gösteren
            bir harita yoktu.
          </Lead>
        </motion.div>
        <LiveVideo
          id={VIDEO_AYAZAGA}
          title="14 Ekim, Ayazağa: Habertürk TV görüntüsü"
          caption="Kaynak: Habertürk TV"
          extra={`&modestbranding=1&loop=1&playlist=${VIDEO_AYAZAGA}`}
        />
      </div>
    ),
  },
  {
    id: "problem",
    nav: "Problem",
    mood: { ...riverShot(-120, { dx: -40, dy: -120, dz: 850 }), depth: 3, rain: 0, buried: 1, contour: 0.85, ember: 0 },
    body: () => (
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
        <motion.div variants={group} className="flex flex-col gap-4 sm:gap-6 [@media(max-height:720px)]:gap-3">
          <Eyebrow>Problem</Eyebrow>
          <Title>
            Dereyi betonla örttük. <span className="text-ember">Su, yolunu unutmadı.</span>
          </Title>
          <Lead>Üstü kapatılan dere haritadan silinir, eğim yerinde kalır. Kuvvetli yağışta su eski yatağına döner.</Lead>
          <motion.div variants={group} className="grid max-w-[900px] grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <Stat value={59} label="Pilot bölgede arazide olup haritada olmayan akış koridoru (32,5 km)" ember />
            <Stat value={3706} label="İstanbul genelinde bulduğumuz akış koridoru" />
          </motion.div>
        </motion.div>
        <LiveVideo
          id="Lm_YAwsHXLQ"
          title="Maltepe TV: apartmanların altından dere akıyor"
          caption="Kaynak: Maltepe TV"
          aspect="9/16"
          extra="&loop=1&playlist=Lm_YAwsHXLQ"
        />
      </div>
    ),
  },
  {
    id: "cozum",
    nav: "Çözüm",
    mood: { ...riverShot(150, { dx: -260, dy: 420, dz: 360 }), depth: 4.5, rain: 0.3, buried: 0.5, contour: 1, ember: 0 },
    body: () => (
      <>
        <Eyebrow>Çözüm</Eyebrow>
        <Title>
          Dereyi bul, seli oynat, <span className="text-ember">binayı sırala.</span>
        </Title>
        <Cards
          numbered
          items={[
            ["Gömülü dereyi buluruz", "Yükseklik verisinden suyun gerçek akış yollarını çıkarırız. Haritada olmayan dereler de bu yolların içinde."],
            ["Seli saat saat oynatırız", "Gerçek yağışı fizik tabanlı bir su modeline veririz. Suyun hangi saatte, hangi sokakta, kaç metreye çıktığını görürüz."],
            ["Binaları sıralarız", "Her binaya bir aciliyet kademesi veririz. Okullar ve hastaneler listenin başına geçer."],
          ]}
        />
      </>
    ),
  },
  {
    id: "kanit",
    nav: "Kanıt",
    mood: { ...riverShot(650, { dx: 220, dy: -420, dz: 260 }), depth: 10, rain: 0.4, buried: 0.2, contour: 0.5, ember: 0.4 },
    body: () => (
      <>
        <Eyebrow>Kanıt · 14 Ekim</Eyebrow>
        <Title>
          14 Ekim&rsquo;i yeniden oynattık: <span className="text-ember">9 noktanın 7&rsquo;si tuttu.</span>
        </Title>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-8">
          <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
            <motion.div variants={group} className="grid grid-cols-2 gap-3">
              <Stat small value={3650} label="Su baskını olan bina" ember />
              <Stat small value={128} label="Su baskını olan okul, hastane ve kritik tesis" />
            </motion.div>
            <DataTable
              head={["Yer", "Gözlenen", "Model"]}
              numericLast
              rows={[
                ["Ayazağa Meydanı", "Restoranda 1,5–2 m su", "1,54 m"],
                ["Dereboyu Caddesi", "Mağazada 1,70 m su", "2,76 m"],
                ["Kemerburgaz Caddesi", "1 m'yi aşan su, botla kurtarma", "2,08 m"],
                ["Su 0,5 m'ye ne zaman çıktı", "~17:30", "18:10"],
              ]}
            />
            <Note>Model bu olaya göre kalibre edildi; bağımsız sınama uydu verisiyle yapılacak.</Note>
          </div>
          {/* the width cap keeps the 16:9 box under ~42vh tall, so the slide still fits 1366x768 */}
          <div className="w-full min-w-0 max-w-[calc(42vh*16/9)]">
            <LiveVideo id={VIDEO_IHA} title="14 Ekim, Ayazağa: İhlas Haber Ajansı görüntüsü" caption="Kaynak: İHA" />
          </div>
        </div>
      </>
    ),
  },
  {
    id: "yapay-zeka",
    nav: "Yapay zekâ",
    mood: { ...riverShot(500, { dx: 0, dy: -60, dz: 1100 }), depth: 9, rain: 0, buried: 0.3, contour: 1, ember: 0.2 },
    body: () => (
      <>
        <Eyebrow>Yapay zekâ ve fizik</Eyebrow>
        <Title>
          Binaları yapay zekâ buldu, <span className="text-ember">suyu fizik hesapladı.</span>
        </Title>
        <Cards
          items={[
            ["Eksik binaları yapay zekâ buldu", "Haritalarda 11.841 bina vardı. Uydu görüntülerinden derin öğrenmeyle çıkarılan bina izleriyle bu sayı 16.787'ye çıktı."],
            ["Suyun yolunu fizik hesaplar", "Su eğimle akar; bunu sığ su denklemleri hesaplar. 14 Ekim gibi nadir bir selden öğrenecek kadar veri yok, bu yüzden modeli fiziğe dayandırdık."],
            ["Dakikalar içinde sonuç", "30 saatlik bir seli ekran kartında 3 dakikada hesaplıyoruz. Yeni bir yağış tahmini geldiğinde senaryo dakikalar içinde hazır olur."],
          ]}
        />
      </>
    ),
  },
  {
    id: "pazar",
    nav: "Pazar",
    mood: { ...riverShot(850, { dx: 260, dy: -300, dz: 380 }), depth: 7, rain: 0.2, buried: 0.3, contour: 0.7, ember: 0.2 },
    body: () => (
      <>
        <Eyebrow>Pazar ve rakipler</Eyebrow>
        <Title>Türkiye&rsquo;de selin yıllık faturası 100–300 milyon dolar.</Title>
        {/* nested boxes: global market contains our first customer base contains the regulatory pull */}
        <Nest
          levels={[
            { value: "1,8", unit: "milyar $", label: "Küresel iklim riski analitiği pazarı (2025)" },
            { value: "1.003", unit: "belediye", label: "30 büyükşehir, 51 il, 922 ilçe: ilk müşteri kitlemiz" },
            {
              value: "TSRS 2",
              label: "Bankalar ve büyük şirketler sel dahil fiziksel iklim riskini raporlamak zorunda",
              ember: true,
            },
          ]}
        />
        <motion.p
          variants={item}
          className="max-w-[62ch] text-[clamp(16px,min(1.3vw,2.4vh),26px)] font-medium leading-snug text-fg-2"
        >
          Fathom ve JBA harita satar, ICEYE seli olduktan sonra görür, HEC-RAS aylar ister.{" "}
          <span className="font-semibold text-ember">Biz: açık veriden otomatik, gerçek olayla kalibre, bina bazında.</span>
        </motion.p>
        <Note>Kaynak: EM-DAT/DSİ, Fortune Business Insights, KGK.</Note>
        <Note>
          TSRS: Türkiye Sürdürülebilirlik Raporlama Standartları (KGK). TSRS 2, sel gibi fiziksel iklim risklerinin
          raporlanmasını ister.
        </Note>
      </>
    ),
  },
  {
    id: "is-modeli",
    nav: "İş modeli",
    mood: { ...riverShot(700, { dx: -300, dy: 260, dz: 420 }), depth: 6, rain: 0.1, buried: 0.4, contour: 0.8, ember: 0.2 },
    body: () => (
      <>
        <Eyebrow>İş modeli</Eyebrow>
        <Title>
          Vatandaşa ücretsiz, <span className="text-ember">kuruma lisanslı.</span>
        </Title>
        <motion.div variants={group} className="grid max-w-[1200px] gap-3 md:grid-cols-3 md:gap-4">
          {[
            {
              who: "Belediyeler",
              head: "Yıllık abonelik",
              gets: "Güncel dere koridoru haritası, yağış senaryoları, bina bazında aciliyet listesi; model her yıl yenilenir.",
              pays: "Kurulum + nüfusa göre yıllık lisans.",
            },
            {
              who: "Banka, sigorta, büyük şirketler",
              head: "Risk verisi ve API",
              gets: "Tesis ya da adres bazında sel riski; TSRS 2 raporuna hazır çıktı.",
              pays: "Tesis başına yıllık ücret ya da API kullanımı.",
            },
            {
              who: "Altyapı ve dönüşüm projeleri",
              head: "Proje bazlı analiz",
              gets: "Dere ıslahı, kentsel dönüşüm ve kanal yatırımı için 'önce ve sonra' sel senaryosu.",
              pays: "Proje başına.",
            },
          ].map((c) => (
            <motion.div key={c.head} variants={item} className="glass flex flex-col gap-2 rounded-2xl p-4 sm:gap-3 sm:p-6">
              <span className="text-[clamp(14px,min(1.05vw,1.9vh),20px)] font-semibold leading-snug text-ember">{c.who}</span>
              <span className="font-display text-[clamp(18px,min(1.35vw,2.4vh),26px)] font-bold leading-tight">{c.head}</span>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[clamp(15px,min(1.05vw,1.85vh),20px)] leading-snug sm:gap-y-3">
                <dt className="text-fg-3">Ne alır</dt>
                <dd className="text-fg-2">{c.gets}</dd>
                <dt className="text-fg-3">Nasıl öder</dt>
                <dd className="text-fg-2">{c.pays}</dd>
              </dl>
            </motion.div>
          ))}
        </motion.div>
        <motion.p
          variants={item}
          className="max-w-[1200px] border-t border-line pt-3 text-[clamp(16px,min(1.2vw,2.2vh),24px)] leading-snug text-fg-2 sm:pt-4"
        >
          <strong className="font-extrabold text-fg">Vatandaş ücretsiz:</strong> kendi sokağını görür; bu görünürlük belediyeye talep
          yaratır, bildirimler modeli besler.
        </motion.p>
        <Note>Satış yolu: ücretsiz pilot → yıllık lisans. İlk belediye, sonrakiler için referans olur.</Note>
      </>
    ),
  },
  {
    id: "riskler",
    nav: "Sıradaki adımlar",
    mood: { ...riverShot(300, { dx: -900, dy: -1100, dz: 950 }), depth: 2.5, rain: 0, buried: 0.7, contour: 0.7, ember: 0 },
    body: () => (
      <>
        <Eyebrow>Sıradaki adımlar</Eyebrow>
        <Title>
          Sahaya çıkmadan önce <span className="text-ember">dört adım.</span>
        </Title>
        <motion.ul variants={group} className="flex max-w-[1100px] flex-col">
          {[
            ["Bağımsız doğrulama", "Uydu taşkın haritalarıyla isabet, IoU ve yanlış alarm oranını ölçeceğiz."],
            ["Boru ağı", "İSKİ kanal verisiyle kanalizasyondan gelen suyu da modele katacağız."],
            ["Ticari veri", "FABDEM yerine ticari kullanıma açık yükseklik verisine geçeceğiz."],
            ["Gizlilik", "Kişisel veri işlemiyoruz; bina bazlı risk yalnız kurumlarla paylaşılır."],
          ].map(([head, t]) => (
            <motion.li
              key={head}
              variants={item}
              className="flex items-baseline gap-4 border-b border-line py-3 text-[clamp(18px,min(1.7vw,3vh),34px)] font-medium leading-snug text-fg-2 last:border-0 sm:py-4"
            >
              <span aria-hidden="true" className="size-2.5 shrink-0 -translate-y-0.5 rounded-full bg-ember" />
              <span>
                <strong className="font-extrabold text-fg">{head}:</strong> {t}
              </span>
            </motion.li>
          ))}
        </motion.ul>
        <motion.ol
          variants={item}
          aria-label="Yol haritası"
          className="flex max-w-[1100px] flex-col gap-2 text-[clamp(15px,min(1.2vw,2.2vh),22px)] leading-snug md:flex-row md:items-center md:gap-3"
        >
          {[
            ["0–6 ay", "İBB pilotu"],
            ["6–12 ay", "ilk lisans, İzmir"],
            ["1–2 yıl", "her ilçe"],
          ].map(([when, what], i) => (
            <li key={when} className="flex items-center gap-3 md:contents">
              {i > 0 && <span aria-hidden="true" className="hidden h-px min-w-6 flex-1 bg-line md:block" />}
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-ember" />
                <span>
                  <strong className="font-extrabold text-fg">{when}:</strong> <span className="text-fg-2">{what}</span>
                </span>
              </span>
            </li>
          ))}
        </motion.ol>
        <Note>Pilot çalışma; resmi sel risk haritasının yerine geçmez, onu besler.</Note>
      </>
    ),
  },
  {
    id: "kapanis",
    nav: "Çağrı",
    mood: { ...riverShot(-700, { dx: -650, dy: -700, dz: 520 }), depth: 3, rain: 0.1, buried: 0.5, contour: 0.6, ember: 0 },
    body: () => (
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
        <motion.div variants={group} className="flex min-w-0 flex-col gap-4 sm:gap-6 [@media(max-height:720px)]:gap-3">
        <Eyebrow>Takım SALU</Eyebrow>
        <motion.ul variants={group} className="flex flex-wrap gap-2">
          {["Atakan Çalışkan", "Meriç Özkaya", "Funda Zeynep Şarkışla"].map((n) => (
            <motion.li
              key={n}
              variants={item}
              className="glass rounded-xl px-4 py-1.5 text-[clamp(15px,min(1.1vw,2vh),20px)] font-semibold"
            >
              {n}
            </motion.li>
          ))}
        </motion.ul>
        <Title className="text-[clamp(30px,min(4.2vw,7.4vh),76px)]">İlk pilot belediyemizi arıyoruz.</Title>
        <Lead>
          Bize bir dere havzası ve menfez verisi verin; size o şehrin ilk güncel sel koridoru haritasını verelim.
        </Lead>
        <motion.p
          variants={item}
          className="font-display text-[clamp(36px,min(5.4vw,8.6vh),96px)] font-extrabold leading-none tracking-[-0.02em]"
        >
          Teşekkürler<span className="text-ember">.</span>
        </motion.p>
        <FinalCtas />
        <motion.p variants={item} className="flex flex-wrap gap-x-4 gap-y-1 text-[clamp(15px,min(1.1vw,2vh),20px)] text-fg-2">
          <span>EkoZeka 2026 · Takım SALU</span>
          <a
            href="https://github.com/atakanclskn/floodograph"
            className="underline decoration-line underline-offset-4 hover:text-fg"
          >
            github.com/atakanclskn/floodograph
          </a>
        </motion.p>
        <Note>Veri: FABDEM CC BY-NC-SA, OSM ve Overture ODbL, ERA5, İBB.</Note>
        </motion.div>
        {/* scan to open the live site on a phone */}
        <motion.figure variants={item} className="flex flex-col items-center gap-3 justify-self-start md:justify-self-end">
          <div className="rounded-3xl bg-white p-[clamp(10px,0.9vw,18px)] shadow-2xl ring-1 ring-white/20">
            <Image
              src="/img/qr-floodograph.png"
              alt="floodograph.vercel.app adresine giden QR kod"
              width={450}
              height={450}
              className="size-[clamp(150px,min(16vw,30vh),300px)]"
            />
          </div>
          <figcaption className="font-mono text-[clamp(13px,min(0.95vw,1.7vh),17px)] text-fg-2">floodograph.vercel.app</figcaption>
        </motion.figure>
      </div>
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
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const linked = useRef<string | null>(null); // the #slide the page was opened with
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

  /** Next/previous for keys and the arrow button: if the slide's own content still has more to show in that
   * direction, scroll it by most of a page first; change slide only from its edge. */
  const advance = useCallback(
    (d: number) => {
      const sc = document.querySelector<HTMLElement>("[data-deck-scroll]");
      if (sc) {
        const more = d > 0 ? sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2 : sc.scrollTop > 2;
        if (more) {
          sc.scrollBy({ top: d * sc.clientHeight * 0.8, behavior: reduce ? "auto" : "smooth" });
          return;
        }
      }
      step(d);
    },
    [step, reduce],
  );

  // overflow cue: fade the bottom edge of a slide whose content continues below
  useEffect(() => {
    let raf = 0;
    const mark = () => {
      const sc = document.querySelector<HTMLElement>("[data-deck-scroll]");
      if (sc) sc.dataset.more = sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2 ? "1" : "0";
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(mark);
    };
    // Only once the staggered items have settled ("deck-settled"): while they still slide up, their offset inflates
    // the scroll height, the cue switched on mid-transition and snapped off a moment later (the bottom of every
    // slide looked faded, then popped in). Fallback for when no animation runs.
    const t = setTimeout(mark, 1800);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("deck-settled", onScroll);
    window.addEventListener("resize", onScroll);
    return () => {
      clearTimeout(t);
      document.removeEventListener("deck-settled", onScroll);
      cancelAnimationFrame(raf);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [idx]);

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
  // deep link: must read the hash before the effect below rewrites the URL for slide 0
  useEffect(() => {
    linked.current ??= location.hash.slice(1);
    const i = SLIDES.findIndex((s) => s.id === linked.current);
    if (i <= 0) return;
    const r = requestAnimationFrame(() => go(i)); // after hydration, so server and client markup match
    return () => cancelAnimationFrame(r);
  }, [go]);

  useEffect(() => {
    backdrop.current?.setMood(SLIDES[idx]!.mood);
    const id = SLIDES[idx]!.id;
    if (location.hash.slice(1) !== id) history.replaceState(null, "", idx === 0 ? location.pathname : `#${id}`);
  }, [idx]);

  // keyboard, wheel, touch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      // Space / Enter belong to the focused control (button, link); presenter clickers send PageDown/PageUp anyway
      const onControl = !!el && ["BUTTON", "A"].includes(el.tagName);
      const pressed = (e.key === " " || e.key === "Enter") && !onControl;
      if (["ArrowDown", "PageDown", "ArrowRight"].includes(e.key) || (pressed && !e.shiftKey)) {
        e.preventDefault();
        advance(1);
      } else if (["ArrowUp", "PageUp", "ArrowLeft"].includes(e.key) || (pressed && e.shiftKey)) {
        e.preventDefault();
        advance(-1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n - 1);
    };
    let acc = 0;
    let accT = 0;
    const onWheel = (e: WheelEvent) => {
      const sc = (e.target as Element | null)?.closest?.("[data-deck-scroll]") as HTMLElement | null;
      if (sc && Math.abs(e.deltaY) > 0) {
        const more = e.deltaY > 0 ? sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1 : sc.scrollTop > 1;
        if (more) {
          acc = 0;
          return; // native scroll inside the slide
        }
      }
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
    let x0 = 0;
    let scrollable: HTMLElement | null = null;
    let atTop = true;
    let atBottom = true;
    const onStart = (e: TouchEvent) => {
      y0 = e.touches[0]?.clientY ?? null;
      x0 = e.touches[0]?.clientX ?? 0;
      scrollable = (e.target as Element | null)?.closest?.("[data-deck-scroll]") ?? null;
      atTop = !scrollable || scrollable.scrollTop <= 1;
      atBottom = !scrollable || scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
    };
    const onEnd = (e: TouchEvent) => {
      if (y0 == null) return;
      const t = e.changedTouches[0];
      const dy = y0 - (t?.clientY ?? y0);
      const dx = x0 - (t?.clientX ?? x0);
      y0 = null;
      if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx)) return;
      // inside a slide that scrolls: only change slide from its top / bottom edge
      if (dy > 0 && !atBottom) return;
      if (dy < 0 && !atTop) return;
      step(dy > 0 ? 1 : -1);
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
  }, [go, step, advance, n]);

  const slide = SLIDES[idx]!;
  const last = idx === n - 1;

  return (
    // Deck-only fonts: remap the site's display/sans variables on this subtree, the rest of the site is untouched.
    <div
      // a plain left click (or tap) anywhere advances; links, buttons and the player dialog do their own thing
      onPointerDown={(e) => {
        pointerStart.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
      }}
      onPointerUp={(e) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (!start || e.button !== 0 || last) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 6) return; // drag, not a click
        if ((e.target as Element).closest("a, button, input, select, textarea, [data-no-advance]")) return;
        if (window.getSelection()?.isCollapsed === false) return; // text was selected
        advance(1);
      }}
      className="fixed inset-0 touch-pinch-zoom overflow-hidden overscroll-none bg-ink font-sans [--font-bricolage:var(--font-deck-display)] [--font-geist-sans:var(--font-deck-body)]">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {/* legibility scrim: content sits on the left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(10_15_18/0.92)_0%,rgb(10_15_18/0.8)_50%,rgb(10_15_18/0.45)_80%,rgb(10_15_18/0.25)_100%)] max-md:bg-[linear-gradient(180deg,rgb(10_15_18/0.35)_0%,rgb(10_15_18/0.9)_55%)]"
      />

      <header
        inert={idx === 0}
        className={`absolute left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-20 flex items-center justify-between transition-[opacity,transform] duration-500 ease-out sm:left-[max(2rem,env(safe-area-inset-left))] sm:right-[max(2rem,env(safe-area-inset-right))] ${
          idx === 0 ? "pointer-events-none -translate-y-4 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <button type="button" onClick={() => go(0)} className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2.5 pr-4">
          <Image src="/icon.png" alt="" width={34} height={34} />
          <span className="font-display text-[clamp(18px,1.3vw,24px)] font-extrabold tracking-[-0.02em]">floodograph</span>
        </button>
        <div className="flex items-center gap-2">
          <Link href="/izmir" transitionTypes={["nav-forward"]} className="glass hidden min-h-11 items-center rounded-xl px-4 text-base font-semibold sm:inline-flex">
            İzmir
          </Link>
          <Link href="/sinema" transitionTypes={["nav-forward"]} className="btn-ember inline-flex min-h-11 items-center gap-2 rounded-xl bg-ember px-4 text-base font-semibold text-ink">
            <Play />
            İstanbul
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex h-full items-center pb-[calc(6.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(5rem+env(safe-area-inset-top))] [@media(max-height:720px)]:pb-[calc(5.5rem+env(safe-area-inset-bottom))] [@media(max-height:720px)]:pt-[calc(4.25rem+env(safe-area-inset-top))] sm:pl-[max(2.5rem,env(safe-area-inset-left))] sm:pr-[max(2.5rem,env(safe-area-inset-right))] lg:pl-20 md:pr-36 lg:pr-44 max-md:items-end">
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
            data-deck-scroll
            className="flex max-h-full w-full max-w-[1280px] touch-pan-y touch-pinch-zoom flex-col gap-6 overflow-y-auto overscroll-contain [scrollbar-width:none]"
          >
            <motion.div
              variants={group}
              initial="hidden"
              animate="show"
              onAnimationComplete={() => document.dispatchEvent(new Event("deck-settled"))}
              className="flex flex-col gap-4 sm:gap-6 [@media(max-height:720px)]:gap-3">
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
            <span className={`text-[clamp(14px,1vw,18px)] font-medium transition-opacity duration-200 ${i === idx ? "text-fg opacity-100" : "text-fg-3 opacity-0 group-hover:opacity-100"}`}>
              {s.nav}
            </span>
            <span
              className={`block rounded-full transition-all duration-300 ${i === idx ? "h-6 w-1.5 bg-ember" : "h-1.5 w-1.5 bg-fg-3/60 group-hover:bg-fg-2"}`}
            />
          </button>
        ))}
      </nav>

      <div className="absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => (last ? go(0) : advance(1))}
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
        <span className="font-mono text-[clamp(13px,0.9vw,16px)] text-fg-3 [font-variant-numeric:tabular-nums]">
          {String(idx + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>
      </div>

    </div>
  );
}

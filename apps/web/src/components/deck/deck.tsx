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
      className={`font-display text-[clamp(28px,min(4.8vw,7.5vh),72px)] font-semibold leading-[1] tracking-[-0.035em] [text-wrap:balance] ${className}`}
    >
      {children}
    </motion.h2>
  );
}
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <motion.p variants={item} className="max-w-[620px] text-[clamp(15px,1.5vw,20px)] leading-relaxed text-fg-2">
      {children}
    </motion.p>
  );
}
function Stat({ value, unit, label, ember = false, raw }: { value?: number; unit?: string; label: string; ember?: boolean; raw?: string }) {
  return (
    <motion.div variants={item} className="glass flex flex-col gap-1.5 rounded-2xl p-3.5 sm:gap-2 sm:p-5">
      <p className={`font-mono text-[clamp(24px,3.4vw,48px)] font-medium leading-none tracking-[-0.04em] ${ember ? "text-ember" : "text-fg"}`}>
        {raw ?? <CountUp value={value ?? 0} />}
        {unit && <span className="ml-1.5 text-[0.45em] font-normal tracking-normal text-fg-3">{unit}</span>}
      </p>
      <p className="text-xs leading-snug text-fg-2 sm:text-sm">{label}</p>
    </motion.div>
  );
}
function Cards({ items, numbered = false }: { items: string[][]; numbered?: boolean }) {
  return (
    <motion.div variants={group} className="grid max-w-[960px] gap-2 md:grid-cols-3 md:gap-3">
      {items.map(([h, p], i) => (
        <motion.div key={h} variants={item} className="glass flex flex-col gap-1.5 rounded-2xl p-3.5 sm:gap-2 sm:p-5">
          {numbered && <span className="font-mono text-xs text-ember">0{i + 1}</span>}
          <span className="font-display text-lg font-semibold leading-tight sm:text-xl">{h}</span>
          <span className="text-[13px] leading-relaxed text-fg-2 sm:text-sm">{p}</span>
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
        <Title className="text-[clamp(32px,min(6.4vw,9.5vh),96px)]">
          Su yolunu her zaman bulur. <span className="text-ember">Biz ondan önce buluruz.</span>
        </Title>
        <Lead>
          Şehrin altına gömülen dereleri açık yükseklik verisinden yeniden bulur, seli fizik tabanlı bir modelle saat saat
          simüle eder ve binaları müdahale önceliğine göre sıralar.
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
        <Title>Bir günde, bir aydan fazla yağmur.</Title>
        <Lead>
          Ayazağa’da dere taştı, caddeler nehre döndü, araçlar ve bir İETT otobüsü sürüklendi. Suyun hangi sokaktan geçeceğini
          önceden gösteren güncel bir harita yoktu.
        </Lead>
        <motion.div variants={group} className="grid max-w-[760px] grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat raw="1985" label="İBB'ye göre bu yıldan beri en yağışlı gün" />
          <Stat value={150} unit="mm" label="Sarıyer istasyonunda günlük toplam yağış" />
          <Stat raw="29,2" unit="mm/sa" label="En yüksek saatlik yağış (19:00)" />
          <Stat raw="≥3" label="Can kaybı (kesin sayı henüz netleşmedi)" ember />
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
          Üstü betonla kapatılan dereler, <span className="text-ember">selde yeniden akıyor.</span>
        </Title>
        <Lead>
          Üstü betonla örtülen dere haritadan silinir, ama arazinin eğimi değişmez. Kuvvetli yağışta su eski yatağını bulur ve
          o yatağın üstüne yapılmış binaları basar.
        </Lead>
        <motion.div variants={group} className="grid max-w-[700px] grid-cols-3 gap-2 sm:gap-3">
          <Stat value={59} label="Arazide var, haritada yok: toplam 32,5 km akış koridoru" ember />
          <Stat value={4} label="OSM'de kayıtlı gömülü dere parçası" />
          <Stat value={22} label="OSM'de kayıtlı açık dere" />
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
        <motion.ol variants={group} className="grid max-w-[980px] gap-2 sm:grid-cols-5 sm:gap-3">
          {[
            ["FABDEM", "Binalardan ve ağaçlardan arındırılmış 30 m yükseklik modeli."],
            ["Dere ağı + HAND", "Suyun akış yönü ve biriktiği yerler; her binanın en yakın dere yatağına göre yüksekliği."],
            ["16.787 bina", "Overture verisi: OpenStreetMap ve Microsoft'un uydu görüntüsünden çıkardığı bina tabanları."],
            ["Sığ su çözücüsü", "HEC-RAS ile aynı sınıftan 2B denklemler; gerçek yağış ve 73 menfezle, ekran kartında çalışır."],
            ["Aciliyet", "Dört kademe: acil, yüksek, orta, izle. Okul ve hastaneler bir kademe yukarı alınır."],
          ].map(([h, p], i) => (
            <motion.li key={h} variants={item} className="glass flex flex-col gap-1 rounded-2xl p-3 sm:gap-2 sm:p-4">
              <span className="font-mono text-xs text-ember">0{i + 1}</span>
              <span className="font-display text-base font-semibold leading-tight sm:text-lg">{h}</span>
              <span className="text-xs leading-snug text-fg-2 sm:text-[13px]">{p}</span>
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
          <Stat value={408} label="Su derinliğinin 0,5 m'yi aştığı bina" ember />
          <Stat value={1366} unit="ha" label="Selin en yaygın anında su altındaki alan" />
          <Stat raw="15/73" label="Taşan menfez; ilki saat 18:32'de" />
        </motion.div>
        <Lead>Su basan binaların çoğu eski dere yataklarının ve haritada olmayan akış koridorlarının üstünde. Aciliyet listesi bu sonuçlardan çıkarılıyor.</Lead>
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
        <Title>Haberlerdeki su baskınları, modelde de var.</Title>
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
                  <td className="px-3 py-2 text-[13px] text-fg-2 sm:px-4 sm:py-2.5 sm:text-sm">{k}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] sm:px-4 sm:py-2.5 sm:text-sm">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        <Lead>
          Değerler, haberlerde su basan noktalarda modelin en yüksek su derinliği. 0,5 m eşiğinde 5 noktanın 3’ü isabetli;
          rastgele bir nokta için bu oran %22. Daha güçlü doğrulama için uydu taşkın haritası gerekiyor.
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
          <Stat raw="1:1" label="CPU ve GPU aynı sonucu veriyor" />
          <Stat raw="10⁻¹⁴" label="Göreli kütle korunumu hatası" />
          <Stat raw="8/8" label="Analitik testin tamamı geçti: durgun göl, kütle korunumu, baraj yıkılması" />
        </motion.div>
        <Lead>HEC-RAS’ın tüm özelliklerini sunmuyoruz; ama çekirdekteki denklemler aynı sınıftan. Farkımız, modelin Türkiye’nin her yerinde açık veriden otomatik olarak kurulması.</Lead>
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
        <Cards
          items={[
            ["Belediyeler", "İBB AKOM, İZSU: sınırlı bütçeyle önce hangi koridora, hangi okula müdahale edileceğine karar vermek için."],
            ["Şirketler ve bankalar", "TSRS 2, sel dahil fiziksel iklim risklerinin raporlanmasını şart koşuyor. Floodograph bu rapora tesis bazında sel riski verisi sağlar."],
            ["Afet hazırlığı", "Suyun hangi saatte nereye ulaşacağını bilerek tahliye ve ekip planlaması yapmak için."],
          ]}
        />
      </>
    ),
  },
  {
    id: "gelir",
    nav: "Gelir modeli",
    mood: { ...riverShot(700, { dx: -300, dy: 260, dz: 420 }), depth: 6, rain: 0.1, buried: 0.4, contour: 0.8, ember: 0.2 },
    body: () => (
      <>
        <Eyebrow n="08">Gelir modeli</Eyebrow>
        <Title>
          Vatandaşa ücretsiz, <span className="text-ember">kuruma lisanslı.</span>
        </Title>
        <Cards
          items={[
            ["Belediye aboneliği", "Şehir başına kurulum ve yıllık lisans: güncel koridor haritası, sel senaryoları, aciliyet listesi."],
            ["Kurumsal risk verisi", "Sigorta, banka ve şirketlere adres ya da tesis bazında sel riski skoru; API ve TSRS 2 raporu."],
            ["Ücretsiz açık katman", "Vatandaş kendi sokağının riskini görür; bildirimleri modelin doğrulanmasına geri döner."],
          ]}
        />
      </>
    ),
  },
  {
    id: "is-birligi",
    nav: "İş birlikleri",
    mood: { ...riverShot(850, { dx: 260, dy: -300, dz: 380 }), depth: 7, rain: 0.2, buried: 0.3, contour: 0.7, ember: 0.2 },
    body: () => (
      <>
        <Eyebrow n="09">İş birlikleri</Eyebrow>
        <Title>Veri sahada, karar kurumda.</Title>
        <Cards
          items={[
            ["Belediye ve su idareleri", "İBB AKOM, İSKİ, İZSU: menfez ve kanal verisiyle modeli kalibre etmek, sonuçları sahada denetlemek."],
            ["Kamu ve meteoroloji", "AFAD ve MGM: anlık yağış ve tahmin verisiyle önceden uyarı, afet planlarına entegrasyon."],
            ["Üniversite ve sigorta", "Uydu taşkın haritalarıyla bağımsız doğrulama; sigorta sektörüyle risk fiyatlaması pilotu."],
          ]}
        />
      </>
    ),
  },
  {
    id: "gelecek",
    nav: "Gelecek planı",
    mood: { ...riverShot(250, { dx: 500, dy: 600, dz: 700 }), depth: 4, rain: 0.1, buried: 0.6, contour: 0.9, ember: 0.1 },
    body: () => (
      <>
        <Eyebrow n="10">Gelecek planı</Eyebrow>
        <Title>Sarıyer’den Türkiye’ye.</Title>
        <Cards
          numbered
          items={[
            ["0–6 ay", "Uydu taşkın haritasıyla doğrulama; İSKİ menfez verisiyle kalibrasyon; ilk belediye pilotu."],
            ["6–12 ay", "İzmir ve Ankara saha pilotları; yağış tahminiyle saatler önceden uyarı; mobil bildirim."],
            ["1–2 yıl", "Türkiye’nin her ilçesinde otomatik kurulum; daha ince ızgarayla sokak ölçeğinde sonuç."],
          ]}
        />
      </>
    ),
  },
  {
    id: "demo",
    nav: "Demo",
    mood: { ...riverShot(620, { dx: -160, dy: -120, dz: 45, lookZ: 6 }), depth: 13, rain: 0.8, buried: 0.2, contour: 0.4, ember: 1 },
    body: () => (
      <>
        <Eyebrow n="11">Canlı</Eyebrow>
        <Title>Kendiniz görün.</Title>
        <Lead>
          Analiz haritasında binalara tıklayın, 14 Ekim’i saat saat oynatın. Sinemada selin dere yataklarından taşışını 3B izleyin.
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
        <Eyebrow n="12">Takım SALU</Eyebrow>
        <Title>
          Bilgisayar bilimi, görüntü işleme, otomasyon. <span className="text-ember">Tek hedef: seli önceden görmek.</span>
        </Title>
        <motion.ul variants={group} className="flex flex-wrap gap-3">
          {["Atakan Çalışkan", "Meriç Özkaya", "Funda Zeynep Şarkışla"].map((n) => (
            <motion.li key={n} variants={item} className="glass rounded-2xl px-4 py-2.5 font-display text-base font-semibold sm:px-5 sm:py-3 sm:text-lg">
              {n}
            </motion.li>
          ))}
        </motion.ul>
        <motion.p variants={item} className="max-w-[640px] text-sm leading-relaxed text-fg-2">
          <span className="text-fg">Sınırlamalar:</span> 20 m ızgara, tahmini menfez kapasiteleri; resmi risk haritası değildir.
          Veri: FABDEM CC BY-NC-SA, OSM ve Overture ODbL.
        </motion.p>
      </>
    ),
  },
  {
    id: "tesekkurler",
    nav: "Teşekkürler",
    mood: { ...riverShot(-700, { dx: -650, dy: -700, dz: 520 }), depth: 3, rain: 0.1, buried: 0.5, contour: 0.6, ember: 0 },
    body: () => (
      <>
        <motion.div variants={item} className="flex items-center gap-3">
          <Image src="/icon.png" alt="" width={40} height={40} />
          <span className="font-display text-2xl font-bold tracking-[-0.02em]">floodograph</span>
        </motion.div>
        <Title className="text-[clamp(40px,min(8vw,12vh),120px)]">
          Teşekkürler<span className="text-ember">.</span>
        </Title>
        <Lead>Dinlediğiniz için teşekkür ederiz. Sorularınızı bekliyoruz.</Lead>
        <Ctas />
        <motion.p variants={item} className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm text-fg-2">
          <span>EkoZeka 2026 · Takım SALU</span>
          <a
            href="https://github.com/atakanclskn/floodograph"
            className="underline decoration-line underline-offset-4 hover:text-fg"
          >
            github.com/atakanclskn/floodograph
          </a>
        </motion.p>
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
    // after the enter transition, and again once the staggered items have settled (their offset inflates the height)
    const t = setTimeout(mark, 700);
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
      if (["ArrowDown", "PageDown", "ArrowRight"].includes(e.key) || (e.key === " " && !e.shiftKey)) {
        e.preventDefault();
        advance(1);
      } else if (["ArrowUp", "PageUp", "ArrowLeft"].includes(e.key) || (e.key === " " && e.shiftKey)) {
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
    <div className="fixed inset-0 touch-pinch-zoom overflow-hidden overscroll-none bg-ink">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {/* legibility scrim: content sits on the left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(10_15_18/0.92)_0%,rgb(10_15_18/0.8)_50%,rgb(10_15_18/0.45)_80%,rgb(10_15_18/0.25)_100%)] max-md:bg-[linear-gradient(180deg,rgb(10_15_18/0.35)_0%,rgb(10_15_18/0.9)_55%)]"
      />

      <header className="absolute left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-20 flex items-center justify-between sm:left-[max(2rem,env(safe-area-inset-left))] sm:right-[max(2rem,env(safe-area-inset-right))]">
        <button type="button" onClick={() => go(0)} className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2.5 pr-4">
          <Image src="/icon.png" alt="" width={26} height={26} />
          <span className="font-display text-[17px] font-bold tracking-[-0.02em]">floodograph</span>
        </button>
        <div className="flex items-center gap-2">
          <Link href="/sehirler" transitionTypes={["nav-forward"]} className="glass hidden min-h-11 items-center rounded-xl px-4 text-sm font-semibold sm:inline-flex">
            Şehirler
          </Link>
          <Link href="/sinema" transitionTypes={["nav-forward"]} className="glass hidden min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold sm:inline-flex">
            <Play />
            Sinema
          </Link>
          <Link href="/demo" transitionTypes={["nav-forward"]} className="btn-ember inline-flex min-h-11 items-center rounded-xl bg-ember px-4 text-sm font-semibold text-ink">
            Demoyu aç
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
            className="flex max-h-full w-full max-w-[1100px] touch-pan-y touch-pinch-zoom flex-col gap-6 overflow-y-auto overscroll-contain [scrollbar-width:none] data-[more=1]:[mask-image:linear-gradient(to_bottom,black_calc(100%_-_40px),transparent)]"
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
            <span className={`font-mono text-xs transition-opacity duration-200 ${i === idx ? "text-fg opacity-100" : "text-fg-3 opacity-0 group-hover:opacity-100"}`}>
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
        <span className="font-mono text-[11px] text-fg-3">
          {String(idx + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

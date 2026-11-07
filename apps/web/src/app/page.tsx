import Image from "next/image";
import Link from "next/link";
import { ViewTransition } from "react";
import { CountUp } from "@/components/count-up";

const SLIDE = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={back ? "M13 8H3M7 4L3 8l4 4" : "M3 8h10M9 4l4 4-4 4"} />
    </svg>
  );
}

function DemoLink({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "min-h-11 px-4 text-sm rounded-xl",
    md: "min-h-13 px-6 text-base rounded-2xl",
    lg: "min-h-14 px-7 text-[17px] rounded-2xl",
  }[size];
  return (
    <Link
      href="/demo"
      transitionTypes={["nav-forward"]}
      className={`btn-ember group inline-flex items-center gap-2.5 bg-ember font-semibold text-ink ${cls}`}
    >
      Demoyu aç
      <span className="transition-transform duration-200 ease-out group-hover:translate-x-0.5">
        <Arrow />
      </span>
    </Link>
  );
}

function SinemaLink() {
  return (
    <Link
      href="/sinema"
      transitionTypes={["nav-forward"]}
      className="inline-flex min-h-13 items-center gap-2.5 rounded-2xl border border-line px-5 text-base font-semibold transition-colors duration-150 hover:border-fg-3"
    >
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z" />
      </svg>
      3B sinema
    </Link>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[13px] text-fg-3">{children}</p>;
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[clamp(32px,4.4vw,60px)] font-semibold leading-none tracking-[-0.03em]">
      {children}
    </h2>
  );
}

const PROBLEM = [
  { n: "1985", t: "İBB kayıtlarına göre o yıldan beri en yoğun günlük yağış." },
  { n: "≤242 mm", t: "İstasyon raporlarında görülen en yüksek günlük toplam." },
  { n: "≥3", t: "Hayatını kaybeden insan. Kesin sayı henüz netleşmedi.", ember: true },
  { n: "?", t: "Suyun hangi sokaktan geçeceğini gösteren güncel bir harita. Yoktu." },
];

const STEPS = [
  {
    h: "Gömülü dereleri bulur",
    p: "Binalardan arındırılmış FABDEM yüzeyinden akış yönü ve birikim hesaplanır. OSM'deki kapalı kanallarla eşleşmeyen koridorlar, haritada olmayan dereler olarak işaretlenir.",
  },
  {
    h: "Seli fiziğiyle hesaplar",
    p: "HEC-RAS sınıfı 2D sığ su çözücüsü, 14 Ekim'in gerçek yağış serisiyle 10 m'lik ızgarada çalışır. Binalar suyun etrafından dolaştığı engellerdir.",
  },
  {
    h: "3D sahnede oynatır",
    p: "Suyun yükselişi saat saat, gerçek arazi ve bina yükseklikleri üstünde görülür. Bir binaya dokununca suyun oraya kaçta geldiği ve ne kadar yükseldiği çıkar.",
  },
  {
    h: "Önceliği sıralar",
    p: "Her bina acil, yüksek, orta ya da izle kademesine girer. Hastane, okul, itfaiye ve bakımevi bir kademe yukarı alınır.",
  },
];

const TIERS = [
  { label: "Acil", n: 1337, color: "var(--tier-acil)" },
  { label: "Yüksek", n: 227, color: "var(--tier-yuksek)" },
  { label: "Orta", n: 501, color: "var(--tier-orta)" },
];
const TOTAL = 16787;

const CORRIDORS = [
  { label: "Açık dere", n: 22, km: "16,3 km" },
  { label: "OSM'de kayıtlı gömülü dere", n: 4, km: "1,9 km" },
  { label: "Hiçbir haritada olmayan koridor", n: 59, km: "32,5 km", hot: true },
];

const TEAM = ["Atakan Çalışkan", "Meriç Özkaya", "Funda Zeynep Şarkışla"];


export default function Home() {
  return (
    <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
      <div className="w-full overflow-x-clip">
        <header className="sticky top-0 z-20 px-4 pt-4 sm:px-8 lg:px-12">
          <nav aria-label="Ana gezinme" className="glass mx-auto flex max-w-[1280px] items-center justify-between gap-3 rounded-[18px] py-1.5 pl-3 pr-1.5 sm:pl-4">
            <a href="#top" className="flex items-center gap-2.5">
              <Image src="/icon.png" alt="" width={28} height={28} priority />
              <span className="font-display text-[19px] font-bold tracking-[-0.02em]">floodograph</span>
            </a>
            <div className="flex items-center gap-1">
              <div className="hidden items-center md:flex">
                {[
                  ["#problem", "14 Ekim"],
                  ["#yontem", "Yöntem"],
                  ["#sayilar", "Sayılar"],
                  ["#ekip", "Ekip"],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="rounded-lg px-3 py-2.5 text-sm text-fg-3 transition-colors duration-150 hover:text-fg">
                    {label}
                  </a>
                ))}
              </div>
              <DemoLink size="sm" />
            </div>
          </nav>
        </header>

        <main>
          {/* HERO */}
          <section id="top" className="relative px-4 pb-24 pt-[clamp(48px,9vw,120px)] sm:px-8 lg:px-12">
            <svg aria-hidden="true" viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-55" fill="none">
              <g stroke="rgb(111 168 201 / 0.22)" strokeWidth="1">
                {Array.from({ length: 8 }, (_, i) => {
                  const d = i * 44;
                  return (
                    <path
                      key={i}
                      d={`M-20 ${640 - d} C ${200 + i * 10} ${560 - d}, ${330 + i * 10} ${700 - d * 1.2}, 520 ${610 - d} S ${860 - i * 5} ${470 - d * 0.9}, 1040 ${560 - d} S 1320 ${690 - d * 1.1}, 1460 ${600 - d * 0.9}`}
                    />
                  );
                })}
              </g>
              <path
                d="M300 830 C 360 720, 470 660, 520 600 S 640 470, 760 430 S 980 360, 1120 250"
                stroke="var(--ember)"
                strokeWidth="2"
                strokeDasharray="2 7"
                strokeLinecap="round"
                opacity="0.9"
              />
            </svg>
            <div className="relative mx-auto grid max-w-[1280px] items-end gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="hero-rise flex max-w-[760px] flex-col gap-7">
                <p className="font-mono text-[13px] uppercase tracking-[0.08em] text-ember-2">14.10.2026 · İstanbul · Sarıyer–Ayazağa</p>
                <h1 className="font-display text-[clamp(44px,7.2vw,104px)] font-bold leading-[0.95] tracking-[-0.035em] text-balance">
                  Su yolunu her zaman bulur. <span className="text-ember">Biz önce buluruz.</span>
                </h1>
                <p className="max-w-[560px] text-[clamp(17px,1.6vw,20px)] leading-relaxed text-fg-2">
                  Floodograph, şehrin altına gömülen dereleri açık yükseklik verisinden yeniden çizer, 14 Ekim selini gerçek yağışla saat saat oynatır ve hangi binaya önce gidilmesi gerektiğini söyler.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <DemoLink />
                  <SinemaLink />
                  <a href="#problem" className="inline-flex min-h-13 items-center rounded-2xl border border-line px-5 text-base transition-colors duration-150 hover:border-fg-3">
                    Ne oldu?
                  </a>
                </div>
              </div>
              <div className="hero-rise glass flex w-full max-w-[340px] gap-5 rounded-3xl p-6 lg:justify-self-end" style={{ animationDelay: "240ms" }}>
                <div aria-hidden="true" className="flex w-3.5 flex-col justify-end overflow-hidden rounded-lg bg-water/12">
                  <div className="gauge-fill h-[92%] rounded-lg bg-water" />
                </div>
                <div className="flex flex-col gap-3.5">
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-fg-3">Günlük yağış</p>
                  <p className="font-mono text-[64px] font-medium leading-none tracking-[-0.04em]">
                    <CountUp value={242} />
                    <span className="text-[22px] text-fg-3"> mm</span>
                  </p>
                  <p className="text-sm leading-normal text-fg-2">Raporlarda 242 mm&apos;ye kadar. İBB&apos;ye göre 1985&apos;ten beri en yoğun gün.</p>
                </div>
              </div>
            </div>
          </section>

          {/* PROBLEM */}
          <section id="problem" className="scroll-mt-24 border-t border-line/70 px-4 py-24 sm:px-8 lg:px-12">
            <div className="mx-auto grid max-w-[1280px] gap-12 lg:grid-cols-2">
              <div className="reveal flex flex-col gap-5">
                <Eyebrow>01 — Problem</Eyebrow>
                <H2>Bir günde, bir mevsimin yağmuru.</H2>
              </div>
              <dl className="grid border-t border-line sm:grid-cols-2">
                {PROBLEM.map((x) => (
                  <div key={x.n} className="reveal flex flex-col gap-2 border-b border-line py-6 pr-6">
                    <dt className={`font-mono text-[40px] tracking-[-0.03em] ${x.ember ? "text-ember" : ""}`}>{x.n}</dt>
                    <dd className="text-[15px] leading-normal text-fg-2">{x.t}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          {/* BURIED STREAMS */}
          <section className="border-t border-line/70 bg-ink-2 px-4 py-24 sm:px-8 lg:px-12">
            <div className="mx-auto flex max-w-[1280px] flex-col gap-12">
              <div className="reveal grid items-end gap-12 lg:grid-cols-2">
                <div className="flex flex-col gap-5">
                  <Eyebrow>02 — Neden</Eyebrow>
                  <H2>
                    Su eski yolunu <span className="text-water">unutmaz.</span>
                  </H2>
                </div>
                <p className="max-w-[560px] text-lg leading-relaxed text-fg-2">
                  İstanbul&apos;da onlarca derenin üstü beton kanalla kapatıldı, üstüne yol ve bina yapıldı. Kanal taşınca su, vadinin en alçak çizgisini, yani derenin eski yatağını izler. Bugünkü haritaların çoğunda bu yataklar yok.
                </p>
              </div>
              <figure className="reveal flex flex-col gap-4 rounded-3xl border border-line bg-ink p-4 sm:p-8">
                <svg role="img" aria-label="Kesit: vadinin dibinde üstü kapatılmış dere kanalı, üstünde yol ve binalar; kanal taşınca su yol seviyesine çıkıyor" viewBox="0 0 1200 380" className="h-auto w-full">
                  <path d="M0 120 C 180 130, 300 200, 440 270 L 520 300 L 680 300 L 760 270 C 900 200, 1020 140, 1200 120 L 1200 380 L 0 380 Z" fill="#141C21" />
                  <path d="M0 120 C 180 130, 300 200, 440 270 L 520 300 L 680 300 L 760 270 C 900 200, 1020 140, 1200 120" stroke="rgb(233 238 240 / 0.35)" strokeWidth="1.5" fill="none" />
                  <rect x="560" y="312" width="80" height="44" rx="4" fill="none" stroke="var(--water)" strokeWidth="1.5" />
                  <rect x="562" y="330" width="76" height="24" fill="var(--water)" opacity="0.55" />
                  <path d="M430 258 L 770 258 L 770 300 L 430 300 Z" fill="var(--water)" opacity="0.28" />
                  <path d="M430 258 L 770 258" stroke="var(--water)" strokeWidth="2" />
                  <g fill="#1C262C" stroke="rgb(233 238 240 / 0.25)">
                    <rect x="455" y="170" width="54" height="128" />
                    <rect x="700" y="196" width="48" height="102" />
                    <rect x="300" y="120" width="60" height="96" />
                    <rect x="860" y="112" width="70" height="92" />
                  </g>
                  <rect x="455" y="258" width="54" height="40" fill="var(--tier-acil)" opacity="0.75" />
                  <rect x="700" y="258" width="48" height="40" fill="var(--tier-acil)" opacity="0.75" />
                  <g fontFamily="var(--font-geist-mono), monospace" fontSize="15" fill="#8C999F">
                    <text x="556" y="374">gömülü kanal</text>
                    <text x="520" y="248" fill="var(--water)">taşkın seviyesi</text>
                    <text x="292" y="106">sırt: güvende</text>
                    <text x="852" y="98">sırt: güvende</text>
                    <text x="458" y="160" fill="var(--ember-2)">acil</text>
                    <text x="702" y="186" fill="var(--ember-2)">acil</text>
                  </g>
                </svg>
                <figcaption className="text-sm leading-normal text-fg-3">
                  Şematik kesit. Bir bina ile en yakın akış çizgisi arasındaki dikey fark (HAND) küçüldükçe risk büyür.
                </figcaption>
              </figure>
            </div>
          </section>

          {/* METHOD */}
          <section id="yontem" className="scroll-mt-24 border-t border-line/70 px-4 py-24 sm:px-8 lg:px-12">
            <div className="mx-auto flex max-w-[1280px] flex-col gap-12">
              <div className="reveal flex max-w-[760px] flex-col gap-5">
                <Eyebrow>03 — Floodograph ne yapıyor</Eyebrow>
                <H2>Yükseklikten dereye, dereden kapıya.</H2>
              </div>
              <ol className="border-t border-line">
                {STEPS.map((s, i) => (
                  <li key={s.h} className="reveal grid gap-3 border-b border-line py-8 md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1.3fr)] md:items-baseline md:gap-6">
                    <span className="font-mono text-sm text-ember">0{i + 1}</span>
                    <h3 className="font-display text-[26px] font-semibold tracking-[-0.02em]">{s.h}</h3>
                    <p className="text-base leading-relaxed text-fg-2">{s.p}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* NUMBERS */}
          <section id="sayilar" className="scroll-mt-24 border-t border-line/70 bg-ink-2 px-4 py-24 sm:px-8 lg:px-12">
            <div className="mx-auto flex max-w-[1280px] flex-col gap-14">
              <div className="reveal flex max-w-[760px] flex-col gap-5">
                <Eyebrow>04 — Sarıyer–Ayazağa pilotu</Eyebrow>
                <H2>59 dere hiçbir haritada yok.</H2>
              </div>
              <div className="grid items-start gap-12 lg:grid-cols-2">
                <div className="flex flex-col gap-10">
                  <div className="reveal flex flex-col gap-4">
                    <p className="font-mono text-[clamp(56px,7vw,96px)] font-medium leading-none tracking-[-0.05em]">
                      <CountUp value={TOTAL} />
                    </p>
                    <p className="text-base text-fg-2">bina tek tek analiz edildi</p>
                    <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-md bg-[var(--tier-izle)]">
                      {TIERS.map((t) => (
                        <div key={t.label} className="bar-grow" style={{ width: `${(t.n / TOTAL) * 100}%`, background: t.color }} />
                      ))}
                    </div>
                    <dl className="grid grid-cols-3 gap-4">
                      {TIERS.map((t) => (
                        <div key={t.label} className="flex flex-col gap-1">
                          <dt className="flex items-center gap-2 text-[13px] text-fg-3">
                            <span className="size-2 rounded-[2px]" style={{ background: t.color }} />
                            {t.label}
                          </dt>
                          <dd className="font-mono text-[28px]">
                            <CountUp value={t.n} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="reveal border-t border-line">
                    {CORRIDORS.map((c) => (
                      <div key={c.label} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-4 border-b border-line py-[18px]">
                        <span className={`text-[15px] ${c.hot ? "font-semibold text-fg" : "text-fg-2"}`}>{c.label}</span>
                        <CountUp value={c.n} className={`font-mono text-[22px] ${c.hot ? "text-ember" : ""}`} />
                        <span className={`min-w-16 text-right font-mono text-sm ${c.hot ? "text-ember-2" : "text-fg-3"}`}>{c.km}</span>
                      </div>
                    ))}
                    <p className="mt-4 text-sm text-fg-3">Toplam 72 akış koridoru, 41,8 km.</p>
                  </div>
                </div>
                <figure className="reveal flex flex-col gap-3">
                  <Image
                    src="/img/istanbul-hand-koridorlar.png"
                    alt="Sarıyer-Ayazağa HAND haritası: mavi akış koridorları, kırmızı ve turuncu kademeli binalar"
                    width={1365}
                    height={1310}
                    sizes="(min-width: 1024px) 620px, 100vw"
                    className="h-auto w-full rounded-[20px] border border-line"
                  />
                  <figcaption className="text-[13px] leading-normal text-fg-3">
                    Veri hattı çıktısı. Mavi: HAND ≤ 5 m. Kesikli mor: OSM&apos;deki gömülü dere. Noktalı: haritada olmayan koridor.
                  </figcaption>
                </figure>
              </div>
            </div>
          </section>

          {/* TEAM */}
          <section id="ekip" className="scroll-mt-24 border-t border-line/70 px-4 py-24 sm:px-8 lg:px-12">
            <div className="mx-auto grid max-w-[1280px] gap-12 lg:grid-cols-2">
              <div className="reveal flex flex-col gap-5">
                <Eyebrow>05 — Ekip</Eyebrow>
                <H2>SALU</H2>
                <p className="text-base leading-relaxed text-fg-2">EkoZeka 2026 Hackathon, DEÜ CS-AI Topluluğu.</p>
              </div>
              <ul className="border-t border-line">
                {TEAM.map((n) => (
                  <li key={n} className="reveal border-b border-line py-[22px] font-display text-[28px] tracking-[-0.02em]">
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* CTA */}
          <section className="px-4 pb-24 sm:px-8 lg:px-12">
            <div className="reveal relative mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-8 overflow-hidden rounded-[32px] border border-line bg-surface p-[clamp(28px,6vw,80px)]">
              <svg aria-hidden="true" viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" fill="none">
                <path d="M0 300 C 200 260, 400 330, 600 290 S 1000 250, 1200 290 L 1200 400 L 0 400 Z" fill="rgb(111 168 201 / 0.10)" />
                <path d="M0 330 C 220 300, 420 360, 620 320 S 1000 290, 1200 320 L 1200 400 L 0 400 Z" fill="rgb(111 168 201 / 0.10)" />
              </svg>
              <div className="relative flex max-w-[640px] flex-col gap-4">
                <h2 className="font-display text-[clamp(36px,5vw,72px)] font-bold leading-[0.95] tracking-[-0.035em]">Ayazağa&apos;yı kendin gez.</h2>
                <p className="text-[17px] leading-relaxed text-fg-2">İzohipsler, akış koridorları ve 16.787 binanın kademesi tek haritada.</p>
              </div>
              <div className="relative">
                <DemoLink size="lg" />
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-line/70 px-4 pb-12 pt-8 sm:px-8 lg:px-12">
          <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-x-8 gap-y-4 text-[13px] leading-relaxed text-fg-3">
            <p className="max-w-[640px]">
              Veri: FABDEM · © OpenStreetMap katkıcıları (ODbL) · OpenFreeMap · Open-Meteo. Bu bir pilot çalışmadır, resmi bir sel risk haritası değildir.
            </p>
            <a href="https://github.com/atakanclskn/floodograph" className="text-fg-2 hover:text-fg">
              GitHub · MIT
            </a>
          </div>
        </footer>
      </div>
    </ViewTransition>
  );
}

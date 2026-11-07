import Link from "next/link";
import { ViewTransition } from "react";

const SLIDE = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

// Shell only. The MapLibre map (contours + tiered buildings) and the 3D flood scene mount here next.
export default function DemoPage() {
  return (
    <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
      <main className="relative flex min-h-dvh w-full flex-col justify-between bg-ink p-4">
        <header className="glass flex w-fit items-center gap-2 rounded-2xl p-1.5">
          <Link
            href="/"
            transitionTypes={["nav-back"]}
            aria-label="Ana sayfaya dön"
            className="inline-flex size-11 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-white/10"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8H3M7 4L3 8l4 4" />
            </svg>
          </Link>
          <span className="pr-2.5 font-display text-[17px] font-bold tracking-[-0.02em]">floodograph</span>
          <span className="border-l border-line px-2.5 py-1.5 font-mono text-xs text-fg-3">İstanbul · Ayazağa</span>
        </header>
        <p className="glass max-w-[320px] rounded-[22px] p-5 text-sm leading-normal text-fg-2">
          Harita hazırlanıyor: izohipsler, akış koridorları ve 19.763 binanın kademesi buraya gelecek.
        </p>
      </main>
    </ViewTransition>
  );
}

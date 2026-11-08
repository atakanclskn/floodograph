"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The story in two steps: İstanbul, where the model is validated on the 14 Oct 2026 Sarıyer flood (cinematic tour +
 * free exploration), then İzmir, the same model asked "what if this rain fell here?".
 */
const SECTIONS = [
  { href: "/sinema", label: "İstanbul", short: "İstanbul" },
  { href: "/izmir", label: "İzmir", short: "İzmir" },
] as const;

/** One top bar for every map page: home on the left, the two sections as tabs. */
export function SiteNav() {
  const path = usePathname();
  return (
    <nav aria-label="Bölümler" className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5">
      <Link
        href="/"
        transitionTypes={["nav-back"]}
        aria-label="Ana sayfa"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl pl-1.5 pr-3 transition-colors duration-150 hover:bg-white/10"
      >
        <Image src="/icon.png" alt="" width={32} height={32} />
        <span className="hidden font-display text-[18px] font-bold tracking-[-0.02em] lg:inline">floodograph</span>
      </Link>
      <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-line" />
      {SECTIONS.map((s) => {
        const active = path === s.href;
        return (
          <span key={s.href} className="flex items-center">
            <Link
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold transition-colors duration-150 sm:px-3.5 ${
                active ? "bg-white/12 text-fg" : "text-fg-3 hover:bg-white/8 hover:text-fg"
              }`}
            >
              <span className="sm:hidden">{s.short}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

import Image from "next/image";

// Placeholder until the design round. Intentionally bare: no template hero, no gradients.
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col justify-end gap-6 p-8 sm:p-16">
      <Image
        src="/floodograph-logo.png"
        alt="Floodograph"
        width={240}
        height={165}
        priority
      />
      <p className="max-w-md text-sm leading-6 text-foreground/70">
        Sel anında suyun nereye gideceğini öngören ve acil müdahale önceliklerini çıkaran analiz aracı.
      </p>
      <p className="font-mono text-xs uppercase tracking-widest text-foreground/40">
        MVP geliştiriliyor · EkoZeka 2026 · SALU
      </p>
    </main>
  );
}

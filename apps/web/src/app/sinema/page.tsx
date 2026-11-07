import type { Metadata } from "next";
import { SceneApp } from "@/components/scene/scene-app";

export const metadata: Metadata = {
  title: "Sinema · Floodograph",
  description:
    "14 Ekim 2026 İstanbul selinin 2B sığ su modeli, 3B arazi üzerinde: akan su, ıslanan binalar ve Ayazağa koridorunda taşma anı.",
};

export default function SinemaPage() {
  return (
    <main className="w-full">
      <SceneApp />
    </main>
  );
}

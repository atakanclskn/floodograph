import type { Metadata } from "next";
import { ViewTransition } from "react";
import { DemoApp } from "@/components/demo/demo-app";

export const metadata: Metadata = {
  title: "Demo · Floodograph",
  description: "Sarıyer-Ayazağa: izohipsler, akış koridorları ve 19.763 binanın aciliyet kademesi.",
};

const SLIDE = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

export default function DemoPage() {
  return (
    <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
      <main className="w-full">
        <DemoApp />
      </main>
    </ViewTransition>
  );
}

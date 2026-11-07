import { ViewTransition } from "react";
import { Deck } from "@/components/deck/deck";

const SLIDE = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

/** The landing page is the pitch: full-screen slides over a live 3D valley (↓ / ↑, wheel, swipe). */
export default function Home() {
  return (
    <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
      <Deck />
    </ViewTransition>
  );
}

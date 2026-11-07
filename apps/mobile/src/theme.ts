import type { Tier } from "@floodograph/core";

/** Same tokens as apps/web/src/app/globals.css, so web and mobile read as one product. */
export const color = {
  ink: "#0a0f12",
  ink2: "#0d1418",
  surface: "#11181c",
  fg: "#e9eef0",
  fg2: "#b6c1c6",
  fg3: "#8c999f",
  line: "rgba(233, 238, 240, 0.12)",
  lineStrong: "rgba(233, 238, 240, 0.22)",
  ember: "#ff5a2b",
  ember2: "#ff8a3d",
  water: "#6fa8c9",
  glass: "rgba(17, 24, 28, 0.55)",
  glassSolid: "rgba(17, 24, 28, 0.92)",
} as const;

export const tierColor: Readonly<Record<Tier, string>> = {
  acil: "#ff4a2b",
  yuksek: "#ff8f4f",
  orta: "#f4c27a",
  izle: "#5b666c",
};

/** Families registered in app/_layout.tsx (Geist, Geist Mono, Bricolage Grotesque, as on the web). */
export const font = {
  sans: "Geist_400Regular",
  sansMedium: "Geist_500Medium",
  sansSemi: "Geist_600SemiBold",
  mono: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
  display: "BricolageGrotesque_700Bold",
  displaySemi: "BricolageGrotesque_600SemiBold",
} as const;

export const radius = { sm: 10, md: 16, lg: 22, xl: 28 } as const;

/** cubic-bezier(0.16, 1, 0.3, 1), the web's hero-rise curve */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const SITE_URL = "https://floodograph.vercel.app";
export const DEMO_URL = `${SITE_URL}/demo`;

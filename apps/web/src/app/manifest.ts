import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Floodograph",
    short_name: "Floodograph",
    description: "Gömülü dereleri bulan, seli saat saat oynatan ve binaları aciliyete göre sıralayan sel analiz platformu.",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0f12",
    theme_color: "#0a0f12",
    categories: ["utilities", "navigation", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "İstanbul · 14 Ekim seli", url: "/sinema", icons: [{ src: "/icon-192.png", sizes: "192x192" }] }],
  };
}

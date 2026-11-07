import type { Metadata } from "next";
import { CityFlood } from "@/components/cities/city-flood";

export const metadata: Metadata = {
  title: "Şehirler · Floodograph",
  description: "14 Ekim 2026 yağışının İstanbul, İzmir ve Ankara'nın tamamında 50 m'lik 2D sel simülasyonu.",
};

export default function SehirlerPage() {
  return <CityFlood />;
}

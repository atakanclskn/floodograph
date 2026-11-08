import type { Metadata } from "next";
import { Suspense } from "react";
import { CityFlood } from "@/components/cities/city-flood";

export const metadata: Metadata = {
  title: "İzmir · Floodograph",
  description:
    "Sarıyer'de 14 Ekim 2026 seliyle doğrulanan model İzmir merkezinde: yağışı belirleyin, hangi binalara su ulaşır ve önce nereye müdahale edilmeli görün.",
};

export default function IzmirPage() {
  return (
    <main className="w-full">
      {/* CityFlood reads ?yagis= (initial rain, mm) */}
      <Suspense>
        <CityFlood />
      </Suspense>
    </main>
  );
}

import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClientRoot } from "@/components/client-root";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "latin-ext"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Floodograph",
  description:
    "Şehrin altına gömülen dereleri açık yükseklik verisinden yeniden bulan, 14 Ekim İstanbul selini saat saat oynatan ve binaları aciliyete göre sıralayan sel analiz platformu.",
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }], apple: "/apple-icon.png" },
  appleWebApp: { capable: true, title: "Floodograph", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0f12",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}

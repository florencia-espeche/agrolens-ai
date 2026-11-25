import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgroLens AI — Monitoreo Satelital & Diagnóstico Agronómico",
  description: "Detección temprana de anomalías con Sentinel-2, NASA POWER y Gemini en cultivos de Córdoba",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark bg-slate-950 text-slate-100 overflow-x-hidden`}
    >
      <body className="min-h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-x-hidden">{children}</body>
    </html>
  );
}

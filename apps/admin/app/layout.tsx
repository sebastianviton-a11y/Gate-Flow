import type { Metadata } from "next";
import { Poppins, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Poppins — tipografía oficial de marca GateFlow ("moderna, clara y
// amigable que transmite confianza y tecnología"). Un solo family con
// tres pesos cubre display y cuerpo de texto, tal como especifica el
// brand board (Bold / Semibold / Regular) — ya no se combinan dos
// familias distintas para esos dos roles.
const fontDisplay = Poppins({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const fontSans = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GateFlow",
  description: "Plataforma de operaciones de portería — GateFlow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

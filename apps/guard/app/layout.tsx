import type { Metadata, Viewport } from "next";
import { Poppins, IBM_Plex_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import "./globals.css";

// Poppins — tipografía oficial de marca GateFlow, mismo criterio que apps/admin.
const fontDisplay = Poppins({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display", display: "swap" });
const fontSans = Poppins({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const fontMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "GateFlow Guardia",
  description: "Registro y entrega de paquetes en portería",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GateFlow Guardia",
  },
};

export const viewport: Viewport = {
  themeColor: "#0D1B2A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita zoom accidental en formularios táctiles repetidos
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

"use client";

import { useParams } from "next/navigation";
import { QRCodeCanvas } from "qrcode.react";
import { GateFlowLogo } from "@gateflow/ui";

/**
 * Deliberadamente NO consulta la base de datos ni pide sesión — esta
 * página solo dibuja el QR a partir del token que ya viene en la propia
 * URL (el mismo dato, no algo adicional que se esté expuniendo). Mostrar
 * el código en sí no revela nombre, domicilio ni estado del paquete —
 * eso sigue exigiendo sesión de guardia en /escanear/[token] (la ruta
 * padre). Es la página que se manda dentro del mensaje de WhatsApp,
 * porque wa.me nunca puede adjuntar una imagen, solo texto con un enlace.
 */
export default function VerQrPage() {
  const params = useParams<{ token: string }>();
  const scanUrl =
    typeof window !== "undefined" ? `${window.location.origin}/escanear/${params.token}` : "";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center">
      <GateFlowLogo size={40} onDark />
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-5">
        {scanUrl && <QRCodeCanvas value={scanUrl} size={220} level="M" includeMargin={false} />}
      </div>
      <p className="max-w-xs text-sm text-white/70">
        Presenta este código al personal de seguridad para recoger tu paquete. Mantén presionada la
        imagen para guardarla.
      </p>
    </div>
  );
}

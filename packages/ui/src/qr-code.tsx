"use client";

import { QRCodeSVG } from "qrcode.react";

interface PackageQRCodeProps {
  codigoGateflow: string;
  size?: number;
}

/**
 * Codifica únicamente el código GateFlow en texto plano (ej.
 * "GF-2026-0001234") — nunca IDs internos, tenant_id, ni datos de
 * residentes (04-API.md §8: "no exponer datos sensibles"). Es
 * intencionalmente lo mismo que se buscaría manualmente en
 * apps/guard/packages/search o apps/guard/packages/deliver, así que
 * escanear el QR y teclear el código llegan al mismo resultado.
 */
export function PackageQRCode({ codigoGateflow, size = 180 }: PackageQRCodeProps) {
  return (
    <div className="inline-flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-4">
      <QRCodeSVG value={codigoGateflow} size={size} level="M" includeMargin={false} />
      <span className="gf-code">{codigoGateflow}</span>
    </div>
  );
}

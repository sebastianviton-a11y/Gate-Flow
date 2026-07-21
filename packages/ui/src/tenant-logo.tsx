"use client";

import { useState } from "react";
import { GateFlowLogo } from "./gateflow-logo";
import { cn } from "./utils";

interface TenantLogoProps {
  logoUrl?: string | null;
  nombreTenant?: string;
  size?: number;
  withWordmark?: boolean;
  onDark?: boolean;
  className?: string;
}

/**
 * White-label: el sistema se vende a distintos residenciales, cada uno
 * debe poder mostrar su propia marca. Cae de vuelta a <GateFlowLogo />
 * — sin cambios, sin romper nada — cuando el tenant no subió logo
 * propio, o si la imagen falla al cargar (enlace roto, archivo
 * eliminado del Storage, etc.) — nunca se queda en un ícono partido.
 */
export function TenantLogo({ logoUrl, nombreTenant, size = 40, withWordmark = false, onDark = false, className }: TenantLogoProps) {
  const [fallo, setFallo] = useState(false);

  if (!logoUrl || fallo) {
    return <GateFlowLogo size={size} withWordmark={withWordmark} onDark={onDark} className={className} />;
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={nombreTenant ? `Logo de ${nombreTenant}` : "Logo"}
        style={{ height: size, width: size }}
        className="rounded-md object-contain"
        onError={() => setFallo(true)}
      />
      {withWordmark && nombreTenant && (
        <span className={cn("font-display text-lg font-semibold tracking-tight", onDark ? "text-white" : "text-foreground")}>
          {nombreTenant}
        </span>
      )}
    </div>
  );
}

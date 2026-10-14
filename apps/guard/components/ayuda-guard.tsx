"use client";

import { createContext, useContext } from "react";
import { GuiaPrimeraVisita } from "@gateflow/ui";
import { GUIAS_GUARD, type ClaveGuiaGuard } from "@/lib/guias";

/**
 * Datos de las guías de portería, resueltos en app/guard/layout.tsx:
 * quién mira y si las guías se abren solas (solo durante la prueba).
 */
interface AyudaGuardContexto {
  usuarioId: string;
  autoMostrar: boolean;
}

const Ctx = createContext<AyudaGuardContexto | null>(null);

export function AyudaGuardProvider({ usuarioId, autoMostrar, children }: AyudaGuardContexto & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ usuarioId, autoMostrar }}>{children}</Ctx.Provider>;
}

export function GuiaGuard({ clave, className }: { clave: ClaveGuiaGuard; className?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <GuiaPrimeraVisita guia={GUIAS_GUARD[clave]} usuarioId={ctx.usuarioId} autoMostrar={ctx.autoMostrar} enlaceAyuda="/guard/ayuda" className={className} />
  );
}

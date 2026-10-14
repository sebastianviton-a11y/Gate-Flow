"use client";

import { createContext, useContext } from "react";
import { GuiaPrimeraVisita } from "@gateflow/ui";
import { GUIAS_ADMIN, type ClaveGuiaAdmin } from "@/lib/ayuda/guias";

/**
 * Datos que necesitan las guías de primera visita, resueltos una vez en
 * app/(app)/layout.tsx: quién mira (la marca de «guía vista» es por
 * usuario) y si las guías se abren solas (solo durante la prueba o la
 * configuración inicial; para los demás, solo con «Cómo funciona»).
 */
interface AyudaContexto {
  usuarioId: string;
  autoMostrar: boolean;
}

const Ctx = createContext<AyudaContexto | null>(null);

export function AyudaProvider({ usuarioId, autoMostrar, children }: AyudaContexto & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ usuarioId, autoMostrar }}>{children}</Ctx.Provider>;
}

/** Guía de una sección del panel; fuera del provider no se muestra. */
export function GuiaSeccion({ clave, className }: { clave: ClaveGuiaAdmin; className?: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return <GuiaPrimeraVisita guia={GUIAS_ADMIN[clave]} usuarioId={ctx.usuarioId} autoMostrar={ctx.autoMostrar} enlaceAyuda="/ayuda" className={className} />;
}

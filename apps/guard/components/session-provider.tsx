"use client";

import { createContext, useContext } from "react";
import type { SessionContext as GateflowSessionContext } from "@gateflow/types";

/**
 * Antes no existía ningún Context en el proyecto — no había necesidad
 * real (CLAUDE.md §9: "no crear abstracciones sin un caso real que las
 * justifique"). Ahora sí: las pantallas de registro/entrega/búsqueda son
 * Client Components que llaman a Supabase directamente desde el
 * navegador (mismo patrón que login-form.tsx) y necesitan `tenantId` y
 * el usuario actual para las mutaciones. La sesión ya se resuelve una
 * vez, en el servidor, en app/guard/layout.tsx — este Context solo la
 * distribuye, no la vuelve a calcular ni la cachea por su cuenta.
 */
const SessionCtx = createContext<GateflowSessionContext | null>(null);

export function GuardSessionProvider({
  session,
  children,
}: {
  session: GateflowSessionContext;
  children: React.ReactNode;
}) {
  return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
}

export function useGuardSession(): GateflowSessionContext {
  const ctx = useContext(SessionCtx);
  if (!ctx) {
    throw new Error("useGuardSession() debe usarse dentro de <GuardSessionProvider> (app/guard/layout.tsx)");
  }
  return ctx;
}

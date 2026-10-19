import { cookies } from "next/headers";
import { COOKIE_TENANT, type FilaMembresia, type ResultadoAccesoUsuario } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { SELECT_MEMBRESIA_PANEL, resultadoPanel } from "@/lib/acceso-panel";

export interface AccesoAdmin {
  userId: string | null;
  filas: FilaMembresia[];
  resultado: ResultadoAccesoUsuario;
}

/**
 * Lectura única para Server Components y Server Actions de Admin:
 * usuario → TODAS sus membresías activas (sin limit) → gf_tenant →
 * membresía de ese tenant → decisión. Mismo cálculo que el middleware.
 * Sin usuario → userId null (quien llama manda a /login).
 */
export async function leerAccesoAdmin(ahora: Date = new Date()): Promise<AccesoAdmin> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { userId: null, filas: [], resultado: resultadoPanel(null, [], null, ahora) };
  }
  const { data, error } = await supabase
    .from("user_tenants")
    .select(SELECT_MEMBRESIA_PANEL)
    .eq("user_id", user.id)
    .eq("activo", true);
  const filas = (data ?? []) as FilaMembresia[];
  return {
    userId: user.id,
    filas,
    resultado: resultadoPanel(error, filas, cookies().get(COOKIE_TENANT)?.value, ahora),
  };
}

"use server";

import { createServerSupabaseClient } from "@gateflow/supabase";
import { paisDeMembresias, type PaisInvitacion } from "@/lib/legal/pais-invitacion";

/**
 * País del residencial de la invitación, para enlazar sus documentos
 * legales. No recibe argumentos: el navegador no puede elegir el país ni
 * el residencial. Valida la sesión con getUser() (revalida el token) y
 * lee las membresías activas y el país de su residencial con el cliente
 * de la sesión (RLS: solo las propias). En el log, solo el motivo.
 */
export async function paisDeLaInvitacion(): Promise<PaisInvitacion> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();
  if (errorSesion || !user) return { estado: "indeterminado", motivo: "sin_sesion" };

  const { data, error } = await supabase.from("user_tenants").select("tenant_id, tenants(pais)").eq("user_id", user.id).eq("activo", true);
  const resultado = paisDeMembresias(error, data);
  if (resultado.estado !== "ok") console.error(`[GateFlow] aceptar-invitacion: país del residencial no determinado (${resultado.motivo})`);
  return resultado;
}

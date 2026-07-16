"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { obtenerPaquetePorId } from "@gateflow/paquetes";

/**
 * Único campo editable en este sprint: `notas`. La lista de campos NO
 * autorizados (tenant, código GateFlow, fecha de recepción original,
 * historial, delivered_by, delivered_at) está protegida a nivel de base
 * de datos por el trigger `fn_proteger_campos_paquete()` — esta acción
 * ni siquiera intenta tocarlos, pero aunque lo intentara, la base de
 * datos los rechazaría igual (defensa en profundidad real, no solo
 * "el frontend no muestra el campo").
 */
export async function actualizarNotasPaquete(paqueteId: string, notasNuevas: string) {
  const session = await getSessionContext();
  if (!session) throw new Error("Sesión no válida.");

  const supabase = createServerSupabaseClient();
  const anterior = await obtenerPaquetePorId(supabase, paqueteId);
  if (!anterior) throw new Error("Paquete no encontrado.");

  const { error } = await supabase.from("paquetes").update({ notas: notasNuevas }).eq("id", paqueteId);
  if (error) throw error;

  // Auditoría real, no un console.log — vía la función SECURITY DEFINER
  // que garantiza que el tenant y el autor no pueden falsificarse.
  await supabase.rpc("registrar_auditoria", {
    p_tenant_id: session.tenant.id,
    p_accion: "paquete.notas_editadas",
    p_entidad: "paquetes",
    p_entidad_id: paqueteId,
    p_datos_anteriores: { notas: anterior.notas },
    p_datos_nuevos: { notas: notasNuevas },
  });

  revalidatePath(`/paquetes/${paqueteId}`);
}

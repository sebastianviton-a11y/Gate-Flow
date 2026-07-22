"use server";

import { getSessionContext } from "@gateflow/auth";
import { createServiceRoleClient } from "@gateflow/supabase";
import type { RoleKey } from "@gateflow/types";

export interface InvitarUsuarioResidencialInput {
  correo: string;
  rolClave: RoleKey;
}

/**
 * A diferencia de invitarAdministrador() (que crea el residencial),
 * esta función solo invita — el residencial ya existe. La usa el
 * propio administrador desde el asistente de configuración (Paso 4)
 * para invitar a su equipo (guardia, recepción, supervisor, otro
 * administrador) — nunca desde Super Admin.
 */
export async function invitarUsuarioResidencial(input: InvitarUsuarioResidencialInput): Promise<{ ok: boolean; mensaje: string }> {
  const session = await getSessionContext();
  if (!session || (session.role !== "admin_residencial" && session.role !== "super_admin")) {
    return { ok: false, mensaje: "No tienes permiso para invitar usuarios." };
  }

  let servicioClient;
  try {
    servicioClient = createServiceRoleClient();
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Falta configurar SUPABASE_SERVICE_ROLE_KEY." };
  }

  const { error } = await servicioClient.auth.admin.inviteUserByEmail(input.correo.trim(), {
    data: { tenant_id: session.tenant.id, rol_clave: input.rolClave },
    redirectTo: `${process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? ""}/aceptar-invitacion`,
  });

  if (error) {
    return { ok: false, mensaje: `No se pudo enviar la invitación: ${error.message}` };
  }

  return { ok: true, mensaje: "Invitación enviada." };
}

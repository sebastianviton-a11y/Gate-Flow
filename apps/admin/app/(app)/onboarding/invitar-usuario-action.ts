"use server";

import { getSessionContext } from "@gateflow/auth";
import { ROLES_INVITABLES, puedeInvitar } from "@gateflow/paquetes";
import { createServiceRoleClient } from "@gateflow/supabase";
import type { RoleKey } from "@gateflow/types";
import { MENSAJE_SERVICIO_INACTIVO, residencialPuedeOperar } from "@/lib/operacion";

export interface InvitarUsuarioResidencialInput {
  correo: string;
  rolClave: RoleKey;
}

/**
 * A diferencia de invitarAdministrador() (que crea el residencial),
 * esta función solo invita — el residencial ya existe. La usa el
 * propio administrador desde el asistente de configuración (Paso 4)
 * y desde /usuarios para invitar guardias — nunca desde Super Admin.
 * Un admin_residencial adicional solo lo invita Super Admin
 * (superadmin/invitacion-actions.ts).
 *
 * La membresía NO viaja en la metadata de la invitación (cualquiera
 * que haga un signUp público controla esa metadata). Se otorga después
 * con otorgar_membresia(), que vuelve a validar en la base de datos el
 * rol (lista blanca) y que quien invita administra ESTE residencial.
 */
export async function invitarUsuarioResidencial(input: InvitarUsuarioResidencialInput): Promise<{ ok: boolean; mensaje: string }> {
  const session = await getSessionContext();
  if (!session || (session.role !== "admin_residencial" && session.role !== "super_admin")) {
    return { ok: false, mensaje: "No tienes permiso para invitar usuarios." };
  }

  // El rol llega del cliente: en este flujo solo se acepta guardia
  // (ROLES_INVITABLES), y solo si quien invita puede otorgarlo.
  if (!ROLES_INVITABLES.some((r) => r.clave === input.rolClave) || !puedeInvitar(session.role, input.rolClave)) {
    return { ok: false, mensaje: "Ese rol no se puede asignar por invitación." };
  }

  // Escribe con la clave de servicio (sin RLS): el bloqueo por trial
  // vencido / suscripción inactiva se verifica aquí.
  if (!(await residencialPuedeOperar())) {
    return { ok: false, mensaje: MENSAJE_SERVICIO_INACTIVO };
  }

  let servicioClient;
  try {
    servicioClient = createServiceRoleClient();
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Falta configurar SUPABASE_SERVICE_ROLE_KEY." };
  }

  const { data: dataInvite, error } = await servicioClient.auth.admin.inviteUserByEmail(input.correo.trim(), {
    redirectTo: `${process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? ""}/aceptar-invitacion`,
  });

  if (error) {
    return { ok: false, mensaje: `No se pudo enviar la invitación: ${error.message}` };
  }

  const { error: errorMembresia } = await servicioClient.rpc("otorgar_membresia", {
    p_user_id: dataInvite.user.id,
    p_tenant_id: session.tenant.id,
    p_rol_clave: input.rolClave,
    p_otorgado_por: session.user.id,
  });

  if (errorMembresia) {
    await revertirInvitacion(servicioClient, dataInvite.user);
    return { ok: false, mensaje: `No se pudo asignar el usuario al residencial: ${errorMembresia.message}` };
  }

  return { ok: true, mensaje: "Invitación enviada." };
}

/**
 * Si la membresía no se pudo otorgar, la cuenta recién invitada queda
 * sin residencial: se borra para que el enlace del correo deje de
 * servir. Solo si nunca inició sesión y no pertenece a ningún otro
 * residencial — una cuenta existente nunca se borra.
 */
async function revertirInvitacion(
  servicioClient: ReturnType<typeof createServiceRoleClient>,
  usuario: { id: string; last_sign_in_at?: string },
) {
  if (usuario.last_sign_in_at) return;

  const { count, error } = await servicioClient
    .from("user_tenants")
    .select("id", { count: "exact", head: true })
    .eq("user_id", usuario.id);

  if (!error && count === 0) {
    await servicioClient.auth.admin.deleteUser(usuario.id);
  }
}

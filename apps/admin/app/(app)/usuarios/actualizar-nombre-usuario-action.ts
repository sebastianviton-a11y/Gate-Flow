"use server";

import { getSessionContext } from "@gateflow/auth";
import { createServiceRoleClient } from "@gateflow/supabase";

export interface ActualizarNombreUsuarioInput {
  userId: string;
  nombreCompleto: string;
}

/**
 * No existe ninguna policy de RLS que permita a un admin editar el
 * nombre_completo de OTRO usuario (users_update_self solo permite
 * id = auth.uid()) — a propósito no se debilita esa policy. En vez de
 * eso, se sigue el mismo patrón que ya usan invitarUsuarioResidencial
 * y establecerPasswordInvitado: la sesión y el permiso se validan a
 * mano en el servidor, y solo entonces se escribe con el service role
 * client, acotado siempre al tenant del admin que hace la petición.
 */
export async function actualizarNombreUsuario(input: ActualizarNombreUsuarioInput): Promise<{ ok: boolean; mensaje: string }> {
  const session = await getSessionContext();
  if (!session || (session.role !== "admin_residencial" && session.role !== "super_admin")) {
    return { ok: false, mensaje: "No tienes permiso para editar usuarios." };
  }

  const nombreLimpio = input.nombreCompleto.trim();
  if (nombreLimpio.length < 3) {
    return { ok: false, mensaje: "El nombre completo debe tener al menos 3 caracteres." };
  }

  let servicioClient;
  try {
    servicioClient = createServiceRoleClient();
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Falta configurar SUPABASE_SERVICE_ROLE_KEY." };
  }

  // Verificación explícita de pertenencia al mismo tenant ANTES de
  // escribir — el service role client se salta RLS, así que esta
  // comprobación manual es la única barrera real contra editar a
  // alguien de otro residencial.
  const { data: membresia, error: errorMembresia } = await servicioClient
    .from("user_tenants")
    .select("id")
    .eq("user_id", input.userId)
    .eq("tenant_id", session.tenant.id)
    .maybeSingle();

  if (errorMembresia || !membresia) {
    return { ok: false, mensaje: "Este usuario no pertenece a tu residencial." };
  }

  const { error: errorUpdate } = await servicioClient
    .from("users")
    .update({ nombre_completo: nombreLimpio })
    .eq("id", input.userId);

  if (errorUpdate) {
    return { ok: false, mensaje: `No se pudo guardar el nombre: ${errorUpdate.message}` };
  }

  return { ok: true, mensaje: "Nombre actualizado." };
}


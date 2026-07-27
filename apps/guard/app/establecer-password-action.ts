"use server";

import { createServerSupabaseClient, createServiceRoleClient } from "@gateflow/supabase";

export interface ResultadoEstablecerPassword {
  ok: boolean;
  mensaje: string;
}

/**
 * Copia exacta de la misma Server Action en apps/admin — apps/guard es
 * un proyecto de Next.js separado (despliegue propio en Netlify), así
 * que no puede importar directamente el archivo del otro. Ver el
 * comentario completo en apps/admin/app/establecer-password-action.ts
 * para el porqué de este mecanismo.
 */
export async function establecerPasswordInvitado(password: string): Promise<ResultadoEstablecerPassword> {
  if (password.length < 8) {
    return { ok: false, mensaje: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();

  if (errorSesion || !user) {
    return { ok: false, mensaje: "Tu sesión ya no es válida. Solicita un enlace nuevo." };
  }

  let servicioClient;
  try {
    servicioClient = createServiceRoleClient();
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Falta configurar SUPABASE_SERVICE_ROLE_KEY." };
  }

  const { data: dataUpdate, error: errorUpdate } = await servicioClient.auth.admin.updateUserById(user.id, {
    password: password.trim(),
  });

  if (errorUpdate || !dataUpdate.user) {
    console.error(
      "[GateFlow] admin.updateUserById falló:",
      errorUpdate?.message,
      "code:",
      (errorUpdate as { code?: string } | undefined)?.code,
      "status:",
      errorUpdate?.status,
    );
    return { ok: false, mensaje: errorUpdate?.message ?? "No se pudo guardar la contraseña. Intenta de nuevo." };
  }

  return { ok: true, mensaje: "Contraseña actualizada." };
}

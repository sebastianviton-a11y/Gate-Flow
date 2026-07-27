"use server";

import { createServerSupabaseClient, createServiceRoleClient } from "@gateflow/supabase";

export interface ResultadoEstablecerPassword {
  ok: boolean;
  mensaje: string;
}

/**
 * Reemplaza la llamada directa del navegador a
 * supabase.auth.updateUser({password}) dentro de la sesión de
 * invitación/recuperación — esa llamada devolvía éxito (sin error, con
 * data.user presente) pero la contraseña resultante no funcionaba
 * después en signInWithPassword. Confirmado con una prueba controlada:
 * escribir la contraseña directo en la base de datos SÍ funcionaba de
 * inmediato, lo que aisló el problema al mecanismo de updateUser()
 * dentro de esa sesión específica, no a la contraseña en sí ni a cómo
 * se escribía.
 *
 * Esta función usa el mismo tipo de escritura privilegiada que la
 * prueba de SQL, pero por el canal correcto: la API de administración
 * de Supabase (auth.admin.updateUserById), no SQL a mano.
 *
 * Seguridad: no confía en ningún ID que el navegador pudiera enviar —
 * primero valida la sesión real de la persona (cookies, vía el
 * cliente de servidor normal) y usa getUser() en vez de getSession()
 * porque getUser() revalida el token contra Supabase en vez de
 * confiar en lo que ya esté guardado localmente.
 */
export async function establecerPasswordInvitado(password: string): Promise<ResultadoEstablecerPassword> {
  console.log("[SERVER] STEP A: establecerPasswordInvitado invocada. Longitud de password recibida:", password.length);

  if (password.length < 8) {
    return { ok: false, mensaje: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: errorSesion,
  } = await supabase.auth.getUser();

  console.log(
    "[SERVER] STEP B: getUser() (vía cookies de la Server Action) ->",
    JSON.stringify({ userId: user?.id, email: user?.email, errorSesion: errorSesion?.message }),
  );

  if (errorSesion || !user) {
    return { ok: false, mensaje: "Tu sesión ya no es válida. Solicita un enlace nuevo." };
  }

  let servicioClient;
  try {
    servicioClient = createServiceRoleClient();
    console.log("[SERVER] STEP C: createServiceRoleClient() OK — la clave de servicio sí está configurada.");
  } catch (e) {
    console.error("[SERVER] STEP C: createServiceRoleClient() falló:", e instanceof Error ? e.message : e);
    return { ok: false, mensaje: e instanceof Error ? e.message : "Falta configurar SUPABASE_SERVICE_ROLE_KEY." };
  }

  const { data: dataUpdate, error: errorUpdate } = await servicioClient.auth.admin.updateUserById(user.id, {
    password: password.trim(),
  });

  console.log(
    "[SERVER] STEP D: admin.updateUserById() ->",
    JSON.stringify({
      userIdDevuelto: dataUpdate?.user?.id,
      userIdEsperado: user.id,
      coincideId: dataUpdate?.user?.id === user.id,
      emailDevuelto: dataUpdate?.user?.email,
      updatedAt: dataUpdate?.user?.updated_at,
      error: errorUpdate?.message,
    }),
  );

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

  console.log("[SERVER] STEP E: éxito — password actualizada para user.id:", user.id);
  return { ok: true, mensaje: "Contraseña actualizada." };
}

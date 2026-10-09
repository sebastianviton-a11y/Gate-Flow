"use server";

import { getSessionContext } from "@gateflow/auth";
import { puedeInvitar } from "@gateflow/paquetes";
import { createServerSupabaseClient, createServiceRoleClient } from "@gateflow/supabase";
import { urlPublicaAdmin } from "@/lib/entorno";

export interface InvitarAdministradorInput {
  empresaId: string;
  nombreResidencial: string;
  ciudad?: string;
  estadoGeografico?: string;
  plan: string;
  correoAdministrador: string;
}

export interface ResultadoInvitacion {
  ok: boolean;
  tenantId?: string;
  mensaje: string;
}

/**
 * Reemplaza el flujo anterior ("solo guarda el contacto, la cuenta se
 * crea manual en Supabase") — ahora que existe createServiceRoleClient,
 * la invitación real por correo es posible. Crea el residencial y, en
 * el mismo paso, envía la invitación — si la invitación falla después
 * de crear el residencial, el residencial NO se deja huérfano: se
 * elimina también, para que "Enviar invitación" sea una operación
 * atómica desde la perspectiva de quien la usa (o funciona completa, o
 * no deja nada a medias).
 *
 * La membresía de administrador NO viaja en la metadata de la
 * invitación (cualquiera que haga un signUp público controla esa
 * metadata): se otorga después con otorgar_membresia(), que valida en
 * la base de datos que quien invita es super_admin.
 */
export async function invitarAdministrador(input: InvitarAdministradorInput): Promise<ResultadoInvitacion> {
  const session = await getSessionContext();
  if (!session || !puedeInvitar(session.role, "admin_residencial")) {
    return { ok: false, mensaje: "Solo Super Admin puede enviar esta invitación." };
  }

  const supabase = createServerSupabaseClient();

  const { data: tenant, error: errorTenant } = await supabase
    .from("tenants")
    .insert({
      nombre: input.nombreResidencial.trim(),
      tipo: "residencial",
      empresa_id: input.empresaId,
      ciudad: input.ciudad?.trim() || null,
      estado_geografico: input.estadoGeografico?.trim() || null,
      plan: input.plan,
      estado_servicio: "piloto",
      onboarding_completado: false,
    })
    .select("id")
    .single();

  if (errorTenant || !tenant) {
    return { ok: false, mensaje: `No se pudo crear el residencial: ${errorTenant?.message ?? "error desconocido"}` };
  }

  let servicioClient;
  try {
    servicioClient = createServiceRoleClient();
  } catch (e) {
    // La clave de servicio no está configurada — no se deja el
    // residencial a medias (sin nadie que pueda administrarlo), se
    // revierte la creación y se explica exactamente qué falta.
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, mensaje: e instanceof Error ? e.message : "Falta configurar SUPABASE_SERVICE_ROLE_KEY." };
  }

  // Toda alta manual queda con suscripción active + alta_manual, sin
  // trial (como el backfill de la migración de registro). Solo en el
  // servidor y con la clave de servicio: la RPC no acepta estado,
  // origen ni fechas, así que el navegador no puede elegirlos. Sin
  // suscripción no se deja el residencial a medias.
  const { error: errorSuscripcion } = await servicioClient.rpc("crear_suscripcion_alta_manual", { p_tenant_id: tenant.id });
  if (errorSuscripcion) {
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, mensaje: `No se pudo crear la suscripción del residencial: ${errorSuscripcion.message}` };
  }

  // El enlace del correo vuelve a ESTE Admin; sin su URL pública no se envía.
  const urlAdmin = urlPublicaAdmin();
  if (!urlAdmin) {
    console.error("[GateFlow] superadmin: falta NEXT_PUBLIC_ADMIN_APP_URL; invitación no enviada.");
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, mensaje: "No se pudo enviar la invitación: falta configurar NEXT_PUBLIC_ADMIN_APP_URL." };
  }

  const { data: dataInvite, error: errorInvite } = await servicioClient.auth.admin.inviteUserByEmail(input.correoAdministrador.trim(), {
    redirectTo: `${urlAdmin}/aceptar-invitacion`,
  });

  if (errorInvite) {
    // Solo estado y código: nunca el correo ni la respuesta completa.
    const e = errorInvite as { status?: number; code?: string };
    console.error("[GateFlow] superadmin: invitación rechazada por Auth", JSON.stringify({ status: e.status ?? null, code: e.code ?? null }));
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, mensaje: `No se pudo enviar la invitación: ${errorInvite.message}` };
  }

  const { error: errorMembresia } = await servicioClient.rpc("otorgar_membresia", {
    p_user_id: dataInvite.user.id,
    p_tenant_id: tenant.id,
    p_rol_clave: "admin_residencial",
    p_otorgado_por: session.user.id,
  });

  if (errorMembresia) {
    // Misma regla de atomicidad: sin membresía, ni la cuenta invitada
    // ni el residencial deben quedar a medias.
    await revertirInvitacion(servicioClient, dataInvite.user);
    await supabase.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, mensaje: `No se pudo asignar el residencial al administrador invitado: ${errorMembresia.message}` };
  }

  await supabase.rpc("registrar_auditoria", {
    p_tenant_id: tenant.id,
    p_accion: "superadmin.invitacion_administrador_enviada",
    p_entidad: "tenants",
    p_entidad_id: tenant.id,
    p_datos_anteriores: {},
    p_datos_nuevos: { correo: input.correoAdministrador, enviada_por: session.user.id },
  });

  return { ok: true, tenantId: tenant.id, mensaje: "Invitación enviada correctamente." };
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

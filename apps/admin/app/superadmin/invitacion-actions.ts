"use server";

import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient, createServiceRoleClient } from "@gateflow/supabase";

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
 */
export async function invitarAdministrador(input: InvitarAdministradorInput): Promise<ResultadoInvitacion> {
  const session = await getSessionContext();
  if (!session || session.role !== "super_admin") {
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

  const { data: dataInvite, error: errorInvite } = await servicioClient.auth.admin.inviteUserByEmail(input.correoAdministrador.trim(), {
    data: { tenant_id: tenant.id, rol_clave: "admin_residencial" },
    redirectTo: `${process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? ""}/aceptar-invitacion`,
  });

  if (errorInvite) {
    // ── DIAGNÓSTICO TEMPORAL — imprimir absolutamente todo ──────
    // Los console.error de una Server Action salen en los logs de
    // FUNCIONES de Netlify (Netlify → Logs → Functions), no en la
    // consola del navegador.
    console.error("=== ERROR COMPLETO DE inviteUserByEmail ===");
    console.error(errorInvite);
    console.error("message:", errorInvite.message);
    console.error("stack:", (errorInvite as Error).stack);
    console.error("cause:", (errorInvite as Error).cause);
    console.error("typeof:", typeof errorInvite);
    console.error("propiedades:", Object.getOwnPropertyNames(errorInvite));
    const e = errorInvite as unknown as Record<string, unknown>;
    console.error("status:", e.status);
    console.error("statusCode:", e.statusCode);
    console.error("code:", e.code);
    console.error("error:", e.error);
    console.error("details:", e.details);
    console.error("body:", e.body);
    console.error("response:", e.response);
    console.error("dataInvite:", JSON.stringify(dataInvite));
    console.error("=== FIN ERROR COMPLETO ===");

    // Mensaje visible en pantalla con todo el detalle disponible,
    // propiedad por propiedad (no JSON.stringify del objeto, que en
    // AuthError esconde las propiedades no-enumerables — por eso se
    // veía "{}").
    const detalle = [
      `message=${String(errorInvite.message)}`,
      `name=${String((errorInvite as Error).name)}`,
      `status=${String(e.status)}`,
      `code=${String(e.code)}`,
      `props=[${Object.getOwnPropertyNames(errorInvite).join(", ")}]`,
    ].join(" | ");

    await supabase.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, mensaje: `No se pudo enviar la invitación: ${detalle}` };
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

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

  // ── DIAGNÓSTICO 1: entorno en tiempo de ejecución ─────────────
  const urlBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const redirectTo = `${process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? ""}/aceptar-invitacion`;
  console.error("=== DIAGNOSTICO ENTORNO ===");
  console.error("SUPABASE_URL presente:", Boolean(urlBase), "| valor:", urlBase);
  console.error("SERVICE_ROLE_KEY presente:", Boolean(serviceKey), "| longitud:", serviceKey.length, "| inicia con:", serviceKey.slice(0, 8));
  console.error("NEXT_PUBLIC_ADMIN_APP_URL:", process.env.NEXT_PUBLIC_ADMIN_APP_URL);
  console.error("redirectTo calculado:", redirectTo);

  const { data: dataInvite, error: errorInvite } = await servicioClient.auth.admin.inviteUserByEmail(input.correoAdministrador.trim(), {
    data: { tenant_id: tenant.id, rol_clave: "admin_residencial" },
    redirectTo,
  });

  if (errorInvite) {
    // ── DIAGNÓSTICO 2: el error tal como lo entrega supabase-js ──
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

    // ── DIAGNÓSTICO 3: repetir la MISMA llamada HTTP directa al ──
    // endpoint, sin pasar por supabase-js, para capturar el cuerpo
    // crudo de la respuesta que la librería no expone. Solo lectura
    // de diagnóstico — usa un correo inexistente a propósito NO:
    // usa el mismo correo; la primera llamada ya falló, así que no
    // duplica invitaciones (GoTrue falla igual las dos veces).
    let cuerpoCrudo = "(no capturado)";
    let statusCrudo = 0;
    try {
      const respuestaDirecta = await fetch(`${urlBase}/auth/v1/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ email: input.correoAdministrador.trim() }),
      });
      statusCrudo = respuestaDirecta.status;
      cuerpoCrudo = await respuestaDirecta.text();
      console.error("=== RESPUESTA HTTP DIRECTA /auth/v1/invite ===");
      console.error("HTTP status:", statusCrudo);
      console.error("Response body crudo:", cuerpoCrudo);
      console.error("Headers:", JSON.stringify(Object.fromEntries(respuestaDirecta.headers.entries())));
      console.error("=== FIN RESPUESTA DIRECTA ===");
    } catch (fetchError) {
      console.error("La llamada directa también falló a nivel de red:", fetchError);
      cuerpoCrudo = `fetch falló: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
    }

    const detalle = [
      `message=${String(errorInvite.message)}`,
      `name=${String((errorInvite as Error).name)}`,
      `status=${String(e.status)}`,
      `code=${String(e.code)}`,
      `httpDirecto=${statusCrudo}`,
      `bodyCrudo=${cuerpoCrudo.slice(0, 300)}`,
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

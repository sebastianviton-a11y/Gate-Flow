"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";

/**
 * "Entrar como soporte": pone una cookie con el tenant a soportar —
 * getSessionContext() la lee y, SOLO si el rol real es super_admin,
 * hace que session.tenant apunte a ese residencial. No crea ninguna
 * sesión ni token de otro usuario real (eso exigiría la clave de
 * servicio de Supabase, que nunca debe vivir en el navegador).
 */
export async function entrarComoSoporte(tenantId: string) {
  const session = await getSessionContext();
  if (!session || session.role !== "super_admin") {
    throw new Error("Solo Super Admin puede entrar en modo soporte.");
  }

  const supabase = createServerSupabaseClient();
  await supabase.rpc("registrar_auditoria", {
    p_tenant_id: tenantId,
    p_accion: "superadmin.impersonacion_iniciada",
    p_entidad: "tenants",
    p_entidad_id: tenantId,
    p_datos_anteriores: {},
    p_datos_nuevos: { super_admin_id: session.user.id },
  });

  cookies().set("gf_soporte_tenant", tenantId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4, // 4 horas — una sesión de soporte no debe quedar abierta indefinidamente
    path: "/",
  });

  redirect("/dashboard");
}

export async function salirModoSoporte() {
  const session = await getSessionContext();

  if (session?.impersonando && session.tenantReal) {
    const supabase = createServerSupabaseClient();
    await supabase.rpc("registrar_auditoria", {
      p_tenant_id: session.tenant.id,
      p_accion: "superadmin.impersonacion_finalizada",
      p_entidad: "tenants",
      p_entidad_id: session.tenant.id,
      p_datos_anteriores: {},
      p_datos_nuevos: { super_admin_id: session.user.id },
    });
  }

  cookies().delete("gf_soporte_tenant");
  redirect("/superadmin/residenciales");
}

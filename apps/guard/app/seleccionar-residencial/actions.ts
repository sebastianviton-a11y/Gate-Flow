"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_TENANT,
  SELECT_MEMBRESIAS_ACCESO,
  opcionesCookieTenant,
  resolverAccesoUsuario,
  resultadoEleccionGuard,
  rolDeFila,
  type FilaMembresia,
} from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { RUTA_SERVICIO_INACTIVO, esServicioInactivo } from "@/lib/acceso-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Elegir residencial en Guard. No se confía en el tenant_id del
 * formulario: se valida la membresía ACTIVA del usuario en ese tenant
 * (unique user_id, tenant_id), con un rol que opera en Guard. Se guarda
 * la gf_tenant de Guard (cookie de este dominio, independiente de
 * Admin) y se resuelve el estado de ESE residencial:
 *   operativo → /guard;  no operativo → /servicio-inactivo.
 */
export async function elegirResidencialGuard(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!UUID.test(tenantId)) redirect("/seleccionar-residencial");

  const { data: fila, error } = await supabase
    .from("user_tenants")
    .select(SELECT_MEMBRESIAS_ACCESO)
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .maybeSingle();

  if (error || !fila || !resultadoEleccionGuard(rolDeFila(fila as FilaMembresia)).guardarCookie) {
    cookies().delete(COOKIE_TENANT);
    redirect("/seleccionar-residencial");
  }

  // Reemplaza la selección anterior (misma cookie).
  cookies().set(COOKIE_TENANT, tenantId, opcionesCookieTenant());

  const { decision } = resolverAccesoUsuario({ error: null, filas: [fila as FilaMembresia], cookieTenantId: tenantId, app: "guard" });
  if (decision.tipo === "permitir") redirect("/guard");
  if (esServicioInactivo(decision)) redirect(RUTA_SERVICIO_INACTIVO);
  redirect("/sin-acceso");
}

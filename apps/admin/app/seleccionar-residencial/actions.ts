"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_TENANT, opcionesCookieTenant, resultadoEleccionAdmin, rolDeFila, type FilaMembresia } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { SELECT_MEMBRESIA_PANEL, urlAppGuard } from "@/lib/acceso-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Elegir residencial en Admin. El tenant_id llega del formulario: no se
 * confía en él; se valida que exista la membresía ACTIVA del usuario en
 * ese tenant (unique user_id, tenant_id: a lo sumo una fila).
 *   admin_residencial / super_admin → guarda gf_tenant (de Admin) y entra.
 *   guardia → NO guarda nada en Admin; va a Guard (que tiene su propia
 *             selección y su propia gf_tenant).
 */
export async function elegirResidencialAdmin(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!UUID.test(tenantId)) redirect("/seleccionar-residencial");

  const { data: fila, error } = await supabase
    .from("user_tenants")
    .select(SELECT_MEMBRESIA_PANEL)
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .maybeSingle();

  if (error || !fila) {
    cookies().delete(COOKIE_TENANT);
    redirect("/seleccionar-residencial");
  }

  const resultado = resultadoEleccionAdmin(rolDeFila(fila as FilaMembresia));
  if (resultado.guardarCookie) {
    // Reemplaza la selección anterior (misma cookie).
    cookies().set(COOKIE_TENANT, tenantId, opcionesCookieTenant());
    redirect("/dashboard");
  }
  if (resultado.destino === "guard") {
    const urlGuard = urlAppGuard();
    redirect(urlGuard ? `${urlGuard}/guard` : "/sin-acceso?motivo=rol");
  }
  redirect("/sin-acceso?motivo=rol");
}

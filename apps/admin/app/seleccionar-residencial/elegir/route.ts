import { cookies } from "next/headers";
import {
  COOKIE_TENANT,
  RUTA_SELECCIONAR_RESIDENCIAL,
  opcionesCookieTenant,
  origenPermitidoEleccion,
  redireccionEleccion,
  resultadoEleccionAdmin,
  rolDeFila,
  type FilaMembresia,
} from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { SELECT_MEMBRESIA_PANEL, urlAppGuard } from "@/lib/acceso-panel";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Elegir residencial en Admin (POST del formulario nativo de
 * ../page.tsx; ver RUTA_ELEGIR_RESIDENCIAL). El tenant_id llega del
 * formulario: no se confía en él; se valida que exista la membresía
 * ACTIVA del usuario en ese tenant (unique user_id, tenant_id: a lo sumo
 * una fila).
 *   admin_residencial / super_admin → guarda gf_tenant (de Admin) y entra.
 *   guardia → NO guarda nada en Admin; va a Guard (que tiene su propia
 *             selección y su propia gf_tenant).
 * Responde siempre 303: el navegador abre el destino con GET.
 */
export async function POST(request: Request): Promise<Response> {
  if (!origenPermitidoEleccion(request.headers)) return new Response(null, { status: 403 });

  const formData = await request.formData().catch(() => null);
  const tenantId = String(formData?.get("tenant_id") ?? "");
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redireccionEleccion("/login");

  if (!UUID.test(tenantId)) return redireccionEleccion(RUTA_SELECCIONAR_RESIDENCIAL);

  const { data: fila, error } = await supabase
    .from("user_tenants")
    .select(SELECT_MEMBRESIA_PANEL)
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .maybeSingle();

  if (error || !fila) {
    cookies().delete(COOKIE_TENANT);
    return redireccionEleccion(RUTA_SELECCIONAR_RESIDENCIAL);
  }

  const resultado = resultadoEleccionAdmin(rolDeFila(fila as FilaMembresia));
  if (resultado.guardarCookie) {
    // Reemplaza la selección anterior (misma cookie).
    cookies().set(COOKIE_TENANT, tenantId, opcionesCookieTenant());
    return redireccionEleccion("/dashboard");
  }
  if (resultado.destino === "guard") {
    const urlGuard = urlAppGuard();
    return redireccionEleccion(urlGuard ? `${urlGuard}/guard` : "/sin-acceso?motivo=rol");
  }
  return redireccionEleccion("/sin-acceso?motivo=rol");
}

/** GET directo (p. ej. volver tras iniciar sesión con ?next=): al selector. */
export function GET(): Response {
  return redireccionEleccion(RUTA_SELECCIONAR_RESIDENCIAL);
}

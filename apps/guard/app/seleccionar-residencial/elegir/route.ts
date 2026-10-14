import { cookies } from "next/headers";
import {
  COOKIE_TENANT,
  RUTA_SELECCIONAR_RESIDENCIAL,
  SELECT_MEMBRESIAS_ACCESO,
  opcionesCookieTenant,
  origenPermitidoEleccion,
  redireccionEleccion,
  resolverAccesoUsuario,
  resultadoEleccionGuard,
  rolDeFila,
  type FilaMembresia,
} from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { RUTA_SERVICIO_INACTIVO, esServicioInactivo } from "@/lib/acceso-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Elegir residencial en Guard (POST del formulario nativo de
 * ../page.tsx; ver RUTA_ELEGIR_RESIDENCIAL). No se confía en el
 * tenant_id del formulario: se valida la membresía ACTIVA del usuario en
 * ese tenant (unique user_id, tenant_id), con un rol que opera en Guard.
 * Se guarda la gf_tenant de Guard (cookie de este dominio, independiente
 * de Admin) y se resuelve el estado de ESE residencial:
 *   operativo → /guard;  no operativo → /servicio-inactivo.
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
    .select(SELECT_MEMBRESIAS_ACCESO)
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .maybeSingle();

  if (error || !fila || !resultadoEleccionGuard(rolDeFila(fila as FilaMembresia)).guardarCookie) {
    cookies().delete(COOKIE_TENANT);
    return redireccionEleccion(RUTA_SELECCIONAR_RESIDENCIAL);
  }

  // Reemplaza la selección anterior (misma cookie).
  cookies().set(COOKIE_TENANT, tenantId, opcionesCookieTenant());

  const { decision } = resolverAccesoUsuario({ error: null, filas: [fila as FilaMembresia], cookieTenantId: tenantId, app: "guard" });
  if (decision.tipo === "permitir") return redireccionEleccion("/guard");
  if (esServicioInactivo(decision)) return redireccionEleccion(RUTA_SERVICIO_INACTIVO);
  return redireccionEleccion("/sin-acceso");
}

/** GET directo (p. ej. volver tras iniciar sesión con ?next=): al selector. */
export function GET(): Response {
  return redireccionEleccion(RUTA_SELECCIONAR_RESIDENCIAL);
}

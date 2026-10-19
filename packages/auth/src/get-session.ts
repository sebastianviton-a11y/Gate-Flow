import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@gateflow/supabase";
import type { SessionContext, RoleKey, Tenant } from "@gateflow/types";
import { COOKIE_TENANT, RUTA_SELECCIONAR_RESIDENCIAL, seleccionarMembresia, type FilaMembresia } from "./membresias";

/**
 * Ruta pública (en Admin y en Guard) a la que se envía a un usuario
 * autenticado que no tiene un residencial activo. No llama a
 * getSessionContext, así que no puede entrar en bucle.
 */
export const RUTA_SIN_ACCESO = "/sin-acceso";

/**
 * Error al resolver la membresía. Se lanza en vez de devolver una
 * sesión: el Server Component corta ahí (no se hace ninguna consulta más
 * con un tenant inventado) y lo atrapa el error boundary de la app. El
 * mensaje es genérico a propósito; el detalle va al log del servidor.
 */
export class SesionNoResueltaError extends Error {
  constructor() {
    super("No se pudo validar tu acceso. Intenta de nuevo en unos segundos.");
    this.name = "SesionNoResueltaError";
  }
}

/**
 * Resuelve el contexto de sesión (usuario + tenant activo + rol) en el
 * servidor. La fuente de verdad es siempre `user_tenants` (03-DATABASE.md
 * §6), nunca un valor asumido en el cliente.
 *
 * Falla cerrado:
 *   * sin usuario autenticado → null (los layouts redirigen a /login);
 *   * error al leer user_tenants, o fila sin tenant/rol → lanza
 *     SesionNoResueltaError. Nunca se inventa un tenant ni un rol;
 *   * usuario autenticado sin membresía activa → redirige a
 *     RUTA_SIN_ACCESO;
 *   * varias membresías sin selección válida (cookie gf_tenant ausente
 *     o sin membresía activa) → redirige a /seleccionar-residencial.
 *     Nunca se elige una fila arbitraria (sin limit(1) ni ORDER BY).
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const baseUser = {
    id: user.id,
    nombreCompleto: user.user_metadata?.nombre_completo ?? user.email ?? "Usuario",
    email: user.email,
    avatarUrl: user.user_metadata?.avatar_url ?? null,
    activo: true,
  };

  // TODAS las membresías activas (una por tenant: unique user_id,
  // tenant_id); la que manda la elige seleccionarMembresia con gf_tenant.
  const { data: filas, error } = await supabase
    .from("user_tenants")
    .select("tenant_id, rol_id, roles(clave), tenants(id, nombre, tipo, plan, activo, configuracion, empresa_id, pais, timezone)")
    .eq("user_id", user.id)
    .eq("activo", true);

  if (error) {
    console.error("[GateFlow] No se pudo resolver user_tenants; se corta la sesión:", {
      code: error.code,
      message: error.message,
      details: error.details,
    });
    throw new SesionNoResueltaError();
  }

  const seleccion = seleccionarMembresia({
    error: null,
    filas: (filas ?? []) as FilaMembresia[],
    cookieTenantId: cookies().get(COOKIE_TENANT)?.value,
    app: "admin",
  });
  if (seleccion.tipo === "sin_membresia" || seleccion.tipo === "error") {
    redirect(RUTA_SIN_ACCESO);
  }
  if (seleccion.tipo !== "resuelta") {
    redirect(RUTA_SELECCIONAR_RESIDENCIAL);
  }
  const membership = seleccion.membresia;

  const tenantRow = membership.tenants as unknown as {
    id: string;
    nombre: string;
    tipo: Tenant["tipo"];
    plan: Tenant["plan"];
    activo: boolean;
    configuracion: { logoUrl?: string } | null;
    empresa_id: string;
    pais: string | null;
    timezone: string | null;
  } | null;
  const role = (membership.roles as unknown as { clave: RoleKey } | null)?.clave;

  // Una membresía cuyo tenant o rol no se puede leer (RLS, grants) no
  // se completa con valores por defecto: eso convertiría un error de
  // permisos en un rol de administrador.
  if (!tenantRow || !role || tenantRow.id !== membership.tenant_id) {
    console.error("[GateFlow] Membresía sin tenant o rol legible; se corta la sesión:", {
      tenant: Boolean(tenantRow),
      rol: Boolean(role),
    });
    throw new SesionNoResueltaError();
  }

  const tenant: Tenant = {
    id: tenantRow.id,
    nombre: tenantRow.nombre,
    tipo: tenantRow.tipo,
    plan: tenantRow.plan,
    activo: tenantRow.activo,
    logoUrl: tenantRow.configuracion?.logoUrl ?? null,
    empresaId: tenantRow.empresa_id,
    pais: tenantRow.pais,
    timezone: tenantRow.timezone ?? null,
  };

  // "Entrar como soporte": solo aplica si el rol REAL es super_admin —
  // una cookie manipulada por cualquier otro rol se ignora en
  // silencio, nunca concede acceso. No se crea sesión de otro usuario
  // real (exigiría la clave de servicio) — simplemente se cambia a
  // qué tenant apunta `session.tenant`, con la propia identidad.
  if (role === "super_admin") {
    const tenantSoporteId = cookies().get("gf_soporte_tenant")?.value;
    if (tenantSoporteId && tenantSoporteId !== tenant.id) {
      const { data: tenantSoporte, error: errorSoporte } = await supabase
        .from("tenants")
        .select("id, nombre, tipo, plan, activo, configuracion, empresa_id, pais, timezone")
        .eq("id", tenantSoporteId)
        .maybeSingle();

      if (errorSoporte) {
        console.error("[GateFlow] No se pudo leer el tenant de soporte; se corta la sesión:", {
          code: errorSoporte.code,
          message: errorSoporte.message,
        });
        throw new SesionNoResueltaError();
      }

      if (tenantSoporte) {
        const tenantImpersonado: Tenant = {
          id: tenantSoporte.id,
          nombre: tenantSoporte.nombre,
          tipo: tenantSoporte.tipo,
          plan: tenantSoporte.plan,
          activo: tenantSoporte.activo,
          logoUrl: (tenantSoporte.configuracion as { logoUrl?: string } | null)?.logoUrl ?? null,
          empresaId: tenantSoporte.empresa_id,
          pais: (tenantSoporte as { pais?: string | null }).pais ?? null,
          timezone: (tenantSoporte as { timezone?: string | null }).timezone ?? null,
        };
        return {
          user: baseUser,
          tenant: tenantImpersonado,
          role: "admin_residencial",
          availableTenants: [tenantImpersonado],
          impersonando: true,
          tenantReal: tenant,
          rolReal: role,
        };
      }
    }
  }

  // Para el selector del header: los residenciales con membresía activa
  // (solo informativo; el cambio pasa por /seleccionar-residencial).
  const availableTenants: Tenant[] = ((filas ?? []) as FilaMembresia[]).flatMap((f) => {
    const t = f.tenants as typeof tenantRow;
    return t
      ? [{ id: t.id, nombre: t.nombre, tipo: t.tipo, plan: t.plan, activo: t.activo, logoUrl: t.configuracion?.logoUrl ?? null, empresaId: t.empresa_id }]
      : [];
  });

  return {
    user: baseUser,
    tenant,
    role,
    availableTenants: availableTenants.some((t) => t.id === tenant.id) ? availableTenants : [tenant],
  };
});

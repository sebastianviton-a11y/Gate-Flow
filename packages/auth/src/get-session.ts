import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@gateflow/supabase";
import type { SessionContext, RoleKey, Tenant } from "@gateflow/types";

/**
 * Resuelve el contexto de sesión (usuario + tenant activo + rol) en el
 * servidor. La fuente de verdad es siempre `user_tenants` (03-DATABASE.md
 * §6), nunca un valor asumido en el cliente.
 *
 * DECISIÓN MENOR NO DOCUMENTADA (resuelta según CLAUDE.md — "si Claude
 * encuentra una decisión menor no documentada, la resuelve sin detener
 * el desarrollo"): en Sprint 01 el esquema de `03-DATABASE.md` todavía no
 * tiene migraciones aplicadas en el proyecto Supabase del usuario. Cuando
 * eso ocurre, se usa una sesión de demostración para que el layout y el
 * dashboard con datos mock sean navegables sin bloquear el sprint.
 *
 * IMPORTANTE (corrección de SPRINT_01_VALIDATION): este fallback NUNCA debe
 * silenciar un error real e inesperado de Supabase (credenciales mal
 * configuradas, RLS mal definido, falla de red hacia el proyecto, etc.).
 * Solo se considera "esperado" el error de Postgres 42P01 (relation does
 * not exist), que es exactamente lo que ocurre cuando `user_tenants`
 * todavía no fue migrada. Cualquier otro error se registra explícitamente
 * con `console.error` y se marca con `demoReason: "unexpected_error"`, para
 * que sea visible en el banner de la UI y en los logs del servidor — nunca
 * queda indistinguible del caso esperado.
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

  const { data: membership, error } = await supabase
    .from("user_tenants")
    .select("rol_id, roles(clave), tenants(id, nombre, tipo, plan, activo, configuracion)")
    .eq("user_id", user.id)
    .eq("activo", true)
    .limit(1)
    .maybeSingle();

  // Caso real: la tabla existe, el usuario tiene una fila de pertenencia.
  if (!error && membership?.tenants) {
    const tenantRow = membership.tenants as unknown as {
      id: string;
      nombre: string;
      tipo: Tenant["tipo"];
      plan: Tenant["plan"];
      activo: boolean;
      configuracion: { logoUrl?: string } | null;
    };
    const tenant: Tenant = {
      id: tenantRow.id,
      nombre: tenantRow.nombre,
      tipo: tenantRow.tipo,
      plan: tenantRow.plan,
      activo: tenantRow.activo,
      logoUrl: tenantRow.configuracion?.logoUrl ?? null,
    };
    const role = (membership.roles as unknown as { clave: RoleKey })?.clave ?? "admin_residencial";

    return {
      user: baseUser,
      tenant,
      role,
      availableTenants: [tenant],
      isDemo: false,
    };
  }

  // Caso esperado y documentado: el esquema de 03-DATABASE.md aún no está
  // migrado en este proyecto Supabase.
  const isSchemaNotMigrated = error?.code === "42P01";

  if (error && !isSchemaNotMigrated) {
    // Caso NO esperado: no se silencia. Se registra en el servidor con
    // el código y mensaje reales de Supabase, para que un problema
    // genuino (RLS, red, credenciales) no se confunda con "faltan migrar
    // las tablas".
    console.error(
      "[GateFlow] Error inesperado al resolver user_tenants (no es ausencia de tabla):",
      { code: error.code, message: error.message, details: error.details },
    );
  }

  const demoTenant: Tenant = {
    id: "demo-tenant",
    nombre: "Residencial Demo",
    tipo: "residencial",
    plan: "trial",
    activo: true,
  };

  return {
    user: baseUser,
    tenant: demoTenant,
    role: "admin_residencial",
    availableTenants: [demoTenant],
    isDemo: true,
    demoReason: isSchemaNotMigrated
      ? "schema_not_migrated"
      : error
        ? "unexpected_error"
        : "no_membership_row",
  };
});

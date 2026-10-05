import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleKey } from "@gateflow/types";

/** Única fuente de verdad para qué roles puede invitar un
 * admin_residencial desde cualquier pantalla (onboarding y /usuarios):
 * solo guardia. admin_residencial lo otorga únicamente Super Admin
 * desde su propio flujo; supervisor y recepcion no tienen una app a la
 * cual entrar, y nadie invita super_admin. */
export const ROLES_INVITABLES: { clave: RoleKey; etiqueta: string }[] = [
  { clave: "guardia", etiqueta: "Guardia" },
];

/**
 * Quién puede invitar a quién. Misma regla que otorgar_membresia() a
 * partir de la fase C:
 *   guardia           ← admin_residencial o super_admin
 *   admin_residencial ← solo super_admin (flujo de Super Admin)
 * Cualquier otro rol, vacío o desconocido, no se puede invitar.
 */
export function puedeInvitar(rolQuienInvita: string | null | undefined, rolInvitado: string | null | undefined): boolean {
  switch (rolInvitado) {
    case "guardia":
      return rolQuienInvita === "admin_residencial" || rolQuienInvita === "super_admin";
    case "admin_residencial":
      return rolQuienInvita === "super_admin";
    default:
      return false;
  }
}

export interface UsuarioTenant {
  id: string;
  /** id real en `users` — necesario para editar nombre_completo, que
   * vive en esa tabla, no en user_tenants. */
  userId: string;
  nombreCompleto: string;
  email: string | null;
  telefono: string | null;
  rolClave: string;
  rolNombre: string;
  activo: boolean;
  creadoEn: string;
  /** true si nombre_completo nunca se llenó de verdad — el trigger de
   * creación de usuario copia el correo ahí porque la columna es
   * NOT NULL. No es una columna nueva: se deriva comparando los dos
   * valores que ya trae esta misma consulta. */
  perfilIncompleto: boolean;
}

/**
 * Consulta user_tenants con el mismo aislamiento por tenant_id que ya
 * usa el resto del producto (RLS lo garantiza, aunque esta consulta
 * también filtra explícito para que el código sea legible por sí
 * solo).
 */
export async function listarUsuariosTenant(supabase: SupabaseClient, tenantId: string): Promise<UsuarioTenant[]> {
  const { data, error } = await supabase
    .from("user_tenants")
    .select("id, activo, created_at, users(id, nombre_completo, email, telefono), roles(clave, nombre)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    id: string;
    activo: boolean;
    created_at: string;
    users: { id: string; nombre_completo: string; email: string | null; telefono: string | null } | null;
    roles: { clave: string; nombre: string } | null;
  }>).map((fila) => {
    const nombreCompleto = fila.users?.nombre_completo ?? "Sin nombre";
    const email = fila.users?.email ?? null;
    return {
      id: fila.id,
      userId: fila.users?.id ?? "",
      nombreCompleto,
      email,
      telefono: fila.users?.telefono ?? null,
      rolClave: fila.roles?.clave ?? "—",
      rolNombre: fila.roles?.nombre ?? "—",
      activo: fila.activo,
      creadoEn: fila.created_at,
      perfilIncompleto: !!email && nombreCompleto === email,
    };
  });
}

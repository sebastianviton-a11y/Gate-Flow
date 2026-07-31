import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleKey } from "@gateflow/types";

export const ROLES_INVITABLES: { clave: RoleKey; etiqueta: string }[] = [
  { clave: "admin_residencial", etiqueta: "Administrador adicional" },
  { clave: "guardia", etiqueta: "Guardia" },
  { clave: "recepcion", etiqueta: "Recepción" },
  { clave: "supervisor", etiqueta: "Supervisor" },
];

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

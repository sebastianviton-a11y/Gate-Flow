import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleKey } from "@gateflow/types";

/** Única fuente de verdad para qué roles puede invitar un
 * admin_residencial desde cualquier pantalla — antes vivía duplicada
 * como constante local dentro del asistente de onboarding. */
export const ROLES_INVITABLES: { clave: RoleKey; etiqueta: string }[] = [
  { clave: "admin_residencial", etiqueta: "Administrador adicional" },
  { clave: "guardia", etiqueta: "Guardia" },
  { clave: "recepcion", etiqueta: "Recepción" },
  { clave: "supervisor", etiqueta: "Supervisor" },
];

export interface UsuarioTenant {
  id: string;
  nombreCompleto: string;
  email: string | null;
  telefono: string | null;
  rolClave: string;
  rolNombre: string;
  activo: boolean;
  creadoEn: string;
}

/**
 * Reemplaza el placeholder que decía "se conecta junto con la
 * autenticación real en Sprint 02" — esa etapa ya pasó hace mucho;
 * esto consulta user_tenants de verdad, con el mismo aislamiento por
 * tenant_id que ya usa el resto del producto (RLS lo garantiza,
 * aunque esta consulta también filtra explícito para que el código
 * sea legible por sí solo).
 */
export async function listarUsuariosTenant(supabase: SupabaseClient, tenantId: string): Promise<UsuarioTenant[]> {
  const { data, error } = await supabase
    .from("user_tenants")
    .select("id, activo, created_at, users(nombre_completo, email, telefono), roles(clave, nombre)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    id: string;
    activo: boolean;
    created_at: string;
    users: { nombre_completo: string; email: string | null; telefono: string | null } | null;
    roles: { clave: string; nombre: string } | null;
  }>).map((fila) => ({
    id: fila.id,
    nombreCompleto: fila.users?.nombre_completo ?? "Sin nombre",
    email: fila.users?.email ?? null,
    telefono: fila.users?.telefono ?? null,
    rolClave: fila.roles?.clave ?? "—",
    rolNombre: fila.roles?.nombre ?? "—",
    activo: fila.activo,
    creadoEn: fila.created_at,
  }));
}

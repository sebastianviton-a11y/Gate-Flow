import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoServicio = "piloto" | "activo" | "suspendido" | "cancelado";
export type PlanClave = "piloto" | "starter" | "business" | "enterprise" | "trial" | "basico" | "pro";

export const ESTADO_SERVICIO_LABEL: Record<EstadoServicio, string> = {
  piloto: "Piloto",
  activo: "Activo",
  suspendido: "Suspendido",
  cancelado: "Cancelado",
};

/** Cubre tanto los nombres nuevos (piloto/starter/business/enterprise)
 * como los antiguos (trial/basico/pro) que ya existían antes de este
 * módulo — no se migraron datos existentes, así que la UI debe poder
 * mostrar ambos sin verse rota. */
export const PLAN_LABEL: Record<PlanClave, string> = {
  piloto: "Piloto",
  starter: "Starter",
  business: "Business",
  enterprise: "Enterprise",
  trial: "Piloto (heredado)",
  basico: "Starter (heredado)",
  pro: "Business (heredado)",
};

export interface MetricasGlobales {
  residencialesActivos: number;
  residencialesPiloto: number;
  residencialesSuspendidos: number;
  totalResidentes: number;
  totalUsuarios: number;
  totalPaquetes: number;
  paquetesEsteMes: number;
  /** % de cambio en paquetes registrados este mes vs. el mes anterior.
   * null cuando el mes anterior no tuvo ningún paquete (división por
   * cero) — la UI debe mostrar "—" o "Nuevo", no un porcentaje falso. */
  crecimientoMensual: number | null;
}

/**
 * Todas las cuentas son globales (sin filtrar por tenant_id) — a
 * propósito, es el propio objetivo del dashboard de Super Admin. Cada
 * tabla consultada ya tiene `or is_super_admin()` en su policy de
 * SELECT desde la migración 5, así que estas consultas no necesitan
 * ninguna función especial: RLS ya las autoriza para quien de verdad
 * tiene el rol.
 */
export async function obtenerMetricasGlobales(supabase: SupabaseClient): Promise<MetricasGlobales> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const inicioMesAnterior = new Date(inicioMes);
  inicioMesAnterior.setMonth(inicioMesAnterior.getMonth() - 1);

  const [tenants, unidadesConContacto, residentesFormales, usuarios, paquetesTotal, paquetesEsteMes, paquetesMesAnterior] = await Promise.all([
    supabase.from("tenants").select("estado_servicio"),
    supabase.from("unidades").select("id", { count: "exact", head: true }).not("contacto_nombre", "is", null),
    supabase.from("residentes_unidades").select("user_id", { count: "exact", head: true }),
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("paquetes").select("id", { count: "exact", head: true }),
    supabase.from("paquetes").select("id", { count: "exact", head: true }).gte("fecha_recepcion", inicioMes.toISOString()),
    supabase
      .from("paquetes")
      .select("id", { count: "exact", head: true })
      .gte("fecha_recepcion", inicioMesAnterior.toISOString())
      .lt("fecha_recepcion", inicioMes.toISOString()),
  ]);

  if (tenants.error) throw tenants.error;

  const porEstado = { piloto: 0, activo: 0, suspendido: 0, cancelado: 0 };
  for (const t of tenants.data ?? []) {
    const estado = (t.estado_servicio ?? "piloto") as EstadoServicio;
    porEstado[estado] = (porEstado[estado] ?? 0) + 1;
  }

  const totalMesAnterior = paquetesMesAnterior.count ?? 0;
  const totalEsteMes = paquetesEsteMes.count ?? 0;
  const crecimientoMensual = totalMesAnterior === 0 ? null : ((totalEsteMes - totalMesAnterior) / totalMesAnterior) * 100;

  return {
    residencialesActivos: porEstado.activo,
    residencialesPiloto: porEstado.piloto,
    residencialesSuspendidos: porEstado.suspendido,
    // "Total de residentes": suma de unidades con contacto informal +
    // vínculos formales en residentes_unidades. La mayoría de los datos
    // reales hoy son contactos informales (unidades.contacto_nombre) —
    // contar solo residentes_unidades mostraría ~0 aunque el
    // residencial tenga residentes reales cargados. Es una decisión de
    // interpretación, no un dato exacto de "personas únicas".
    totalResidentes: (unidadesConContacto.count ?? 0) + (residentesFormales.count ?? 0),
    totalUsuarios: usuarios.count ?? 0,
    totalPaquetes: paquetesTotal.count ?? 0,
    paquetesEsteMes: totalEsteMes,
    crecimientoMensual,
  };
}

export interface ResidencialListItem {
  id: string;
  nombre: string;
  logoUrl: string | null;
  ciudad: string | null;
  estadoGeografico: string | null;
  estadoServicio: EstadoServicio;
  plan: PlanClave;
  administradorNombre: string | null;
  totalViviendas: number;
  totalUsuarios: number;
  creadoEn: string;
  planFechaRenovacion: string | null;
  empresaId: string;
  empresaNombre: string;
}

interface TenantRow {
  id: string;
  nombre: string;
  ciudad: string | null;
  estado_geografico: string | null;
  estado_servicio: string;
  plan: string;
  configuracion: { logoUrl?: string } | null;
  admin_contacto_nombre: string | null;
  created_at: string;
  plan_fecha_renovacion: string | null;
  empresa_id: string;
  empresas: { nombre: string } | null;
}

/** `empresaId` filtra a los residenciales de una sola empresa — es lo
 * que usa la pantalla de detalle de empresa (Super Admin → Empresas →
 * [una empresa] → sus residenciales), reutilizando esta misma función
 * y el mismo componente de tabla que ya existía. */
export async function listarResidenciales(supabase: SupabaseClient, empresaId?: string): Promise<ResidencialListItem[]> {
  let consulta = supabase
    .from("tenants")
    .select(
      "id, nombre, ciudad, estado_geografico, estado_servicio, plan, configuracion, admin_contacto_nombre, created_at, plan_fecha_renovacion, empresa_id, empresas ( nombre )",
    )
    .order("created_at", { ascending: false });
  if (empresaId) consulta = consulta.eq("empresa_id", empresaId);

  const { data: tenants, error } = await consulta;
  if (error) throw error;

  const filas = (tenants ?? []) as unknown as TenantRow[];
  if (filas.length === 0) return [];

  const ids = filas.map((f) => f.id);

  const [unidadesPorTenant, userTenantsPorTenant, adminsPorTenant] = await Promise.all([
    supabase.from("unidades").select("tenant_id").in("tenant_id", ids),
    supabase.from("user_tenants").select("tenant_id, user_id").in("tenant_id", ids).eq("activo", true),
    supabase.from("user_tenants").select("tenant_id, users(nombre_completo), roles(clave)").in("tenant_id", ids).eq("activo", true),
  ]);

  const conteoViviendas = new Map<string, number>();
  for (const u of unidadesPorTenant.data ?? []) {
    conteoViviendas.set(u.tenant_id, (conteoViviendas.get(u.tenant_id) ?? 0) + 1);
  }

  const conteoUsuarios = new Map<string, number>();
  for (const ut of userTenantsPorTenant.data ?? []) {
    conteoUsuarios.set(ut.tenant_id, (conteoUsuarios.get(ut.tenant_id) ?? 0) + 1);
  }

  const adminPorTenant = new Map<string, string>();
  for (const a of (adminsPorTenant.data ?? []) as unknown as Array<{
    tenant_id: string;
    users: { nombre_completo: string } | null;
    roles: { clave: string } | null;
  }>) {
    if (a.roles?.clave === "admin_residencial" && a.users?.nombre_completo && !adminPorTenant.has(a.tenant_id)) {
      adminPorTenant.set(a.tenant_id, a.users.nombre_completo);
    }
  }

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    logoUrl: f.configuracion?.logoUrl ?? null,
    ciudad: f.ciudad,
    estadoGeografico: f.estado_geografico,
    estadoServicio: f.estado_servicio as EstadoServicio,
    plan: f.plan as PlanClave,
    administradorNombre: adminPorTenant.get(f.id) ?? f.admin_contacto_nombre ?? null,
    totalViviendas: conteoViviendas.get(f.id) ?? 0,
    totalUsuarios: conteoUsuarios.get(f.id) ?? 0,
    creadoEn: f.created_at,
    planFechaRenovacion: f.plan_fecha_renovacion,
    empresaId: f.empresa_id,
    empresaNombre: f.empresas?.nombre ?? "—",
  }));
}

export interface ResidencialInput {
  nombre: string;
  empresaId: string;
  ciudad?: string | null;
  estadoGeografico?: string | null;
  pais?: string;
  plan?: PlanClave;
  adminContactoNombre?: string | null;
  adminContactoEmail?: string | null;
  adminContactoTelefono?: string | null;
  observaciones?: string | null;
}

export async function crearResidencial(supabase: SupabaseClient, input: ResidencialInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("tenants")
    .insert({
      nombre: input.nombre.trim(),
      tipo: "residencial",
      empresa_id: input.empresaId,
      ciudad: input.ciudad?.trim() || null,
      estado_geografico: input.estadoGeografico?.trim() || null,
      pais: input.pais || "MX",
      plan: input.plan || "piloto",
      estado_servicio: "piloto",
      admin_contacto_nombre: input.adminContactoNombre?.trim() || null,
      admin_contacto_email: input.adminContactoEmail?.trim() || null,
      admin_contacto_telefono: input.adminContactoTelefono?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function actualizarResidencial(supabase: SupabaseClient, id: string, input: ResidencialInput): Promise<void> {
  const { error } = await supabase
    .from("tenants")
    .update({
      nombre: input.nombre.trim(),
      ciudad: input.ciudad?.trim() || null,
      estado_geografico: input.estadoGeografico?.trim() || null,
      admin_contacto_nombre: input.adminContactoNombre?.trim() || null,
      admin_contacto_email: input.adminContactoEmail?.trim() || null,
      admin_contacto_telefono: input.adminContactoTelefono?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function cambiarEstadoServicio(supabase: SupabaseClient, id: string, estado: EstadoServicio): Promise<void> {
  const { error } = await supabase.from("tenants").update({ estado_servicio: estado }).eq("id", id);
  if (error) throw error;
}

export async function actualizarPlanResidencial(
  supabase: SupabaseClient,
  id: string,
  input: { plan: PlanClave; precio?: number | null; fechaInicio?: string | null; fechaRenovacion?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("tenants")
    .update({
      plan: input.plan,
      plan_precio: input.precio ?? null,
      plan_fecha_inicio: input.fechaInicio || null,
      plan_fecha_renovacion: input.fechaRenovacion || null,
    })
    .eq("id", id);
  if (error) throw error;
}

/** Destructivo — borra en cascada TODO lo del residencial (paquetes,
 * unidades, usuarios vinculados, historial). La confirmación de "escribe
 * el nombre para confirmar" vive en la UI, no aquí — esta función no
 * vuelve a preguntar, asume que quien la llama ya confirmó. */
export async function eliminarResidencial(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("tenants").delete().eq("id", id);
  if (error) throw error;
}

export interface ResidencialDetalle extends ResidencialListItem {
  pais: string;
  planPrecio: number | null;
  planFechaInicio: string | null;
  adminContactoEmail: string | null;
  adminContactoTelefono: string | null;
  observaciones: string | null;
}

export async function obtenerResidencialDetalle(supabase: SupabaseClient, id: string): Promise<ResidencialDetalle | null> {
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, nombre, ciudad, estado_geografico, estado_servicio, plan, configuracion, admin_contacto_nombre, admin_contacto_email, admin_contacto_telefono, observaciones, created_at, pais, plan_precio, plan_fecha_inicio, plan_fecha_renovacion, empresa_id, empresas ( nombre )",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const empresaRelacionada = data.empresas as unknown as { nombre: string } | null;

  const [unidades, userTenants, admins] = await Promise.all([
    supabase.from("unidades").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    supabase.from("user_tenants").select("user_id", { count: "exact", head: true }).eq("tenant_id", id).eq("activo", true),
    supabase.from("user_tenants").select("users(nombre_completo), roles(clave)").eq("tenant_id", id).eq("activo", true),
  ]);

  const adminReal = (admins.data as unknown as Array<{ users: { nombre_completo: string } | null; roles: { clave: string } | null }> | null)?.find(
    (a) => a.roles?.clave === "admin_residencial",
  );

  return {
    id: data.id,
    nombre: data.nombre,
    logoUrl: (data.configuracion as { logoUrl?: string } | null)?.logoUrl ?? null,
    ciudad: data.ciudad,
    estadoGeografico: data.estado_geografico,
    estadoServicio: data.estado_servicio as EstadoServicio,
    plan: data.plan as PlanClave,
    administradorNombre: adminReal?.users?.nombre_completo ?? data.admin_contacto_nombre ?? null,
    totalViviendas: unidades.count ?? 0,
    totalUsuarios: userTenants.count ?? 0,
    creadoEn: data.created_at,
    planFechaRenovacion: data.plan_fecha_renovacion,
    pais: data.pais,
    planPrecio: data.plan_precio,
    planFechaInicio: data.plan_fecha_inicio,
    adminContactoEmail: data.admin_contacto_email,
    adminContactoTelefono: data.admin_contacto_telefono,
    observaciones: data.observaciones,
    empresaId: data.empresa_id,
    empresaNombre: empresaRelacionada?.nombre ?? "—",
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoServicio } from "./superadmin";

export interface EmpresaListItem {
  id: string;
  nombre: string;
  logoUrl: string | null;
  ciudad: string | null;
  estadoGeografico: string | null;
  estadoServicio: EstadoServicio;
  plan: string;
  totalResidenciales: number;
  creadaEn: string;
}

interface EmpresaRow {
  id: string;
  nombre: string;
  ciudad: string | null;
  estado_geografico: string | null;
  estado_servicio: string;
  plan: string;
  configuracion: { logoUrl?: string } | null;
  created_at: string;
}

/** Pantalla principal de Super Admin — "primero las Empresas". */
export async function listarEmpresas(supabase: SupabaseClient): Promise<EmpresaListItem[]> {
  const { data: empresas, error } = await supabase
    .from("empresas")
    .select("id, nombre, ciudad, estado_geografico, estado_servicio, plan, configuracion, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const filas = (empresas ?? []) as EmpresaRow[];
  if (filas.length === 0) return [];

  const { data: tenants } = await supabase.from("tenants").select("empresa_id");
  const conteo = new Map<string, number>();
  for (const t of tenants ?? []) {
    conteo.set(t.empresa_id, (conteo.get(t.empresa_id) ?? 0) + 1);
  }

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    logoUrl: f.configuracion?.logoUrl ?? null,
    ciudad: f.ciudad,
    estadoGeografico: f.estado_geografico,
    estadoServicio: f.estado_servicio as EstadoServicio,
    plan: f.plan,
    totalResidenciales: conteo.get(f.id) ?? 0,
    creadaEn: f.created_at,
  }));
}

/** Para el selector del formulario "Crear residencial" — liviano, solo
 * lo que ese selector necesita mostrar. */
export async function listarEmpresasParaSelector(supabase: SupabaseClient): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
  if (error) throw error;
  return data ?? [];
}

export interface EmpresaInput {
  nombre: string;
  razonSocial?: string | null;
  rfc?: string | null;
  correoPrincipal?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  estadoGeografico?: string | null;
  pais?: string;
  plan?: string;
  observaciones?: string | null;
}

export async function crearEmpresa(supabase: SupabaseClient, input: EmpresaInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("empresas")
    .insert({
      nombre: input.nombre.trim(),
      razon_social: input.razonSocial?.trim() || null,
      rfc: input.rfc?.trim() || null,
      correo_principal: input.correoPrincipal?.trim() || null,
      telefono: input.telefono?.trim() || null,
      direccion: input.direccion?.trim() || null,
      ciudad: input.ciudad?.trim() || null,
      estado_geografico: input.estadoGeografico?.trim() || null,
      pais: input.pais || "MX",
      plan: input.plan || "piloto",
      estado_servicio: "piloto",
      observaciones: input.observaciones?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function actualizarEmpresa(supabase: SupabaseClient, id: string, input: EmpresaInput): Promise<void> {
  const { error } = await supabase
    .from("empresas")
    .update({
      nombre: input.nombre.trim(),
      razon_social: input.razonSocial?.trim() || null,
      rfc: input.rfc?.trim() || null,
      correo_principal: input.correoPrincipal?.trim() || null,
      telefono: input.telefono?.trim() || null,
      direccion: input.direccion?.trim() || null,
      ciudad: input.ciudad?.trim() || null,
      estado_geografico: input.estadoGeografico?.trim() || null,
      observaciones: input.observaciones?.trim() || null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function cambiarEstadoEmpresa(supabase: SupabaseClient, id: string, estado: EstadoServicio): Promise<void> {
  const { error } = await supabase.from("empresas").update({ estado_servicio: estado }).eq("id", id);
  if (error) throw error;
}

export interface EmpresaDetalle extends EmpresaListItem {
  razonSocial: string | null;
  rfc: string | null;
  correoPrincipal: string | null;
  telefono: string | null;
  direccion: string | null;
  pais: string;
  observaciones: string | null;
}

export async function obtenerEmpresaDetalle(supabase: SupabaseClient, id: string): Promise<EmpresaDetalle | null> {
  const { data, error } = await supabase
    .from("empresas")
    .select(
      "id, nombre, razon_social, rfc, correo_principal, telefono, direccion, ciudad, estado_geografico, pais, configuracion, estado_servicio, plan, observaciones, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { count } = await supabase.from("tenants").select("id", { count: "exact", head: true }).eq("empresa_id", id);

  return {
    id: data.id,
    nombre: data.nombre,
    razonSocial: data.razon_social,
    rfc: data.rfc,
    correoPrincipal: data.correo_principal,
    telefono: data.telefono,
    direccion: data.direccion,
    ciudad: data.ciudad,
    estadoGeografico: data.estado_geografico,
    pais: data.pais,
    logoUrl: (data.configuracion as { logoUrl?: string } | null)?.logoUrl ?? null,
    estadoServicio: data.estado_servicio as EstadoServicio,
    plan: data.plan,
    observaciones: data.observaciones,
    totalResidenciales: count ?? 0,
    creadaEn: data.created_at,
  };
}

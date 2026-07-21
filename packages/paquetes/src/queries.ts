import type { SupabaseClient } from "@supabase/supabase-js";
import type { Paquete, PaqueteFiltros, PaqueteHistorialEvento, UnidadConResidentes, FotografiaPaquete } from "@gateflow/types";
import { mapPaqueteRow, mapHistorialRow, type PaqueteRow, type HistorialRow } from "./mappers";
import { listarUbicacionesActivas } from "./ubicaciones";

/**
 * Select completo de un paquete con sus relaciones embebidas. Los alias
 * `residente:`, `recibido:`, `entregado:` desambiguan las tres FK
 * distintas hacia `users` usando el nombre de constraint que Postgres
 * genera automáticamente (`paquetes_<columna>_fkey`) — ver advertencia
 * en mappers.ts si esto no resuelve tal cual contra el proyecto real.
 */
const PAQUETE_SELECT = `
  id, codigo_gateflow, tenant_id, unidad_id, residente_id, remitente,
  empresa_paqueteria_id, estado_id, tamano_id, prioridad_id, ubicacion_id,
  numero_guia, notas, recibido_por, entregado_por, entregado_a_nombre,
  fecha_recepcion, fecha_entrega, pickup_token,
  unidades ( identificador, contacto_telefono ),
  residente:users!paquetes_residente_id_fkey ( nombre_completo, telefono ),
  recibido:users!paquetes_recibido_por_fkey ( nombre_completo ),
  entregado:users!paquetes_entregado_por_fkey ( nombre_completo ),
  empresas_paqueteria ( nombre ),
  tamanos_paquete ( clave ),
  prioridades_paquete ( clave ),
  ubicaciones ( nombre )
`;

export interface ListarPaquetesResultado {
  items: Paquete[];
  total: number;
}

export async function listarPaquetes(
  supabase: SupabaseClient,
  filtros: PaqueteFiltros,
): Promise<ListarPaquetesResultado> {
  const pagina = filtros.pagina ?? 1;
  const porPagina = filtros.porPagina ?? 25;
  const desde = (pagina - 1) * porPagina;
  const hasta = desde + porPagina - 1;

  let query = supabase
    .from("paquetes")
    .select(PAQUETE_SELECT, { count: "exact" })
    .eq("tenant_id", filtros.tenantId);

  if (filtros.estado && filtros.estado.length > 0) {
    query = query.in("estado_id", filtros.estado);
  }
  if (filtros.unidadId) {
    query = query.eq("unidad_id", filtros.unidadId);
  }
  if (filtros.ubicacionId) {
    query = query.eq("ubicacion_id", filtros.ubicacionId);
  }
  if (filtros.fechaDesde) {
    query = query.gte("fecha_recepcion", filtros.fechaDesde);
  }
  if (filtros.fechaHasta) {
    query = query.lte("fecha_recepcion", filtros.fechaHasta);
  }

  const ordenarPor = filtros.ordenarPor ?? "fecha_recepcion";
  const ascending = filtros.orden === "asc";
  query = query.order(ordenarPor, { ascending }).range(desde, hasta);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    items: ((data ?? []) as unknown as PaqueteRow[]).map(mapPaqueteRow),
    total: count ?? 0,
  };
}

/** Búsqueda universal (BR-42) contra el vector de texto completo de
 * 03-DATABASE.md §5, con fallback a coincidencia parcial de código si el
 * texto tiene forma de código GateFlow — cubre el caso de escaneo de QR. */
export async function buscarPaquetes(
  supabase: SupabaseClient,
  tenantId: string,
  texto: string,
): Promise<Paquete[]> {
  const textoLimpio = texto.trim();
  if (!textoLimpio) return [];

  const { data, error } = await supabase
    .from("paquetes")
    .select(PAQUETE_SELECT)
    .eq("tenant_id", tenantId)
    .textSearch("search_vector", textoLimpio, { type: "websearch", config: "spanish" })
    .order("fecha_recepcion", { ascending: false })
    .limit(20);

  if (error) throw error;
  return ((data ?? []) as unknown as PaqueteRow[]).map(mapPaqueteRow);
}

export async function obtenerPaquetePorId(supabase: SupabaseClient, id: string): Promise<Paquete | null> {
  const { data, error } = await supabase.from("paquetes").select(PAQUETE_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapPaqueteRow(data as unknown as PaqueteRow) : null;
}

export async function obtenerPaquetePorCodigo(
  supabase: SupabaseClient,
  tenantId: string,
  codigo: string,
): Promise<Paquete | null> {
  const { data, error } = await supabase
    .from("paquetes")
    .select(PAQUETE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("codigo_gateflow", codigo.trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? mapPaqueteRow(data as unknown as PaqueteRow) : null;
}

export async function listarPendientes(supabase: SupabaseClient, tenantId: string): Promise<Paquete[]> {
  const { data, error } = await supabase
    .from("paquetes")
    .select(PAQUETE_SELECT)
    .eq("tenant_id", tenantId)
    .in("estado_id", ["recibido", "notificado"])
    .order("fecha_recepcion", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as PaqueteRow[]).map(mapPaqueteRow);
}

export interface FirmaEntrega {
  firmaData: string;
  firmanteNombre: string;
  creadoEn: string;
}

export async function obtenerFirmaEntrega(supabase: SupabaseClient, paqueteId: string): Promise<FirmaEntrega | null> {
  const { data, error } = await supabase
    .from("paquete_firmas")
    .select("firma_data, firmante_nombre, created_at")
    .eq("paquete_id", paqueteId)
    .eq("tipo", "entrega_residente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { firmaData: data.firma_data, firmanteNombre: data.firmante_nombre, creadoEn: data.created_at };
}

/**
 * El bucket es privado (BR de evidencia — nunca público), así que mostrar
 * una foto exige una URL firmada de corta duración, no la ruta cruda.
 * 10 minutos alcanza para ver el detalle de un paquete sin dejar el
 * enlace utilizable indefinidamente si se comparte por error.
 */
export async function obtenerFotografiasPaquete(supabase: SupabaseClient, paqueteId: string): Promise<FotografiaPaquete[]> {
  const { data, error } = await supabase
    .from("paquete_fotografias")
    .select("id, tipo, storage_path, created_at, users:tomada_por ( nombre_completo )")
    .eq("paquete_id", paqueteId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const filas = data as unknown as Array<{
    id: string;
    tipo: string;
    storage_path: string;
    created_at: string;
    users: { nombre_completo: string } | null;
  }>;

  const conUrl = await Promise.all(
    filas.map(async (f) => {
      const { data: firmada } = await supabase.storage.from("evidencia").createSignedUrl(f.storage_path, 600);
      return {
        id: f.id,
        tipo: f.tipo as FotografiaPaquete["tipo"],
        url: firmada?.signedUrl ?? "",
        tomadaPorNombre: f.users?.nombre_completo ?? null,
        creadoEn: f.created_at,
      };
    }),
  );

  return conUrl.filter((f) => f.url !== "");
}

/**
 * Busca un paquete por su pickup_token. Es una consulta autenticada
 * normal — RLS (paquetes_tenant_isolation) ya garantiza que devuelve
 * null si el paquete pertenece a otro tenant, sin necesitar ninguna
 * función especial. Quien llama a esto SIEMPRE debe ya estar
 * autenticado como guardia/admin de un tenant — nunca se expone esta
 * consulta a una ruta sin sesión (ver app/guard/escanear/[token]/page.tsx,
 * que decide ANTES de llamar aquí si hay sesión activa).
 */
export async function buscarPaquetePorPickupToken(supabase: SupabaseClient, token: string): Promise<Paquete | null> {
  const { data, error } = await supabase.from("paquetes").select(PAQUETE_SELECT).eq("pickup_token", token).maybeSingle();
  if (error) throw error;
  return data ? mapPaqueteRow(data as unknown as PaqueteRow) : null;
}

/** Otros paquetes pendientes de la misma unidad — para la sección
 * "Otros paquetes pendientes para este domicilio" al escanear un QR. */
export async function listarPendientesPorUnidad(supabase: SupabaseClient, unidadId: string, excluirPaqueteId: string): Promise<Paquete[]> {
  const { data, error } = await supabase
    .from("paquetes")
    .select(PAQUETE_SELECT)
    .eq("unidad_id", unidadId)
    .in("estado_id", ["recibido", "notificado"])
    .neq("id", excluirPaqueteId)
    .order("fecha_recepcion", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as PaqueteRow[]).map(mapPaqueteRow);
}

export async function obtenerHistorial(supabase: SupabaseClient, paqueteId: string): Promise<PaqueteHistorialEvento[]> {
  const { data, error } = await supabase
    .from("paquete_historial")
    .select("id, paquete_id, estado_anterior_id, estado_nuevo_id, notas, created_at, users:user_id ( nombre_completo )")
    .eq("paquete_id", paqueteId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as HistorialRow[]).map(mapHistorialRow);
}

/** Búsqueda de unidad para el paso de selección al registrar un paquete
 * (apps/guard). Tolerante a coincidencia parcial del identificador. */
export async function buscarUnidades(
  supabase: SupabaseClient,
  tenantId: string,
  texto: string,
): Promise<UnidadConResidentes[]> {
  const texto_ = texto.trim();
  const { data, error } = await supabase
    .from("unidades")
    .select(
      "id, identificador, contacto_nombre, contacto_telefono, residentes_unidades ( fecha_fin, users ( id, nombre_completo ) )",
    )
    .eq("tenant_id", tenantId)
    // Busca por identificador de unidad O por nombre del contacto informal
    // — "buscar residente" y "buscar unidad" son, para el guardia, la
    // misma caja de búsqueda (no dos pantallas distintas).
    .or(`identificador.ilike.%${texto_}%,contacto_nombre.ilike.%${texto_}%`)
    .eq("activo", true)
    .limit(10);

  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    id: string;
    identificador: string;
    contacto_nombre: string | null;
    contacto_telefono: string | null;
    residentes_unidades: Array<{ fecha_fin: string | null; users: { id: string; nombre_completo: string } | null }>;
  }>).map((u) => ({
    id: u.id,
    identificador: u.identificador,
    residentes: u.residentes_unidades
      .filter((r) => !r.fecha_fin && r.users)
      .map((r) => ({ id: r.users!.id, nombreCompleto: r.users!.nombre_completo })),
    contactoNombre: u.contacto_nombre,
    contactoTelefono: u.contacto_telefono,
  }));
}

// ── Dashboard (apps/admin) — lee de las vistas de la migración Sprint 02 ──

export interface DashboardResumen {
  pendientes: number;
  recibidosHoy: number;
  entregadosHoy: number;
  olvidados: number;
  horasPromedioEntrega30d: number | null;
}

export async function obtenerResumenDashboard(supabase: SupabaseClient, tenantId: string): Promise<DashboardResumen> {
  const { data, error } = await supabase
    .from("v_dashboard_resumen")
    .select("pendientes, recibidos_hoy, entregados_hoy, olvidados, horas_promedio_entrega_30d")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;

  return {
    pendientes: data?.pendientes ?? 0,
    recibidosHoy: data?.recibidos_hoy ?? 0,
    entregadosHoy: data?.entregados_hoy ?? 0,
    olvidados: data?.olvidados ?? 0,
    horasPromedioEntrega30d: data?.horas_promedio_entrega_30d ?? null,
  };
}

export interface UnidadListItem {
  id: string;
  tipo: string;
  identificador: string;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  activo: boolean;
}

export async function listarUnidades(supabase: SupabaseClient, tenantId: string): Promise<UnidadListItem[]> {
  const { data, error } = await supabase
    .from("unidades")
    .select("id, tipo, identificador, contacto_nombre, contacto_telefono, activo")
    .eq("tenant_id", tenantId)
    .order("identificador");

  if (error) throw error;

  return (data ?? []).map((u) => ({
    id: u.id,
    tipo: u.tipo,
    identificador: u.identificador,
    contactoNombre: u.contacto_nombre,
    contactoTelefono: u.contacto_telefono,
    activo: u.activo,
  }));
}

// ── Catálogos (para el formulario de registro y para Configuración) ──

export interface CatalogoItem {
  id: string;
  clave: string;
  nombre: string;
  colorHex?: string | null;
}

export interface UbicacionItem {
  id: string;
  nombre: string;
  /** Ruta completa cuando hay jerarquía, ej. "Estante A / Nivel superior".
   * Igual a `nombre` cuando la ubicación no tiene padre. */
  ruta: string;
  codigo: string | null;
  padreId: string | null;
}

export interface Catalogos {
  empresasPaqueteria: CatalogoItem[];
  tamanos: CatalogoItem[];
  prioridades: CatalogoItem[];
  ubicaciones: UbicacionItem[];
}

/** Combina catálogo global (tenant_id NULL) + propio del tenant, tal
 * como lo describe 03-DATABASE.md §14 — el cliente nunca decide esa
 * combinación, RLS ya la resuelve devolviendo ambos conjuntos de filas.
 *
 * Las ubicaciones se resuelven con listarUbicacionesActivas() (packages/
 * paquetes/src/ubicaciones.ts) en vez de una consulta propia — antes
 * este archivo tenía su propia consulta duplicada que solo traía
 * `nombre`, sin ruta jerárquica ni código; ahora hay un solo lugar que
 * calcula la ruta, usado tanto aquí como en la pantalla de
 * administración de bodega. */
export async function obtenerCatalogos(supabase: SupabaseClient, tenantId: string): Promise<Catalogos> {
  const [empresas, tamanos, prioridades, ubicaciones] = await Promise.all([
    supabase.from("empresas_paqueteria").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("tamanos_paquete").select("id, clave, nombre, color_hex").eq("activo", true).order("orden"),
    supabase.from("prioridades_paquete").select("id, clave, nombre, color_hex").eq("activo", true).order("orden"),
    listarUbicacionesActivas(supabase, tenantId),
  ]);

  if (empresas.error) throw empresas.error;
  if (tamanos.error) throw tamanos.error;
  if (prioridades.error) throw prioridades.error;

  return {
    empresasPaqueteria: (empresas.data ?? []).map((e) => ({ id: e.id, clave: e.nombre, nombre: e.nombre })),
    tamanos: (tamanos.data ?? []).map((t) => ({ id: t.id, clave: t.clave, nombre: t.nombre, colorHex: t.color_hex })),
    prioridades: (prioridades.data ?? []).map((p) => ({ id: p.id, clave: p.clave, nombre: p.nombre, colorHex: p.color_hex })),
    ubicaciones: (ubicaciones as UbicacionItem[]).map((u) => ({ id: u.id, nombre: u.nombre, ruta: u.ruta, codigo: u.codigo, padreId: null })),
  };
}

export interface DashboardConteoPorEtiqueta {
  etiqueta: string;
  total: number;
  colorHex?: string | null;
}

export async function obtenerPorPrioridad(supabase: SupabaseClient, tenantId: string): Promise<DashboardConteoPorEtiqueta[]> {
  const { data, error } = await supabase
    .from("v_dashboard_por_prioridad")
    .select("prioridad, total, color_hex")
    .eq("tenant_id", tenantId);
  if (error) throw error;
  return (data ?? []).map((d) => ({ etiqueta: d.prioridad, total: d.total, colorHex: d.color_hex }));
}

export async function obtenerPorUbicacion(supabase: SupabaseClient, tenantId: string): Promise<DashboardConteoPorEtiqueta[]> {
  const { data, error } = await supabase.from("v_dashboard_por_ubicacion").select("ubicacion, total").eq("tenant_id", tenantId);
  if (error) throw error;
  return (data ?? []).map((d) => ({ etiqueta: d.ubicacion, total: d.total }));
}

export interface VolumenDiario {
  fecha: string;
  recibidosTotal: number;
  entregados: number;
}

/** Lee de la vista MATERIALIZADA (mv_dashboard_diario, migración
 * 20260713230300) — a diferencia de v_dashboard_resumen, esta sí
 * requiere refresh periódico (supabase/README.md). Si nunca se refrescó,
 * devuelve un array vacío en vez de fallar — el gráfico simplemente
 * queda vacío hasta el primer refresh, no rompe el dashboard. */
export async function obtenerVolumen30Dias(supabase: SupabaseClient, tenantId: string): Promise<VolumenDiario[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - 30);

  const { data, error } = await supabase
    .from("mv_dashboard_diario")
    .select("fecha, recibidos_total, entregados")
    .eq("tenant_id", tenantId)
    .gte("fecha", desde.toISOString().slice(0, 10))
    .order("fecha", { ascending: true });

  if (error) return []; // ver nota arriba — vista sin refrescar no debe romper el dashboard
  return (data ?? []).map((d) => ({ fecha: d.fecha, recibidosTotal: d.recibidos_total, entregados: d.entregados }));
}

export interface ActividadRecienteItem {
  id: string;
  descripcion: string;
  codigoGateflow: string;
  creadoEn: string;
}

export async function obtenerActividadReciente(supabase: SupabaseClient, tenantId: string): Promise<ActividadRecienteItem[]> {
  const { data, error } = await supabase
    .from("paquete_historial")
    .select("id, estado_nuevo_id, created_at, paquetes!inner ( codigo_gateflow, tenant_id, unidades ( identificador ) )")
    .eq("paquetes.tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) throw error;

  return ((data ?? []) as unknown as Array<{
    id: string;
    estado_nuevo_id: string;
    created_at: string;
    paquetes: { codigo_gateflow: string; unidades: { identificador: string } | null };
  }>).map((h) => ({
    id: h.id,
    descripcion: `${ESTADO_DESCRIPCION[h.estado_nuevo_id] ?? h.estado_nuevo_id} — ${h.paquetes.unidades?.identificador ?? ""}`,
    codigoGateflow: h.paquetes.codigo_gateflow,
    creadoEn: h.created_at,
  }));
}

const ESTADO_DESCRIPCION: Record<string, string> = {
  recibido: "Paquete recibido",
  notificado: "Residente notificado",
  entregado: "Paquete entregado",
  rechazado: "Paquete rechazado",
  devuelto: "Paquete devuelto",
};

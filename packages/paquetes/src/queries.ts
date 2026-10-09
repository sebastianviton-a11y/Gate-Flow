import type { SupabaseClient } from "@supabase/supabase-js";
import type { Paquete, PaqueteFiltros, PaqueteHistorialEvento, UnidadConResidentes, FotografiaPaquete } from "@gateflow/types";
import { claveDiaLocal, inicioDiaLocal, sumarDias } from "@gateflow/types";
import { mapPaqueteRow, mapPaqueteResumenRow, mapHistorialRow, type PaqueteRow, type PaqueteResumenRow, type HistorialRow } from "./mappers";
import { listarUbicacionesActivas } from "./ubicaciones";

/**
 * Select completo de un paquete con sus relaciones embebidas. Los alias
 * `residente:`, `recibido:`, `entregado:` desambiguan las tres FK
 * distintas hacia `users` usando el nombre de constraint que Postgres
 * genera automáticamente (`paquetes_<columna>_fkey`) — ver advertencia
 * en mappers.ts si esto no resuelve tal cual contra el proyecto real.
 *
 * `unidades` y `ubicaciones` también llevan su FK explícita: la
 * integridad multitenant (20261007100000) añadió FKs compuestas
 * (x_id, tenant_id) junto a las simples y, con dos caminos, PostgREST
 * responde 300 / PGRST201 a un embed sin FK. Se usan las simples, que
 * existen antes y después de esa migración (contrato_selects.py lo
 * comprueba).
 */
const PAQUETE_SELECT = `
  id, codigo_gateflow, tenant_id, unidad_id, residente_id, remitente,
  empresa_paqueteria_id, estado_id, tamano_id, prioridad_id, ubicacion_id,
  numero_guia, notas, recibido_por, entregado_por, entregado_a_nombre,
  fecha_recepcion, fecha_entrega, pickup_token, grupo_entrega_id,
  destinatario_nombre, destinatario_telefono,
  unidades!paquetes_unidad_id_fkey ( identificador, contacto_telefono ),
  residente:users!paquetes_residente_id_fkey ( nombre_completo, telefono ),
  recibido:users!paquetes_recibido_por_fkey ( nombre_completo ),
  entregado:users!paquetes_entregado_por_fkey ( nombre_completo ),
  empresas_paqueteria ( nombre ),
  tamanos_paquete ( clave ),
  prioridades_paquete ( clave ),
  ubicaciones!paquetes_ubicacion_id_fkey ( nombre )
`;

/**
 * Versión liviana de PAQUETE_SELECT — solo para las pantallas de LISTA
 * de guard (buscarPaquetesResumen, listarPendientesResumen). Sin los
 * 4 JOIN que esas pantallas no usan (empresa de paquetería, tamaño,
 * prioridad, guardias que recibieron/entregaron) ni las columnas que
 * tampoco muestran (remitente, guía, notas, fecha_entrega, etc.). El
 * detalle completo (obtenerPaquetePorId) y el resto de las consultas
 * existentes siguen usando PAQUETE_SELECT sin ningún cambio.
 */
const PAQUETE_RESUMEN_SELECT = `
  id, codigo_gateflow, tenant_id, unidad_id, residente_id, estado_id, ubicacion_id, fecha_recepcion,
  unidades!paquetes_unidad_id_fkey ( identificador ),
  residente:users!paquetes_residente_id_fkey ( nombre_completo ),
  ubicaciones!paquetes_ubicacion_id_fkey ( nombre )
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

/**
 * Misma búsqueda que buscarPaquetes (mismo índice de texto completo,
 * mismo orden, mismo límite de 20) pero con el SELECT liviano — para
 * "Buscar paquete" en guard, que solo necesita mostrar unidad,
 * residente, código, estado, ubicación y fecha de recepción en cada
 * fila de resultado.
 */
export async function buscarPaquetesResumen(
  supabase: SupabaseClient,
  tenantId: string,
  texto: string,
): Promise<Paquete[]> {
  const textoLimpio = texto.trim();
  if (!textoLimpio) return [];

  const { data, error } = await supabase
    .from("paquetes")
    .select(PAQUETE_RESUMEN_SELECT)
    .eq("tenant_id", tenantId)
    .textSearch("search_vector", textoLimpio, { type: "websearch", config: "spanish" })
    .order("fecha_recepcion", { ascending: false })
    .limit(20);

  if (error) throw error;
  return ((data ?? []) as unknown as PaqueteResumenRow[]).map(mapPaqueteResumenRow);
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

/** Misma consulta que listarPendientes, con el SELECT liviano — para
 * la pantalla "Paquetes pendientes" de guard. */
export async function listarPendientesResumen(supabase: SupabaseClient, tenantId: string): Promise<Paquete[]> {
  const { data, error } = await supabase
    .from("paquetes")
    .select(PAQUETE_RESUMEN_SELECT)
    .eq("tenant_id", tenantId)
    .in("estado_id", ["recibido", "notificado"])
    .order("fecha_recepcion", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as PaqueteResumenRow[]).map(mapPaqueteResumenRow);
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
 * Portada por paquete para vistas de LISTA (Buscar paquete, Resultado de
 * búsqueda, Paquetes pendientes en apps/guard) — un solo storage_path por
 * paquete (el más reciente de tipo "recepcion"), sin duplicar ninguna
 * fila ni volver a subir nada: es la misma tabla y el mismo bucket
 * privado que ya usa obtenerFotografiasPaquete/admin, solo que aquí se
 * firma en LOTE (createSignedUrls, no createSignedUrl uno por uno) para
 * no hacer N llamadas de Storage al renderizar una lista de N paquetes.
 */
export async function obtenerFotoPrincipalPorPaquetes(
  supabase: SupabaseClient,
  paqueteIds: string[],
): Promise<Map<string, string>> {
  if (paqueteIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("paquete_fotografias")
    .select("paquete_id, storage_path, created_at")
    .in("paquete_id", paqueteIds)
    .eq("tipo", "recepcion")
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return new Map();

  // Ya viene ordenado por fecha descendente — al no sobreescribir una
  // entrada ya presente, nos quedamos con la más reciente por paquete.
  const rutaPorPaquete = new Map<string, string>();
  for (const fila of data as Array<{ paquete_id: string; storage_path: string }>) {
    if (!rutaPorPaquete.has(fila.paquete_id)) rutaPorPaquete.set(fila.paquete_id, fila.storage_path);
  }

  const rutas = [...rutaPorPaquete.values()];
  const { data: firmadas, error: errorFirma } = await supabase.storage.from("evidencia").createSignedUrls(rutas, 600);
  if (errorFirma) throw errorFirma;

  const urlPorRuta = new Map((firmadas ?? []).filter((f) => !f.error).map((f) => [f.path ?? "", f.signedUrl]));

  const resultado = new Map<string, string>();
  for (const [paqueteId, ruta] of rutaPorPaquete) {
    const url = urlPorRuta.get(ruta);
    if (url) resultado.set(paqueteId, url);
  }
  return resultado;
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
 * (apps/guard). Tolerante a coincidencia parcial de la dirección. Trae
 * también a las personas adicionales de cada vivienda (sin cuenta,
 * aprobadas desde el enlace de residentes): son destinatarios posibles.
 * Las solicitudes pendientes nunca aparecen (la guardia no las lee). */
const SELECT_UNIDAD_CON_RESIDENTES = `id, identificador, contacto_nombre, contacto_telefono,
  residentes_unidades!residentes_unidades_unidad_id_fkey ( id, fecha_fin, origen, nombre, apellido, telefono, users ( id, nombre_completo ) )`;

type FilaUnidadConResidentes = {
  id: string;
  identificador: string;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  residentes_unidades: Array<{
    id?: string;
    fecha_fin: string | null;
    origen?: string | null;
    nombre?: string | null;
    apellido?: string | null;
    telefono?: string | null;
    users: { id: string; nombre_completo: string } | null;
  }>;
};

function mapUnidadConResidentes(u: FilaUnidadConResidentes): UnidadConResidentes {
  const vigentes = u.residentes_unidades.filter((r) => !r.fecha_fin);
  return {
    id: u.id,
    identificador: u.identificador,
    residentes: vigentes.filter((r) => r.users).map((r) => ({ id: r.users!.id, nombreCompleto: r.users!.nombre_completo })),
    adicionales: vigentes
      .filter((r) => r.origen === "enlace" && r.id && r.telefono)
      .map((r) => ({ id: r.id!, nombre: `${r.nombre ?? ""} ${r.apellido ?? ""}`.trim(), telefono: r.telefono! })),
    contactoNombre: u.contacto_nombre,
    contactoTelefono: u.contacto_telefono,
  };
}

export async function buscarUnidades(
  supabase: SupabaseClient,
  tenantId: string,
  texto: string,
): Promise<UnidadConResidentes[]> {
  const texto_ = texto.trim();
  const { data, error } = await supabase
    .from("unidades")
    .select(SELECT_UNIDAD_CON_RESIDENTES)
    .eq("tenant_id", tenantId)
    // Busca por dirección O por nombre del contacto informal — "buscar
    // residente" y "buscar unidad" son, para el guardia, la misma caja
    // de búsqueda (no dos pantallas distintas).
    .or(`identificador.ilike.%${texto_}%,contacto_nombre.ilike.%${texto_}%`)
    .eq("activo", true)
    .limit(10);

  if (error) throw error;
  const filas = (data ?? []) as unknown as FilaUnidadConResidentes[];

  // También por el nombre de un residente adicional de la vivienda.
  if (texto_ && filas.length < 10) {
    const { data: porNombre, error: errorNombre } = await supabase
      .from("residentes_unidades")
      .select("unidad_id")
      .eq("tenant_id", tenantId)
      .eq("origen", "enlace")
      .is("fecha_fin", null)
      .or(`nombre.ilike.%${texto_}%,apellido.ilike.%${texto_}%`)
      .limit(10);
    if (errorNombre) throw errorNombre;
    const faltan = [...new Set((porNombre ?? []).map((r) => r.unidad_id as string))].filter((id) => !filas.some((f) => f.id === id));
    if (faltan.length > 0) {
      const { data: extra, error: errorExtra } = await supabase
        .from("unidades")
        .select(SELECT_UNIDAD_CON_RESIDENTES)
        .eq("tenant_id", tenantId)
        .eq("activo", true)
        .in("id", faltan.slice(0, 10 - filas.length));
      if (errorExtra) throw errorExtra;
      filas.push(...((extra ?? []) as unknown as FilaUnidadConResidentes[]));
    }
  }

  return filas.map(mapUnidadConResidentes);
}

// ── Dashboard (apps/admin) — lee de las vistas de la migración Sprint 02 ──

export interface DashboardResumen {
  pendientes: number;
  recibidosHoy: number;
  entregadosHoy: number;
  olvidados: number;
  horasPromedioEntrega30d: number | null;
}

/** Límites [desde, hasta) del día local de `ahora` en la zona del residencial. */
export function limitesDiaLocal(ahora: Date, zonaHoraria: string | null | undefined): { desde: string; hasta: string } {
  const hoy = claveDiaLocal(ahora, zonaHoraria);
  return {
    desde: inicioDiaLocal(hoy, zonaHoraria).toISOString(),
    hasta: inicioDiaLocal(sumarDias(hoy, 1), zonaHoraria).toISOString(),
  };
}

/**
 * "Hoy" es el día local del residencial (`tenants.timezone`), no el día
 * UTC: v_dashboard_resumen compara con CURRENT_DATE de la base (UTC), así
 * que en Argentina un paquete de las 21:00 contaba para mañana. De la
 * vista se toman solo los datos que no dependen del día (pendientes,
 * olvidados, promedio de 30 días); recibidos y entregados de hoy se
 * cuentan aquí con los mismos criterios que la vista (recibido: estado
 * `recibido` y recepción hoy; entregado: estado `entregado` y entrega
 * hoy) y los límites del día local. La base no cambia.
 */
export async function obtenerResumenDashboard(
  supabase: SupabaseClient,
  tenantId: string,
  zonaHoraria: string | null | undefined,
  ahora: Date = new Date(),
): Promise<DashboardResumen> {
  const { desde, hasta } = limitesDiaLocal(ahora, zonaHoraria);
  const [vista, recibidos, entregados] = await Promise.all([
    supabase
      .from("v_dashboard_resumen")
      .select("pendientes, olvidados, horas_promedio_entrega_30d")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("paquetes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado_id", "recibido")
      .gte("fecha_recepcion", desde)
      .lt("fecha_recepcion", hasta),
    supabase
      .from("paquetes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("estado_id", "entregado")
      .gte("fecha_entrega", desde)
      .lt("fecha_entrega", hasta),
  ]);

  if (vista.error) throw vista.error;
  if (recibidos.error) throw recibidos.error;
  if (entregados.error) throw entregados.error;

  return {
    pendientes: vista.data?.pendientes ?? 0,
    recibidosHoy: recibidos.count ?? 0,
    entregadosHoy: entregados.count ?? 0,
    olvidados: vista.data?.olvidados ?? 0,
    horasPromedioEntrega30d: vista.data?.horas_promedio_entrega_30d ?? null,
  };
}

export interface UnidadListItem {
  id: string;
  /** Casa o departamento; null en las viviendas creadas sin tipo. */
  tipo: string | null;
  identificador: string;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  contactoTelefonoSecundario: string | null;
  contactoEmail: string | null;
  notas: string | null;
  activo: boolean;
}

export async function listarUnidades(supabase: SupabaseClient, tenantId: string): Promise<UnidadListItem[]> {
  const { data, error } = await supabase
    .from("unidades")
    .select("id, tipo, identificador, contacto_nombre, contacto_telefono, contacto_telefono_secundario, contacto_email, notas, activo")
    .eq("tenant_id", tenantId)
    .order("identificador");

  if (error) throw error;

  return (data ?? []).map((u) => ({
    id: u.id,
    tipo: u.tipo,
    identificador: u.identificador,
    contactoNombre: u.contacto_nombre,
    contactoTelefono: u.contacto_telefono,
    contactoTelefonoSecundario: u.contacto_telefono_secundario,
    contactoEmail: u.contacto_email,
    notas: u.notas,
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

export interface RecepcionParaVolumen {
  fecha_recepcion: string;
  estado_id: string;
}

/**
 * Agrupa por el día local del residencial. Mismos criterios que la vista
 * mv_dashboard_diario (recibidos = todos los recibidos ese día;
 * entregados = los de ese día que hoy están entregados), pero con el día
 * de `zonaHoraria`, no el de UTC. Solo aparecen días con paquetes.
 */
export function agruparVolumenPorDia(filas: RecepcionParaVolumen[], zonaHoraria: string | null | undefined): VolumenDiario[] {
  const porDia = new Map<string, VolumenDiario>();
  for (const f of filas) {
    const fecha = claveDiaLocal(f.fecha_recepcion, zonaHoraria);
    const dia = porDia.get(fecha) ?? { fecha, recibidosTotal: 0, entregados: 0 };
    dia.recibidosTotal += 1;
    if (f.estado_id === "entregado") dia.entregados += 1;
    porDia.set(fecha, dia);
  }
  return [...porDia.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

const VOLUMEN_POR_PAGINA = 1000;
const VOLUMEN_MAX_PAGINAS = 50;

/**
 * Últimos 30 días (más hoy) por día local del residencial. Antes leía la
 * vista materializada mv_dashboard_diario, que agrupa por día UTC y no
 * conoce la zona del residencial; ahora se agrupa aquí, sobre las
 * recepciones del periodo (con RLS, en páginas). La vista no se toca.
 * Si la consulta falla devuelve [] en vez de romper el dashboard: el
 * gráfico queda vacío.
 */
export async function obtenerVolumen30Dias(
  supabase: SupabaseClient,
  tenantId: string,
  zonaHoraria: string | null | undefined,
  ahora: Date = new Date(),
): Promise<VolumenDiario[]> {
  const desde = inicioDiaLocal(sumarDias(claveDiaLocal(ahora, zonaHoraria), -30), zonaHoraria).toISOString();
  const filas: RecepcionParaVolumen[] = [];
  for (let pagina = 0; pagina < VOLUMEN_MAX_PAGINAS; pagina++) {
    const inicio = pagina * VOLUMEN_POR_PAGINA;
    const { data, error } = await supabase
      .from("paquetes")
      .select("fecha_recepcion, estado_id")
      .eq("tenant_id", tenantId)
      .gte("fecha_recepcion", desde)
      .order("fecha_recepcion", { ascending: true })
      .range(inicio, inicio + VOLUMEN_POR_PAGINA - 1);
    if (error) return [];
    const lote = (data ?? []) as RecepcionParaVolumen[];
    filas.push(...lote);
    if (lote.length < VOLUMEN_POR_PAGINA) break;
  }
  return agruparVolumenPorDia(filas, zonaHoraria);
}

export interface ActividadRecienteItem {
  id: string;
  descripcion: string;
  codigoGateflow: string;
  creadoEn: string;
}

/** Widget del dashboard: si la consulta falla, el dashboard se muestra
 * sin actividad reciente en vez de caer entero (mismo criterio que
 * obtenerVolumen30Dias). La tolerancia es SOLO de este widget: el resto
 * de consultas sigue lanzando el error. */
export async function obtenerActividadReciente(supabase: SupabaseClient, tenantId: string): Promise<ActividadRecienteItem[]> {
  const { data, error } = await supabase
    .from("paquete_historial")
    .select(
      "id, estado_nuevo_id, created_at, paquetes!paquete_historial_paquete_id_fkey!inner ( codigo_gateflow, tenant_id, unidades!paquetes_unidad_id_fkey ( identificador ) )",
    )
    .eq("paquetes.tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    console.error("[GateFlow] Actividad reciente no disponible:", error.code ?? "", error.message);
    return [];
  }

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

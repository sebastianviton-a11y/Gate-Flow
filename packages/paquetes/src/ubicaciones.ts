import type { SupabaseClient } from "@supabase/supabase-js";

export interface UbicacionAdmin {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  tipoNodo: string;
  padreId: string | null;
  padreNombre: string | null;
  /** Ruta completa, ej. "Bodega principal / Estante A / Nivel superior". */
  ruta: string;
  orden: number;
  activo: boolean;
  /** Paquetes recibidos/notificados que hoy están en esta ubicación —
   * lo que importa para advertir antes de desactivar. */
  totalPaquetesActivos: number;
  /** Cualquier paquete que alguna vez haya usado esta ubicación, sin
   * importar su estado actual — lo que importa para decidir si se
   * puede borrar físicamente o solo desactivar. */
  totalPaquetesHistoricos: number;
  creadoEn: string;
}

export interface UbicacionInput {
  nombre: string;
  codigo?: string | null;
  descripcion?: string | null;
  tipoNodo: string;
  padreId?: string | null;
  orden?: number;
}

interface FilaUbicacionCruda {
  id: string;
  nombre: string;
  padre_id: string | null;
}

/**
 * Calcula la ruta completa de cada ubicación caminando su cadena de
 * padres en memoria — no una CTE recursiva en SQL. El número de
 * ubicaciones de una bodega real es pequeño (decenas, no miles), así
 * que esto es simple de razonar y de probar sin poder ejecutar SQL
 * directamente en este entorno. `visitados` evita un bucle infinito si
 * alguna vez existiera un ciclo (no debería, por las validaciones de
 * escritura, pero defensivo por si un ciclo llegara a existir de
 * cualquier otra forma).
 */
function construirRutas(filas: FilaUbicacionCruda[]): Map<string, string> {
  const porId = new Map(filas.map((f) => [f.id, f]));
  const rutas = new Map<string, string>();

  function rutaDe(id: string): string {
    if (rutas.has(id)) return rutas.get(id)!;
    const nombres: string[] = [];
    let actual = porId.get(id);
    const visitados = new Set<string>();
    while (actual && !visitados.has(actual.id)) {
      visitados.add(actual.id);
      nombres.unshift(actual.nombre);
      actual = actual.padre_id ? porId.get(actual.padre_id) : undefined;
    }
    const ruta = nombres.join(" / ");
    rutas.set(id, ruta);
    return ruta;
  }

  for (const f of filas) rutaDe(f.id);
  return rutas;
}

/** Lista completa para Configuración → Bodega — incluye inactivas y los
 * conteos de uso que determinan si se puede borrar o solo desactivar. */
export async function listarUbicacionesAdmin(supabase: SupabaseClient, tenantId: string): Promise<UbicacionAdmin[]> {
  const { data: filas, error } = await supabase
    .from("ubicaciones")
    .select("id, nombre, codigo, descripcion, tipo_nodo, padre_id, orden, activo, created_at")
    .eq("tenant_id", tenantId)
    .order("orden");
  if (error) throw error;

  const { data: conteos, error: errorConteos } = await supabase
    .from("paquetes")
    .select("ubicacion_id, estado_id")
    .eq("tenant_id", tenantId)
    .not("ubicacion_id", "is", null);
  if (errorConteos) throw errorConteos;

  const activosPorUbicacion = new Map<string, number>();
  const historicosPorUbicacion = new Map<string, number>();
  for (const c of (conteos ?? []) as { ubicacion_id: string; estado_id: string }[]) {
    historicosPorUbicacion.set(c.ubicacion_id, (historicosPorUbicacion.get(c.ubicacion_id) ?? 0) + 1);
    if (c.estado_id === "recibido" || c.estado_id === "notificado") {
      activosPorUbicacion.set(c.ubicacion_id, (activosPorUbicacion.get(c.ubicacion_id) ?? 0) + 1);
    }
  }

  const todas = (filas ?? []) as Array<{
    id: string;
    nombre: string;
    codigo: string | null;
    descripcion: string | null;
    tipo_nodo: string;
    padre_id: string | null;
    orden: number;
    activo: boolean;
    created_at: string;
  }>;
  const rutas = construirRutas(todas.map((f) => ({ id: f.id, nombre: f.nombre, padre_id: f.padre_id })));
  const porId = new Map(todas.map((f) => [f.id, f]));

  return todas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    codigo: f.codigo,
    descripcion: f.descripcion,
    tipoNodo: f.tipo_nodo,
    padreId: f.padre_id,
    padreNombre: f.padre_id ? porId.get(f.padre_id)?.nombre ?? null : null,
    ruta: rutas.get(f.id) ?? f.nombre,
    orden: f.orden,
    activo: f.activo,
    totalPaquetesActivos: activosPorUbicacion.get(f.id) ?? 0,
    totalPaquetesHistoricos: historicosPorUbicacion.get(f.id) ?? 0,
    creadoEn: f.created_at,
  }));
}

/** Para selectores (registro/edición de paquete) — solo activas, con
 * ruta completa, en el orden que definió el administrador. */
export async function listarUbicacionesActivas(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ id: string; nombre: string; codigo: string | null; ruta: string }[]> {
  const { data, error } = await supabase
    .from("ubicaciones")
    .select("id, nombre, codigo, padre_id")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .order("orden");
  if (error) throw error;

  const filas = (data ?? []) as Array<{ id: string; nombre: string; codigo: string | null; padre_id: string | null }>;
  const rutas = construirRutas(filas.map((f) => ({ id: f.id, nombre: f.nombre, padre_id: f.padre_id })));
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, codigo: f.codigo, ruta: rutas.get(f.id) ?? f.nombre }));
}

/**
 * Detecta si asignar `nuevoPadreId` como padre de `ubicacionId` crearía
 * un ciclo (incluye el caso trivial de ser su propio padre). Camina la
 * cadena de ancestros del padre propuesto — si en algún punto llega a
 * `ubicacionId`, sería un ciclo. Se valida en la aplicación, no con un
 * trigger de base de datos — es una jerarquía pequeña, mantenida solo
 * desde esta pantalla de administración, no una API pública abierta a
 * cualquier escritor externo.
 */
export function detectarCiclo(
  todasLasUbicaciones: { id: string; padreId: string | null }[],
  ubicacionId: string,
  nuevoPadreId: string | null,
): boolean {
  if (!nuevoPadreId) return false;
  if (nuevoPadreId === ubicacionId) return true;

  const porId = new Map(todasLasUbicaciones.map((u) => [u.id, u]));
  let actual = porId.get(nuevoPadreId);
  const visitados = new Set<string>();
  while (actual) {
    if (actual.id === ubicacionId) return true;
    if (visitados.has(actual.id)) return false; // ciclo preexistente ajeno — no lo agrava esta operación
    visitados.add(actual.id);
    actual = actual.padreId ? porId.get(actual.padreId) : undefined;
  }
  return false;
}

export async function crearUbicacion(supabase: SupabaseClient, tenantId: string, creadoPor: string, input: UbicacionInput): Promise<void> {
  const { error } = await supabase.from("ubicaciones").insert({
    tenant_id: tenantId,
    nombre: input.nombre.trim(),
    codigo: input.codigo?.trim() || null,
    descripcion: input.descripcion?.trim() || null,
    tipo_nodo: input.tipoNodo,
    padre_id: input.padreId || null,
    orden: input.orden ?? 0,
    created_by: creadoPor,
  });
  if (error) throw error;
}

export async function actualizarUbicacion(supabase: SupabaseClient, id: string, input: UbicacionInput): Promise<void> {
  const { error } = await supabase
    .from("ubicaciones")
    .update({
      nombre: input.nombre.trim(),
      codigo: input.codigo?.trim() || null,
      descripcion: input.descripcion?.trim() || null,
      tipo_nodo: input.tipoNodo,
      padre_id: input.padreId || null,
      orden: input.orden ?? 0,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function cambiarActivoUbicacion(supabase: SupabaseClient, id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from("ubicaciones").update({ activo }).eq("id", id);
  if (error) throw error;
}

/**
 * Elimina físicamente solo si nunca se usó. Si algún paquete la
 * referenció alguna vez, la propia foreign key de `paquetes.ubicacion_id`
 * (sin ON DELETE) rechaza el DELETE con un error 23503 — se traduce a
 * un mensaje claro en vez de dejar pasar el error crudo de Postgres.
 */
export async function eliminarUbicacion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("ubicaciones").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("Esta ubicación ya se usó en al menos un paquete — no se puede eliminar, solo desactivar.");
    }
    throw error;
  }
}

export interface UbicacionHistorialEvento {
  id: string;
  ubicacionAnteriorRuta: string | null;
  ubicacionNuevaRuta: string | null;
  usuarioNombre: string;
  creadoEn: string;
}

export async function obtenerHistorialUbicacion(supabase: SupabaseClient, tenantId: string, paqueteId: string): Promise<UbicacionHistorialEvento[]> {
  const { data, error } = await supabase
    .from("paquete_ubicacion_historial")
    .select(
      "id, created_at, ubicacion_anterior_id, ubicacion_nueva_id, users:user_id ( nombre_completo ), " +
        "anterior:ubicaciones!paquete_ubicacion_historial_ubicacion_anterior_id_fkey ( nombre, padre_id ), " +
        "nueva:ubicaciones!paquete_ubicacion_historial_ubicacion_nueva_id_fkey ( nombre, padre_id )",
    )
    .eq("paquete_id", paqueteId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Las rutas completas de anterior/nueva no valen el costo de otra
  // consulta recursiva aquí — con el nombre directo alcanza para un
  // evento de historial (a diferencia del selector, donde sí importa
  // desambiguar entre ubicaciones con el mismo nombre bajo padres
  // distintos). Suficiente para "de X a Y", no crítico mostrar la ruta
  // completa en cada entrada de un timeline.
  return ((data ?? []) as unknown as Array<{
    id: string;
    created_at: string;
    users: { nombre_completo: string } | null;
    anterior: { nombre: string } | null;
    nueva: { nombre: string } | null;
  }>).map((f) => ({
    id: f.id,
    ubicacionAnteriorRuta: f.anterior?.nombre ?? null,
    ubicacionNuevaRuta: f.nueva?.nombre ?? null,
    usuarioNombre: f.users?.nombre_completo ?? "—",
    creadoEn: f.created_at,
  }));
}

/** Cambia la ubicación de un paquete ya registrado (mientras no esté
 * entregado — la pantalla que llama a esto es responsable de no
 * mostrar esta acción una vez entregado, RLS no distingue por estado
 * aquí). El trigger fn_registrar_historial_ubicacion() registra el
 * cambio automáticamente — esta función no inserta el historial ella
 * misma, evitando la duplicación de esa responsabilidad. */
export async function cambiarUbicacionPaquete(supabase: SupabaseClient, paqueteId: string, nuevaUbicacionId: string): Promise<void> {
  const { error } = await supabase.from("paquetes").update({ ubicacion_id: nuevaUbicacionId }).eq("id", paqueteId);
  if (error) throw error;
}

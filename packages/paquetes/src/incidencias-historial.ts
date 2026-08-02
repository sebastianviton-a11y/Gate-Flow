import type { SupabaseClient } from "@supabase/supabase-js";

export interface FotoIncidencia {
  id: string;
  url: string;
  tomadaPorNombre: string | null;
  createdAt: string;
}

export interface IncidenciaConFotos {
  id: string;
  tipo: string;
  descripcion: string;
  estado: string;
  nivelDanio: string | null;
  reportadaPorNombre: string | null;
  resueltaPorNombre: string | null;
  comentarioResolucion: string | null;
  createdAt: string;
  resueltaEn: string | null;
  fotos: FotoIncidencia[];
}

export async function contarIncidenciasPorPaquetes(supabase: SupabaseClient, paqueteIds: string[]): Promise<Map<string, number>> {
  if (paqueteIds.length === 0) return new Map();
  const { data, error } = await supabase.from("incidencias").select("paquete_id").in("paquete_id", paqueteIds);
  if (error) throw error;
  const mapa = new Map<string, number>();
  for (const fila of (data ?? []) as { paquete_id: string }[]) {
    mapa.set(fila.paquete_id, (mapa.get(fila.paquete_id) ?? 0) + 1);
  }
  return mapa;
}

export async function listarIncidenciasDePaquete(supabase: SupabaseClient, paqueteId: string): Promise<IncidenciaConFotos[]> {
  const { data: incidenciasData, error: errorIncidencias } = await supabase
    .from("incidencias")
    .select("id, tipo, descripcion, estado, nivel_danio, comentario_resolucion, created_at, resuelta_en, reportada_por, resuelta_por")
    .eq("paquete_id", paqueteId)
    .order("created_at", { ascending: false });

  if (errorIncidencias) throw errorIncidencias;

  const filas = (incidenciasData ?? []) as Array<{
    id: string;
    tipo: string;
    descripcion: string;
    estado: string;
    nivel_danio: string | null;
    comentario_resolucion: string | null;
    created_at: string;
    resuelta_en: string | null;
    reportada_por: string | null;
    resuelta_por: string | null;
  }>;

  if (filas.length === 0) return [];

  const idsUsuarios = [...new Set(filas.flatMap((f) => [f.reportada_por, f.resuelta_por]).filter((v): v is string => !!v))];
  const { data: usuariosData } =
    idsUsuarios.length > 0
      ? await supabase.from("users").select("id, nombre_completo").in("id", idsUsuarios)
      : { data: [] as { id: string; nombre_completo: string }[] };
  const mapaUsuarios = new Map((usuariosData ?? []).map((u) => [u.id, u.nombre_completo]));

  const idsIncidencias = filas.map((f) => f.id);
  const { data: fotosData, error: errorFotos } = await supabase
    .from("incidencia_fotografias")
    .select("id, incidencia_id, storage_path, tomada_por, created_at")
    .in("incidencia_id", idsIncidencias);

  if (errorFotos) throw errorFotos;

  const fotosPorIncidencia = new Map<string, FotoIncidencia[]>();
  for (const foto of (fotosData ?? []) as Array<{
    id: string;
    incidencia_id: string;
    storage_path: string;
    tomada_por: string | null;
    created_at: string;
  }>) {
    const { data: firmada, error: errorFirma } = await supabase.storage.from("evidencia").createSignedUrl(foto.storage_path, 3600);
    if (errorFirma || !firmada) {
      console.error("[GateFlow] No se pudo firmar la URL de una fotografía de incidencia:", errorFirma?.message);
      continue;
    }
    const lista = fotosPorIncidencia.get(foto.incidencia_id) ?? [];
    lista.push({
      id: foto.id,
      url: firmada.signedUrl,
      tomadaPorNombre: foto.tomada_por ? mapaUsuarios.get(foto.tomada_por) ?? null : null,
      createdAt: foto.created_at,
    });
    fotosPorIncidencia.set(foto.incidencia_id, lista);
  }

  return filas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    descripcion: f.descripcion,
    estado: f.estado,
    nivelDanio: f.nivel_danio,
    reportadaPorNombre: f.reportada_por ? mapaUsuarios.get(f.reportada_por) ?? null : null,
    resueltaPorNombre: f.resuelta_por ? mapaUsuarios.get(f.resuelta_por) ?? null : null,
    comentarioResolucion: f.comentario_resolucion,
    createdAt: f.created_at,
    resueltaEn: f.resuelta_en,
    fotos: (fotosPorIncidencia.get(f.id) ?? []).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  }));
}

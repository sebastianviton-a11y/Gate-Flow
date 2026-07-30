export {
  reportarIncidencia,
  registrarPaqueteConIncidencia,
  subirFotografiaIncidencia,
  listarIncidencias,
  obtenerIncidenciasPaquete,
  resolverIncidencia,
  cambiarEstadoSeguimiento,
  /** Reabre una incidencia que ya estaba resuelta o en seguimiento —
 * limpia los datos de resolución para no dejar un estado "abierta"
 * con resuelta_por/resuelta_en de una resolución anterior. */
export async function reabrirIncidencia(supabase: SupabaseClient, incidenciaId: string): Promise<void> {
  const { error } = await supabase
    .from("incidencias")
    .update({ estado: "abierta", resuelta_por: null, resuelta_en: null, comentario_resolucion: null })
    .eq("id", incidenciaId);
  if (error) throw error;
}

  TIPO_INCIDENCIA_LABEL,
  NIVEL_DANIO_LABEL,
  type Incidencia,
  type TipoIncidencia,
  type EstadoIncidencia,
  type NivelDanio,
  type ReportarIncidenciaInput,
  type RegistrarPaqueteConIncidenciaInput,
  type SubirFotografiaIncidenciaInput,
} from "./incidencias";

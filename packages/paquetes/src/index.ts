export {
  reportarIncidencia,
  registrarPaqueteConIncidencia,
  subirFotografiaIncidencia,
  listarIncidencias,
  obtenerIncidenciasPaquete,
  resolverIncidencia,
  cambiarEstadoSeguimiento,
  reabrirIncidencia,
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

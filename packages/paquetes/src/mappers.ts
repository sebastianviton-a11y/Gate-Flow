import type { Paquete, PaqueteHistorialEvento, EstadoPaquete, TamanoPaqueteClave, PrioridadPaqueteClave } from "@gateflow/types";

/**
 * Forma cruda que devuelve Supabase para el select completo de un paquete
 * (ver PAQUETE_SELECT en queries.ts). PostgREST embebe relaciones como
 * objetos anidados (o arrays si la cardinalidad no está garantizada a 1).
 *
 * ADVERTENCIA (la parte de esta capa que no pude verificar contra un
 * Postgres real): `paquetes` tiene TRES foreign keys hacia `users`
 * (residente_id, recibido_por, entregado_por). PostgREST requiere
 * desambiguar cada una con el nombre de su constraint
 * (`paquetes_residente_id_fkey`, etc.), que Postgres genera
 * automáticamente con ese patrón — no lo definí explícitamente en la
 * migración. Si el nombre real difiere, este es el primer lugar a
 * revisar (ver SPRINT_02_DELIVERY.md).
 */
export interface PaqueteRow {
  id: string;
  codigo_gateflow: string;
  tenant_id: string;
  unidad_id: string;
  residente_id: string | null;
  remitente: string | null;
  empresa_paqueteria_id: string | null;
  estado_id: string;
  tamano_id: string | null;
  prioridad_id: string | null;
  ubicacion_id: string | null;
  numero_guia: string | null;
  notas: string | null;
  recibido_por: string;
  entregado_por: string | null;
  entregado_a_nombre: string | null;
  fecha_recepcion: string;
  fecha_entrega: string | null;
  unidades?: { identificador: string; contacto_telefono: string | null } | null;
  residente?: { nombre_completo: string; telefono: string | null } | null;
  recibido?: { nombre_completo: string } | null;
  entregado?: { nombre_completo: string } | null;
  empresas_paqueteria?: { nombre: string } | null;
  tamanos_paquete?: { clave: string } | null;
  prioridades_paquete?: { clave: string } | null;
  ubicaciones?: { nombre: string } | null;
}

export function mapPaqueteRow(row: PaqueteRow): Paquete {
  return {
    id: row.id,
    codigoGateflow: row.codigo_gateflow,
    tenantId: row.tenant_id,
    unidadId: row.unidad_id,
    unidadIdentificador: row.unidades?.identificador ?? "",
    residenteId: row.residente_id,
    residenteNombre: row.residente?.nombre_completo ?? null,
    residenteTelefono: row.residente?.telefono ?? null,
    contactoTelefono: row.unidades?.contacto_telefono ?? null,
    remitente: row.remitente,
    empresaPaqueteria: row.empresas_paqueteria?.nombre ?? null,
    estado: row.estado_id as EstadoPaquete,
    tamano: (row.tamanos_paquete?.clave as TamanoPaqueteClave | undefined) ?? null,
    prioridad: (row.prioridades_paquete?.clave as PrioridadPaqueteClave | undefined) ?? null,
    ubicacionId: row.ubicacion_id,
    ubicacionDescripcion: row.ubicaciones?.nombre ?? null,
    numeroGuia: row.numero_guia,
    notas: row.notas,
    recibidoPor: row.recibido_por,
    recibidoPorNombre: row.recibido?.nombre_completo ?? null,
    entregadoPor: row.entregado_por,
    entregadoPorNombre: row.entregado?.nombre_completo ?? null,
    entregadoANombre: row.entregado_a_nombre,
    fechaRecepcion: row.fecha_recepcion,
    fechaEntrega: row.fecha_entrega,
  };
}

export interface HistorialRow {
  id: string;
  paquete_id: string;
  estado_anterior_id: string | null;
  estado_nuevo_id: string;
  notas: string | null;
  created_at: string;
  users?: { nombre_completo: string } | null;
}

export function mapHistorialRow(row: HistorialRow): PaqueteHistorialEvento {
  return {
    id: row.id,
    paqueteId: row.paquete_id,
    estadoAnteriorId: (row.estado_anterior_id as EstadoPaquete | null) ?? null,
    estadoNuevoId: row.estado_nuevo_id as EstadoPaquete,
    usuarioNombre: row.users?.nombre_completo ?? "Sistema",
    notas: row.notas,
    creadoEn: row.created_at,
  };
}

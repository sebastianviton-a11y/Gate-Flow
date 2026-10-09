/**
 * Fuente única de verdad para el importador de unidades/residentes.
 * La plantilla descargable (CSV y XLSX) y el validador
 * (validarCSVUnidades) leen SIEMPRE de aquí — nunca se escriben
 * encabezados a mano en un segundo lugar. Si un día se agrega o
 * renombra una columna, se cambia UNA vez, en este archivo.
 *
 * "Tipo" (casa/departamento) dejó de pedirse: ya no está en la
 * plantilla. Los archivos anteriores que lo traen se siguen aceptando
 * (COLUMNAS_ANTERIORES).
 */
export interface ResidentImportColumn {
  key: "identificador" | "residente_nombre" | "residente_telefono";
  label: string;
  /** Encabezados de plantillas anteriores que se siguen aceptando. */
  alias: string[];
  example: string;
  required: boolean;
}

export const RESIDENT_IMPORT_COLUMNS: ResidentImportColumn[] = [
  { key: "identificador", label: "Dirección", alias: ["Identificador"], example: "MZA 2 LTE 6", required: true },
  { key: "residente_nombre", label: "Nombre del residente", alias: [], example: "Pedro Gómez", required: true },
  { key: "residente_telefono", label: "Teléfono", alias: [], example: "9981234567", required: true },
];

/** Columnas opcionales de plantillas anteriores: se leen si están, nunca se exigen. */
export const COLUMNAS_ANTERIORES = [{ key: "tipo", label: "Tipo", alias: [] as string[] }] as const;

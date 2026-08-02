/**
 * Fuente única de verdad para el importador de unidades/residentes.
 * La plantilla descargable (CSV y XLSX) y el validador
 * (validarCSVUnidades) leen SIEMPRE de aquí — nunca se escriben
 * encabezados a mano en un segundo lugar. Si un día se agrega o
 * renombra una columna, se cambia UNA vez, en este archivo.
 */
export interface ResidentImportColumn {
  key: "tipo" | "identificador" | "residente_nombre" | "residente_telefono";
  label: string;
  example: string;
  required: boolean;
}

export const RESIDENT_IMPORT_COLUMNS: ResidentImportColumn[] = [
  { key: "tipo", label: "Tipo", example: "Casa", required: true },
  { key: "identificador", label: "Identificador", example: "MZA 2 LTE 6", required: true },
  { key: "residente_nombre", label: "Nombre del residente", example: "Pedro Gómez", required: true },
  { key: "residente_telefono", label: "Teléfono", example: "9981234567", required: true },
];


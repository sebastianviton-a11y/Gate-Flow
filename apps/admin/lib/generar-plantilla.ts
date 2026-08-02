import { RESIDENT_IMPORT_COLUMNS } from "./residentes-import-columns";

declare global {
  interface Window {
    XLSX?: any;
  }
}

/**
 * Carga SheetJS desde CDN una sola vez por sesión de navegador —
 * compartida entre la generación de la plantilla XLSX y la lectura de
 * archivos .xlsx/.xls que sube el usuario (importar-unidades.tsx).
 * Antes vivía duplicado dentro de ese componente; ahora es la única
 * copia.
 */
export function cargarXLSXDesdeCDN(): Promise<NonNullable<Window["XLSX"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("XLSX solo puede cargarse en el navegador."));
  if (window.XLSX) return Promise.resolve(window.XLSX);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX);
      else reject(new Error("XLSX no quedó disponible después de cargar el script."));
    };
    script.onerror = () => reject(new Error("No se pudo cargar la librería para leer archivos Excel."));
    document.head.appendChild(script);
  });
}

function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

/**
 * Plantilla CSV generada en memoria (Blob), no un archivo estático en
 * /public — nunca puede "romperse" ni depender de que un archivo
 * exista en el servidor. Encabezados y fila de ejemplo vienen de
 * RESIDENT_IMPORT_COLUMNS, nunca escritos a mano aquí.
 */
export function descargarPlantillaCSV() {
  const encabezado = RESIDENT_IMPORT_COLUMNS.map((c) => c.label).join(",");
  const ejemplo = RESIDENT_IMPORT_COLUMNS.map((c) => `"${c.example}"`).join(",");
  const contenido = `${encabezado}\n${ejemplo}\n`;
  // \uFEFF (BOM) para que Excel abra acentos como "Teléfono" bien al doble clic.
  const blob = new Blob([`\uFEFF${contenido}`], { type: "text/csv;charset=utf-8;" });
  descargarBlob(blob, "plantilla-residentes.csv");
}

/**
 * Plantilla XLSX real. La columna Teléfono se preformatea como TEXTO
 * (formato de celda "@") en un rango de filas — así, cuando el
 * administrador escriba números después de la fila de ejemplo, Excel
 * los conserva como texto y nunca los convierte a "9981234567.0" ni a
 * notación científica.
 */
export async function descargarPlantillaXLSX() {
  const XLSX = await cargarXLSXDesdeCDN();

  const encabezado = RESIDENT_IMPORT_COLUMNS.map((c) => c.label);
  const ejemplo = RESIDENT_IMPORT_COLUMNS.map((c) => c.example);
  const hoja = XLSX.utils.aoa_to_sheet([encabezado, ejemplo]);

  const idxTelefono = RESIDENT_IMPORT_COLUMNS.findIndex((c) => c.key === "residente_telefono");
  const columnaTelefono = XLSX.utils.encode_col(idxTelefono);
  const FILAS_A_PREFORMATEAR = 200;

  for (let fila = 1; fila <= FILAS_A_PREFORMATEAR; fila++) {
    const direccion = `${columnaTelefono}${fila + 1}`;
    if (!hoja[direccion]) hoja[direccion] = { t: "s", v: fila === 1 ? ejemplo[idxTelefono] : "" };
    hoja[direccion].t = "s";
    hoja[direccion].z = "@";
  }

  hoja["!cols"] = RESIDENT_IMPORT_COLUMNS.map(() => ({ wch: 22 }));
  hoja["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: FILAS_A_PREFORMATEAR, c: RESIDENT_IMPORT_COLUMNS.length - 1 },
  });

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Residentes");
  XLSX.writeFile(libro, "plantilla-residentes.xlsx");
}


import { RESIDENT_IMPORT_COLUMNS } from "./residentes-import-columns";

/**
 * Parser CSV mínimo pero correcto: maneja campos entre comillas (incluye
 * comas y comillas escapadas dentro del campo). Sin cambios respecto a
 * la versión original.
 */
export function parseCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;

  const normalizado = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalizado.length; i++) {
    const char = normalizado[i];
    const siguiente = normalizado[i + 1];

    if (dentroDeComillas) {
      if (char === '"' && siguiente === '"') {
        campo += '"';
        i++;
      } else if (char === '"') {
        dentroDeComillas = false;
      } else {
        campo += char;
      }
      continue;
    }

    if (char === '"') {
      dentroDeComillas = true;
    } else if (char === ",") {
      fila.push(campo);
      campo = "";
    } else if (char === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += char;
    }
  }

  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

export interface FilaImportacionUnidad {
  tipo: string;
  identificador: string;
  contactoNombre: string;
  contactoTelefono: string;
}

export interface FilaValidada {
  fila: number;
  datos: FilaImportacionUnidad;
  errores: string[];
}

export interface ResultadoValidacionCSV {
  encabezadoValido: boolean;
  /** Etiquetas amigables (no claves técnicas) de las columnas que
   * faltan — para mostrar en el mensaje de error exactamente cuáles. */
  columnasFaltantes: string[];
  filas: FilaValidada[];
}

/** Ignora mayúsculas/minúsculas, espacios al inicio/fin, espacios
 * dobles y acentos — "Teléfono", "TELEFONO", " telefono " y "Telefono"
 * deben interpretarse como la misma columna. */
function normalizarEncabezado(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Acepta tanto la etiqueta amigable actual ("Nombre del residente")
 * como la clave técnica del formato anterior ("residente_nombre") —
 * es lo que garantiza que instalaciones con la plantilla vieja sigan
 * funcionando sin cambios (punto 4 de la especificación). */
function encontrarIndiceColumna(encabezadoNormalizado: string[], columna: { key: string; label: string }): number {
  const candidatos = [normalizarEncabezado(columna.label), normalizarEncabezado(columna.key)];
  return encabezadoNormalizado.findIndex((h) => candidatos.includes(h));
}

export function validarCSVUnidades(contenido: string): ResultadoValidacionCSV {
  const filasCrudas = parseCSV(contenido);
  if (filasCrudas.length === 0) {
    return {
      encabezadoValido: false,
      columnasFaltantes: RESIDENT_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.label),
      filas: [],
    };
  }

  const encabezadoNormalizado = filasCrudas[0]!.map(normalizarEncabezado);

  const indices = new Map<string, number>();
  const columnasFaltantes: string[] = [];
  for (const columna of RESIDENT_IMPORT_COLUMNS) {
    const idx = encontrarIndiceColumna(encabezadoNormalizado, columna);
    if (idx === -1) {
      if (columna.required) columnasFaltantes.push(columna.label);
    } else {
      indices.set(columna.key, idx);
    }
  }

  if (columnasFaltantes.length > 0) {
    return { encabezadoValido: false, columnasFaltantes, filas: [] };
  }

  const idxTipo = indices.get("tipo")!;
  const idxIdentificador = indices.get("identificador")!;
  const idxNombre = indices.get("residente_nombre")!;
  const idxTelefono = indices.get("residente_telefono")!;

  const filas: FilaValidada[] = filasCrudas.slice(1).map((cols, i) => {
    const tipo = (cols[idxTipo] ?? "").trim().toLowerCase();
    const identificador = (cols[idxIdentificador] ?? "").trim();
    const contactoNombre = (cols[idxNombre] ?? "").trim();
    // Por si el archivo viene de un Excel que ya convirtió el teléfono
    // en número y lo exportó como "9981234567.0" — se limpia aquí,
    // nunca se guarda ese sufijo en la base de datos.
    const contactoTelefono = (cols[idxTelefono] ?? "").trim().replace(/\.0$/, "");

    const errores: string[] = [];
    if (!identificador) errores.push('Falta el identificador (ej. "Casa 45").');
    if (tipo !== "casa" && tipo !== "departamento") errores.push('El tipo debe ser "Casa" o "Departamento".');

    return { fila: i + 2, datos: { tipo, identificador, contactoNombre, contactoTelefono }, errores };
  });

  return { encabezadoValido: true, columnasFaltantes: [], filas };
}

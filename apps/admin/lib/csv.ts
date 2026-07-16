/**
 * Parser CSV mínimo pero correcto: maneja campos entre comillas (incluye
 * comas y comillas escapadas dentro del campo), que es lo que Excel
 * produce al exportar/editar un .csv real — un split(",") ingenuo se
 * rompe con datos reales (ej. una dirección con coma). Decisión D014
 * (DECISIONS.md): CSV en vez de .xlsx real, para no agregar una
 * dependencia de parseo binario a un formato que Excel ya lee/escribe
 * nativamente como texto.
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

const ENCABEZADOS_ESPERADOS = ["tipo", "identificador", "residente_nombre", "residente_telefono"];

export function validarCSVUnidades(contenido: string): { encabezadoValido: boolean; filas: FilaValidada[] } {
  const filasCrudas = parseCSV(contenido);
  if (filasCrudas.length === 0) return { encabezadoValido: false, filas: [] };

  const encabezado = filasCrudas[0]!.map((h) => h.trim().toLowerCase());
  const encabezadoValido = ENCABEZADOS_ESPERADOS.every((h) => encabezado.includes(h));
  if (!encabezadoValido) return { encabezadoValido: false, filas: [] };

  const idxTipo = encabezado.indexOf("tipo");
  const idxIdentificador = encabezado.indexOf("identificador");
  const idxNombre = encabezado.indexOf("residente_nombre");
  const idxTelefono = encabezado.indexOf("residente_telefono");

  const filas: FilaValidada[] = filasCrudas.slice(1).map((cols, i) => {
    const tipo = (cols[idxTipo] ?? "").trim().toLowerCase();
    const identificador = (cols[idxIdentificador] ?? "").trim();
    const contactoNombre = (cols[idxNombre] ?? "").trim();
    const contactoTelefono = (cols[idxTelefono] ?? "").trim();

    const errores: string[] = [];
    if (!identificador) errores.push("Falta el identificador (ej. \"Casa 45\").");
    if (tipo !== "casa" && tipo !== "departamento") errores.push('El tipo debe ser "casa" o "departamento".');

    return { fila: i + 2, datos: { tipo, identificador, contactoNombre, contactoTelefono }, errores };
  });

  return { encabezadoValido, filas };
}

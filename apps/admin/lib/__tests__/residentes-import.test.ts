/**
 * Pruebas sin dependencia de framework — se corren con:
 *   npx tsx apps/admin/lib/__tests__/residentes-import.test.ts
 * (tsx no requiere instalación permanente; npx lo descarga al vuelo).
 * Se evita Jest/Vitest a propósito: no hay config de testing confirmada
 * en el monorepo, y agregar una a ciegas es justo el tipo de cambio que
 * ya rompió un build anterior en esta sesión.
 */
import { validarCSVUnidades, parseCSV } from "../csv";
import { COLUMNAS_ANTERIORES, RESIDENT_IMPORT_COLUMNS } from "../residentes-import-columns";

let pasadas = 0;
let fallidas = 0;

function assert(condicion: boolean, mensaje: string) {
  if (condicion) {
    pasadas++;
  } else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}

function seccion(nombre: string, fn: () => void) {
  console.log(`\n${nombre}`);
  fn();
}

seccion("Plantilla actual: Dirección, sin Tipo", () => {
  const csv = "Dirección,Nombre del residente,Teléfono\nTorre B Depto 4,Pedro Gómez,9981234567";
  const { encabezadoValido, filas } = validarCSVUnidades(csv);
  assert(encabezadoValido, "acepta la plantilla sin la columna Tipo");
  assert(filas[0]?.datos.identificador === "Torre B Depto 4", "Dirección → identificador");
  assert(filas[0]?.datos.tipo === null && filas[0]?.errores.length === 0, "sin Tipo: la vivienda queda sin tipo, sin errores");
});

seccion("Plantillas anteriores con Tipo: se conserva si es válido, nunca bloquea", () => {
  const csv = "Tipo,Identificador,Nombre del residente,Teléfono\nCasa,X1,Ana,555\nChalet,X2,Beto,556\n,X3,Caro,557";
  const { encabezadoValido, filas } = validarCSVUnidades(csv);
  assert(encabezadoValido, "acepta Tipo + Identificador");
  assert(filas[0]?.datos.tipo === "casa", "Casa → casa (se conserva)");
  assert(filas[1]?.datos.tipo === null && filas[1]?.errores.length === 0, "un tipo desconocido ya no es error: queda sin tipo");
  assert(filas[2]?.datos.tipo === null && filas[2]?.errores.length === 0, "Tipo vacío: sin tipo, sin error");
});

seccion("Encabezados amigables (formato anterior con Identificador)", () => {
  const csv = "Tipo,Identificador,Nombre del residente,Teléfono\nCasa,MZA 2 LTE 6,Pedro Gómez,9981234567";
  const { encabezadoValido, filas } = validarCSVUnidades(csv);
  assert(encabezadoValido, "debe aceptar los encabezados amigables");
  assert(filas.length === 1, "debe leer 1 fila de datos");
  assert(filas[0]?.datos.identificador === "MZA 2 LTE 6", "debe mapear Identificador correctamente");
  assert(filas[0]?.datos.contactoNombre === "Pedro Gómez", "debe mapear Nombre del residente → contactoNombre");
  assert(filas[0]?.datos.contactoTelefono === "9981234567", "debe mapear Teléfono → contactoTelefono");
});

seccion("Compatibilidad con formato anterior (claves técnicas)", () => {
  const csv = "tipo,identificador,residente_nombre,residente_telefono\ndepartamento,Depto 101,María López,9987654321";
  const { encabezadoValido, filas } = validarCSVUnidades(csv);
  assert(encabezadoValido, "debe seguir aceptando encabezados técnicos antiguos");
  assert(filas[0]?.datos.tipo === "departamento", "debe leer el tipo del formato antiguo");
});

seccion("Insensible a mayúsculas, espacios y acentos", () => {
  const variantes = ["TIPO", " Tipo ", "tipo", "TiPo"];
  for (const variante of variantes) {
    const csv = `${variante},Identificador,Nombre del residente,Teléfono\nCasa,X1,Ana,555`;
    const { encabezadoValido } = validarCSVUnidades(csv);
    assert(encabezadoValido, `debe aceptar la variante de encabezado "${variante}"`);
  }
  const csvSinAcento = "Tipo,Identificador,Nombre del residente,Telefono\nCasa,X1,Ana,555";
  assert(validarCSVUnidades(csvSinAcento).encabezadoValido, "debe aceptar 'Telefono' sin acento");
});

seccion("Columna faltante reporta exactamente cuál falta", () => {
  const csv = "Tipo,Identificador,Teléfono\nCasa,X1,555";
  const { encabezadoValido, columnasFaltantes } = validarCSVUnidades(csv);
  assert(!encabezadoValido, "debe rechazar el archivo si falta una columna requerida");
  assert(columnasFaltantes.includes("Nombre del residente"), "debe listar 'Nombre del residente' como faltante");
  assert(columnasFaltantes.length === 1, "no debe reportar columnas de más");
});

seccion("Teléfonos nunca terminan en .0 (arrastre de Excel)", () => {
  const csv = "Tipo,Identificador,Nombre del residente,Teléfono\nCasa,X1,Ana,9981234567.0";
  const { filas } = validarCSVUnidades(csv);
  assert(filas[0]?.datos.contactoTelefono === "9981234567", "debe limpiar el sufijo .0 del teléfono");
});

seccion("Fuente única de verdad: RESIDENT_IMPORT_COLUMNS tiene las 3 columnas de la plantilla", () => {
  assert(RESIDENT_IMPORT_COLUMNS.length === 3, "la plantilla tiene exactamente 3 columnas (sin Tipo)");
  const claves = RESIDENT_IMPORT_COLUMNS.map((c) => c.key);
  assert(!(claves as string[]).includes("tipo") && COLUMNAS_ANTERIORES.some((c) => c.key === "tipo"), "Tipo solo como columna anterior (opcional)");
  assert(RESIDENT_IMPORT_COLUMNS.find((c) => c.key === "identificador")?.label === "Dirección", "la columna se llama Dirección");
  assert(claves.includes("identificador"), "debe incluir la clave 'identificador'");
  assert(claves.includes("residente_nombre"), "debe incluir la clave 'residente_nombre'");
  assert(claves.includes("residente_telefono"), "debe incluir la clave 'residente_telefono'");
});

seccion("parseCSV maneja comas dentro de comillas", () => {
  const filas = parseCSV('Tipo,Identificador\n"Casa","Calle 1, Mza 2"');
  assert(filas[1]?.[1] === "Calle 1, Mza 2", "no debe partir un campo entre comillas por la coma interna");
});

seccion("Archivo vacío no truena, reporta columnas faltantes", () => {
  const { encabezadoValido, columnasFaltantes } = validarCSVUnidades("");
  assert(!encabezadoValido, "un archivo vacío debe marcarse como inválido, no lanzar excepción");
  assert(columnasFaltantes.length === 3, "debe reportar las 3 columnas requeridas como faltantes");
});

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);


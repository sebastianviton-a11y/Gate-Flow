/**
 * Páginas legales públicas: parámetros de la URL, lectura por RPC y
 * Markdown seguro. Solo datos ficticios.
 *   npx tsx apps/admin/lib/__tests__/legal-paginas.test.ts
 */
import {
  hrefDocumento,
  leerDocumentoLegal,
  normalizarPais,
  normalizarVersionId,
  type ClienteRpc,
  type ResultadoDocumento,
} from "../legal/documentos";
import { hrefSeguro, parsearInline, parsearMarkdown, slug } from "../legal/markdown";

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

// ---------------------------------------------------------------------------
// Datos ficticios: Términos MX con una vigente, una anterior, una retirada y
// una programada; Términos AR con una vigente; Privacidad MX con una vigente.
// ---------------------------------------------------------------------------
const ID = {
  mxVigente: "11111111-1111-4111-8111-111111111111",
  mxAnterior: "22222222-2222-4222-8222-222222222222",
  mxRetirada: "33333333-3333-4333-8333-333333333333",
  mxProgramada: "44444444-4444-4444-8444-444444444444",
  arVigente: "55555555-5555-4555-8555-555555555555",
  privMx: "66666666-6666-4666-8666-666666666666",
  borrador: "77777777-7777-4777-8777-777777777777",
  rara: "88888888-8888-4888-8888-888888888888",
};

type Version = {
  id: string; clave: string; pais: string; version: string; estado: string; situacion: string; contenido: string;
};
const VERSIONES: Version[] = [
  { id: ID.mxProgramada, clave: "terminos", pais: "MX", version: "2.0", estado: "publicado", situacion: "programada", contenido: "Ficticio MX 2.0" },
  { id: ID.mxVigente, clave: "terminos", pais: "MX", version: "1.1", estado: "publicado", situacion: "vigente", contenido: "Ficticio MX 1.1" },
  { id: ID.mxAnterior, clave: "terminos", pais: "MX", version: "1.0", estado: "publicado", situacion: "anterior", contenido: "Ficticio MX 1.0" },
  { id: ID.mxRetirada, clave: "terminos", pais: "MX", version: "0.9", estado: "retirado", situacion: "retirada", contenido: "Ficticio MX 0.9" },
  { id: ID.arVigente, clave: "terminos", pais: "AR", version: "1.0", estado: "publicado", situacion: "vigente", contenido: "Ficticio AR 1.0" },
  { id: ID.privMx, clave: "privacidad", pais: "MX", version: "1.0", estado: "publicado", situacion: "vigente", contenido: "Ficticio privacidad" },
];

function filaHistorial(v: Version) {
  return {
    version_id: v.id, version: v.version, jurisdiccion: v.pais, estado: v.estado, situacion: v.situacion,
    vigente_desde: "2026-01-01T00:00:00Z", publicado_en: "2026-01-01T00:00:00Z",
    retirado_en: v.estado === "retirado" ? "2026-02-01T00:00:00Z" : null, resumen_cambios: null, contenido_sha256: "ab".repeat(32),
  };
}
function filaPublicado(v: Version) {
  return {
    version_id: v.id, documento_clave: v.clave, titulo: "Título ficticio", version: v.version, jurisdiccion: v.pais, estado: v.estado,
    vigente_desde: "2026-01-01T00:00:00Z", publicado_en: "2026-01-01T00:00:00Z",
    retirado_en: v.estado === "retirado" ? "2026-02-01T00:00:00Z" : null, contenido: v.contenido, contenido_sha256: "ab".repeat(32),
  };
}

type Opciones = {
  versiones?: Version[];
  errorEn?: string;
  formaRara?: boolean;
  lanzar?: boolean;
  /** documento_legal_publicado devuelve también esta fila (simula datos inconsistentes). */
  extraPublicado?: Version;
};
function clienteFalso(op: Opciones = {}): ClienteRpc & { llamadas: string[] } {
  const versiones = op.versiones ?? VERSIONES;
  const llamadas: string[] = [];
  return {
    llamadas,
    async rpc(fn, args) {
      llamadas.push(fn);
      if (op.lanzar) throw new TypeError("fetch failed");
      if (op.errorEn === fn) return { data: null, error: { code: "42883", message: "detalle que no debe registrarse" } };
      if (fn === "documentos_legales_historial") {
        if (op.formaRara) return { data: [{ version_id: ID.mxVigente, situacion: "borrador" }], error: null };
        const filas = versiones.filter((v) => v.clave === args.p_clave && v.pais === args.p_pais).map(filaHistorial);
        return { data: filas, error: null };
      }
      if (fn === "documento_legal_publicado") {
        const v = versiones.find((x) => x.id === args.p_version_id) ?? (op.extraPublicado?.id === args.p_version_id ? op.extraPublicado : undefined);
        return { data: v ? [filaPublicado(v)] : [], error: null };
      }
      return { data: null, error: { code: "PGRST202" } };
    },
  };
}

const registros: string[] = [];
const registrar = (contexto: string, codigo: string) => registros.push(`${contexto}:${codigo}`);

async function main() {
  console.log("\nParámetros de la URL");
  assert(normalizarPais(undefined) === "MX", "sin ?pais → México");
  assert(normalizarPais("ar") === "AR" && normalizarPais(" AR ") === "AR", "?pais=ar → AR");
  assert(normalizarPais("BR") === "MX" && normalizarPais("") === "MX", "país desconocido → México");
  assert(normalizarPais(["AR", "MX"]) === "AR", "parámetro repetido → el primero");
  assert(normalizarVersionId(ID.mxVigente.toUpperCase()) === ID.mxVigente, "?version=<UUID> → minúsculas");
  assert(normalizarVersionId("1.0") === null && normalizarVersionId("'; drop table x; --") === null, "?version no UUID → null");
  assert(normalizarVersionId(undefined) === null, "sin ?version → null");
  assert(hrefDocumento("terminos", "AR") === "/terminos?pais=AR", "enlace con país");
  assert(hrefDocumento("acuerdo_tratamiento", "MX", ID.mxVigente) === `/acuerdo-datos?pais=MX&version=${ID.mxVigente}`, "enlace al acuerdo con versión");

  console.log("\nLectura: documento publicado vigente");
  let c = clienteFalso();
  let r: ResultadoDocumento = await leerDocumentoLegal(c, "terminos", "MX", null, registrar);
  assert(r.tipo === "publicado" && r.documento.versionId === ID.mxVigente && r.documento.situacion === "vigente", "MX → la vigente que marca la base (1.1)");
  assert(r.tipo === "publicado" && r.historial.length === 4, "historial MX completo (programada, vigente, anterior, retirada)");
  assert(c.llamadas.every((f) => f === "documentos_legales_historial" || f === "documento_legal_publicado"), "solo las dos RPC de lectura");

  console.log("\nSelección por país");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "AR", null, registrar);
  assert(r.tipo === "publicado" && r.documento.pais === "AR" && r.documento.contenido === "Ficticio AR 1.0", "AR → la vigente de Argentina");
  assert(r.tipo === "publicado" && r.historial.every((h) => h.pais === "AR"), "historial solo de Argentina");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "MX", ID.arVigente, registrar);
  assert(r.tipo === "publicado" && r.pais === "AR" && r.historial.every((h) => h.pais === "AR"), "versión de AR pedida con ?pais=MX → la página pasa a Argentina");

  console.log("\nDocumento inexistente / pendiente");
  r = await leerDocumentoLegal(clienteFalso(), "acuerdo_tratamiento", "MX", null, registrar);
  assert(r.tipo === "pendiente" && r.historial.length === 0, "sin versiones publicadas → pendiente");
  r = await leerDocumentoLegal(clienteFalso(), "privacidad", "AR", null, registrar);
  assert(r.tipo === "pendiente", "publicado en MX pero no en AR → AR pendiente (no se usa el de otro país)");
  const soloProgramada = VERSIONES.filter((v) => v.id === ID.mxProgramada);
  r = await leerDocumentoLegal(clienteFalso({ versiones: soloProgramada }), "terminos", "MX", null, registrar);
  assert(r.tipo === "pendiente" && r.historial.length === 1 && r.historial[0]?.situacion === "programada", "solo una programada → pendiente (no se adelanta)");

  console.log("\nHistorial: anterior, retirada y programada");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "MX", ID.mxRetirada, registrar);
  assert(r.tipo === "publicado" && r.documento.estado === "retirado" && r.documento.situacion === "retirada", "versión retirada consultable desde el historial");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "MX", ID.mxAnterior, registrar);
  assert(r.tipo === "publicado" && r.documento.situacion === "anterior", "versión anterior");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "MX", ID.mxProgramada, registrar);
  assert(r.tipo === "publicado" && r.documento.situacion === "programada", "versión programada (marcada como no vigente)");

  console.log("\nVersiones que no deben mostrarse");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "MX", ID.borrador, registrar);
  assert(r.tipo === "version_no_encontrada", "id inexistente / borrador (la RPC no lo devuelve) → no encontrada");
  r = await leerDocumentoLegal(clienteFalso(), "terminos", "MX", ID.privMx, registrar);
  assert(r.tipo === "version_no_encontrada", "versión de OTRO documento → no encontrada (no se muestra en /terminos)");
  const aprobado: Version = { id: ID.rara, clave: "terminos", pais: "MX", version: "9.9", estado: "aprobado", situacion: "vigente", contenido: "NO PUBLICO" };
  r = await leerDocumentoLegal(clienteFalso({ extraPublicado: aprobado }), "terminos", "MX", ID.rara, registrar);
  assert(r.tipo === "version_no_encontrada", "estado distinto de publicado/retirado → no se muestra");
  const fuera: Version = { id: ID.rara, clave: "terminos", pais: "MX", version: "9.8", estado: "publicado", situacion: "vigente", contenido: "FUERA DEL HISTORIAL" };
  r = await leerDocumentoLegal(clienteFalso({ extraPublicado: fuera }), "terminos", "MX", ID.rara, registrar);
  assert(r.tipo === "version_no_encontrada", "versión que no figura en el historial → no se muestra");

  console.log("\nLectura no disponible (migración sin aplicar, error, excepción)");
  registros.length = 0;
  r = await leerDocumentoLegal(clienteFalso({ errorEn: "documentos_legales_historial" }), "terminos", "MX", null, registrar);
  assert(r.tipo === "no_disponible", "sin permiso / función inexistente → no disponible");
  r = await leerDocumentoLegal(clienteFalso({ errorEn: "documento_legal_publicado" }), "terminos", "MX", null, registrar);
  assert(r.tipo === "no_disponible", "error al leer el contenido → no disponible");
  r = await leerDocumentoLegal(clienteFalso({ formaRara: true }), "terminos", "MX", null, registrar);
  assert(r.tipo === "no_disponible", "respuesta con forma inesperada → no disponible");
  r = await leerDocumentoLegal(clienteFalso({ lanzar: true }), "terminos", "AR", null, registrar);
  assert(r.tipo === "no_disponible" && r.pais === "AR", "excepción de red → no disponible");
  assert(
    registros.length === 4 && registros.every((x) => /^(historial|version|excepcion):[\w]+$/.test(x)) && !registros.some((x) => x.includes("detalle")),
    `solo se registran códigos, nunca mensajes ni parámetros (${registros.join(", ")})`,
  );

  console.log("\nMarkdown seguro");
  assert(hrefSeguro("https://ejemplo.test/a") === "https://ejemplo.test/a" && hrefSeguro("mailto:legal@ejemplo.test") !== null, "http(s) y mailto permitidos");
  assert(hrefSeguro("#seccion-2") === "#seccion-2", "anclas internas permitidas");
  assert(hrefSeguro("javascript:alert(1)") === null && hrefSeguro("JaVaScRiPt:alert(1)") === null, "javascript: bloqueado");
  assert(hrefSeguro("data:text/html,<b>") === null && hrefSeguro("//ejemplo.test") === null && hrefSeguro("/ruta") === null, "data:, protocolo relativo y rutas bloqueados");
  const enlaceMalo = parsearInline("[clic](javascript:alert(1))");
  assert(enlaceMalo.every((n) => n.tipo === "texto"), "enlace peligroso → solo su texto");
  const html = parsearMarkdown('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
  assert(
    html.length === 2 && html.every((b) => b.tipo === "parrafo" && b.contenido.every((n) => n.tipo === "texto" && n.texto.includes("<"))),
    "HTML crudo queda como texto literal (React lo escapa)",
  );
  const doc = parsearMarkdown("# Título ficticio\n\n## Sección uno\n\nTexto **negrita** y *cursiva*.\nSigue el párrafo.\n\n- uno\n- dos\n\n3. tres\n4. cuatro\n\n> cita\n\n---\n\n## Sección uno");
  const tipos = doc.map((b) => b.tipo).join(",");
  assert(tipos === "titulo,titulo,parrafo,lista,lista,cita,separador,titulo", `bloques reconocidos (${tipos})`);
  assert(doc[0]?.tipo === "titulo" && doc[0].nivel === 2, "# del documento → h2 (el h1 es el título de la página)");
  assert(doc[1]?.tipo === "titulo" && doc[7]?.tipo === "titulo" && doc[1].id === "seccion-uno" && doc[7].id === "seccion-uno-2", "ids de sección únicos");
  assert(doc[4]?.tipo === "lista" && doc[4].ordenada && doc[4].inicio === 3, "lista numerada conserva el número inicial");
  const p = doc[2];
  assert(p?.tipo === "parrafo" && p.contenido.some((n) => n.tipo === "negrita") && p.contenido.some((n) => n.tipo === "cursiva"), "negrita y cursiva");
  assert(slug("Artículo 5º — Tratamiento") === "articulo-5o-tratamiento" || slug("Artículo 5º — Tratamiento").startsWith("articulo-5"), "slug sin acentos");
  assert(parsearMarkdown("").length === 0 && parsearMarkdown("\r\n\r\n").length === 0, "texto vacío → sin bloques");
  assert(parsearInline("snake_case_id").every((n) => n.tipo === "texto"), "guiones bajos dentro de palabras no son cursiva");
  assert(parsearInline("\\*literal\\*").map((n) => (n.tipo === "texto" ? n.texto : "")).join("") === "*literal*", "escapes");

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

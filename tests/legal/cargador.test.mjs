#!/usr/bin/env node
// ============================================================
// Cargador de documentos legales (scripts/legal/documentos-legales.mjs).
//   node tests/legal/cargador.test.mjs
// Parte A (siempre): validación de los archivos, normalización y hash,
// SQL generado. Parte B (con Postgres local; si no hay, SKIP): el SQL de
// carga y de verificación contra el esquema REAL de la Fase 1 + la
// lectura pública (20261015), en una base desechable gf_legal_cargador.
// Solo documentos FICTICIOS, generados en un directorio temporal.
// ============================================================
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generarSqlCarga,
  generarSqlVerificacion,
  leerArchivo,
  leerDocumentos,
  normalizarContenido,
  separarCabecera,
  sha256Hex,
} from "../../scripts/legal/documentos-legales.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const CLI = path.join(RAIZ, "scripts/legal/documentos-legales.mjs");
const DB = process.env.GF_LEGAL_CARGADOR_DB ?? "gf_legal_cargador";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-legal-cargador-"));

let pasadas = 0;
let fallidas = 0;
function ok(cond, texto, detalle = "") {
  if (cond) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${texto}${detalle ? ` — ${String(detalle).slice(0, 600)}` : ""}`);
  }
}
const lanza = (fn, re) => {
  try {
    fn();
    return false;
  } catch (e) {
    return re.test(e.message);
  }
};

let contador = 0;
/** Escribe un documento ficticio y devuelve su ruta. */
function doc(dir, carpeta, nombre, cabecera, cuerpo = "# Documento ficticio\n\nTexto de prueba ZZ_AUTOTEST.\n") {
  const ruta = path.join(dir, carpeta, nombre);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const lineas = Object.entries(cabecera).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`);
  fs.writeFileSync(ruta, `---\n${lineas.join("\n")}\n---\n${cuerpo}`);
  return ruta;
}
const nuevoDir = () => {
  const d = path.join(TMP, `caso-${++contador}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const base = (extra = {}) => ({ identificador: "terminos", version: '"1.0"', jurisdicciones: ["MX"], estado: "borrador", ...extra });
const aprobado = (extra = {}) => base({ estado: "aprobado", aprobacion: '"ZZ-REF-FICTICIA-001"', ...extra });

// ── Parte A ─────────────────────────────────────────────────
console.log("\nA. Normalización y hash");
ok(sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 de referencia");
ok(normalizarContenido("\r\n\r\n# T  \r\nLínea\t\r\n\r\n\r\n") === "# T\nLínea\n", "CRLF → LF, sin espacios finales ni líneas vacías al principio/final, un salto final");
ok(normalizarContenido("   \n\n") === "\n" || normalizarContenido("   \n\n") === "", "solo espacios → vacío");
ok(separarCabecera("﻿---\na: 1\n---\nx").cuerpo === "x", "BOM al principio admitido");
ok(lanza(() => separarCabecera("sin cabecera"), /falta la cabecera/), "sin cabecera → error");
ok(lanza(() => separarCabecera("---\na: 1\n"), /no se cierra/), "cabecera sin cerrar → error");
ok(lanza(() => separarCabecera("---\na: 1\na: 2\n---\n"), /repetida/), "campo repetido → error");

console.log("\nA. Validación de cada archivo");
{
  const d = nuevoDir();
  const casos = [
    ["identificador de otra carpeta", "terminos", "v1.0.md", base({ identificador: "privacidad" }), /no corresponde a la carpeta/],
    ["versión mal formada", "terminos", "v1.0.md", base({ version: '"1"' }), /version "1" no válida/],
    ["país no admitido", "terminos", "v1.0.md", base({ jurisdicciones: ["BR"] }), /jurisdicciones/],
    ["país repetido", "terminos", "v1.0.md", base({ jurisdicciones: ["MX", "MX"] }), /jurisdicciones/],
    ["estado desconocido", "terminos", "v1.0.md", base({ estado: "vigente" }), /estado "vigente" no válido/],
    ["campo desconocido", "terminos", "v1.0.md", base({ precio: "100" }), /campo desconocido "precio"/],
    ["aprobado sin referencia jurídica", "terminos", "v1.0.md", base({ estado: "aprobado" }), /exige "aprobacion"/],
    ["publicado sin vigencia", "terminos", "v1.0.md", aprobado({ estado: "publicado" }), /exige vigente_desde/],
    ["vigencia sin zona horaria", "terminos", "v1.0.md", aprobado({ estado: "publicado", vigente_desde: "2030-01-01T00:00:00" }), /no válida: fecha y hora con zona/],
    ["nombre que no coincide con la versión", "terminos", "v1.1.md", base(), /el nombre dice versión 1.1/],
    ["sufijo -ar con México", "terminos", "v1.0-ar.md", base(), /sufijo -ar exige/],
    ["nombre no válido", "terminos", "terminos-final.md", base(), /nombre "terminos-final.md" no válido/],
    ["requiere_nueva_aceptacion no booleano", "terminos", "v1.0.md", base({ requiere_nueva_aceptacion: "si" }), /true o false/],
  ];
  for (const [texto, carpeta, nombre, cab, re] of casos) {
    const ruta = doc(d, carpeta, nombre, cab);
    ok(lanza(() => leerArchivo(ruta, carpeta), re), texto);
    fs.rmSync(ruta);
  }
  const vacio = doc(d, "terminos", "v1.0.md", base(), "\n\n");
  ok(lanza(() => leerArchivo(vacio, "terminos"), /contenido está vacío/), "contenido vacío");
  for (const marcador of ["[PENDIENTE: domicilio]", "{{razon_social}}", "TODO revisar"]) {
    const r = doc(d, "terminos", "v1.0.md", aprobado(), `# Ficticio\n\nTexto ${marcador}\n`);
    ok(lanza(() => leerArchivo(r, "terminos"), /marcadores de texto pendiente/), `aprobado con marcador ${marcador} → rechazado`);
  }
  const borr = doc(d, "terminos", "v1.0.md", base(), "# [PENDIENTE: título]\n\n[PENDIENTE: texto]\n");
  ok(leerArchivo(borr, "terminos").versiones[0]?.estado === "borrador", "un borrador puede tener marcadores pendientes");
  const dos = doc(d, "terminos", "v1.0.md", aprobado({ jurisdicciones: ["MX", "AR"] }));
  const v2 = leerArchivo(dos, "terminos").versiones;
  ok(v2.length === 2 && v2[0]?.pais === "MX" && v2[1]?.pais === "AR" && v2[0]?.sha256 === v2[1]?.sha256, "[MX, AR] → una versión por país con el mismo texto");
  const crlf = doc(d, "terminos", "v1.0.md", aprobado(), "# Título ficticio  \r\n\r\nPárrafo con ñ, acentos y €.\r\n");
  const vc = leerArchivo(crlf, "terminos").versiones[0];
  ok(vc?.contenido === "# Título ficticio\n\nPárrafo con ñ, acentos y €.\n" && vc?.sha256 === sha256Hex(vc.contenido), "CRLF y espacios finales normalizados antes del hash");
  const pasada = doc(d, "terminos", "v1.0.md", aprobado({ estado: "publicado", vigente_desde: "2020-01-01T00:00:00-06:00" }));
  const rp = leerArchivo(pasada, "terminos");
  ok(rp.avisos.length === 1 && /vigencia retroactiva/.test(rp.avisos[0] ?? ""), "publicado con vigencia pasada → aviso (la base lo rechazará si no está publicado)");
  ok(rp.versiones[0]?.vigenteDesde === "2020-01-01T06:00:00.000Z", "vigencia con zona → UTC");
  const dpa = doc(d, "dpa", "v1.0.md", { identificador: "acuerdo_tratamiento", version: '"1.0"', jurisdicciones: ["MX"], estado: "borrador" });
  ok(leerArchivo(dpa, "dpa").versiones[0]?.clave === "acuerdo_tratamiento", "legal/dpa → acuerdo_tratamiento");
}

console.log("\nA. Validación del conjunto");
{
  const d = nuevoDir();
  doc(d, "terminos", "v1.0.md", aprobado());
  doc(d, "terminos", "v1.0-mx.md", aprobado());
  ok(lanza(() => leerDocumentos(d), /aparece dos veces/), "misma versión y país en dos archivos → error");
  const d2 = nuevoDir();
  doc(d2, "terminos", "v1.0.md", aprobado({ estado: "publicado", vigente_desde: "2030-01-01T00:00:00Z" }));
  doc(d2, "terminos", "v1.1.md", aprobado({ version: '"1.1"', estado: "publicado", vigente_desde: "2030-01-01T00:00:00Z" }));
  ok(lanza(() => leerDocumentos(d2), /misma vigencia/), "dos publicadas con la misma vigencia → error");
  const d3 = nuevoDir();
  fs.mkdirSync(path.join(d3, "terminos"));
  fs.writeFileSync(path.join(d3, "terminos", "README.md"), "# no es una versión\n");
  fs.copyFileSync(path.join(RAIZ, "legal/plantilla.md"), path.join(d3, "terminos", "v1.0.md"));
  const r3 = leerDocumentos(d3);
  ok(r3.versiones.length === 1 && r3.versiones[0]?.estado === "borrador", "README ignorado; la plantilla del repo es un borrador válido");
  ok(!/insert into/.test(generarSqlCarga(r3.versiones)), "la plantilla (borrador) no genera ninguna carga");
  const repo = spawnSync(process.execPath, [CLI, "validar"], { encoding: "utf8" });
  ok(repo.status === 0 && /^0 versión\(es\)/m.test(repo.stdout), "legal/ del repositorio: sin versiones todavía (los textos reales no están)", repo.stdout + repo.stderr);
  const malo = nuevoDir();
  doc(malo, "terminos", "v1.0.md", base({ estado: "x" }));
  const rm = spawnSync(process.execPath, [CLI, "validar", "--dir", malo], { encoding: "utf8" });
  ok(rm.status === 1 && /Documentos legales con errores/.test(rm.stderr), "CLI: errores → código 1");
}

console.log("\nA. SQL generado");
{
  const d = nuevoDir();
  doc(d, "terminos", "v1.0.md", aprobado({ estado: "publicado", vigente_desde: "2030-01-01T00:00:00Z" }), "# Ficticio\n\nTexto con 'comillas' y $gf_ y $$ dólares.\n");
  doc(d, "terminos", "v2.0.md", base({ version: '"2.0"' }), "# ZZ_BORRADOR_NO_PUBLICO\n");
  const { versiones } = leerDocumentos(d);
  const sin = generarSqlCarga(versiones);
  const con = generarSqlCarga(versiones, { publicar: true });
  ok(!sin.includes("ZZ_BORRADOR_NO_PUBLICO") && !con.includes("ZZ_BORRADOR_NO_PUBLICO"), "el texto de un borrador nunca entra en el SQL");
  ok(!/set estado = 'publicado'/.test(sin) && /set estado = 'publicado'/.test(con), "sin --publicar no se publica nada; con --publicar sí");
  ok(/^begin;$/m.test(sin) && /^commit;$/m.test(sin) && /to_regclass\('public\.documentos_legales_versiones'\)/.test(sin), "una transacción con guarda de esquema");
  ok(!/\bdelete\b|\btruncate\b|\bdrop\b|\bgrant\b|\balter\b/i.test(con.replace(/--.*$/gm, "")), "sin DELETE/TRUNCATE/DROP/GRANT/ALTER");
  ok(/^select /m.test(generarSqlVerificacion(versiones)) && !/\b(insert|update|delete)\b/i.test(generarSqlVerificacion(versiones).replace(/--.*$/gm, "")), "la verificación es solo lectura");
  // El texto contiene la etiqueta $…$ que tocaría: se elige otra.
  const sintetica = { archivo: "x", clave: "terminos", version: "9.9", pais: "MX", estado: "aprobado", vigenteDesde: null, aprobacion: "ZZ", requiereNuevaAceptacion: true, resumenCambios: null, contenido: "a $gf_aaaaaaaaaaaa$ b\n", sha256: "a".repeat(64) };
  ok(generarSqlCarga([sintetica]).includes("c text := $gf_aaaaaaaaaaaa_0$a $gf_aaaaaaaaaaaa$ b"), "la etiqueta $…$ nunca aparece dentro del texto");
}

// ── Parte B: base local ─────────────────────────────────────
const quien = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const hayPg = quien("psql") && spawnSync("psql", ["-X", "-At", "-d", "postgres", "-c", "select 1"]).status === 0;
const remoto = [process.env.PGHOST, process.env.DATABASE_URL, process.env.PGDATABASE].some((v) => /supabase|pooler/.test(v ?? ""));
if (!/^gf_legal_/.test(DB) || remoto) {
  ok(false, "salvaguarda: la base debe ser local y llamarse gf_legal_*");
} else if (!hayPg) {
  console.log("\nB. SKIP: no hay Postgres local accesible (PGHOST/PGPORT/PGUSER)");
} else {
  parteB();
}

function parteB() {
  console.log("\nB. Carga y verificación contra el esquema real (base local desechable)");
  execFileSync("bash", [path.join(AQUI, "construir-base.sh"), DB], { stdio: ["ignore", "ignore", "inherit"] });
  const sql = (q, rol = null) =>
    execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, ...(rol ? ["-c", `set role ${rol}`] : []), "-c", q], { encoding: "utf8" }).trim();
  const ejecutar = (texto, db = DB) => {
    const f = path.join(TMP, `sql-${++contador}.sql`);
    fs.writeFileSync(f, texto);
    const r = spawnSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", f], { encoding: "utf8" });
    return { ok: r.status === 0, salida: r.stdout, error: r.stderr };
  };
  const huella = () =>
    sql(`select coalesce(md5(string_agg(t::text, '|' order by id)), '-') || ':' || (select count(*) from public.audit_log) from public.documentos_legales_versiones t`);
  const estados = () => sql(`select string_agg(documento_clave || ' ' || version || ' ' || jurisdiccion || '=' || estado, ', ' order by documento_clave, jurisdiccion, version) from public.documentos_legales_versiones`);
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

  // Vigencias relativas: la Fase 1 no publica con vigencia de más de 5 minutos atrás.
  const en = (min) => new Date(Date.now() + min * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const d = nuevoDir();
  const ref = '"ZZ-REF-FICTICIA-JURIDICO-001"';
  const pub = (version, desde, extra = {}) => aprobado({ version: `"${version}"`, estado: "publicado", vigente_desde: desde, aprobacion: ref, ...extra });
  doc(d, "terminos", "v0.9-mx.md", pub("0.9", en(-4), { estado: "retirado", jurisdicciones: ["MX"] }), "# Términos ficticios 0.9\n\nZZ_TEXTO_RETIRADO.\n");
  doc(d, "terminos", "v1.0.md", pub("1.0", en(-3), { jurisdicciones: ["MX", "AR"], resumen_cambios: '"Versión inicial ficticia"' }), "# Términos ficticios 1.0\n\nTexto común MX/AR con ñ y acentos: áéíóú.\r\n");
  doc(d, "terminos", "v1.1-mx.md", pub("1.1", en(-2)), "# Términos ficticios 1.1\n\nZZ_TEXTO_VIGENTE_MX.\n");
  doc(d, "terminos", "v2.0-mx.md", pub("2.0", en(60 * 24 * 10)), "# Términos ficticios 2.0\n\nZZ_TEXTO_PROGRAMADO.\n");
  doc(d, "terminos", "v3.0-mx.md", base({ version: '"3.0"' }), "# ZZ_BORRADOR_NO_PUBLICO\n\n[PENDIENTE: texto]\n");
  doc(d, "terminos", "v3.1-mx.md", aprobado({ version: '"3.1"', aprobacion: ref }), "# ZZ_APROBADO_NO_PUBLICO\n");
  doc(d, "privacidad", "v1.0-ar.md", { ...pub("1.0", en(-2), { jurisdicciones: ["AR"] }), identificador: "privacidad" }, "# Aviso ficticio AR\n\nZZ_PRIVACIDAD_AR.\n");
  doc(d, "dpa", "v1.0-mx.md", { ...aprobado({ aprobacion: ref }), identificador: "acuerdo_tratamiento" }, "# Acuerdo ficticio\n\nZZ_DPA_APROBADO.\n");

  ok(huella().startsWith("-:"), "base vacía de versiones");
  const sinPub = cli(["sql-carga", "--dir", d]);
  ok(sinPub.status === 0, "sql-carga sin --publicar", sinPub.stderr);
  const vacio = huella();
  let r = ejecutar(sinPub.stdout);
  ok(r.ok, "carga sin --publicar aplicada", r.error);
  ok(
    estados() ===
      "acuerdo_tratamiento 1.0 MX=aprobado, privacidad 1.0 AR=aprobado, terminos 1.0 AR=aprobado, terminos 0.9 MX=aprobado, terminos 1.0 MX=aprobado, terminos 1.1 MX=aprobado, terminos 2.0 MX=aprobado, terminos 3.1 MX=aprobado",
    "sin --publicar todo queda como mucho aprobado; el borrador no se carga",
    estados(),
  );
  ok(sql("select count(*) from public.documentos_legales_vigentes('MX')", "anon") === "0" && sql("select count(*) from public.documentos_legales_historial('terminos','MX')", "anon") === "0", "nada aprobado es visible para anon");
  ok(sql("select count(*) from public.documentos_legales_versiones where contenido like '%ZZ_BORRADOR_NO_PUBLICO%'") === "0", "el borrador del repositorio no está en la base");
  ok(sql("select count(*) from public.documentos_legales_versiones where contenido_sha256 <> encode(sha256(convert_to(contenido,'UTF8')),'hex')") === "0", "hash de Node = sha256 de Postgres (acentos, ñ, CRLF normalizado)");
  const trasAprobar = huella();
  ok(trasAprobar !== vacio, "la carga cambió la base");
  r = ejecutar(cli(["sql-carga", "--dir", d]).stdout);
  ok(r.ok && huella() === trasAprobar, "repetir la carga no cambia nada (idempotente, sin auditoría nueva)", r.error);
  const ver1 = ejecutar(cli(["sql-verificar", "--dir", d]).stdout);
  ok(ver1.ok && ver1.salida.trim().split("\n").every((l) => l.startsWith("OK|")) && ver1.salida.trim().split("\n").length === 8, "verificación sin --publicar: 8 OK", ver1.salida);
  const ver2 = ejecutar(cli(["sql-verificar", "--dir", d, "--publicar"]).stdout);
  ok(ver2.ok && (ver2.salida.match(/^DIFERENTE: estado aprobado \(repo: (publicado|retirado)\)/gm) ?? []).length === 6, "verificación con --publicar: 6 pendientes de publicar/retirar", ver2.salida);

  const conPub = cli(["sql-carga", "--dir", d, "--publicar"]);
  r = ejecutar(conPub.stdout);
  ok(r.ok, "carga con --publicar aplicada", r.error);
  ok(
    estados() ===
      "acuerdo_tratamiento 1.0 MX=aprobado, privacidad 1.0 AR=publicado, terminos 1.0 AR=publicado, terminos 0.9 MX=retirado, terminos 1.0 MX=publicado, terminos 1.1 MX=publicado, terminos 2.0 MX=publicado, terminos 3.1 MX=aprobado",
    "con --publicar: publicadas, retirada y las aprobadas siguen sin publicar",
    estados(),
  );
  ok(sql("select string_agg(documento_clave || ':' || version, ',' order by documento_clave) from public.documentos_legales_vigentes('MX')", "anon") === "terminos:1.1", "vigentes MX para anon: Términos 1.1 (ni la programada ni el aprobado)");
  ok(sql("select string_agg(documento_clave || ':' || version, ',' order by documento_clave) from public.documentos_legales_vigentes('AR')", "anon") === "privacidad:1.0,terminos:1.0", "vigentes AR: Privacidad 1.0 y Términos 1.0");
  ok(sql("select string_agg(version || ':' || situacion, ',') from public.documentos_legales_historial('terminos','MX')", "anon") === "2.0:programada,1.1:vigente,1.0:anterior,0.9:retirada", "historial MX: programada, vigente, anterior, retirada");
  ok(sql("select count(*) from public.documentos_legales_historial('acuerdo_tratamiento','MX')", "anon") === "0", "el acuerdo (solo aprobado) no aparece");
  const trasPublicar = huella();
  r = ejecutar(cli(["sql-carga", "--dir", d, "--publicar"]).stdout);
  ok(r.ok && huella() === trasPublicar, "repetir la carga publicada no cambia nada", r.error);
  const ver3 = ejecutar(cli(["sql-verificar", "--dir", d, "--publicar"]).stdout);
  ok(ver3.ok && ver3.salida.trim().split("\n").every((l) => l.startsWith("OK|")), "verificación con --publicar: todo OK, nada SOLO_EN_BASE", ver3.salida);

  // Texto modificado en el repositorio: la carga aborta entera y la verificación lo señala.
  const alterado = nuevoDir();
  fs.cpSync(d, alterado, { recursive: true });
  const f11 = path.join(alterado, "terminos", "v1.1-mx.md");
  fs.writeFileSync(f11, fs.readFileSync(f11, "utf8").replace("ZZ_TEXTO_VIGENTE_MX.", "ZZ_TEXTO_CAMBIADO."));
  r = ejecutar(cli(["sql-carga", "--dir", alterado, "--publicar"]).stdout);
  ok(!r.ok && /ya existe con OTRO texto/.test(r.error) && huella() === trasPublicar, "texto distinto para una versión existente → aborta sin cambios", r.error);
  const ver4 = ejecutar(cli(["sql-verificar", "--dir", alterado, "--publicar"]).stdout);
  ok(/^DIFERENTE: texto \(hash\)\|terminos\|MX\|1\.1/m.test(ver4.salida), "la verificación marca el texto distinto", ver4.salida);

  // SQL editado a mano (texto cambiado sin su hash): aborta.
  const editado = conPub.stdout.replace("ZZ_TEXTO_VIGENTE_MX.", "ZZ_TEXTO_EDITADO.");
  r = ejecutar(editado);
  ok(!r.ok && /no coincide con su hash/.test(r.error) && huella() === trasPublicar, "script alterado → aborta sin cambios", r.error);

  // Otra referencia de aprobación, o el repositorio atrasado respecto de la base: aborta.
  const otraRef = nuevoDir();
  fs.cpSync(d, otraRef, { recursive: true });
  const f31 = path.join(otraRef, "terminos", "v3.1-mx.md");
  fs.writeFileSync(f31, fs.readFileSync(f31, "utf8").replace("ZZ-REF-FICTICIA-JURIDICO-001", "ZZ-REF-OTRA"));
  r = ejecutar(cli(["sql-carga", "--dir", otraRef]).stdout);
  ok(!r.ok && /aprobada con otra referencia/.test(r.error) && huella() === trasPublicar, "otra referencia de aprobación → aborta sin cambios", r.error);
  const atrasado = nuevoDir();
  fs.cpSync(d, atrasado, { recursive: true });
  const fa = path.join(atrasado, "terminos", "v1.1-mx.md");
  fs.writeFileSync(fa, fs.readFileSync(fa, "utf8").replace("estado: publicado", "estado: aprobado"));
  r = ejecutar(cli(["sql-carga", "--dir", atrasado]).stdout);
  ok(!r.ok && /actualizar el repositorio/.test(r.error) && huella() === trasPublicar, "el repositorio dice aprobado y la base publicado → aborta", r.error);
  const otraVig = nuevoDir();
  fs.cpSync(d, otraVig, { recursive: true });
  const fv = path.join(otraVig, "terminos", "v2.0-mx.md");
  fs.writeFileSync(fv, fs.readFileSync(fv, "utf8").replace(/vigente_desde: .*/, `vigente_desde: ${en(60 * 24 * 11)}`));
  r = ejecutar(cli(["sql-carga", "--dir", otraVig, "--publicar"]).stdout);
  ok(!r.ok && /se publicó con otra vigencia/.test(r.error) && huella() === trasPublicar, "otra vigencia para una versión publicada → aborta", r.error);

  // Una versión en la base que el repositorio no tiene.
  const incompleto = nuevoDir();
  fs.cpSync(d, incompleto, { recursive: true });
  fs.rmSync(path.join(incompleto, "privacidad", "v1.0-ar.md"));
  const ver5 = ejecutar(cli(["sql-verificar", "--dir", incompleto, "--publicar"]).stdout);
  ok(/^SOLO_EN_BASE\|privacidad\|AR\|1\.0/m.test(ver5.salida), "la verificación lista lo que está en la base y no en el repositorio", ver5.salida);

  // Publicación retroactiva: la rechaza la Fase 1 y no queda nada a medias.
  const retro = nuevoDir();
  fs.cpSync(d, retro, { recursive: true });
  doc(retro, "terminos", "v1.2-mx.md", pub("1.2", en(-60)), "# Términos ficticios 1.2\n\nZZ_RETROACTIVA.\n");
  r = ejecutar(cli(["sql-carga", "--dir", retro, "--publicar"]).stdout);
  ok(!r.ok && /vigencia retroactiva/.test(r.error) && huella() === trasPublicar, "vigencia de hace 1 hora → rechazada; ni siquiera queda la 1.2 aprobada", r.error);
  ok(sql("select count(*) from public.documentos_legales_versiones where version = '1.2'") === "0", "la transacción entera se revirtió");

  // Base sin el esquema legal: la guarda aborta antes de tocar nada.
  const sinEsquema = `${DB}_vacia`;
  spawnSync("dropdb", ["--if-exists", sinEsquema]);
  execFileSync("createdb", [sinEsquema]);
  r = ejecutar(conPub.stdout, sinEsquema);
  ok(!r.ok && /no existe el esquema de documentos legales/.test(r.error), "base sin la migración 20261014 → aborta", r.error);
  spawnSync("dropdb", ["--if-exists", sinEsquema]);

  ok(sql("select count(*) from public.aceptaciones_legales") === "0", "cargar documentos no crea aceptaciones");
  spawnSync("dropdb", ["--if-exists", DB]);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);

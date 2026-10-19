#!/usr/bin/env node
/**
 * documentos-legales.mjs — carga y verificación de las versiones de los
 * documentos legales (legal/) contra el esquema de la Fase 1
 * (supabase/migrations/20261014000000_documentos_legales.sql).
 *
 * El repositorio es la fuente: cada archivo legal/<carpeta>/v<versión>[-mx|-ar].md
 * describe UNA versión (identificador, versión, jurisdicciones, estado,
 * vigencia, referencia de aprobación jurídica) y su texto. Este script
 * NUNCA se conecta a una base: genera SQL para revisarlo y ejecutarlo a
 * mano en el SQL Editor del proyecto que corresponda.
 *
 *   node scripts/legal/documentos-legales.mjs validar [--dir legal]
 *   node scripts/legal/documentos-legales.mjs sql-carga [--dir legal] [--publicar] [--salida archivo.sql]
 *   node scripts/legal/documentos-legales.mjs sql-verificar [--dir legal] [--salida archivo.sql]
 *
 * Reglas:
 *   * Los borradores se quedan en el repositorio: no se cargan.
 *   * Sin --publicar, la carga llega como mucho a "aprobado" (nada queda
 *     visible en las páginas). Publicar o retirar exige --publicar.
 *   * Idempotente: una versión que ya está en la base con el MISMO hash
 *     solo avanza de estado; con OTRO hash, la carga aborta sin tocar
 *     nada (una versión aprobada o publicada no se corrige: se crea otra).
 *   * Todo el script de carga es una transacción: o se aplica entero o nada.
 * Sin dependencias (solo Node).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Carpeta de legal/ → clave en documentos_legales. */
export const CARPETAS = { terminos: "terminos", privacidad: "privacidad", dpa: "acuerdo_tratamiento" };
export const PAISES = ["MX", "AR"];
export const ESTADOS = ["borrador", "aprobado", "publicado", "retirado"];
const CAMPOS = ["identificador", "version", "jurisdicciones", "estado", "vigente_desde", "aprobacion", "requiere_nueva_aceptacion", "resumen_cambios"];
const ORDEN_ESTADO = { borrador: 0, aprobado: 1, publicado: 2, retirado: 3 };
/**
 * Marcadores de texto incompleto: ninguna versión aprobada o publicada puede llevarlos.
 * Corchetes: cualquier [texto] que no sea el texto de un enlace [texto](url) —
 * [NOMBRE LEGAL DEL PRESTADOR], [DOMICILIO LEGAL], [PENDIENTE: …], [Razón social], […] —.
 * Se admiten solo las llamadas numéricas [1] y [sic]: el resto se mostraría tal cual en la página.
 */
const MARCADORES_PENDIENTES = [/\[(?![0-9]{1,3}\]|sic\])[^\[\]\n]+\](?!\()/gi, /\{\{[^\n]*?(?:\}\}|$)/gm, /<<[^\n]*?>>/g, /\bTODO\b/g, /\bTBD\b/g, /_{4,}/g];

/** Los marcadores pendientes de un texto (como aparecen, sin repetir), en orden de aparición. */
export function marcadoresPendientes(texto) {
  const encontrados = [];
  for (const re of MARCADORES_PENDIENTES) for (const m of String(texto ?? "").matchAll(re)) encontrados.push([m.index, m[0].trim()]);
  return [...new Set(encontrados.sort((a, b) => a[0] - b[0]).map(([, t]) => t))];
}
const RE_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

export function sha256Hex(texto) {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** El texto exactamente como se guarda (y se hashea): LF, sin espacios al final de línea ni líneas en blanco al principio, un salto final. */
export function normalizarContenido(cuerpo) {
  const lineas = cuerpo.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lineas.length && lineas[0] === "") lineas.shift();
  while (lineas.length && lineas[lineas.length - 1] === "") lineas.pop();
  return lineas.length ? lineas.join("\n") + "\n" : "";
}

function valorEscalar(crudo) {
  const v = crudo.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/** Separa la cabecera (--- clave: valor ---) del cuerpo. Sin YAML completo: solo "clave: valor" por línea. */
export function separarCabecera(texto) {
  const t = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!t.startsWith("---\n")) throw new Error("falta la cabecera (el archivo debe empezar con ---)");
  const fin = t.indexOf("\n---\n", 4);
  if (fin < 0) throw new Error("la cabecera no se cierra con ---");
  const cabecera = {};
  for (const [i, linea] of t.slice(4, fin).split("\n").entries()) {
    if (!linea.trim() || linea.trim().startsWith("#")) continue;
    const m = /^([a-z_]+):(.*)$/.exec(linea);
    if (!m) throw new Error(`cabecera, línea ${i + 2}: se esperaba "clave: valor"`);
    if (m[1] in cabecera) throw new Error(`cabecera: "${m[1]}" repetida`);
    cabecera[m[1]] = valorEscalar(m[2].replace(/\s+#.*$/, ""));
  }
  return { cabecera, cuerpo: t.slice(fin + 5) };
}

/** Valida un archivo y devuelve sus versiones (una por jurisdicción) o lanza con todos los errores. */
export function leerArchivo(ruta, carpeta, ahora = new Date()) {
  const errores = [];
  const avisos = [];
  let cabecera;
  let cuerpo;
  try {
    ({ cabecera, cuerpo } = separarCabecera(readFileSync(ruta, "utf8")));
  } catch (e) {
    throw new Error(`${ruta}: ${e.message}`);
  }
  for (const k of Object.keys(cabecera)) if (!CAMPOS.includes(k)) errores.push(`campo desconocido "${k}"`);
  const clave = CARPETAS[carpeta];
  const { identificador, version, estado, vigente_desde: vigente, aprobacion } = cabecera;
  if (identificador !== clave) errores.push(`identificador "${identificador ?? ""}" no corresponde a la carpeta ${carpeta}/ (debe ser "${clave}")`);
  if (typeof version !== "string" || !/^[0-9]{1,3}\.[0-9]{1,3}$/.test(version)) errores.push(`version "${version ?? ""}" no válida (formato N.N, p. ej. "1.0")`);
  const jurisdicciones = Array.isArray(cabecera.jurisdicciones) ? cabecera.jurisdicciones.map((j) => j.toUpperCase()) : null;
  if (!jurisdicciones || jurisdicciones.length === 0 || jurisdicciones.some((j) => !PAISES.includes(j)) || new Set(jurisdicciones).size !== jurisdicciones.length) {
    errores.push(`jurisdicciones debe ser una lista sin repetidos de ${PAISES.join(", ")} (p. ej. [MX] o [MX, AR])`);
  }
  if (!ESTADOS.includes(estado)) errores.push(`estado "${estado ?? ""}" no válido (${ESTADOS.join(", ")})`);
  const requiere = cabecera.requiere_nueva_aceptacion ?? true;
  if (typeof requiere !== "boolean") errores.push("requiere_nueva_aceptacion debe ser true o false");
  const resumen = cabecera.resumen_cambios ?? null;
  if (resumen !== null && typeof resumen !== "string") errores.push("resumen_cambios debe ser texto");
  let vigenteDesde = null;
  if (vigente !== undefined && vigente !== "") {
    if (typeof vigente !== "string" || !RE_FECHA.test(vigente) || Number.isNaN(Date.parse(vigente))) {
      errores.push(`vigente_desde "${vigente}" no válida: fecha y hora con zona, p. ej. 2026-11-01T00:00:00-06:00`);
    } else {
      vigenteDesde = new Date(vigente).toISOString();
    }
  }
  const avanzado = ORDEN_ESTADO[estado] >= ORDEN_ESTADO.aprobado;
  if (avanzado && !(typeof aprobacion === "string" && aprobacion.trim())) errores.push(`estado ${estado} exige "aprobacion" (referencia de la aprobación jurídica)`);
  if (ORDEN_ESTADO[estado] >= ORDEN_ESTADO.publicado && !vigenteDesde) errores.push(`estado ${estado} exige vigente_desde`);
  if (estado === "publicado" && vigenteDesde && new Date(vigenteDesde) < ahora) {
    avisos.push(`vigente_desde ya pasó: si la versión todavía no está publicada en la base, la publicación será rechazada (no se publica con vigencia retroactiva)`);
  }
  const contenido = normalizarContenido(cuerpo ?? "");
  if (!contenido.trim()) errores.push("el contenido está vacío");
  if (avanzado) {
    const pendientes = marcadoresPendientes(contenido);
    if (pendientes.length) errores.push(`el contenido tiene marcadores de texto pendiente y el estado es ${estado}: ${pendientes.slice(0, 5).join(", ")}${pendientes.length > 5 ? ` (y ${pendientes.length - 5} más)` : ""}`);
    for (const [campo, valor] of [["aprobacion", aprobacion], ["resumen_cambios", resumen]]) {
      const enCampo = typeof valor === "string" ? marcadoresPendientes(valor) : [];
      if (enCampo.length) errores.push(`${campo} tiene marcadores de texto pendiente y el estado es ${estado}: ${enCampo.join(", ")}`);
    }
  }
  // Nombre: v<versión>.md, o v<versión>-mx.md / -ar.md si aplica a un solo país.
  const nombre = basename(ruta);
  const m = /^v([0-9]{1,3}\.[0-9]{1,3})(?:-(mx|ar))?\.md$/.exec(nombre);
  if (!m) errores.push(`nombre "${nombre}" no válido: v<versión>.md o v<versión>-mx.md / -ar.md`);
  else {
    if (m[1] !== version) errores.push(`el nombre dice versión ${m[1]} y la cabecera ${version}`);
    if (m[2] && !(jurisdicciones?.length === 1 && jurisdicciones[0] === m[2].toUpperCase())) errores.push(`el sufijo -${m[2]} exige jurisdicciones [${m[2].toUpperCase()}]`);
  }
  if (errores.length) throw new Error(`${ruta}:\n  - ${errores.join("\n  - ")}`);
  const sha = sha256Hex(contenido);
  return {
    avisos: avisos.map((a) => `${ruta}: ${a}`),
    versiones: jurisdicciones.map((pais) => ({
      archivo: ruta, clave, version, pais, estado, vigenteDesde, aprobacion: avanzado ? aprobacion.trim() : null,
      requiereNuevaAceptacion: requiere, resumenCambios: resumen, contenido, sha256: sha,
    })),
  };
}

/** Lee legal/: todas las versiones, validadas entre sí (sin duplicados ni vigencias desordenadas). */
export function leerDocumentos(dir, ahora = new Date()) {
  const errores = [];
  const avisos = [];
  const versiones = [];
  for (const carpeta of Object.keys(CARPETAS)) {
    const ruta = join(dir, carpeta);
    if (!existsSync(ruta)) continue;
    for (const nombre of readdirSync(ruta).sort()) {
      if (!nombre.endsWith(".md") || nombre.toLowerCase() === "readme.md") continue;
      try {
        const r = leerArchivo(join(ruta, nombre), carpeta, ahora);
        versiones.push(...r.versiones);
        avisos.push(...r.avisos);
      } catch (e) {
        errores.push(e.message);
      }
    }
  }
  const vistas = new Map();
  for (const v of versiones) {
    const k = `${v.clave}|${v.pais}|${v.version}`;
    if (vistas.has(k)) errores.push(`${v.clave} ${v.version} (${v.pais}) aparece dos veces: ${vistas.get(k)} y ${v.archivo}`);
    else vistas.set(k, v.archivo);
  }
  // Mismo documento y país: las vigencias publicadas no se repiten (la Fase 1 exige que cada publicación sea posterior).
  const porDoc = new Map();
  for (const v of versiones.filter((x) => ORDEN_ESTADO[x.estado] >= ORDEN_ESTADO.publicado)) {
    const k = `${v.clave}|${v.pais}`;
    const prev = porDoc.get(k) ?? [];
    if (prev.some((p) => p.vigenteDesde === v.vigenteDesde)) errores.push(`${v.clave} (${v.pais}): dos versiones publicadas con la misma vigencia ${v.vigenteDesde}`);
    porDoc.set(k, [...prev, v]);
  }
  if (errores.length) throw new Error(errores.join("\n"));
  versiones.sort((a, b) =>
    a.clave.localeCompare(b.clave) || a.pais.localeCompare(b.pais) || (a.vigenteDesde ?? "9999").localeCompare(b.vigenteDesde ?? "9999") || a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
  return { versiones, avisos };
}

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

function etiquetaDolar(texto, base) {
  let etiqueta = `$${base}$`;
  for (let i = 0; texto.includes(etiqueta); i++) etiqueta = `$${base}_${i}$`;
  return etiqueta;
}

/** SQL de carga (una transacción) para el SQL Editor. */
export function generarSqlCarga(versiones, { publicar = false, origen = "legal/" } = {}) {
  const cargables = versiones.filter((v) => v.estado !== "borrador");
  const omitidas = versiones.length - cargables.length;
  const partes = [
    `-- ============================================================`,
    `-- Carga de documentos legales desde ${origen} (generado por scripts/legal/documentos-legales.mjs)`,
    `-- ${cargables.length} versión(es); ${omitidas} borrador(es) omitido(s) (los borradores no se cargan).`,
    publicar
      ? `-- CON --publicar: las versiones "publicado" quedan VISIBLES en /terminos, /privacidad y /acuerdo-datos.`
      : `-- SIN --publicar: nada llega a "publicado"; las versiones quedan como mucho "aprobado" (no visibles).`,
    `-- Revisar el proyecto antes de ejecutar. Todo o nada: ante cualquier diferencia, aborta sin cambios.`,
    `-- ============================================================`,
    `begin;`,
    ``,
    `do $guarda$ begin`,
    `  if to_regclass('public.documentos_legales_versiones') is null then`,
    `    raise exception 'ABORTADO: no existe el esquema de documentos legales (migración 20261014000000)';`,
    `  end if;`,
    `end $guarda$;`,
    ``,
  ];
  for (const v of cargables) {
    const objetivo = !publicar && ORDEN_ESTADO[v.estado] > ORDEN_ESTADO.aprobado ? "aprobado" : v.estado;
    const tag = etiquetaDolar(v.contenido, `gf_${v.sha256.slice(0, 12)}`);
    partes.push(
      `-- ${v.clave} ${v.version} (${v.pais}) → ${objetivo}${objetivo !== v.estado ? ` (el archivo dice ${v.estado}; falta --publicar)` : ""} · ${v.archivo}`,
      `do $carga$`,
      `declare`,
      `  v public.documentos_legales_versiones;`,
      `  c text := ${tag}${v.contenido}${tag};`,
      `  h text := ${lit(v.sha256)};`,
      `begin`,
      `  if encode(sha256(convert_to(c, 'UTF8')), 'hex') <> h then`,
      `    raise exception 'ABORTADO: el texto de ${v.clave} ${v.version} (${v.pais}) no coincide con su hash (script alterado)';`,
      `  end if;`,
      `  select * into v from public.documentos_legales_versiones x`,
      `   where x.documento_clave = ${lit(v.clave)} and x.jurisdiccion = ${lit(v.pais)} and x.version = ${lit(v.version)};`,
      `  if not found then`,
      `    insert into public.documentos_legales_versiones (documento_clave, version, jurisdiccion, contenido, contenido_sha256, requiere_nueva_aceptacion, resumen_cambios)`,
      `    values (${lit(v.clave)}, ${lit(v.version)}, ${lit(v.pais)}, c, h, ${v.requiereNuevaAceptacion}, ${lit(v.resumenCambios)})`,
      `    returning * into v;`,
      `  elsif v.contenido_sha256 <> h then`,
      `    raise exception 'ABORTADO: ${v.clave} ${v.version} (${v.pais}) ya existe con OTRO texto (hash %); no se modifica: crear una versión nueva', v.contenido_sha256;`,
      `  elsif v.estado = 'borrador' and (v.requiere_nueva_aceptacion, v.resumen_cambios) is distinct from (${v.requiereNuevaAceptacion}, ${lit(v.resumenCambios)}::text) then`,
      `    update public.documentos_legales_versiones set requiere_nueva_aceptacion = ${v.requiereNuevaAceptacion}, resumen_cambios = ${lit(v.resumenCambios)} where id = v.id returning * into v;`,
      `  elsif v.estado <> 'borrador' and (v.requiere_nueva_aceptacion, v.resumen_cambios) is distinct from (${v.requiereNuevaAceptacion}, ${lit(v.resumenCambios)}::text) then`,
      `    raise exception 'ABORTADO: ${v.clave} ${v.version} (${v.pais}) en la base tiene otros metadatos (requiere_nueva_aceptacion/resumen_cambios); no se modifican';`,
      `  end if;`,
      `  if v.aprobado_por is not null and v.aprobado_por <> ${lit(v.aprobacion)} then`,
      `    raise exception 'ABORTADO: ${v.clave} ${v.version} (${v.pais}) fue aprobada con otra referencia (%)', v.aprobado_por;`,
      `  end if;`,
      `  if v.publicado_en is not null and v.vigente_desde is distinct from ${lit(v.vigenteDesde)}::timestamptz then`,
      `    raise exception 'ABORTADO: ${v.clave} ${v.version} (${v.pais}) se publicó con otra vigencia (%)', v.vigente_desde;`,
      `  end if;`,
      `  if ${ORDEN_ESTADO[v.estado]} < (case v.estado when 'borrador' then 0 when 'aprobado' then 1 when 'publicado' then 2 else 3 end) then`,
      `    raise exception 'ABORTADO: ${v.clave} ${v.version} (${v.pais}) está % en la base y el repositorio dice ${v.estado}: actualizar el repositorio', v.estado;`,
      `  end if;`,
      `  if v.estado = 'borrador' then`,
      `    update public.documentos_legales_versiones set estado = 'aprobado', aprobado_por = ${lit(v.aprobacion)} where id = v.id returning * into v;`,
      `  end if;`,
    );
    if (ORDEN_ESTADO[objetivo] >= ORDEN_ESTADO.publicado) {
      partes.push(
        `  if v.estado = 'aprobado' then`,
        `    update public.documentos_legales_versiones set estado = 'publicado', vigente_desde = ${lit(v.vigenteDesde)}::timestamptz where id = v.id returning * into v;`,
        `  end if;`,
      );
    }
    if (objetivo === "retirado") {
      partes.push(
        `  if v.estado = 'publicado' then`,
        `    update public.documentos_legales_versiones set estado = 'retirado' where id = v.id returning * into v;`,
        `  end if;`,
      );
    }
    partes.push(`end`, `$carga$;`, ``);
  }
  partes.push(`commit;`, ``, `-- Para comprobar el resultado: node scripts/legal/documentos-legales.mjs sql-verificar (solo lectura).`, ``);
  return partes.join("\n");
}

/** SQL de solo lectura: compara cada versión del repositorio con la base (y lista las publicadas que el repositorio no tiene). */
export function generarSqlVerificacion(versiones, { publicar = true } = {}) {
  const cargables = versiones.filter((v) => v.estado !== "borrador");
  const filas = cargables.map((v) => {
    const objetivo = !publicar && ORDEN_ESTADO[v.estado] > ORDEN_ESTADO.aprobado ? "aprobado" : v.estado;
    return `    (${lit(v.clave)}, ${lit(v.pais)}, ${lit(v.version)}, ${lit(objetivo)}, ${lit(v.sha256)}, ${lit(v.vigenteDesde)}::timestamptz, ${lit(v.aprobacion)})`;
  });
  const valores = filas.length ? filas.join(",\n") : `    (null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::text)`;
  return [
    `-- Verificación (solo lectura) de documentos legales: repositorio vs base. Cada fila: OK | DIFERENTE | FALTA | SOLO_EN_BASE.`,
    `with repo(clave, pais, version, estado, sha256, vigente_desde, aprobacion) as (values`,
    valores,
    `), repo_ok as (select * from repo where clave is not null)`,
    `select case`,
    `         when b.id is null then 'FALTA'`,
    `         when b.contenido_sha256 <> r.sha256 then 'DIFERENTE: texto (hash)'`,
    `         when b.estado <> r.estado then 'DIFERENTE: estado ' || b.estado || ' (repo: ' || r.estado || ')'`,
    `         when b.aprobado_por is distinct from r.aprobacion then 'DIFERENTE: referencia de aprobación'`,
    `         when b.publicado_en is not null and b.vigente_desde is distinct from r.vigente_desde then 'DIFERENTE: vigencia'`,
    `         else 'OK' end as resultado,`,
    `       r.clave, r.pais, r.version, r.estado as estado_repo, b.estado as estado_base, b.contenido_sha256 = r.sha256 as mismo_hash`,
    `from repo_ok r`,
    `left join public.documentos_legales_versiones b on b.documento_clave = r.clave and b.jurisdiccion = r.pais and b.version = r.version`,
    `union all`,
    `select 'SOLO_EN_BASE', b.documento_clave, b.jurisdiccion, b.version, null, b.estado, null`,
    `from public.documentos_legales_versiones b`,
    `where b.estado <> 'borrador' and not exists (select 1 from repo_ok r where r.clave = b.documento_clave and r.pais = b.jurisdiccion and r.version = b.version)`,
    `order by 2, 3, 4;`,
    ``,
  ].join("\n");
}

function main(argv) {
  const [modo = "validar", ...resto] = argv;
  const opcion = (n) => {
    const i = resto.indexOf(n);
    return i >= 0 ? resto[i + 1] : undefined;
  };
  const raiz = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const dir = resolve(opcion("--dir") ?? join(raiz, "legal"));
  const publicar = resto.includes("--publicar");
  const salida = opcion("--salida");
  let leido;
  try {
    leido = leerDocumentos(dir);
  } catch (e) {
    console.error(`✗ Documentos legales con errores:\n${e.message}`);
    return 1;
  }
  const { versiones, avisos } = leido;
  for (const a of avisos) console.error(`! ${a}`);
  const origen = relative(raiz, dir) || dir;
  if (modo === "validar") {
    console.log(`${versiones.length} versión(es) en ${origen}:`);
    for (const v of versiones) {
      console.log(`  ${v.clave.padEnd(20)} ${v.version.padEnd(6)} ${v.pais}  ${v.estado.padEnd(9)} ${(v.vigenteDesde ?? "—").padEnd(24)} ${v.sha256}  ${relative(raiz, v.archivo)}`);
    }
    return 0;
  }
  if (modo === "sql-carga" || modo === "sql-verificar") {
    const sql = modo === "sql-carga" ? generarSqlCarga(versiones, { publicar, origen }) : generarSqlVerificacion(versiones, { publicar });
    if (salida) {
      writeFileSync(salida, sql);
      console.error(`SQL escrito en ${salida} (${versiones.filter((v) => v.estado !== "borrador").length} versión(es)).`);
    } else {
      process.stdout.write(sql);
    }
    return 0;
  }
  console.error(`Modo desconocido: ${modo} (validar | sql-carga | sql-verificar)`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

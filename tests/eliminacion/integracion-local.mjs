#!/usr/bin/env node
// ============================================================
// Eliminación asistida de punta a punta, LOCAL y con datos SINTÉTICOS:
// el script real (scripts/eliminacion/eliminar-residencial.mjs) contra
// PostgREST real sobre un Postgres local con todas las migraciones. Las
// API de Storage y de Auth las imita un gateway local que borra en la
// base lo mismo que borraría Supabase (y puede fallar a pedido).
//
//   PGHOST=/tmp PGPORT=54329 PGUSER=postgres GF_POSTGREST_BIN=/ruta/postgrest \
//     node tests/eliminacion/integracion-local.mjs
//
// Nunca apunta a un proyecto Supabase. La base se elimina al final.
// Salida: RESULT|E-eliminacion|<caso>|PASS/FAIL|descripción.
// ============================================================
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firmarJwt, verificarJwt } from "../billing/e2e/gateway.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const SCRIPT = path.join(RAIZ, "scripts/eliminacion/eliminar-residencial.mjs");
const DB = "gf_legal_eliminacion_e2e";
const PGRST = process.env.GF_POSTGREST_BIN ?? "postgrest";
const P = { postgrest: 54941, gateway: 54942 };
const CAPA = "E-eliminacion";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gf-eliminacion-"));
let fallas = 0;

function res(caso, estado, texto) {
  if (estado === "FAIL") fallas++;
  console.log(`RESULT|${CAPA}|${caso}|${estado}|${String(texto).replace(/[|\n]/g, " ")}`);
}
const ok = (caso, cond, texto, detalle = "") => res(caso, cond ? "PASS" : "FAIL", cond || !detalle ? texto : `${texto} — ${detalle}`);
const sql = (q) => execFileSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", q], { encoding: "utf8" }).trim();

const procesos = [];
let gateway = null;
function detener() {
  for (const p of procesos) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {
      /* ya terminó */
    }
  }
  gateway?.close();
}
process.on("exit", detener);

async function esperar(url, ms = 20_000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Gateway: /rest/v1 → PostgREST; Storage y Auth imitados sobre la base. */
function iniciarGateway(secreto, fallas) {
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return http
    .createServer(async (req, resp) => {
      const url = new URL(req.url, "http://x");
      const partes = [];
      for await (const c of req) partes.push(c);
      const cuerpo = Buffer.concat(partes).toString("utf8");
      const json = (estado, datos) => {
        resp.writeHead(estado, { "content-type": "application/json" });
        resp.end(JSON.stringify(datos));
      };
      const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
      const claims = verificarJwt(token, secreto);
      if (!claims || claims.role !== "service_role" || req.headers.apikey !== token) return json(401, { message: "clave inválida" });
      if (url.pathname.startsWith("/rest/v1/")) {
        const r = await fetch(`http://127.0.0.1:${P.postgrest}${url.pathname.slice("/rest/v1".length)}${url.search}`, {
          method: req.method,
          headers: { authorization: req.headers.authorization, "content-type": "application/json" },
          body: req.method === "GET" ? undefined : cuerpo,
        });
        resp.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
        return resp.end(await r.text());
      }
      let m = /^\/storage\/v1\/object\/([a-z0-9_-]+)$/.exec(url.pathname);
      if (m && req.method === "DELETE") {
        if (fallas.storage) return json(500, { error: "internal", message: "storage no disponible (simulado)" });
        const nombres = JSON.parse(cuerpo).prefixes ?? [];
        if (!nombres.length) return json(200, []);
        const borrados = sql(`with d as (delete from storage.objects where bucket_id = ${lit(m[1])} and name in (${nombres.map(lit).join(",")}) returning name) select count(*) from d`);
        return json(200, Array.from({ length: Number(borrados) }, () => ({})));
      }
      m = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (m && req.method === "DELETE") {
        if (fallas.auth) return json(500, { msg: "Database error deleting user" });
        const n = sql(`with d as (delete from auth.users where id = ${lit(m[1])} returning id) select count(*) from d`);
        return n === "1" ? json(200, {}) : json(404, { msg: "User not found" });
      }
      json(404, { message: "ruta no imitada" });
    })
    .listen(P.gateway, "127.0.0.1");
}

/** Corre el script como lo haría quien opera; `entrada` = lo que escribe. */
function correr(args, { clave, entrada = "" }) {
  return new Promise((resolver) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, GF_ELIMINACION_SUPABASE_URL: `http://127.0.0.1:${P.gateway}`, GF_ELIMINACION_SERVICE_ROLE_KEY: clave, GF_ELIMINACION_LOCAL: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.stderr.on("data", (d) => (salida += d));
    p.stdin.end(entrada);
    p.on("close", (codigo) => resolver({ codigo, salida }));
  });
}

const codigoDe = (salida) => /Código: ([0-9A-F]{10})/.exec(salida)?.[1];
const idDe = (salida) => /Registro de la operación: ([0-9a-f-]{36})/.exec(salida)?.[1];

async function main() {
  const inicio = Date.now();
  execFileSync("bash", [path.join(RAIZ, "tests/legal/construir-base.sh"), DB], { stdio: ["ignore", "ignore", "inherit"] });

  // Residencial vencido hace 45 días (T) y uno vecino activo (V) que comparte una cuenta.
  const T = crypto.randomUUID();
  const V = crypto.randomUUID();
  const u = { admin: crypto.randomUUID(), guardia: crypto.randomUUID(), compartida: crypto.randomUUID(), vecino: crypto.randomUUID() };
  const correo = (k) => `zz_autotest_eliminacion_${k}@gateflow.invalid`;
  sql(`insert into public.empresas (id, nombre) values ('${T}', 'ZZ Empresa Eliminable'), ('${V}', 'ZZ Empresa Vecina')`);
  sql(`insert into public.tenants (id, nombre, tipo, pais, empresa_id) values ('${T}', 'ZZ Residencial Eliminable', 'residencial', 'MX', '${T}'), ('${V}', 'ZZ Residencial Vecino', 'residencial', 'MX', '${V}')`);
  sql(`insert into public.suscripciones (tenant_id, estado, trial_started_at, trial_ends_at, origen) values
       ('${T}', 'trialing', now() - interval '75 days', now() - interval '45 days', 'registro_publico'),
       ('${V}', 'trialing', now() - interval '5 days', now() + interval '25 days', 'registro_publico')`);
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", "set role supabase_auth_admin", "-c",
    `insert into auth.users (id, email) values ${Object.entries(u).map(([k, id]) => `('${id}', '${correo(k)}')`).join(", ")}`]);
  sql(`insert into public.user_tenants (user_id, tenant_id, rol_id) select x.u, x.t, (select id from public.roles where clave = x.r) from (values
       ('${u.admin}'::uuid, '${T}'::uuid, 'admin_residencial'), ('${u.guardia}'::uuid, '${T}'::uuid, 'guardia'),
       ('${u.compartida}'::uuid, '${T}'::uuid, 'guardia'), ('${u.compartida}'::uuid, '${V}'::uuid, 'guardia'),
       ('${u.vecino}'::uuid, '${V}'::uuid, 'admin_residencial')) x(u, t, r)`);
  const unidad = sql(`insert into public.unidades (tenant_id, tipo, identificador) values ('${T}', 'casa', 'ZZ Casa 1') returning id`);
  const unidadV = sql(`insert into public.unidades (tenant_id, tipo, identificador) values ('${V}', 'casa', 'ZZ Casa V') returning id`);
  const paq = sql(`insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('${T}', '${unidad}', '${u.guardia}') returning id`);
  sql(`insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('${V}', '${unidadV}', '${u.compartida}')`);
  sql(`insert into storage.objects (bucket_id, name) values ('evidencia', '${T}/${paq}/a.jpg'), ('evidencia', '${T}/${paq}/b.jpg'), ('logos', '${T}/logo.png'), ('evidencia', '${V}/x/c.jpg')`);
  const huellaVecino = () => sql(`select concat_ws('|', (select count(*) from public.paquetes where tenant_id = '${V}'), (select count(*) from public.user_tenants where tenant_id = '${V}'),
       (select count(*) from storage.objects where name like '${V}/%'), (select count(*) from auth.users where id in ('${u.compartida}', '${u.vecino}')), (select count(*) from public.empresas where id = '${V}'))`);
  const vecinoAntes = huellaVecino();

  // PostgREST con un JWT local y el gateway.
  const secreto = crypto.randomBytes(32).toString("hex");
  const claveDb = crypto.randomBytes(16).toString("hex");
  sql(`alter role authenticator password '${claveDb}'`);
  const log = fs.openSync(path.join(TMP, "postgrest.log"), "a");
  procesos.push(spawn(PGRST, [], {
    env: { ...process.env, PGRST_DB_URI: `postgres://authenticator:${claveDb}@127.0.0.1:${process.env.PGPORT ?? 5432}/${DB}`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: secreto, PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: String(P.postgrest), PGRST_LOG_LEVEL: "crit" },
    stdio: ["ignore", log, log], detached: true,
  }));
  if (!(await esperar(`http://127.0.0.1:${P.postgrest}/`))) return res("--", "FAIL", "PostgREST local no arrancó");
  const fallasSimuladas = { storage: false, auth: false };
  gateway = iniciarGateway(secreto, fallasSimuladas);
  const clave = firmarJwt({ role: "service_role", iss: "supabase" }, secreto);
  const todas = [];
  const run = async (args, opciones = {}) => {
    const r = await correr(args, { clave, ...opciones });
    todas.push(r.salida);
    return r;
  };

  // 1. Simulación.
  let s = await run(["simular", "--residencial", T, "--operador", "ticket-e2e"]);
  let codigo = codigoDe(s.salida);
  let id = idDe(s.salida);
  ok("01", s.codigo === 0 && codigo && id && /ZZ Residencial Eliminable/.test(s.salida) && /2 exclusivas.*1 compartidas/.test(s.salida) && /Archivos en Storage: .*evidencia=2/.test(s.salida) && /Archivos en Storage: .*logos=1/.test(s.salida),
    "simular: elegible, muestra el residencial, cuentas y archivos, y da código", s.salida.split("\n").slice(0, 3).join(" "));
  ok("02", sql(`select count(*) from public.tenants where id = '${T}'`) === "1" && sql(`select count(*) from storage.objects where name like '${T}/%'`) === "3", "simular no borra nada");
  const sv = await run(["simular", "--residencial", V, "--operador", "ticket-e2e"]);
  ok("03", sv.codigo === 2 && /NO ELEGIBLE: prueba_en_curso/.test(sv.salida) && !codigoDe(sv.salida), "el residencial vecino (en prueba) no es elegible y no recibe código");

  // 2. Confirmación: nombre equivocado.
  let e = await run(["ejecutar", "--eliminacion", id, "--codigo", codigo], { entrada: "ZZ Residencial Vecino\n" });
  ok("10", e.codigo === 2 && /No se eliminó nada: HTTP 400 22023 eliminacion_residencial: nombre_no_coincide/.test(e.salida) && sql(`select count(*) from public.tenants where id = '${T}'`) === "1",
    "nombre de otro residencial → la base rechaza, no se borra nada", e.salida);
  e = await run(["ejecutar", "--eliminacion", id, "--codigo", "0000000000"], { entrada: "ZZ Residencial Eliminable\n" });
  ok("11", e.codigo === 2 && /codigo_incorrecto/.test(e.salida), "código equivocado → rechazado");

  // 3. El cliente contrata entre la simulación y la ejecución.
  sql(`update public.suscripciones set estado = 'active', plan = 'hasta-50', provider = 'stripe', provider_subscription_id = 'sub_zz_e2e', current_period_end = now() + interval '30 days' where tenant_id = '${T}'`);
  e = await run(["ejecutar", "--eliminacion", id, "--codigo", codigo], { entrada: "ZZ Residencial Eliminable\n" });
  ok("20", e.codigo === 3 && /CANCELADA \(suscripcion_activa\): no se borró nada/.test(e.salida) && sql(`select count(*) from public.paquetes where tenant_id = '${T}'`) === "1" && sql(`select count(*) from storage.objects where name like '${T}/%'`) === "3",
    "contrató → CANCELADA, datos y archivos intactos", e.salida);
  ok("21", sql(`select estado || ':' || motivo from public.eliminaciones_residencial where id = '${id}'`) === "cancelada:suscripcion_activa", "el registro queda «cancelada» con el motivo");
  // Vuelve a vencer (el cliente canceló hace 40 días): nueva simulación obligatoria.
  sql(`update public.suscripciones set estado = 'canceled', current_period_end = now() - interval '40 days' where tenant_id = '${T}'`);
  s = await run(["simular", "--residencial", T, "--operador", "ticket-e2e"]);
  codigo = codigoDe(s.salida);
  id = idDe(s.salida);

  // 4. Storage falla a mitad: los datos de la base se borran, pero NO se informa que terminó.
  fallasSimuladas.storage = true;
  e = await run(["ejecutar", "--eliminacion", id, "--codigo", codigo], { entrada: "ZZ Residencial Eliminable\n" });
  ok("30", e.codigo === 5 && /La eliminación NO terminó/.test(e.salida) && /reanudar --eliminacion/.test(e.salida) && !/COMPLETADA/.test(e.salida), "Storage no disponible → «NO terminó» con instrucciones para reanudar", e.salida);
  ok("31", sql(`select count(*) from public.tenants where id = '${T}'`) === "0" && sql(`select estado from public.eliminaciones_residencial where id = '${id}'`) === "en_curso"
    && sql(`select count(*) from storage.objects where name like '${T}/%'`) === "3" && sql(`select count(*) from auth.users where id in ('${u.admin}', '${u.guardia}')`) === "2",
    "la base ya no tiene el residencial; el registro sigue «en_curso»; archivos y cuentas siguen pendientes (Auth espera a Storage)");

  // 5. Reanudar con Storage disponible pero Auth fallando, y después todo bien.
  fallasSimuladas.storage = false;
  fallasSimuladas.auth = true;
  e = await run(["reanudar", "--eliminacion", id]);
  ok("40", e.codigo === 5 && /Auth [0-9a-f-]{36}: HTTP 500/.test(e.salida) && !/COMPLETADA/.test(e.salida) && sql(`select count(*) from storage.objects where name like '${T}/%'`) === "0",
    "reanudar: borra los archivos; Auth falla → sigue «NO terminó»", e.salida);
  fallasSimuladas.auth = false;
  e = await run(["reanudar", "--eliminacion", id]);
  ok("41", e.codigo === 0 && /COMPLETADA/.test(e.salida) && sql(`select estado from public.eliminaciones_residencial where id = '${id}'`) === "completada", "reanudar: borra las cuentas y la base confirma «completada»", e.salida);
  ok("42", sql(`select count(*) from auth.users where id in ('${u.admin}', '${u.guardia}')`) === "0" && sql(`select count(*) from public.users where id in ('${u.admin}', '${u.guardia}')`) === "0",
    "las cuentas exclusivas ya no existen (perfil y Auth)");
  ok("43", huellaVecino() === vecinoAntes && sql(`select string_agg(tenant_id::text, ',') from public.user_tenants where user_id = '${u.compartida}'`) === V,
    "el residencial vecino no cambió; la cuenta compartida conserva solo su acceso al vecino");
  ok("44", sql(`select count(*) from public.empresas where id = '${T}'`) === "0" && sql(`select public.eliminacion_residencial_conteo('${T}') = '{}'::jsonb`) === "t", "sin restos del residencial ni de su empresa");
  e = await run(["reanudar", "--eliminacion", id]);
  ok("45", e.codigo === 0 && /COMPLETADA/.test(e.salida), "reanudar una completada es idempotente");
  const reg = sql(`select row_to_json(e)::text from public.eliminaciones_residencial e where id = '${id}'`);
  ok("46", !/@|ZZ Residencial|ZZ Empresa|zz_autotest/.test(reg) && /"operador":"ticket-e2e"/.test(reg), "el registro de la operación no guarda nombres ni correos", reg);
  const salidas = todas.join("\n");
  ok("47", !salidas.includes(clave) && !salidas.includes(secreto) && !/zz_autotest_eliminacion_/.test(salidas), "la salida del script nunca muestra la clave, el secreto ni correos");
  res("99", "PASS", `${((Date.now() - inicio) / 1000).toFixed(0)} s`);
}

main()
  .catch((e) => res("--", "FAIL", `excepción: ${e?.message ?? e}`))
  .finally(() => {
    detener();
    try {
      execFileSync("dropdb", ["--if-exists", DB], { stdio: "ignore" });
    } catch {
      /* la base local se borra en la próxima corrida */
    }
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(fallas ? `FALLAS: ${fallas}` : "OK");
    process.exit(fallas ? 1 : 0);
  });

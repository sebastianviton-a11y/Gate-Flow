// ============================================================
// Compatibilidad del despliegue de 20261009000000 a través de PostgREST.
//
// Base local desechable (gf_billing_compat) en el estado ANTERIOR a la
// migración, PostgREST real y el MISMO cliente que usa el servidor
// (supabase-js → /rest/v1 → PostgREST). Comprueba:
//   1. la llamada exacta del servidor anterior (14 claves, tomadas de
//      a877484) antes de migrar;
//   2. se aplica la migración CON PostgREST en marcha: la llamada anterior
//      sigue resolviendo con la caché vieja y tras recargarla; la nueva
//      (16 claves) necesita la recarga (NOTIFY pgrst);
//   3. una sola función (sin sobrecargas ni PGRST203), EXECUTE solo para
//      service_role (anon / authenticated → 42501);
//   4. el past_due del servidor anterior se rechaza sin registrar nada
//      (el webhook responde 500 y Stripe reintenta) y el servidor nuevo lo
//      aplica con su inicio de impago.
// Nunca toca Supabase: solo Postgres local (PGHOST local) y 127.0.0.1.
//
//   PGHOST=/tmp PGPORT=54329 PGUSER=postgres GF_POSTGREST_BIN=… node tests/billing/compat/rpc-postgrest.mjs
// Salida: RESULT|B2-compat|<escenario>|PASS/FAIL/SKIP|… para tests/billing/run.mjs.
// ============================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firmarJwt, iniciarGateway } from "../e2e/gateway.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CAPA = "B2-compat";
const DB = "gf_billing_compat";
const MIGRACION = "20261009000000_billing_impago_desde.sql";
const P = { postgrest: 3931, gateway: 3932 };
let fallos = 0;
const res = (esc, estado, caso) => {
  if (estado === "FAIL") fallos++;
  console.log(`RESULT|${CAPA}|${esc}|${estado}|${String(caso).replace(/[|\n]/g, " ")}`);
};
const ok = (esc, cond, caso, detalle = "") => res(esc, cond ? "PASS" : "FAIL", cond || !detalle ? caso : `${caso} — ${detalle}`);

const quien = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).stdout.trim();
const PGRST = process.env.GF_POSTGREST_BIN || quien("postgrest");
if (!quien("psql") || spawnSync("psql", ["-X", "-At", "-d", "postgres", "-c", "select 1"]).status !== 0) {
  res("--", "SKIP", "compatibilidad omitida: no hay Postgres local accesible");
  process.exit(0);
}
if (!PGRST || !fs.existsSync(PGRST)) {
  res("--", "SKIP", "compatibilidad omitida: falta PostgREST (GF_POSTGREST_BIN)");
  process.exit(0);
}
case_local: {
  const h = process.env.PGHOST ?? "";
  if (h && !h.startsWith("/") && !["localhost", "127.0.0.1", "::1"].includes(h)) {
    res("--", "FAIL", "rechazado: PGHOST no es local");
    process.exit(1);
  }
  break case_local;
}

const sql = (q) => execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", q], { encoding: "utf8" }).trim();
const { createClient } = createRequire(path.join(RAIZ, "packages/supabase/package.json"))("@supabase/supabase-js");

// La llamada EXACTA del servidor anterior (apps/admin/lib/billing/servidor.ts
// en a877484): estas 14 claves, en este orden.
const CLAVES_ANTERIORES = [
  "p_provider", "p_event_id", "p_tipo", "p_estado", "p_provider_checkout_id", "p_client_reference_id", "p_subscription_id",
  "p_customer_id", "p_current_period_end", "p_cancel_at_period_end", "p_version_at", "p_moneda", "p_monto", "p_intervalo",
];
const cuerpoAnterior = (id, estado, extra = {}) => ({
  p_provider: "stripe",
  p_event_id: id,
  p_tipo: estado === "past_due" ? "invoice.payment_failed" : "invoice.paid",
  p_estado: estado,
  p_provider_checkout_id: "cs_test_compat",
  p_client_reference_id: null,
  p_subscription_id: "sub_compat",
  p_customer_id: "cus_compat",
  p_current_period_end: new Date(Date.now() + 28 * 86_400_000).toISOString(),
  p_cancel_at_period_end: false,
  p_version_at: new Date().toISOString(),
  p_moneda: "MXN",
  p_monto: 49900,
  p_intervalo: "month",
  ...extra,
});

const procesos = [];
let gateway = null;
const esperar = async (url, ms) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      // 200 solo cuando PostgREST ya cargó su caché de esquema (503 PGRST002 mientras tanto).
      if ((await fetch(url)).ok) return true;
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 0. La lista de claves es la del commit anterior (si git está disponible).
  try {
    const viejo = execFileSync("git", ["show", "a877484:apps/admin/lib/billing/servidor.ts"], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const bloque = /rpc\("billing_aplicar_evento", \{([\s\S]*?)\}\);/.exec(viejo)?.[1] ?? "";
    const claves = [...bloque.matchAll(/^\s*(p_[a-z_]+):/gm)].map((m) => m[1]);
    ok("--", claves.join(",") === CLAVES_ANTERIORES.join(","), "la llamada simulada usa exactamente las 14 claves del servidor anterior (a877484)", claves.join(","));
  } catch {
    res("--", "SKIP", "git sin a877484: no se pudo confirmar la lista de claves contra el código anterior");
  }

  // 1. Base en el estado anterior + PostgREST + gateway /rest/v1.
  execFileSync("bash", [path.join(RAIZ, "tests/billing/db/construir-base.sh"), DB], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, GF_BILLING_OMITIR_MIGRACION: MIGRACION },
  });
  const secreto = crypto.randomBytes(32).toString("hex");
  const claveDb = crypto.randomBytes(16).toString("hex");
  sql(`alter role authenticator password '${claveDb}'`);
  // Residencial sintético (base desechable) ya pagado con sub_compat.
  sql(`do $$ declare e uuid; t uuid; u uuid; begin
    insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'zz_autotest+compat-admin@gateflow.invalid', '{"nombre_completo":"ZZ_AUTOTEST_compat"}') returning id into u;
    insert into public.empresas (nombre, observaciones) values ('ZZ_AUTOTEST_compat', 'gf-autotest:compat') returning id into e;
    insert into public.tenants (nombre, tipo, timezone, plan, estado_servicio, onboarding_completado, empresa_id, observaciones)
      values ('ZZ_AUTOTEST_compat', 'residencial', 'America/Mexico_City', 'trial', 'activo', true, e, 'gf-autotest:compat') returning id into t;
    insert into public.suscripciones (tenant_id, estado, origen, viviendas_declaradas, plan, provider, provider_customer_id, provider_subscription_id, current_period_end)
      values (t, 'active', 'registro_publico', 10, 'hasta-50', 'stripe', 'cus_compat', 'sub_compat', now() + interval '2 days');
    -- El checkout que originó la suscripción (pasar a active lo exige).
    insert into public.billing_checkouts (tenant_id, user_id, plan, provider, moneda, monto, provider_checkout_id, provider_subscription_id, estado, expires_at)
      values (t, u, 'hasta-50', 'stripe', 'MXN', 49900, 'cs_test_compat', 'sub_compat', 'completed', now() - interval '1 day');
  end $$`);
  const pgrst = spawn(PGRST, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${claveDb}@127.0.0.1:${process.env.PGPORT ?? 5432}/${DB}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: secreto,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(P.postgrest),
      PGRST_LOG_LEVEL: "crit",
    },
    stdio: "ignore",
  });
  procesos.push(pgrst);
  if (!(await esperar(`http://127.0.0.1:${P.postgrest}/`, 20_000))) {
    res("--", "FAIL", "PostgREST local no arrancó");
    return;
  }
  gateway = await iniciarGateway({ puerto: P.gateway, postgrest: `http://127.0.0.1:${P.postgrest}`, secreto });
  const URL_REST = `http://127.0.0.1:${P.gateway}`;
  const cliente = (rol) => {
    const jwt = firmarJwt({ role: rol, iss: "gf-autotest" }, secreto);
    return createClient(URL_REST, jwt, { auth: { persistSession: false, autoRefreshToken: false } });
  };
  const servicio = cliente("service_role");
  const rpc = (c, cuerpo) => c.rpc("billing_aplicar_evento", cuerpo);
  const estado = () => sql(`select estado || '/' || coalesce(to_char(impago_desde at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), 'null') from public.suscripciones where provider_subscription_id = 'sub_compat'`);
  const codigos = [];

  // 2. Antes de migrar (referencia).
  let r = await rpc(servicio, cuerpoAnterior("evt_compat_pre", "active"));
  ok("--", r.status === 200 && r.data?.resultado === "aplicado", "antes de migrar: la llamada del servidor anterior funciona (referencia)", `${r.status} ${JSON.stringify(r.error ?? r.data)}`);

  // 3. Migración aplicada con PostgREST en marcha, SIN recargar su caché.
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", path.join(RAIZ, "supabase/migrations", MIGRACION)], { stdio: ["ignore", "ignore", "pipe"] });
  r = await rpc(servicio, cuerpoAnterior("evt_compat_cache", "active"));
  codigos.push(r.error?.code);
  ok("10", r.status === 200 && r.data?.resultado === "aplicado", "migrado, caché de PostgREST SIN recargar: la llamada anterior (active) resuelve y se aplica", `${r.status} ${JSON.stringify(r.error ?? r.data)}`);
  const inicio = new Date(Date.now() - 2 * 86_400_000);
  inicio.setMilliseconds(0);
  const cuerpoNuevo = (id) => cuerpoAnterior(id, "past_due", { p_impago_desde: inicio.toISOString(), p_estado_proveedor: "past_due" });
  r = await rpc(servicio, cuerpoNuevo("evt_compat_nuevo_sin_recarga"));
  codigos.push(r.error?.code);
  console.log(`INFO|${CAPA}|10|servidor NUEVO con la caché vieja: HTTP ${r.status} ${r.error?.code ?? r.data?.resultado ?? ""}`);
  ok("10", r.status !== 200 || r.data?.resultado === "aplicado", "servidor nuevo antes de recargar la caché: o falla sin escribir (PGRST202 → 500 → Stripe reintenta) o se aplica completo", `${r.status}`);
  if (r.status !== 200) {
    ok("10", sql(`select count(*) from public.billing_eventos where provider_event_id = 'evt_compat_nuevo_sin_recarga'`) === "0", "ese intento fallido no registró el evento (el reintento se aplicará)");
  }

  // 4. Recarga de la caché (Supabase lo hace con su event trigger; aquí, explícito).
  sql(`notify pgrst, 'reload schema'`);
  await dormir(1500);

  ok("--", sql(`select count(*) || '/' || max(pronargs) || '/' || max(pronargdefaults) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'billing_aplicar_evento'`) === "1/16/2",
    "una sola función billing_aplicar_evento (16 argumentos, 2 opcionales): sin sobrecargas");
  ok("--", sql(`select string_agg(r || ':' || has_function_privilege(r, p.oid, 'execute'), ',' order by r) from pg_proc p, unnest(array['anon','authenticated','public','service_role']) r where p.pronamespace = 'public'::regnamespace and p.proname = 'billing_aplicar_evento'`)
    === "anon:false,authenticated:false,public:false,service_role:true", "EXECUTE solo para service_role (ni anon, ni authenticated, ni PUBLIC)");

  r = await rpc(servicio, cuerpoAnterior("evt_compat_activo", "active"));
  codigos.push(r.error?.code);
  ok("10", r.status === 200 && r.data?.resultado === "aplicado", "caché recargada: la llamada EXACTA del servidor anterior (14 claves) resuelve y se aplica", `${r.status} ${JSON.stringify(r.error ?? r.data)}`);
  for (const [rol, desc] of [["anon", "anon"], ["authenticated", "authenticated"]]) {
    r = await rpc(cliente(rol), cuerpoAnterior(`evt_compat_${rol}`, "active"));
    codigos.push(r.error?.code);
    ok("--", (r.status === 401 || r.status === 403) && r.error?.code === "42501", `${desc} no puede ejecutar la RPC (42501)`, `${r.status} ${r.error?.code}`);
  }

  // 5. past_due del servidor anterior: rechazado sin escribir; el nuevo lo aplica.
  const antes = estado();
  r = await rpc(servicio, cuerpoAnterior("evt_compat_pd_viejo", "past_due"));
  codigos.push(r.error?.code);
  ok("10", r.status >= 400 && /billing:estado_proveedor_requerido/.test(r.error?.message ?? ""),
    "servidor anterior + past_due: error (el webhook responde 500 y Stripe reintenta), nunca un past_due sin gracia", `${r.status} ${r.error?.message}`);
  ok("10", estado() === antes && sql(`select count(*) from public.billing_eventos where provider_event_id = 'evt_compat_pd_viejo'`) === "0",
    "ese past_due no registró el evento ni cambió la suscripción (sigue active, operativa)", estado());
  r = await rpc(servicio, cuerpoNuevo("evt_compat_pd_viejo"));
  codigos.push(r.error?.code);
  ok("10", r.status === 200 && r.data?.resultado === "aplicado" && estado() === `past_due/${inicio.toISOString().slice(0, 19)}`,
    "el reintento del MISMO evento con el servidor nuevo se aplica con su inicio de impago", `${r.status} ${estado()}`);
  ok("--", !codigos.includes("PGRST203"), "ninguna respuesta de PostgREST por ambigüedad de sobrecarga (PGRST203)", codigos.filter(Boolean).join(","));
}

try {
  await main();
} catch (e) {
  res("--", "FAIL", `error: ${String(e?.message ?? e).slice(0, 200)}`);
} finally {
  for (const p of procesos) p.kill("SIGTERM");
  await new Promise((r) => (gateway ? gateway.close(() => r()) : r()));
  await dormir(300);
  spawnSync("dropdb", ["--if-exists", DB]);
  console.log(`FIXTURES|${CAPA}|run=${DB}|creados=1|eliminados=1|residuos=0`);
}
process.exit(fallos ? 1 : 0);

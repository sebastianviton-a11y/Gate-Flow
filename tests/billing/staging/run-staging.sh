#!/usr/bin/env bash
# ============================================================
# Batería billing — capa C contra STAGING. OPT-IN y manual: nunca corre
# en CI ni por accidente.
#
#   GF_BILLING_E2E_STAGING=1 \
#   GF_STAGING_DB_URL='postgresql://…sfuckzzqejerrifuypby…' \
#   tests/billing/staging/run-staging.sh
#
# Opcionales (comprobaciones HTTP):
#   GF_STAGING_ADMIN_URL  (por defecto https://staging--gateflow-admin-staging.netlify.app)
#   GF_STAGING_GUARD_URL  (por defecto https://staging--gateflow-guard-staging.netlify.app)
#   GF_STAGING_HTTP=0     omite las comprobaciones HTTP
#
# Qué hace:
#   1. Verifica el destino: la URL debe contener el ref de staging y NO
#      el de producción; nunca se imprime (lleva contraseña).
#   2. Hash de las tablas que toca (antes).
#   3. tests/billing/db/escenarios.sql ESCRIBE EN STAGING dentro de UNA
#      transacción: crea fixtures ZZ_AUTOTEST_ (empresa, tenants, usuarios
#      en auth.users/public.users, membresías, suscripciones, unidades,
#      checkouts, eventos y auditoría), ejecuta los escenarios 1–20 y el
#      teardown por ids, y termina con una excepción → ROLLBACK de todo.
#      Durante la transacción solo se bloquean filas sintéticas; el
#      rollback no devuelve WAL/estadísticas (no se consumen secuencias).
#   4. Hash (después) = antes y 0 filas ZZ_AUTOTEST_: prueba de que nada
#      quedó confirmado.
#   5. HTTP: webhook con firma inválida → 401 (no 503) sin escrituras en
#      billing_eventos; rutas protegidas → /login; Guard /servicio-inactivo
#      pública. Si alguna escribiera, el paso 4 fallaría.
#   No llama a la API de Stripe, no crea checkouts en Stripe, no envía correos.
# Salida: líneas RESULT|C-staging|… para tests/billing/run.mjs.
# ============================================================
set -uo pipefail

CAPA="C-staging"
DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../../.." && pwd)"
REF_STAGING="sfuckzzqejerrifuypby"
REF_PRODUCCION="xlozkpygubyiuxopmdxw"

res() { echo "RESULT|$CAPA|$1|$2|$3"; }

if [[ "${GF_BILLING_E2E_STAGING:-}" != "1" ]]; then
  res "--" SKIP "staging no habilitado (GF_BILLING_E2E_STAGING=1 para ejecutarlo a mano)"
  exit 0
fi
if [[ "${CI:-}" == "true" && ! ( "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" && "${GF_BILLING_CONFIRMACION:-}" == "staging" ) ]]; then
  res "--" FAIL "rechazado: en CI solo corre desde el workflow manual con confirmación explícita"
  exit 2
fi
URL="${GF_STAGING_DB_URL:-}"
if [[ -z "$URL" ]]; then
  res "--" FAIL "falta GF_STAGING_DB_URL"
  exit 1
fi
# Producción: rechazada en cualquier variable que pudiera usarse.
for v in "$URL" "${PGHOST:-}" "${DATABASE_URL:-}" "${PGDATABASE:-}" "${GF_STAGING_ADMIN_URL:-}" "${GF_STAGING_GUARD_URL:-}"; do
  if [[ "$v" == *"$REF_PRODUCCION"* || "$v" == *gateflow.mx* ]]; then
    res "--" FAIL "RECHAZADO: el entorno apunta a PRODUCCIÓN"
    exit 2
  fi
done
if [[ "$URL" != *"$REF_STAGING"* ]]; then
  res "--" FAIL "RECHAZADO: GF_STAGING_DB_URL no es el proyecto de staging"
  exit 2
fi
command -v psql >/dev/null || { res "--" FAIL "psql no está instalado"; exit 1; }

q() { PGCONNECT_TIMEOUT=15 psql "$URL" -X -A -t -q -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null; }

HASH_SQL="select md5(concat_ws('#',
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.tenants t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.suscripciones t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.user_tenants t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.users t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.empresas t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.unidades t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.calles t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.billing_checkouts t),
 (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.billing_eventos t),
 (select count(*)::text || ':' || coalesce(max(created_at)::text,'-') from public.audit_log),
 (select count(*)::text || ':' || coalesce(max(created_at)::text,'-') from auth.users)))"
ZZ_SQL="select (select count(*) from public.tenants where nombre like 'ZZ\_AUTOTEST\_%')
 + (select count(*) from public.empresas where nombre like 'ZZ\_AUTOTEST\_%')
 + (select count(*) from auth.users where email like 'zz\_autotest+%')
 + (select count(*) from public.billing_eventos where provider_event_id like 'evt\_ZZ\_AUTOTEST\_%')"

ANTES="$(q "$HASH_SQL")"
if [[ -z "$ANTES" ]]; then
  res "--" FAIL "no se pudo conectar a staging (o falta permiso de lectura)"
  exit 1
fi
EVENTOS_ANTES="$(q "select count(*) from public.billing_eventos")"

# El paquete exige 20261009000000 (impago_desde y la RPC de 15 argumentos).
# Sin ella no se ejecuta nada (ni siquiera la transacción revertida).
IMPAGO="$(q "select (to_regprocedure('public.billing_aplicar_evento(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,text,bigint,text,timestamptz)') is not null
               and exists (select 1 from pg_attribute where attrelid = 'public.suscripciones'::regclass and attname = 'impago_desde' and not attisdropped))::text")"
if [[ "$IMPAGO" != "true" ]]; then
  res "10" FAIL "staging sin 20261009000000_billing_impago_desde: la gracia de past_due sigue midiéndose desde current_period_end; el paquete no se ejecuta"
  exit 1
fi

# 3. Paquete SQL (siempre revertido).
SALIDA="$(mktemp)"
trap 'rm -f "$SALIDA"' EXIT
PGCONNECT_TIMEOUT=15 psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$RAIZ/tests/billing/db/escenarios.sql" >"$SALIDA" 2>&1
node "$RAIZ/tests/billing/lib/paquete-a-resultados.mjs" "$CAPA" <"$SALIDA"
FALLO_PAQUETE=$?

# 4. Nada confirmado.
DESPUES="$(q "$HASH_SQL")"
ZZ="$(q "$ZZ_SQL")"
[[ "$ANTES" == "$DESPUES" ]] && res 20 PASS "staging idéntico tras la corrida (hash de 11 tablas, ${ANTES:0:8})" || res 20 FAIL "staging cambió: ${ANTES:0:8} → ${DESPUES:0:8}"
[[ "$ZZ" == "0" ]] && res 20 PASS "0 filas ZZ_AUTOTEST_ en staging" || res 20 FAIL "quedaron $ZZ filas ZZ_AUTOTEST_ en staging"

# 5. HTTP (no deben escribir; billing_eventos se cuenta antes y después).
FALLO_HTTP=0
if [[ "${GF_STAGING_HTTP:-1}" != "0" ]]; then
  ADMIN="${GF_STAGING_ADMIN_URL:-https://staging--gateflow-admin-staging.netlify.app}"
  GUARD="${GF_STAGING_GUARD_URL:-https://staging--gateflow-guard-staging.netlify.app}"
  http() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$@"; }
  CUERPO='{"id":"evt_ZZ_AUTOTEST_firma","type":"checkout.session.completed","data":{"object":{"id":"cs_test_ZZ_AUTOTEST"}}}'
  R="$(http -X POST -H 'content-type: application/json' -H "stripe-signature: t=$(date +%s),v1=$(printf '0%.0s' {1..64})" --data "$CUERPO" "$ADMIN/api/billing/webhook/stripe")"
  [[ "${R%% *}" == "401" ]] && res 14 PASS "webhook con firma inválida → 401" || { res 14 FAIL "webhook con firma inválida → ${R%% *} (esperado 401; 503 = billing sin configurar)"; FALLO_HTTP=1; }
  R="$(http -X POST -H 'content-type: application/json' --data "$CUERPO" "$ADMIN/api/billing/webhook/stripe")"
  [[ "${R%% *}" == "401" ]] && res 14 PASS "webhook sin cabecera de firma → 401" || { res 14 FAIL "webhook sin firma → ${R%% *}"; FALLO_HTTP=1; }
  [[ "$(q "select count(*) from public.billing_eventos")" == "$EVENTOS_ANTES" ]] && res 14 PASS "firma inválida: 0 escrituras en billing_eventos" || { res 14 FAIL "billing_eventos cambió tras firmas inválidas"; FALLO_HTTP=1; }
  for ruta in /dashboard /suscripcion; do
    R="$(http "$ADMIN$ruta")"
    [[ "${R%% *}" =~ ^30[278]$ && "$R" == *"/login"* ]] && res 17 PASS "Admin $ruta sin sesión → /login" || { res 17 FAIL "Admin $ruta sin sesión → $R"; FALLO_HTTP=1; }
  done
  R="$(http "$GUARD/guard")"
  [[ "${R%% *}" =~ ^30[278]$ && "$R" == *"/login"* ]] && res 17 PASS "Guard /guard sin sesión → /login" || { res 17 FAIL "Guard /guard sin sesión → $R"; FALLO_HTTP=1; }
  R="$(http "$GUARD/servicio-inactivo")"
  [[ "${R%% *}" == "200" ]] && res 02 PASS "Guard /servicio-inactivo es pública (200)" || { res 02 FAIL "Guard /servicio-inactivo → $R"; FALLO_HTTP=1; }
else
  res "--" SKIP "comprobaciones HTTP omitidas (GF_STAGING_HTTP=0)"
fi

[[ "$FALLO_PAQUETE" == "0" && "$FALLO_HTTP" == "0" && "$ANTES" == "$DESPUES" && "$ZZ" == "0" ]] || exit 1

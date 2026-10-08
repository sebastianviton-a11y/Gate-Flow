#!/usr/bin/env bash
# ============================================================
# Base LOCAL y desechable para el recorrido de prueba gratuita con el
# servidor de Auth REAL de Supabase (GoTrue): sus propias migraciones
# crean el esquema auth (en vez del stub), y encima se aplican TODAS las
# migraciones del repo + seed. Nunca apunta a un proyecto Supabase.
#
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres \
#   GF_GOTRUE_BIN=… GF_GOTRUE_MIGRACIONES=… GF_AUTH_DB_PASSWORD=… \
#   tests/recorrido/construir-base-auth.sh gf_recorrido_e2e
# La base debe llamarse gf_recorrido_* (se borra y se recrea).
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../.." && pwd)"
SUPA="$RAIZ/supabase"
DB="${1:?base}"
: "${GF_GOTRUE_BIN:?falta GF_GOTRUE_BIN}" "${GF_GOTRUE_MIGRACIONES:?falta GF_GOTRUE_MIGRACIONES}" "${GF_AUTH_DB_PASSWORD:?falta GF_AUTH_DB_PASSWORD}"

case "$DB" in gf_recorrido_*) ;; *) echo "Rechazado: la base local debe llamarse gf_recorrido_* (recibido: $DB)" >&2; exit 2 ;; esac
for v in "${PGHOST:-}" "${DATABASE_URL:-}" "${PGDATABASE:-}"; do
  if [[ "$v" == *supabase* || "$v" == *pooler* ]]; then echo "Rechazado: el entorno apunta a Supabase; esta base es solo local" >&2; exit 2; fi
done
case "${PGHOST:-}" in ""|/*|localhost|127.0.0.1|::1) ;; *) echo "Rechazado: PGHOST no es local ($PGHOST)" >&2; exit 2 ;; esac

sql() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@" >/dev/null; }

dropdb --if-exists "$DB"
createdb "$DB"

# 1. Roles de la plataforma (como el stub) y el rol con el que se conecta GoTrue.
sql <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login noinherit createrole; end if;
end \$\$;
alter role supabase_auth_admin with login password '${GF_AUTH_DB_PASSWORD}';
grant anon, authenticated, service_role, supabase_auth_admin to postgres;
create schema auth authorization supabase_auth_admin;
grant create on database "${DB}" to supabase_auth_admin;
SQL

# 2. Esquema auth con las migraciones REALES de GoTrue.
PGH="${PGHOST:-/tmp}"
GOTRUE_DB_DRIVER=postgres \
DATABASE_URL="postgres://supabase_auth_admin:${GF_AUTH_DB_PASSWORD}@127.0.0.1:${PGPORT:-5432}/${DB}?search_path=auth&sslmode=disable" \
GOTRUE_DB_MIGRATIONS_PATH="$GF_GOTRUE_MIGRACIONES" \
GOTRUE_JWT_SECRET=solo-migraciones-solo-migraciones \
GOTRUE_SITE_URL=http://localhost \
API_EXTERNAL_URL=http://localhost \
GOTRUE_LOG_LEVEL=error \
  "$GF_GOTRUE_BIN" migrate >/dev/null

# Como en Supabase: el esquema auth es visible y sus funciones (auth.uid(), …) ejecutables.
sql <<'SQL'
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
SQL

# 3. El resto del stub (storage y default privileges de public), sin su auth.
sed -n '/^-- ── storage/,$p' "$SUPA/tests/security/harness/supabase_stub.sql" > "${TMPDIR:-/tmp}/gf_stub_sin_auth_$$.sql"
sql -f "${TMPDIR:-/tmp}/gf_stub_sin_auth_$$.sql"
rm -f "${TMPDIR:-/tmp}/gf_stub_sin_auth_$$.sql"
sql -f "$SUPA/tests/grants/harness/acl_staging.sql"
sql -f "$SUPA/tests/grants/harness/extensions_supabase.sql"

# 4. Las migraciones del repo + seed. Con GF_RECORRIDO_OMITIR_DESDE=<versión>
#    se omiten esa migración y las posteriores (p. ej. staging sin
#    20261010000000_billing_mercadopago).
aplicadas=0
for m in "$SUPA"/migrations/*.sql; do
  if [[ -n "${GF_RECORRIDO_OMITIR_DESDE:-}" && ! "$(basename "$m")" < "$GF_RECORRIDO_OMITIR_DESDE" ]]; then break; fi
  sql -f "$m"
  aplicadas=$((aplicadas + 1))
done
sql -f "$SUPA/seed.sql"
PGOPTIONS="-c client_min_messages=warning" psql -X -q -d "$DB" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if; end \$\$; grant anon, authenticated, service_role to authenticator;" >/dev/null
echo "base $DB: auth real (GoTrue) + $aplicadas migraciones${GF_RECORRIDO_OMITIR_DESDE:+ (sin $GF_RECORRIDO_OMITIR_DESDE y posteriores)}"

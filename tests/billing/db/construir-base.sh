#!/usr/bin/env bash
# ============================================================
# Base LOCAL y desechable para la batería de billing: stub de los
# esquemas de Supabase + ACL de staging + TODAS las migraciones del
# repo + seed. Nunca apunta a un proyecto Supabase.
#
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres tests/billing/db/construir-base.sh [db]
#
# La base debe llamarse gf_billing_* (se borra y se recrea).
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../../.." && pwd)"
SUPA="$RAIZ/supabase"
DB="${1:-${GF_BILLING_DB:-gf_billing_test}}"

case "$DB" in gf_billing_*) ;; *) echo "Rechazado: la base local debe llamarse gf_billing_* (recibido: $DB)" >&2; exit 2 ;; esac
for v in "${PGHOST:-}" "${DATABASE_URL:-}" "${PGDATABASE:-}"; do
  if [[ "$v" == *supabase* || "$v" == *pooler* ]]; then echo "Rechazado: el entorno apunta a Supabase; esta base es solo local" >&2; exit 2; fi
done
case "${PGHOST:-}" in ""|/*|localhost|127.0.0.1|::1) ;; *) echo "Rechazado: PGHOST no es local ($PGHOST)" >&2; exit 2 ;; esac

sql() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@" >/dev/null; }

dropdb --if-exists "$DB"
createdb "$DB"
sql -f "$SUPA/tests/security/harness/supabase_stub.sql"
sql -f "$SUPA/tests/grants/harness/acl_staging.sql"
sql -f "$SUPA/tests/grants/harness/extensions_supabase.sql"
# GF_BILLING_OMITIR_MIGRACION=<archivo.sql>: base en el estado ANTERIOR a esa
# migración (prueba de compatibilidad del despliegue; la aplica el que llama).
for m in "$SUPA"/migrations/*.sql; do
  [[ -n "${GF_BILLING_OMITIR_MIGRACION:-}" && "$(basename "$m")" == "$GF_BILLING_OMITIR_MIGRACION" ]] && continue
  sql -f "$m"
done
sql -f "$SUPA/seed.sql"
# Rol de conexión de PostgREST (solo para la capa C local).
PGOPTIONS="-c client_min_messages=warning" psql -X -q -d "$DB" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if; end \$\$; grant anon, authenticated, service_role to authenticator;" >/dev/null
echo "base $DB: $(ls "$SUPA"/migrations/*.sql | wc -l | tr -d ' ') migraciones"

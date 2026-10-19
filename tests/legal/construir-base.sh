#!/usr/bin/env bash
# ============================================================
# Base LOCAL y desechable para las pruebas de documentos legales
# (cargador y páginas): stub de los esquemas de Supabase + ACL de
# staging + las migraciones del repo + seed. Nunca apunta a un proyecto
# Supabase.
#
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres tests/legal/construir-base.sh gf_legal_x
#   GF_LEGAL_OMITIR_DESDE=20261015000000 …  → se omiten esa migración y las
#     posteriores (staging hoy: Fase 1 sin la lectura pública).
#
# La base debe llamarse gf_legal_* (se borra y se recrea).
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../.." && pwd)"
SUPA="$RAIZ/supabase"
DB="${1:?base}"

case "$DB" in gf_legal_*) ;; *) echo "Rechazado: la base local debe llamarse gf_legal_* (recibido: $DB)" >&2; exit 2 ;; esac
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
aplicadas=0
for m in "$SUPA"/migrations/*.sql; do
  if [[ -n "${GF_LEGAL_OMITIR_DESDE:-}" && ! "$(basename "$m")" < "$GF_LEGAL_OMITIR_DESDE" ]]; then break; fi
  sql -f "$m"
  aplicadas=$((aplicadas + 1))
done
sql -f "$SUPA/seed.sql"
# Rol de conexión de PostgREST (solo para la prueba de páginas).
PGOPTIONS="-c client_min_messages=warning" psql -X -q -d "$DB" -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if; end \$\$; grant anon, authenticated, service_role to authenticator;" >/dev/null
echo "base $DB: $aplicadas migraciones${GF_LEGAL_OMITIR_DESDE:+ (sin $GF_LEGAL_OMITIR_DESDE y posteriores)}"

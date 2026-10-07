#!/usr/bin/env bash
# ============================================================
# Batería billing — capa B en una base LOCAL desechable (seguro para CI
# con un Postgres de servicio): construye gf_billing_test con todas las
# migraciones y corre tests/billing/db/escenarios.sql (siempre revertido).
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres tests/billing/db/run-local.sh
# Sin Postgres accesible → SKIP (nunca PASS).
# ============================================================
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$DIR/../../.." && pwd)"
DB="${GF_BILLING_DB:-gf_billing_test}"

if ! command -v psql >/dev/null || ! psql -X -At -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "RESULT|B|--|SKIP|capa B omitida: no hay Postgres local accesible (PGHOST/PGPORT/PGUSER)"
  exit 0
fi
inicio=$(date +%s)
if ! bash "$DIR/construir-base.sh" "$DB" >/dev/null; then
  echo "RESULT|B|--|FAIL|no se pudo construir la base local $DB"
  exit 1
fi
SALIDA="$(mktemp)"
trap 'rm -f "$SALIDA"; dropdb --if-exists "$DB" >/dev/null 2>&1' EXIT
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/escenarios.sql" >"$SALIDA" 2>&1
node "$RAIZ/tests/billing/lib/paquete-a-resultados.mjs" B <"$SALIDA"
estado=$?
# Comprobación externa: nada quedó confirmado.
quedan=$(psql -X -At -d "$DB" -c "select (select count(*) from public.tenants where nombre like 'ZZ\_AUTOTEST\_%') + (select count(*) from auth.users where email like 'zz\_autotest+%') + (select count(*) from public.billing_eventos)")
if [[ "$quedan" == "0" ]]; then echo "RESULT|B|20|PASS|base local sin filas sintéticas tras la corrida (rollback)"; else echo "RESULT|B|20|FAIL|quedaron $quedan filas tras la corrida"; estado=1; fi
echo "DURACION|B|$(( $(date +%s) - inicio ))s"
exit $estado

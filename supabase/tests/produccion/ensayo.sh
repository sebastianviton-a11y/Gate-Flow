#!/usr/bin/env bash
# ============================================================
# Ensayo LOCAL de las migraciones pendientes de producción sobre su
# forma real (nunca contra Supabase):
#   1. base "forma de producción": stub + migraciones del repo hasta
#      20260729000000 + parche_forma_produccion.sql (drift leído del
#      catálogo de producción en solo lectura, 2026-10-08)
#   2. datos SINTÉTICOS con la forma y el volumen de producción
#   3. las 12 migraciones en orden (las mismas que staging)
#   4. ninguna fila existente cambia (huella por tabla) + verificación
#      de comportamiento (verificacion_post.sql)
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/produccion/ensayo.sh
# Suites de seguridad sobre la misma base:
#   GF_BASE_PRODUCCION=1 supabase/tests/security/run-local.sh
# ============================================================
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(cd "$DIR/../.." && pwd)"
DB="${GF_TEST_DB:-gf_produccion_ensayo}"
case "$DB" in postgres|template0|template1) echo "GF_TEST_DB no puede ser $DB" >&2; exit 2 ;; esac
for v in "${PGHOST:-}" "${DATABASE_URL:-}" "${PGDATABASE:-}"; do
  if [[ "$v" == *supabase* || "$v" == *pooler* ]]; then echo "Rechazado: el entorno apunta a Supabase; el ensayo es solo local" >&2; exit 2; fi
done

MIGS=(20260729100000_grants_minimo_privilegio 20260729200000_reconciliacion_paridad_produccion 20260930000000_privilegios_fase_a
      20261005180000_privilegios_fase_c 20261006000000_registro_trial 20261007000000_tenant_operativo 20261007100000_integridad_multitenant
      20261008000000_tenants_columnas_protegidas 20261008100000_billing_base 20261008200000_tenant_operativo_billing
      20261008300000_billing_evento_otro_tenant 20261009000000_billing_impago_desde)
sql() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
OUT="$(mktemp -d)"

dropdb --if-exists "$DB" 2>/dev/null; createdb "$DB"
sql -f "$SUPA/tests/security/harness/supabase_stub.sql" >/dev/null
sql -f "$SUPA/tests/grants/harness/extensions_supabase.sql" >/dev/null
for m in "$SUPA"/migrations/*.sql; do
  [[ "$(basename "$m")" > "20260729000000_zzz" ]] && continue
  sql -f "$m" >/dev/null
done
sql -f "$DIR/parche_forma_produccion.sql" >/dev/null
sql -f "$SUPA/seed.sql" >/dev/null
sql -f "$DIR/datos_sinteticos_forma_prod.sql" >/dev/null

foto() {  # filas y huella de cada tabla existente
  psql -X -At -d "$DB" <<'SQL'
select c.relname,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text,
  (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from public.%I x', E'\n', '', c.relname), false, true, '')))[1]::text
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relname not in ('suscripciones','registro_intentos','billing_checkouts','billing_eventos')
order by 1;
SQL
}
foto > "$OUT/antes.txt"
for m in "${MIGS[@]}"; do
  inicio=$(date +%s%N)
  sql -f "$SUPA/migrations/$m.sql" >/dev/null
  echo "aplicada $m ($(( ($(date +%s%N) - inicio) / 1000000 )) ms)"
done
foto > "$OUT/despues.txt"
if diff -q "$OUT/antes.txt" "$OUT/despues.txt" >/dev/null; then
  echo "PASS|D0|ninguna fila existente cambió ($(wc -l < "$OUT/antes.txt") tablas, $(awk -F'|' '{s+=$2} END {print s}' "$OUT/antes.txt") filas)"
else
  echo "FAIL|D0|cambiaron filas existentes"; diff "$OUT/antes.txt" "$OUT/despues.txt" | head -20
fi
psql -X -q -d "$DB" -f "$DIR/verificacion_post.sql" 2>&1 | grep -E "PASS\||FAIL\||ERROR" | sed 's/^.*NOTICE:  //'

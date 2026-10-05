#!/usr/bin/env bash
# ============================================================
# Tests de seguridad de privilegios (E1/E2/E4) contra un PostgreSQL
# LOCAL y desechable. Nunca apuntar a un proyecto Supabase: el
# script borra y recrea la base $GF_TEST_DB y carga un stub de los
# esquemas auth/storage (harness/supabase_stub.sql).
#
# Uso:
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh
#
# Recorrido:
#   0  esquema actual (sin la fase A)   → informativo: muestra los riesgos
#   A  + migración A                    → 0 FAIL esperado
#   C  + fase C                         → 0 FAIL esperado
#   rollback C → catálogo idéntico a A  → 0 FAIL en fase A
#   rollback A → catálogo idéntico a 0
#   A de nuevo sobre el rollback        → 0 FAIL esperado
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(cd "$DIR/../.." && pwd)"
DB="${GF_TEST_DB:-gf_security_test}"
MIG_A="20260930000000_privilegios_fase_a.sql"
MIG_G="20260729100000_grants_minimo_privilegio.sql"
MIG_C="20261005180000_privilegios_fase_c.sql"
FASE_C="$SUPA/migrations/$MIG_C"
DOWN_A="$SUPA/rollback/20260930000000_privilegios_fase_a.down.sql"
DOWN_C="$SUPA/rollback/privilegios_fase_c.down.sql"
OUT="${GF_TEST_OUT:-$(mktemp -d)}"

case "$DB" in postgres|template0|template1) echo "GF_TEST_DB no puede ser $DB" >&2; exit 2 ;; esac
if [[ "${PGHOST:-}" == *supabase* ]]; then echo "Rechazado: PGHOST apunta a Supabase" >&2; exit 2; fi

sql()      { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
sql_file() { sql -f "$1" >/dev/null; }

# Catálogo comparable: ACLs ordenadas (el orden de las entradas no
# cambia los permisos).
snapshot() {
  sql -A -t > "$1" <<'SQL'
select 'POL|' || schemaname || '.' || tablename || '|' || policyname || '|' || cmd || '|'
       || array_to_string(roles, ',') || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
from pg_policies where schemaname in ('public', 'storage')
union all
select 'FN|' || p.oid::regprocedure::text || '|' || p.prosecdef || '|' || p.provolatile::text || '|'
       || coalesce(array_to_string(p.proconfig, ','), '-') || '|' || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), '-') || '|' || md5(p.prosrc)
from pg_proc p where p.pronamespace = 'public'::regnamespace
union all
select 'TG|' || tgrelid::regclass::text || '|' || tgname || '|' || tgtype || '|' || tgfoid::regproc::text
from pg_trigger where not tgisinternal
union all
select 'ACL|' || c.oid::regclass::text || '|' || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x), '-')
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
union all
select 'COLACL|' || a.attrelid::regclass::text || '.' || a.attname || '|' || (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x)
from pg_attribute a join pg_class c on c.oid = a.attrelid
where c.relnamespace = 'public'::regnamespace and a.attacl is not null
order by 1;
SQL
}

run_suites() {
  local fase="$1" log="$OUT/fase_$1_$2.log"
  : > "$log"
  for f in "$DIR"/[1-9]0_*.sql; do
    PGOPTIONS="-c tests.fase=$fase" psql -X -q -d "$DB" -f "$f" >>"$log" 2>&1 || true
  done
  local pass fail err
  pass=$(grep -c 'NOTICE:  PASS|' "$log" || true)
  fail=$(grep -c 'NOTICE:  FAIL|' "$log" || true)
  err=$(grep -c 'ERROR:' "$log" || true)
  printf '  fase %-2s %-22s PASS=%-4s FAIL=%-4s ERROR=%s\n' "$fase" "($2)" "$pass" "$fail" "$err"
  if [[ "$fase" != "0" && ( "$fail" != "0" || "$err" != "0" ) ]]; then
    grep -E 'NOTICE:  FAIL\||ERROR:' "$log" | sed 's/^/    /'
    FALLAS=$((FALLAS + 1))
  fi
}

same_catalog() {
  if diff -u "$1" "$2" > "$OUT/diff_$3.txt"; then
    echo "  catálogo idéntico: $3"
  else
    echo "  catálogo DIFERENTE: $3 (ver $OUT/diff_$3.txt)"; FALLAS=$((FALLAS + 1))
  fi
}

FALLAS=0
echo "Base: $DB   Salida: $OUT"

dropdb --if-exists "$DB" && createdb "$DB"
sql_file "$DIR/harness/supabase_stub.sql"
for m in "$SUPA"/migrations/*.sql; do
  [[ "$(basename "$m")" == "$MIG_A" || "$(basename "$m")" == "$MIG_C" ]] && continue
  # Estas suites modelan producción (grants amplios de Supabase, RLS
  # como única barrera). Los grants de mínimo privilegio tienen su
  # propia suite: supabase/tests/grants/run-local.sh.
  [[ "$(basename "$m")" == "$MIG_G" ]] && continue
  sql_file "$m"
done
sql_file "$SUPA/seed.sql"
sql_file "$DIR/00_fixtures.sql"
sql_file "$DIR/01_helpers.sql"
snapshot "$OUT/snap_0.txt"

echo "Suites:"
run_suites 0 "base, sin fase A"

sql_file "$SUPA/migrations/$MIG_A"
snapshot "$OUT/snap_A.txt"
run_suites A "migración A"

sql_file "$FASE_C"
run_suites C "fase C"

sql_file "$DOWN_C"
snapshot "$OUT/snap_A_tras_down_C.txt"
same_catalog "$OUT/snap_A.txt" "$OUT/snap_A_tras_down_C.txt" "rollback_C"
run_suites A "tras rollback C"

sql_file "$DOWN_A"
snapshot "$OUT/snap_0_tras_down_A.txt"
same_catalog "$OUT/snap_0.txt" "$OUT/snap_0_tras_down_A.txt" "rollback_A"

sql_file "$SUPA/migrations/$MIG_A"
run_suites A "A reaplicada"

if [[ "$FALLAS" == "0" ]]; then echo "OK"; else echo "FALLAS: $FALLAS"; exit 1; fi

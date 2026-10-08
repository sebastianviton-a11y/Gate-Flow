#!/usr/bin/env bash
# ============================================================
# Tests de seguridad de privilegios (E1/E2/E4) contra un PostgreSQL
# LOCAL y desechable. Nunca apuntar a un proyecto Supabase: el
# script borra y recrea la base $GF_TEST_DB y carga un stub de los
# esquemas auth/storage (harness/supabase_stub.sql).
#
# Uso:
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh
#   GF_BASE_PRODUCCION=1 …  → parte de la forma de producción (ver supabase/tests/produccion).
#   Los rollbacks del repo no restauran la forma de producción: ahí se
#   esperan diferencias de catálogo en rollback_O/T/C/A.
#
# Recorrido:
#   0  esquema actual (sin la fase A)   → informativo: muestra los riesgos
#   A  + migración A                    → 0 FAIL esperado
#   C  + fase C                         → 0 FAIL esperado
#   T  + registro/trial (20261006)      → 0 FAIL esperado
#   O  + tenant_operativo (20261007)    → 0 FAIL esperado
#   I  + integridad multitenant         → 0 FAIL esperado
#   P  + columnas protegidas de tenants → 0 FAIL esperado
#   rollback P → catálogo idéntico a I; P se reaplica
#   B  + billing_base                   → 0 FAIL esperado
#   OB + tenant_operativo_billing       → 0 FAIL esperado; concurrencia real
#   BF + corrección billing_aplicar_evento (otro tenant) → 0 FAIL;
#        rollback BF → catálogo idéntico a OB
#   IM + gracia de past_due desde impago_desde (20261009) → 0 FAIL;
#        rollback IM → catálogo idéntico a BF; IM se reaplica idéntico
#   RE + registro de residentes por enlace (20261011) → 0 FAIL;
#        revisión concurrente (concurrencia_residentes.sh) → 3 PASS;
#        rollback RE → catálogo idéntico a IM; RE se reaplica idéntico;
#        con solicitudes o personas cargadas, el rollback aborta sin cambios
#   rollback OB → catálogo idéntico a B; rollback B → idéntico a P;
#   B y OB se reaplican (idénticos) y se revierten; luego rollback P
#   rollback I → catálogo idéntico a O; con una referencia cruzada en
#   los datos, I aborta sin cambiar nada; I se reaplica y se revierte
#   rollback O → catálogo idéntico a T
#   rollback T → catálogo idéntico a C
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
# Migraciones posteriores a C: se aplican después de C (dependen de A)
# y se revierten antes de revertir C.
MIG_T="20261006000000_registro_trial.sql"
DOWN_T="$SUPA/rollback/20261006000000_registro_trial.down.sql"
MIG_O="20261007000000_tenant_operativo.sql"
DOWN_O="$SUPA/rollback/20261007000000_tenant_operativo.down.sql"
MIG_I="20261007100000_integridad_multitenant.sql"
DOWN_I="$SUPA/rollback/20261007100000_integridad_multitenant.down.sql"
MIG_P="20261008000000_tenants_columnas_protegidas.sql"
DOWN_P="$SUPA/rollback/20261008000000_tenants_columnas_protegidas.down.sql"
MIG_B="20261008100000_billing_base.sql"
DOWN_B="$SUPA/rollback/20261008100000_billing_base.down.sql"
MIG_OB="20261008200000_tenant_operativo_billing.sql"
DOWN_OB="$SUPA/rollback/20261008200000_tenant_operativo_billing.down.sql"
MIG_BF="20261008300000_billing_evento_otro_tenant.sql"
DOWN_BF="$SUPA/rollback/20261008300000_billing_evento_otro_tenant.down.sql"
MIG_IM="20261009000000_billing_impago_desde.sql"
DOWN_IM="$SUPA/rollback/20261009000000_billing_impago_desde.down.sql"
MIG_RE="20261011000000_residentes_enlace.sql"
DOWN_RE="$SUPA/rollback/20261011000000_residentes_enlace.down.sql"
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
union all
select 'CON|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
from pg_constraint where connamespace = 'public'::regnamespace
union all
select 'IDX|' || indexrelid::regclass::text || '|' || pg_get_indexdef(indexrelid)
from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace = 'public'::regnamespace
order by 1;
SQL
}

run_suites() {
  # $3 (opcional): fase que ven las suites por tests.fase; la fase T es
  # "C + registro/trial", así que las suites de A/C la leen como C.
  local fase="$1" log="$OUT/fase_$1_$2.log" fase_sql="${3:-$1}"
  : > "$log"
  for f in "$DIR"/[1-9][0-9]_*.sql; do
    PGOPTIONS="-c tests.fase=$fase_sql" psql -X -q -d "$DB" -f "$f" >>"$log" 2>&1 || true
  done
  local pass fail err pend
  pass=$(grep -c 'NOTICE:  PASS|' "$log" || true)
  pend=$(grep -c 'NOTICE:  PENDIENTE|' "$log" || true)
  fail=$(grep -c 'NOTICE:  FAIL|' "$log" || true)
  err=$(grep -c 'ERROR:' "$log" || true)
  printf '  fase %-2s %-22s PASS=%-4s FAIL=%-4s ERROR=%-3s PENDIENTE=%s\n' "$fase" "($2)" "$pass" "$fail" "$err" "$pend"
  { grep -E 'NOTICE:  PENDIENTE\|' "$log" || true; } | sed 's/^.*NOTICE:  /    /' | sort -u
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
if [[ -n "${GF_BASE_PRODUCCION:-}" ]]; then
  # Ensayo de producción (supabase/tests/produccion): la base parte de la
  # forma real de producción (migraciones hasta 20260729000000 + el drift
  # leído de su catálogo) y la reconciliación, en vez de la del repo.
  for m in "$SUPA"/migrations/*.sql; do
    [[ "$(basename "$m")" > "20260729000000_zzz" ]] && continue
    sql_file "$m"
  done
  sql_file "$SUPA/tests/produccion/parche_forma_produccion.sql"
  sql_file "$SUPA/migrations/20260729200000_reconciliacion_paridad_produccion.sql"
else
  for m in "$SUPA"/migrations/*.sql; do
    [[ "$(basename "$m")" == "$MIG_A" || "$(basename "$m")" == "$MIG_C" || "$(basename "$m")" == "$MIG_T" || "$(basename "$m")" == "$MIG_O" || "$(basename "$m")" == "$MIG_I" || "$(basename "$m")" == "$MIG_P" || "$(basename "$m")" == "$MIG_B" || "$(basename "$m")" == "$MIG_OB" || "$(basename "$m")" == "$MIG_BF" || "$(basename "$m")" == "$MIG_IM" || "$(basename "$m")" == "$MIG_RE" ]] && continue
    # Estas suites modelan producción (grants amplios de Supabase, RLS
    # como única barrera). Los grants de mínimo privilegio tienen su
    # propia suite: supabase/tests/grants/run-local.sh.
    [[ "$(basename "$m")" == "$MIG_G" ]] && continue
    sql_file "$m"
  done
fi
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
snapshot "$OUT/snap_C.txt"

sql_file "$SUPA/migrations/$MIG_T"
run_suites T "fase C + registro trial" C
snapshot "$OUT/snap_T.txt"

sql_file "$SUPA/migrations/$MIG_O"
run_suites O "C + trial + operativo" C
snapshot "$OUT/snap_O.txt"

sql_file "$SUPA/migrations/$MIG_I"
run_suites I "… + integridad multitenant" C
snapshot "$OUT/snap_I.txt"

sql_file "$SUPA/migrations/$MIG_P"
run_suites P "… + columnas tenants" C
snapshot "$OUT/snap_P.txt"
sql_file "$DOWN_P"
snapshot "$OUT/snap_I_tras_down_P.txt"
same_catalog "$OUT/snap_I.txt" "$OUT/snap_I_tras_down_P.txt" "rollback_P"
sql_file "$SUPA/migrations/$MIG_P"
snapshot "$OUT/snap_P2.txt"
same_catalog "$OUT/snap_P.txt" "$OUT/snap_P2.txt" "reaplicar_P"

sql_file "$SUPA/migrations/$MIG_B"
run_suites B "… + billing_base" C
snapshot "$OUT/snap_B.txt"
sql_file "$SUPA/migrations/$MIG_OB"
run_suites OB "… + operativo_billing" C
snapshot "$OUT/snap_OB.txt"
echo "  concurrencia (dos sesiones):"
bash "$DIR/concurrencia_billing.sh" "$DB" > "$OUT/concurrencia.log" 2>&1 || true
sed 's/^/    /' "$OUT/concurrencia.log"
if grep -qv '^PASS|' "$OUT/concurrencia.log" || [[ "$(grep -c '^PASS|' "$OUT/concurrencia.log")" != "3" ]]; then FALLAS=$((FALLAS + 1)); fi
snapshot "$OUT/snap_OB_tras_concurrencia.txt"
same_catalog "$OUT/snap_OB.txt" "$OUT/snap_OB_tras_concurrencia.txt" "concurrencia_sin_cambios_de_catalogo"
sql_file "$SUPA/migrations/$MIG_BF"
run_suites BF "… + corrección otro tenant" C
snapshot "$OUT/snap_BF.txt"
sql_file "$SUPA/migrations/$MIG_IM"
run_suites IM "… + gracia desde impago_desde" C
snapshot "$OUT/snap_IM.txt"
sql_file "$DOWN_IM"
snapshot "$OUT/snap_BF_tras_down_IM.txt"
same_catalog "$OUT/snap_BF.txt" "$OUT/snap_BF_tras_down_IM.txt" "rollback_IM"
sql_file "$SUPA/migrations/$MIG_IM"
snapshot "$OUT/snap_IM2.txt"
same_catalog "$OUT/snap_IM.txt" "$OUT/snap_IM2.txt" "reaplicar_IM"

sql_file "$SUPA/migrations/$MIG_RE"
run_suites RE "… + residentes por enlace" C
echo "  concurrencia de la revisión de residentes (dos sesiones):"
bash "$DIR/concurrencia_residentes.sh" "$DB" > "$OUT/concurrencia_residentes.log" 2>&1 || true
sed 's/^/    /' "$OUT/concurrencia_residentes.log"
if grep -qv '^PASS|' "$OUT/concurrencia_residentes.log" || [[ "$(grep -c '^PASS|' "$OUT/concurrencia_residentes.log")" != "3" ]]; then FALLAS=$((FALLAS + 1)); fi
snapshot "$OUT/snap_RE.txt"
sql_file "$DOWN_RE"
snapshot "$OUT/snap_IM_tras_down_RE.txt"
same_catalog "$OUT/snap_IM2.txt" "$OUT/snap_IM_tras_down_RE.txt" "rollback_RE"
sql_file "$SUPA/migrations/$MIG_RE"
snapshot "$OUT/snap_RE2.txt"
same_catalog "$OUT/snap_RE.txt" "$OUT/snap_RE2.txt" "reaplicar_RE"
# Con datos de personas, el rollback debe abortar sin tocar nada.
sql -c "insert into public.residentes_enlaces (id, tenant_id, token) values ('e1000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000', repeat('e', 64))" >/dev/null
sql -c "insert into public.residentes_solicitudes (tenant_id, enlace_id, nombre, apellido, direccion, telefono) values ('aaaaaaaa-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000000', 'Zz', 'Prueba', 'Casa Z', '529981234567')" >/dev/null
if sql -f "$DOWN_RE" >/dev/null 2>"$OUT/RE_con_datos.err"; then
  echo "  residentes: el rollback se aplicó con solicitudes cargadas (debía abortar)"; FALLAS=$((FALLAS + 1))
else
  echo "  residentes: el rollback aborta con datos ($(grep -o '[0-9]* solicitudes' "$OUT/RE_con_datos.err" | head -1))"
fi
snapshot "$OUT/snap_RE_tras_abortar.txt"
same_catalog "$OUT/snap_RE.txt" "$OUT/snap_RE_tras_abortar.txt" "RE_rollback_abortado_sin_cambios"
sql -c "delete from public.residentes_solicitudes; delete from public.residentes_enlaces" >/dev/null
sql_file "$DOWN_RE"
sql_file "$DOWN_IM"
sql_file "$DOWN_BF"
snapshot "$OUT/snap_OB_tras_down_BF.txt"
same_catalog "$OUT/snap_OB.txt" "$OUT/snap_OB_tras_down_BF.txt" "rollback_BF"
sql_file "$DOWN_OB"
snapshot "$OUT/snap_B_tras_down_OB.txt"
same_catalog "$OUT/snap_B.txt" "$OUT/snap_B_tras_down_OB.txt" "rollback_OB"
sql_file "$DOWN_B"
snapshot "$OUT/snap_P_tras_down_B.txt"
same_catalog "$OUT/snap_P.txt" "$OUT/snap_P_tras_down_B.txt" "rollback_B"
sql_file "$SUPA/migrations/$MIG_B"
sql_file "$SUPA/migrations/$MIG_OB"
snapshot "$OUT/snap_OB2.txt"
same_catalog "$OUT/snap_OB.txt" "$OUT/snap_OB2.txt" "reaplicar_B_OB"
sql_file "$DOWN_OB"
sql_file "$DOWN_B"

sql_file "$DOWN_P"

sql_file "$DOWN_I"
snapshot "$OUT/snap_O_tras_down_I.txt"
same_catalog "$OUT/snap_O.txt" "$OUT/snap_O_tras_down_I.txt" "rollback_I"

# Datos inconsistentes previos: la migración debe abortar sin cambios.
sql -c "insert into public.paquetes (tenant_id, unidad_id, recibido_por) values ('bbbbbbbb-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b9')" >/dev/null
if sql -f "$SUPA/migrations/$MIG_I" >/dev/null 2>"$OUT/I_con_cruce.err"; then
  echo "  integridad: aplicó con una referencia cruzada en los datos (debía abortar)"; FALLAS=$((FALLAS + 1))
else
  echo "  integridad: aborta con datos cruzados ($(grep -o 'paquetes.unidad_id=[0-9]*' "$OUT/I_con_cruce.err" | head -1))"
fi
snapshot "$OUT/snap_O_tras_abortar_I.txt"
same_catalog "$OUT/snap_O.txt" "$OUT/snap_O_tras_abortar_I.txt" "I_abortada_sin_cambios"
sql -c "delete from public.paquetes where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000' and unidad_id = 'a1000000-0000-0000-0000-000000000000'" >/dev/null
sql_file "$SUPA/migrations/$MIG_I"
snapshot "$OUT/snap_I2.txt"
same_catalog "$OUT/snap_I.txt" "$OUT/snap_I2.txt" "reaplicar_I"
sql_file "$DOWN_I"

sql_file "$DOWN_O"
snapshot "$OUT/snap_T_tras_down_O.txt"
same_catalog "$OUT/snap_T.txt" "$OUT/snap_T_tras_down_O.txt" "rollback_O"

sql_file "$DOWN_T"
snapshot "$OUT/snap_C_tras_down_T.txt"
same_catalog "$OUT/snap_C.txt" "$OUT/snap_C_tras_down_T.txt" "rollback_T"

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

#!/usr/bin/env bash
# ============================================================
# Tests de grants de mínimo privilegio + reconciliación de paridad
# con producción, contra un PostgreSQL LOCAL y desechable que imita un
# proyecto Supabase nuevo (como staging): default privileges nuevos y
# pgcrypto en el schema "extensions". Nunca contra Supabase: borra y
# recrea $GF_TEST_DB.
#
# Uso:
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/grants/run-local.sh
#
# Recorrido:
#   0    migraciones hasta 20260729000000   → informativo (reproduce staging)
#   G    + grants                           → 0 FAIL
#        rollback G = 0, reaplicar G = G
#   GR   + reconciliación                   → 0 FAIL
#        rollback R = G, reaplicar R = GR
#   GRA  + migración A                      → 0 FAIL
#        rollback A = GR
#   GRA' has_role_in_tenant "de producción" ya existente + migración A
#                                           → aplica sin error, mismo estado que GRA
#   GRAC + fase C                           → 0 FAIL
#   GRACT + registro/trial (20261006)       → 0 FAIL; contrato aquí
#        rollback T = GRAC
#        rollback C = GRA
#   Contrato: los select(...) del código contra el esquema GRA.
# Los casos PENDIENTE son fallos conocidos con corrección por aprobar:
# se listan, no cuentan como FAIL.
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(cd "$DIR/../.." && pwd)"
SEC="$SUPA/tests/security"
REPO="$(cd "$SUPA/.." && pwd)"
DB="${GF_TEST_DB:-gf_grants_test}"
MIG_G="20260729100000_grants_minimo_privilegio.sql"
MIG_R="20260729200000_reconciliacion_paridad_produccion.sql"
MIG_A="20260930000000_privilegios_fase_a.sql"
DOWN_G="$SUPA/rollback/20260729100000_grants_minimo_privilegio.down.sql"
DOWN_R="$SUPA/rollback/20260729200000_reconciliacion_paridad_produccion.down.sql"
DOWN_A="$SUPA/rollback/20260930000000_privilegios_fase_a.down.sql"
MIG_C="20261005180000_privilegios_fase_c.sql"
FASE_C="$SUPA/migrations/$MIG_C"
# Posteriores a C: se aplican después de C y se revierten antes que C.
MIG_T="20261006000000_registro_trial.sql"
DOWN_T="$SUPA/rollback/20261006000000_registro_trial.down.sql"
DOWN_C="$SUPA/rollback/privilegios_fase_c.down.sql"
OUT="${GF_TEST_OUT:-$(mktemp -d)}"

case "$DB" in postgres|template0|template1) echo "GF_TEST_DB no puede ser $DB" >&2; exit 2 ;; esac
if [[ "${PGHOST:-}" == *supabase* ]]; then echo "Rechazado: PGHOST apunta a Supabase" >&2; exit 2; fi

sql()      { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
sql_file() { sql -f "$1" >/dev/null; }

# Estado comparable: privilegios efectivos (no el texto del ACL),
# columnas, constraints y funciones de public.
snapshot() {
  sql -A -t > "$1" <<'SQL'
select 'PRIV|' || c.relname || '|' || r || '|' ||
  case when c.relkind = 'S' then
    concat_ws(',', case when has_sequence_privilege(r, c.oid, 'USAGE') then 'USAGE' end,
                   case when has_sequence_privilege(r, c.oid, 'SELECT') then 'SELECT' end,
                   case when has_sequence_privilege(r, c.oid, 'UPDATE') then 'UPDATE' end)
  else
    (select coalesce(string_agg(p, ','), '') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
     where has_table_privilege(r, c.oid, p))
  end
from pg_class c cross join unnest(array['anon','authenticated','service_role']) r
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p','S')
union all
select 'DEFAULT|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text
from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace
union all
select 'COL|' || table_name || '.' || column_name || '|' || data_type
from information_schema.columns where table_schema = 'public'
union all
select 'CON|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
from pg_constraint where connamespace = 'public'::regnamespace
union all
select 'FN|' || p.oid::regprocedure::text || '|definer=' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '-')
       || '|x=' || has_function_privilege('anon', p.oid, 'EXECUTE') || ',' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
       || ',' || has_function_privilege('service_role', p.oid, 'EXECUTE') || '|' || md5(p.prosrc)
from pg_proc p where p.pronamespace = 'public'::regnamespace
union all
select 'POL|' || tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
from pg_policies where schemaname in ('public', 'storage')
order by 1;
SQL
}

igual() {  # igual <a> <b> <nombre>
  if diff -u "$1" "$2" > "$OUT/diff_$3.txt"; then
    echo "  estado idéntico: $3"
  else
    echo "  estado DIFERENTE: $3 (ver $OUT/diff_$3.txt)"; FALLAS=$((FALLAS + 1))
  fi
}

run_suites() {
  local fase="$1" log="$OUT/fase_$1_$2.log"
  : > "$log"
  for f in "$DIR"/[1-9]0_*.sql; do
    psql -X -q -d "$DB" -f "$f" >>"$log" 2>&1 || true
  done
  local pass fail err pend
  pass=$(grep -c 'NOTICE:  PASS|' "$log" || true)
  fail=$(grep -c 'NOTICE:  FAIL|' "$log" || true)
  err=$(grep -c 'ERROR:' "$log" || true)
  pend=$(grep -c 'NOTICE:  PENDIENTE|' "$log" || true)
  printf '  fase %-4s %-30s PASS=%-4s FAIL=%-4s ERROR=%-3s PENDIENTE=%s\n' "$fase" "($2)" "$pass" "$fail" "$err" "$pend"
  if [[ "$fase" != "0" ]]; then
    { grep -E 'NOTICE:  PENDIENTE\|' "$log" || true; } | sed 's/^.*NOTICE:  /    /' | sort -u
    if [[ "$fail" != "0" || "$err" != "0" ]]; then
      grep -E 'NOTICE:  FAIL\||ERROR:' "$log" | sed 's/^/    /'
      FALLAS=$((FALLAS + 1))
    fi
  fi
}

FALLAS=0
echo "Base: $DB   Salida: $OUT"

dropdb --if-exists "$DB" && createdb "$DB"
sql_file "$SEC/harness/supabase_stub.sql"
sql_file "$DIR/harness/acl_staging.sql"
sql_file "$DIR/harness/extensions_supabase.sql"
for m in "$SUPA"/migrations/*.sql; do
  case "$(basename "$m")" in "$MIG_G"|"$MIG_R"|"$MIG_A"|"$MIG_C"|"$MIG_T") continue ;; esac
  sql_file "$m"
done
sql_file "$SUPA/seed.sql"
sql_file "$SEC/00_fixtures.sql"
sql_file "$SEC/01_helpers.sql"
snapshot "$OUT/snap_0.txt"

echo "Suites:"
run_suites 0 "estado staging, sin grants"

sql_file "$SUPA/migrations/$MIG_G"
snapshot "$OUT/snap_G.txt"
run_suites G "grants"
sql_file "$DOWN_G";                    snapshot "$OUT/snap_0b.txt"; igual "$OUT/snap_0.txt" "$OUT/snap_0b.txt" rollback_G
sql_file "$SUPA/migrations/$MIG_G";    snapshot "$OUT/snap_Gb.txt"; igual "$OUT/snap_G.txt" "$OUT/snap_Gb.txt" reaplicar_G

sql_file "$SUPA/migrations/$MIG_R"
snapshot "$OUT/snap_GR.txt"
run_suites GR "grants + reconciliación"
sql_file "$DOWN_R";                    snapshot "$OUT/snap_Gc.txt";  igual "$OUT/snap_G.txt" "$OUT/snap_Gc.txt" rollback_R
sql_file "$SUPA/migrations/$MIG_R";    snapshot "$OUT/snap_GRb.txt"; igual "$OUT/snap_GR.txt" "$OUT/snap_GRb.txt" reaplicar_R
sql_file "$SUPA/migrations/$MIG_R";    snapshot "$OUT/snap_GRc.txt"; igual "$OUT/snap_GR.txt" "$OUT/snap_GRc.txt" R_idempotente

sql_file "$SUPA/migrations/$MIG_A"
snapshot "$OUT/snap_GRA.txt"
run_suites GRA "grants + reconciliación + A"
sql_file "$DOWN_A";                    snapshot "$OUT/snap_GRd.txt"; igual "$OUT/snap_GR.txt" "$OUT/snap_GRd.txt" rollback_A

# Producción ya tiene has_role_in_tenant (versión manual: search_path
# = public, EXECUTE para todos). La migración A debe aplicar igual y
# dejar exactamente el mismo estado.
sql <<'SQL' >/dev/null
create function public.has_role_in_tenant(p_tenant_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.user_tenants ut join public.roles r on r.id = ut.rol_id
                 where ut.user_id = auth.uid() and ut.activo = true
                   and ut.tenant_id = p_tenant_id and r.clave = any(p_roles));
$$;
grant execute on function public.has_role_in_tenant(uuid, text[]) to anon, authenticated, service_role;
SQL
if sql -f "$SUPA/migrations/$MIG_A" >/dev/null 2>"$OUT/A_sobre_prod.err"; then
  echo "  migración A aplica con has_role_in_tenant preexistente"
  snapshot "$OUT/snap_GRA2.txt"; igual "$OUT/snap_GRA.txt" "$OUT/snap_GRA2.txt" A_sobre_has_role_in_tenant_previo
else
  echo "  migración A FALLA con has_role_in_tenant preexistente:"; sed 's/^/    /' "$OUT/A_sobre_prod.err"; FALLAS=$((FALLAS + 1))
fi
run_suites GRA "A sobre función preexistente"

sql_file "$FASE_C"
run_suites GRAC "grants + reconciliación + A + C"
snapshot "$OUT/snap_GRAC.txt"

sql_file "$SUPA/migrations/$MIG_T"
run_suites GRACT "grants + rec. + A + C + T"

# El código llama a las RPC de registro: el contrato se verifica con
# el esquema completo (A + C + registro/trial).
echo "Contrato código ↔ esquema:"
if python3 "$DIR/contrato_selects.py" --repo "$REPO" --db "$DB" > "$OUT/contrato.log" 2>&1; then
  tail -n 1 "$OUT/contrato.log" | sed 's/^/  /'
else
  sed 's/^/    /' "$OUT/contrato.log"; FALLAS=$((FALLAS + 1))
fi

sql_file "$DOWN_T";                    snapshot "$OUT/snap_GRACb.txt"; igual "$OUT/snap_GRAC.txt" "$OUT/snap_GRACb.txt" rollback_T
sql_file "$DOWN_C";                    snapshot "$OUT/snap_GRA3.txt"; igual "$OUT/snap_GRA2.txt" "$OUT/snap_GRA3.txt" rollback_C

if [[ "$FALLAS" == "0" ]]; then echo "OK"; else echo "FALLAS: $FALLAS"; exit 1; fi

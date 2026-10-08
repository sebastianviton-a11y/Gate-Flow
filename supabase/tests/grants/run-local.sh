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
#   GRACT + registro/trial (20261006)       → 0 FAIL
#   GRACTO + tenant_operativo (20261007)    → 0 FAIL
#   GRACTOI + integridad multitenant        → 0 FAIL
#   GRACTOIP + columnas protegidas tenants  → 0 FAIL
#   …B   + billing_base                     → 0 FAIL
#   …BO  + tenant_operativo_billing         → 0 FAIL
#   …BOF + corrección otro tenant           → 0 FAIL
#   …BOFM + gracia desde impago_desde       → 0 FAIL
#   …BOFMR + residentes por enlace (20261011) → 0 FAIL; contrato aquí
#        rollback RE = …BOFM
#        rollback IM = …BOF
#        rollback OB = …B, rollback B = GRACTOIP
#        rollback P = GRACTOI
#        rollback I = GRACTO
#        rollback O = GRACT
#        rollback T = GRAC
#        rollback C = GRA
#   Contrato: los select(...) del código contra el esquema completo;
#   solo embebidos (FKs nombradas, sin ambigüedad) también en GRACTO,
#   antes de la integridad multitenant; autoprueba de embeds ambiguos.
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
select 'COLPRIV|' || c.relname || '.' || a.attname || '|' || r || '|' ||
  (select coalesce(string_agg(p, ','), '') from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
   where has_column_privilege(r, c.oid, a.attnum, p) and not has_table_privilege(r, c.oid, p))
from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
cross join unnest(array['anon','authenticated','service_role']) r
where c.relnamespace = 'public'::regnamespace
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
  for f in "$DIR"/[1-9][0-9]_*.sql; do
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
  case "$(basename "$m")" in "$MIG_G"|"$MIG_R"|"$MIG_A"|"$MIG_C"|"$MIG_T"|"$MIG_O"|"$MIG_I"|"$MIG_P"|"$MIG_B"|"$MIG_OB"|"$MIG_BF"|"$MIG_IM"|"$MIG_RE") continue ;; esac
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
snapshot "$OUT/snap_GRACT.txt"

sql_file "$SUPA/migrations/$MIG_O"
run_suites GRACTO "… + T + tenant_operativo"
snapshot "$OUT/snap_GRACTO.txt"

# Antes de la integridad multitenant (como producción hoy): las FKs que
# nombran los embeds existen y ningún embed es ambiguo.
echo "Contrato de embebidos sin integridad multitenant:"
if python3 "$DIR/contrato_selects.py" --repo "$REPO" --db "$DB" --solo-embebidos > "$OUT/contrato_pre_I.log" 2>&1; then
  tail -n 1 "$OUT/contrato_pre_I.log" | sed 's/^/  /'
else
  sed 's/^/    /' "$OUT/contrato_pre_I.log"; FALLAS=$((FALLAS + 1))
fi

sql_file "$SUPA/migrations/$MIG_I"
run_suites GRACTOI "… + O + integridad"
snapshot "$OUT/snap_GRACTOI.txt"

sql_file "$SUPA/migrations/$MIG_P"
run_suites GRACTOIP "… + I + columnas tenants"
snapshot "$OUT/snap_GRACTOIP.txt"

sql_file "$SUPA/migrations/$MIG_B"
run_suites GRACTOIPB "… + P + billing_base"
snapshot "$OUT/snap_GRACTOIPB.txt"

sql_file "$SUPA/migrations/$MIG_OB"
run_suites GRACTOIPBO "… + B + operativo_billing"
snapshot "$OUT/snap_GRACTOIPBO.txt"
sql_file "$SUPA/migrations/$MIG_BF"
run_suites GRACTOIPBOF "… + corrección otro tenant"
snapshot "$OUT/snap_GRACTOIPBOF.txt"
sql_file "$SUPA/migrations/$MIG_IM"
run_suites GRACTOIPBOFM "… + gracia desde impago_desde"
snapshot "$OUT/snap_GRACTOIPBOFM.txt"
sql_file "$SUPA/migrations/$MIG_RE"
run_suites GRACTOIPBOFMR "… + residentes por enlace"
snapshot "$OUT/snap_GRACTOIPBOFMR.txt"

# El código llama a las RPC de registro, Super Admin, billing y
# residentes, lee suscripciones (con las columnas de billing) y
# actualiza tenants por columna: el contrato se verifica con el esquema
# completo.
echo "Contrato código ↔ esquema:"
if python3 "$DIR/contrato_selects.py" --repo "$REPO" --db "$DB" > "$OUT/contrato.log" 2>&1; then
  tail -n 1 "$OUT/contrato.log" | sed 's/^/  /'
else
  sed 's/^/    /' "$OUT/contrato.log"; FALLAS=$((FALLAS + 1))
fi

# Autoprueba: el contrato DEBE detectar embeds ambiguos (PGRST201) y FKs
# inexistentes o que no unen el par (contrato_autoprueba/: 4 errores).
echo "Autoprueba del contrato (embeds ambiguos):"
python3 "$DIR/contrato_selects.py" --repo "$DIR/contrato_autoprueba" --db "$DB" > "$OUT/contrato_autoprueba.log" 2>&1 && AUTO=0 || AUTO=$?
if [[ "$AUTO" == "1" ]] \
   && grep -q 'embeds.ts:8: embed ambiguo (PGRST201) paquetes → unidades' "$OUT/contrato_autoprueba.log" \
   && grep -q 'embeds.ts:10: embed ambiguo (PGRST201) paquete_historial → paquetes!inner' "$OUT/contrato_autoprueba.log" \
   && grep -q 'embeds.ts:12: FK inexistente en el embed paquetes → unidades!no_existe_fkey' "$OUT/contrato_autoprueba.log" \
   && grep -q 'embeds.ts:14: FK incidencias_paquete_id_fkey no une paquetes con unidades' "$OUT/contrato_autoprueba.log" \
   && [[ "$(grep -c '^FAIL|' "$OUT/contrato_autoprueba.log")" == "4" ]]; then
  echo "  detecta los 4 embeds incorrectos y acepta el correcto"
else
  echo "  la autoprueba NO detecta lo esperado:"; sed 's/^/    /' "$OUT/contrato_autoprueba.log"; FALLAS=$((FALLAS + 1))
fi

sql_file "$DOWN_RE";                   snapshot "$OUT/snap_GRACTOIPBOFMb.txt"; igual "$OUT/snap_GRACTOIPBOFM.txt" "$OUT/snap_GRACTOIPBOFMb.txt" rollback_RE
sql_file "$DOWN_IM";                   snapshot "$OUT/snap_GRACTOIPBOFb.txt"; igual "$OUT/snap_GRACTOIPBOF.txt" "$OUT/snap_GRACTOIPBOFb.txt" rollback_IM
sql_file "$DOWN_BF";                   snapshot "$OUT/snap_GRACTOIPBOb.txt"; igual "$OUT/snap_GRACTOIPBO.txt" "$OUT/snap_GRACTOIPBOb.txt" rollback_BF
sql_file "$DOWN_OB";                   snapshot "$OUT/snap_GRACTOIPBb.txt"; igual "$OUT/snap_GRACTOIPB.txt" "$OUT/snap_GRACTOIPBb.txt" rollback_OB
sql_file "$DOWN_B";                    snapshot "$OUT/snap_GRACTOIPb.txt"; igual "$OUT/snap_GRACTOIP.txt" "$OUT/snap_GRACTOIPb.txt" rollback_B
sql_file "$DOWN_P";                    snapshot "$OUT/snap_GRACTOIb.txt"; igual "$OUT/snap_GRACTOI.txt" "$OUT/snap_GRACTOIb.txt" rollback_P
sql_file "$DOWN_I";                    snapshot "$OUT/snap_GRACTOb.txt"; igual "$OUT/snap_GRACTO.txt" "$OUT/snap_GRACTOb.txt" rollback_I
sql_file "$DOWN_O";                    snapshot "$OUT/snap_GRACTb.txt"; igual "$OUT/snap_GRACT.txt" "$OUT/snap_GRACTb.txt" rollback_O
sql_file "$DOWN_T";                    snapshot "$OUT/snap_GRACb.txt"; igual "$OUT/snap_GRAC.txt" "$OUT/snap_GRACb.txt" rollback_T
sql_file "$DOWN_C";                    snapshot "$OUT/snap_GRA3.txt"; igual "$OUT/snap_GRA2.txt" "$OUT/snap_GRA3.txt" rollback_C

if [[ "$FALLAS" == "0" ]]; then echo "OK"; else echo "FALLAS: $FALLAS"; exit 1; fi

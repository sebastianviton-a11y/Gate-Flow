#!/usr/bin/env bash
# ============================================================
# Ensayo LOCAL de las migraciones pendientes de producción sobre su
# forma real (nunca contra Supabase):
#   1. base "forma de producción": stub + migraciones del repo hasta
#      20260729000000 + parche_forma_produccion.sql (drift leído del
#      catálogo de producción en solo lectura, 2026-10-08)
#   2. datos SINTÉTICOS con la forma y el volumen de producción
#   3. las 16 migraciones en orden (las mismas que staging)
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
      20261008300000_billing_evento_otro_tenant 20261009000000_billing_impago_desde
      20261011000000_residentes_enlace 20261013000000_superadmin_suscripcion_manual
      20261014000000_documentos_legales 20261015000000_documentos_legales_lectura_publica)
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

# D0: copia de cada tabla existente antes de migrar; después se comparan solo
# las columnas que ya existían (las migraciones agregan columnas nuevas, en NULL).
sql <<'SQL'
create schema zz_antes;
do $$ declare t text; begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
    execute format('create table zz_antes.%I as select * from public.%I', t, t);
  end loop;
end $$;
SQL
for m in "${MIGS[@]}"; do
  inicio=$(date +%s%N)
  sql -f "$SUPA/migrations/$m.sql" >/dev/null
  echo "aplicada $m ($(( ($(date +%s%N) - inicio) / 1000000 )) ms)"
done
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" > "$OUT/d0.txt" 2>&1 <<'SQL' || true
do $$ declare t text; cols text; n bigint; total bigint := 0; filas bigint; tablas int := 0; distintas text := '';
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'zz_antes'::regnamespace and c.relkind = 'r' order by 1 loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a where a.attrelid = format('zz_antes.%I', t)::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('select count(*) from ((select row(%1$s)::text from public.%2$I except all select row(%1$s)::text from zz_antes.%2$I)
                    union all (select row(%1$s)::text from zz_antes.%2$I except all select row(%1$s)::text from public.%2$I)) d', cols, t) into n;
    execute format('select count(*) from zz_antes.%I', t) into filas;
    total := total + filas; tablas := tablas + 1;
    if n > 0 then distintas := distintas || format(' %s(%s)', t, n); end if;
  end loop;
  if distintas = '' then raise notice 'PASS|D0|ninguna fila existente cambió (% tablas, % filas; columnas previas)', tablas, total;
  else raise notice 'FAIL|D0|cambiaron filas existentes:%', distintas; end if;
end $$;
drop schema zz_antes cascade;
SQL
grep -E "PASS\||FAIL\||ERROR" "$OUT/d0.txt" | sed 's/^.*NOTICE:  //'
psql -X -q -d "$DB" -f "$DIR/verificacion_post.sql" 2>&1 | grep -E "PASS\||FAIL\||ERROR" | sed 's/^.*NOTICE:  //'

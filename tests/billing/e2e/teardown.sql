-- ============================================================
-- Teardown CONFIRMADO de los fixtures de la capa C local, con el mismo
-- gf_teardown de la capa B (ids registrados + marca + conteo de filas).
-- SOLO base local gf_billing_*.
--   psql -v run=… -v reg='{"empresa":…,"tenants":[…],"users":[…],"eventos":[…]}' -At -f teardown.sql
-- Imprime: CREADOS|{…} (filas ligadas al registro), BORRADAS|{…} y RESIDUOS|{…}.
-- ============================================================
\set ON_ERROR_STOP 1
begin;
select set_config('gf.run', :'run', true), set_config('gf.reg', :'reg', true) \g /dev/null
do $g$ begin
  if current_database() not like 'gf\_billing\_%' then
    raise exception 'teardown e2e: solo en una base local gf_billing_* (actual: %)', current_database();
  end if;
end $g$;
\ir ../db/teardown.sql
select 'CREADOS|' || pg_temp.gf_conteo(current_setting('gf.run'), current_setting('gf.reg')::jsonb)::text;
select 'BORRADAS|' || pg_temp.gf_teardown(current_setting('gf.run'), current_setting('gf.reg')::jsonb)::text;
select 'RESIDUOS|' || pg_temp.gf_conteo(current_setting('gf.run'), current_setting('gf.reg')::jsonb)::text;
commit;

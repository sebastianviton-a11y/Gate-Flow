-- ============================================================
-- Helpers de los tests de seguridad. Cada caso reporta una línea
-- NOTICE con el formato:
--   PASS|<id>|<descripción>
--   FAIL|<id>|<descripción>|<detalle>
-- El runner (run-local.sh) cuenta ambas. Un FAIL nunca aborta la
-- suite: cada caso corre en su propia transacción con ROLLBACK.
-- ============================================================

drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.pass(p_id text, p_desc text) returns void
language plpgsql as $$
begin
  raise notice 'PASS|%|%', p_id, p_desc;
end $$;

create function tests.fail(p_id text, p_desc text, p_detalle text) returns void
language plpgsql as $$
begin
  raise notice 'FAIL|%|%|%', p_id, p_desc, p_detalle;
end $$;

-- Fallo conocido y documentado, pendiente de una corrección aprobada.
-- No cuenta como PASS ni como FAIL: el runner lo lista aparte.
create function tests.pendiente(p_id text, p_desc text) returns void
language plpgsql as $$
begin
  raise notice 'PENDIENTE|%|%', p_id, p_desc;
end $$;

-- Simula el JWT de una petición PostgREST para el resto de la
-- transacción (el rol se cambia aparte, con SET LOCAL ROLE).
create function tests.como(p_uid uuid, p_rol text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol)::text, true);
end $$;

-- El SQL debe fallar. Si se indica p_sqlstate, debe fallar con ese código.
create function tests.debe_fallar(p_id text, p_desc text, p_sql text, p_sqlstate text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_sqlstate is null or sqlstate = p_sqlstate then
      perform tests.pass(p_id, p_desc || ' [' || sqlstate || ']');
    else
      perform tests.fail(p_id, p_desc, 'falló con ' || sqlstate || ' (esperado ' || p_sqlstate || '): ' || sqlerrm);
    end if;
    return;
  end;
  perform tests.fail(p_id, p_desc, 'se ejecutó sin error');
end $$;

-- El SQL debe ejecutarse sin error.
create function tests.debe_funcionar(p_id text, p_desc text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform tests.pass(p_id, p_desc);
exception when others then
  perform tests.fail(p_id, p_desc, sqlstate || ': ' || sqlerrm);
end $$;

-- UPDATE/DELETE bajo RLS: una fila invisible no da error, afecta 0 filas.
create function tests.filas(p_id text, p_desc text, p_sql text, p_esperadas int) returns void
language plpgsql as $$
declare
  v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n = p_esperadas then
    perform tests.pass(p_id, p_desc || ' [' || v_n || ' filas]');
  else
    perform tests.fail(p_id, p_desc, v_n || ' filas afectadas, esperadas ' || p_esperadas);
  end if;
exception when others then
  if p_esperadas = 0 and sqlstate = '42501' then
    perform tests.pass(p_id, p_desc || ' [42501]');
  else
    perform tests.fail(p_id, p_desc, sqlstate || ': ' || sqlerrm);
  end if;
end $$;

-- Una consulta escalar debe devolver el valor esperado.
create function tests.igual(p_id text, p_desc text, p_sql text, p_esperado text) returns void
language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  if v is not distinct from p_esperado then
    perform tests.pass(p_id, p_desc || ' [' || coalesce(v, 'null') || ']');
  else
    perform tests.fail(p_id, p_desc, 'obtuvo ' || coalesce(v, 'null') || ', esperado ' || coalesce(p_esperado, 'null'));
  end if;
exception when others then
  perform tests.fail(p_id, p_desc, sqlstate || ': ' || sqlerrm);
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role, supabase_auth_admin;

-- ============================================================
-- Seguridad/auth por etapa del rollout de privilegios, con los grants
-- de mínimo privilegio de staging. La etapa se detecta del catálogo:
--   S0  antes de la migración A (staging hoy, código 59cd426)
--   SA  con la migración A (código viejo o fase B)
--   SC  con la fase C (sin vínculo de membresías por metadata)
-- Las invitaciones se simulan como GoTrue: INSERT en auth.users con el
-- rol supabase_auth_admin (metadata = `data` de inviteUserByEmail o de
-- un signUp público). El código viejo manda {tenant_id, rol_clave};
-- la fase B no manda metadata y llama otorgar_membresia como
-- service_role.
-- Un hueco que solo existe ANTES de su corrección se reporta como
-- PENDIENTE en esa etapa (documenta el riesgo actual) y como FAIL si
-- sigue abierto en una etapa posterior.
--
--   super  …0001 super_admin en P      admin_a …000a  guard_a …00a9
--   admin_b …000b  guard_b …00b9       mixto …00ab admin en A + guardia en B
--   admin_ab …00aa admin en A y en B
-- ============================================================

create temp table if not exists etapa as
select case
         when to_regprocedure('public.otorgar_membresia(uuid,uuid,text,uuid)') is null then 'S0'
         when exists (select 1 from pg_trigger where tgname = 'trg_vincular_membresia_heredada') then 'SA'
         else 'SC'
       end as e;
grant select on etapa to anon, authenticated, service_role, supabase_auth_admin;

create or replace function pg_temp.hueco(p_id text, p_desc text, p_abierto boolean, p_cerrado_desde text)
returns void language plpgsql as $$
declare
  v_e text := (select e from etapa);
  v_orden constant text[] := array['S0', 'SA', 'SC'];
begin
  if not p_abierto then
    perform tests.pass(p_id, p_desc || ' [' || v_e || ']');
  elsif array_position(v_orden, v_e) < array_position(v_orden, p_cerrado_desde) then
    perform tests.pendiente(p_id, p_desc || ': ABIERTO en ' || v_e || ', lo cierra ' || p_cerrado_desde);
  else
    perform tests.fail(p_id, p_desc, 'sigue abierto en ' || v_e);
  end if;
end $$;

do $$ begin raise notice 'INFO|60_rollout_auth etapa=%', (select e from etapa); end $$;

-- ── Login de cada rol (consulta de get-session y del middleware) ──

begin;
set local role authenticated;
do $$
declare
  v text;
  u record;
begin
  for u in select * from (values
      ('RO-01', '00000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000000|super_admin', 'super_admin'),
      ('RO-02', '00000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000000|admin_residencial', 'admin_residencial'),
      ('RO-03', '00000000-0000-0000-0000-0000000000a9', 'aaaaaaaa-0000-0000-0000-000000000000|guardia', 'guardia')) x(id, uid, esperado, rol)
  loop
    perform tests.como(u.uid::uuid);
    perform tests.igual(u.id, 'login ' || u.rol || ': get-session resuelve tenant real y rol (sin demo-tenant)',
      $q$select t.id::text || '|' || r.clave from public.user_tenants ut
         join public.roles r on r.id = ut.rol_id join public.tenants t on t.id = ut.tenant_id
         where ut.user_id = auth.uid() and ut.activo limit 1$q$, u.esperado);
  end loop;
  perform tests.como('00000000-0000-0000-0000-0000000000a9');
  perform tests.igual('RO-04', 'middleware: la consulta devuelve rol guardia (el panel Admin lo rechaza por rol)',
    $q$select r.clave || '|' || t.onboarding_completado from public.user_tenants ut
       join public.roles r on r.id = ut.rol_id join public.tenants t on t.id = ut.tenant_id
       where ut.user_id = auth.uid() and ut.activo limit 1$q$, 'guardia|true');
end $$;
rollback;

-- ── Invitación legítima: código viejo (metadata) ──────────────

begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11110000-0000-0000-0000-0000000000c1', 'inv-viejo@test.local',
   '{"tenant_id":"aaaaaaaa-0000-0000-0000-000000000000","rol_clave":"guardia"}');
reset role;
do $$
declare
  v_e text := (select e from etapa);
  v text := (select r.clave from public.user_tenants ut join public.roles r on r.id = ut.rol_id
             where ut.user_id = '11110000-0000-0000-0000-0000000000c1' and ut.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000');
begin
  if v_e in ('S0', 'SA') then
    if v = 'guardia' then
      perform tests.pass('RO-05', 'invitación del código viejo crea la membresía (compatible en ' || v_e || ')');
    else
      perform tests.fail('RO-05', 'invitación del código viejo', 'sin membresía en ' || v_e);
    end if;
  else
    if v is null then
      perform tests.pass('RO-05', 'con fase C la metadata ya no crea membresías: el código viejo NO puede volver (rollback de código solo antes de C)');
    else
      perform tests.fail('RO-05', 'fase C', 'la metadata aún crea membresías');
    end if;
  end if;
  perform tests.igual('RO-05b', 'el alta crea siempre el perfil en public.users',
    $q$select count(*)::text from public.users where id = '11110000-0000-0000-0000-0000000000c1'$q$, '1');
end $$;
rollback;

-- ── Invitación legítima: fase B (sin metadata + otorgar_membresia) ─

begin;
set local role supabase_auth_admin;
insert into auth.users (id, email) values ('11110000-0000-0000-0000-0000000000c2', 'inv-nuevo@test.local');
set local role service_role;
do $$
declare
  v_e text := (select e from etapa);
begin
  if v_e = 'S0' then
    perform tests.debe_fallar('RO-06', 'fase B antes de A: otorgar_membresia no existe → la invitación falla (B NO puede ir antes que A)',
      $q$select public.otorgar_membresia('11110000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000000',
                                         'guardia', '00000000-0000-0000-0000-00000000000a')$q$, '42883');
  else
    perform tests.igual('RO-06', 'fase B: admin A invita guardia → membresía creada server-side',
      $q$select public.otorgar_membresia('11110000-0000-0000-0000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000000',
                                         'guardia', '00000000-0000-0000-0000-00000000000a')$q$, 'creada');
    perform tests.igual('RO-06b', 'fase B: super_admin invita admin de B → membresía creada',
      $q$select public.otorgar_membresia('11110000-0000-0000-0000-0000000000c2', 'bbbbbbbb-0000-0000-0000-000000000000',
                                         'admin_residencial', '00000000-0000-0000-0000-000000000001')$q$, 'creada');
  end if;
end $$;
-- Aceptación: el invitado entra y actualiza su perfil; la sesión resuelve.
reset role;
select tests.como('11110000-0000-0000-0000-0000000000c2');
set local role authenticated;
do $$
begin
  if (select e from etapa) = 'S0' then return; end if;
  perform tests.filas('RO-07', 'aceptación: el invitado actualiza su propio perfil',
    $q$update public.users set nombre_completo = 'Invitado', terminos_aceptados_en = now() where id = auth.uid()$q$, 1);
  perform tests.igual('RO-07b', 'aceptación: el invitado inicia sesión en su residencial',
    $q$select count(*)::text from public.user_tenants where user_id = auth.uid() and activo$q$, '2');
end $$;
rollback;

-- ── E1: metadata manipulada (signUp público) ──────────────────

begin;
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11110000-0000-0000-0000-0000000000e1', 'atacante1@test.local',
   '{"tenant_id":"bbbbbbbb-0000-0000-0000-000000000000","rol_clave":"super_admin"}'),
  ('11110000-0000-0000-0000-0000000000e2', 'atacante2@test.local',
   '{"tenant_id":"bbbbbbbb-0000-0000-0000-000000000000","rol_clave":"admin_residencial"}'),
  ('11110000-0000-0000-0000-0000000000e3', 'atacante3@test.local',
   '{"tenant_id":"bbbbbbbb-0000-0000-0000-000000000000","rol_clave":"admin_empresa"}');
reset role;
do $$
begin
  perform pg_temp.hueco('E1-01', 'signUp con metadata rol_clave=super_admin no concede super_admin',
    exists (select 1 from public.user_tenants where user_id = '11110000-0000-0000-0000-0000000000e1'), 'SA');
  perform pg_temp.hueco('E1-02', 'signUp con metadata admin_empresa no concede rol',
    exists (select 1 from public.user_tenants where user_id = '11110000-0000-0000-0000-0000000000e3'), 'SA');
  perform pg_temp.hueco('E1-03', 'signUp con metadata admin_residencial en tenant ajeno no concede membresía',
    exists (select 1 from public.user_tenants where user_id = '11110000-0000-0000-0000-0000000000e2'), 'SC');
end $$;
rollback;

-- ── E2: membresías privilegiadas solo server-side ─────────────

begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
do $$
declare
  v_abierto boolean;
begin
  begin
    update public.user_tenants set rol_id = (select id from public.roles where clave = 'super_admin')
    where user_id = auth.uid();
    v_abierto := exists (select 1 from public.user_tenants ut join public.roles r on r.id = ut.rol_id
                         where ut.user_id = auth.uid() and r.clave = 'super_admin');
  exception when insufficient_privilege then v_abierto := false;
  end;
  perform pg_temp.hueco('E2-01', 'admin A no puede otorgarse super_admin (UPDATE rol_id)', v_abierto, 'SA');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.debe_fallar('E2-02', 'admin A no inserta membresías desde el cliente',
  $$insert into public.user_tenants (user_id, tenant_id, rol_id)
    select '00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000', id from public.roles where clave = 'guardia'$$,
  '42501');
do $$
begin
  if (select e from etapa) = 'S0' then return; end if;
  perform tests.debe_fallar('E2-03', 'otorgar_membresia no es ejecutable por authenticated',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'guardia', auth.uid())$q$, '42501');
end $$;
rollback;

begin;
set local role anon;
do $$
begin
  if (select e from etapa) = 'S0' then return; end if;
  perform tests.debe_fallar('E2-04', 'otorgar_membresia no es ejecutable por anon',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'guardia', '00000000-0000-0000-0000-00000000000a')$q$, '42501');
end $$;
rollback;

begin;
set local role service_role;
do $$
begin
  if (select e from etapa) = 'S0' then return; end if;
  perform tests.debe_fallar('E2-05', 'otorgar_membresia rechaza super_admin aunque lo pida un super_admin',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'super_admin', '00000000-0000-0000-0000-000000000001')$q$, '22023');
  perform tests.debe_fallar('E2-06', 'otorgar_membresia: admin A no otorga en B',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000000',
                                       'guardia', '00000000-0000-0000-0000-00000000000a')$q$, '42501');
  perform tests.debe_fallar('E2-07', 'otorgar_membresia: un guardia no otorga membresías',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'guardia', '00000000-0000-0000-0000-0000000000a9')$q$, '42501');
end $$;
rollback;

-- ── E4: rol por tenant, sin role bleed, tenant_id inmóvil ─────

begin;
select tests.como('00000000-0000-0000-0000-0000000000ab');  -- admin en A, guardia en B
set local role authenticated;
do $$
declare
  n int;
begin
  update public.ubicaciones set descripcion = 'x' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform pg_temp.hueco('E4-01', 'guardia en B no hereda el admin de A (UPDATE ubicaciones de B)', n > 0, 'SA');
  update public.ubicaciones set descripcion = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000';
  get diagnostics n = row_count;
  perform tests.igual('E4-02', 'el mismo usuario sí es admin en A', format('select %L', n::text), '1');
end $$;
rollback;

begin;
select tests.como('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select tests.filas('E4-03', 'admin A no es admin en B (UPDATE unidades de B)',
  $$update public.unidades set notas = 'x' where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'$$, 0);
select tests.debe_fallar('E4-04', 'admin A no mueve una membresía de A a B',
  $$update public.user_tenants set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where user_id = '00000000-0000-0000-0000-0000000000a9'$$, '42501');
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000b9');
set local role authenticated;
select tests.filas('E4-05', 'guardia B no edita unidades de A',
  $$update public.unidades set notas = 'x' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000000'$$, 0);
rollback;

begin;
select tests.como('00000000-0000-0000-0000-0000000000aa');  -- admin en A y en B
set local role authenticated;
do $$
declare
  v_abierto boolean;
begin
  begin
    update public.unidades set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where id = 'a1000000-0000-0000-0000-000000000000';
    v_abierto := exists (select 1 from public.unidades where id = 'a1000000-0000-0000-0000-000000000000'
                         and tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000');
  exception when others then v_abierto := false;
  end;
  perform pg_temp.hueco('E4-06', 'tenant_id no se puede mover entre tenants (admin de ambos)', v_abierto, 'SA');
end $$;
rollback;

begin;
set local role service_role;
do $$
declare
  v_abierto boolean;
begin
  begin
    update public.user_tenants set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000'
    where user_id = '00000000-0000-0000-0000-0000000000a9';
    v_abierto := exists (select 1 from public.user_tenants where user_id = '00000000-0000-0000-0000-0000000000a9'
                         and tenant_id = 'bbbbbbbb-0000-0000-0000-000000000000');
  exception when others then v_abierto := false;
  end;
  perform pg_temp.hueco('E4-07', 'ni service_role mueve una membresía entre tenants', v_abierto, 'SA');
end $$;
rollback;

-- ── Roles que se pueden otorgar (flujos actuales) ─────────────
-- guardia ← admin del residencial o super_admin; admin_residencial ←
-- solo super_admin. La app ya lo aplica desde la fase B (puedeInvitar
-- y ROLES_INVITABLES); otorgar_membresia lo aplica en la base desde C.

begin;
set local role service_role;
do $$
declare
  v_e text := (select e from etapa);
  r text;
begin
  if v_e = 'S0' then return; end if;
  perform tests.igual('RO-10', 'admin A otorga guardia en A → creada',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'guardia', '00000000-0000-0000-0000-00000000000a')$q$, 'creada');
  perform tests.igual('RO-11', 'super_admin otorga admin_residencial en B → creada',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-000000000099', 'bbbbbbbb-0000-0000-0000-000000000000',
                                       'admin_residencial', '00000000-0000-0000-0000-000000000001')$q$, 'creada');
  foreach r in array array['super_admin', 'residente', 'admin_empresa', 'rol_inventado'] loop
    perform tests.debe_fallar('RO-12-' || r, 'otorgar_membresia rechaza ' || r,
      format($q$select public.otorgar_membresia('00000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000000',
                                                %L, '00000000-0000-0000-0000-000000000001')$q$, r), '22023');
  end loop;
  if v_e = 'SA' then
    raise notice 'INFO|RO-13..RO-15 solo en SC: en SA otorgar_membresia aún acepta supervisor/recepcion y que un admin otorgue admin_residencial (la app ya no lo pide)';
    return;
  end if;
  foreach r in array array['supervisor', 'recepcion'] loop
    perform tests.debe_fallar('RO-13-' || r, 'SC: otorgar_membresia rechaza ' || r,
      format($q$select public.otorgar_membresia('00000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000000',
                                                %L, '00000000-0000-0000-0000-000000000001')$q$, r), '22023');
  end loop;
  perform tests.debe_fallar('RO-14', 'SC: admin A no otorga admin_residencial en su propio residencial',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000000',
                                       'admin_residencial', '00000000-0000-0000-0000-00000000000a')$q$, '42501');
  perform tests.debe_fallar('RO-15', 'SC: admin A no otorga admin_residencial en B',
    $q$select public.otorgar_membresia('00000000-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000000',
                                       'admin_residencial', '00000000-0000-0000-0000-00000000000a')$q$, '42501');
end $$;
rollback;

-- ── Sin tenant inventado ──────────────────────────────────────

do $$
begin
  perform tests.igual('RO-08', 'no existe ningún tenant "demo-tenant" ni datos con ese id',
    $q$select count(*)::text from public.tenants where id::text = 'demo-tenant' or nombre ilike '%demo-tenant%'$q$, '0');
end $$;

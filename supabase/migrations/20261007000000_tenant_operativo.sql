-- ============================================================
-- 20261007000000_tenant_operativo.sql
--
-- Ciclo de vida del trial: un residencial no operativo (trial vencido,
-- suscripción past_due/canceled/expired, sin suscripción o tenant
-- suspendido) no puede crear ni modificar operación, aunque llame a la
-- API de Supabase sin pasar por la interfaz. Los datos se conservan y
-- se siguen pudiendo LEER: al reactivar la suscripción (active) todo
-- vuelve a funcionar sin recrear nada.
--
--   tenant_operativo(tenant)  SECURITY DEFINER, search_path vacío,
--                             falla cerrado. super_admin conserva su
--                             excepción administrativa.
--   Políticas RESTRICTIVAS    solo INSERT/UPDATE/DELETE, sobre cada
--                             tabla operativa y los buckets evidencia
--                             y logos. Se combinan con AND con las
--                             políticas existentes, que NO se tocan
--                             (E1/E2/E4 quedan igual); las lecturas no
--                             cambian.
--   entregar_paquete          verificación explícita: con el tenant
--                             no operativo el UPDATE bajo RLS afectaría
--                             0 filas en silencio; así falla con un
--                             error claro (42501).
--
-- Fuera a propósito (ver docs/operations/TRIAL_LIFECYCLE.md):
--   users (perfil propio), user_tenants.activo (revocar accesos debe
--   seguir siendo posible), audit_log vía registrar_auditoria,
--   suscripciones (sin políticas de escritura), empresas y alta/baja de
--   tenants (solo super_admin), refrescar_dashboard (solo vistas
--   materializadas). service_role y las funciones DEFINER internas no
--   pasan por RLS: no cambian.
--
-- tenants.estado_servicio: solo 'suspendido' bloquea, igual que hoy;
-- 'cancelado' no se redefine en esta fase.
-- Rollback: supabase/rollback/20261007000000_tenant_operativo.down.sql
-- ============================================================


-- ── 1. tenant_operativo ───────────────────────────────────────
create function public.tenant_operativo(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_tenant_id is null then false
    when public.is_super_admin() then true
    else exists (
      select 1
      from public.user_tenants ut
      join public.tenants t on t.id = ut.tenant_id
      join public.suscripciones s on s.tenant_id = t.id
      where ut.user_id = auth.uid()
        and ut.activo = true
        and ut.tenant_id = p_tenant_id
        and t.estado_servicio in ('piloto', 'activo', 'cancelado')
        and (
          s.estado = 'active'
          or (s.estado = 'trialing' and s.trial_ends_at is not null and pg_catalog.now() < s.trial_ends_at)
        )
    )
  end;
$$;

comment on function public.tenant_operativo(uuid) is
  'true si quien llama puede operar el tenant: super_admin, o miembro activo de un tenant no suspendido con suscripción active o trial vigente. Falla cerrado.';

revoke all on function public.tenant_operativo(uuid) from public, anon, authenticated, service_role;
grant execute on function public.tenant_operativo(uuid) to authenticated, service_role;


-- ── 2. Políticas restrictivas de escritura ────────────────────
-- Tablas con tenant_id propio.
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'paquetes', 'paquete_fotografias', 'paquete_firmas', 'paquete_grupos_entrega',
    'notificaciones', 'incidencias', 'unidades', 'residentes_unidades',
    'calles', 'manzanas', 'edificios', 'ubicaciones', 'empresas_paqueteria',
    'plantillas_notificacion', 'prioridades_paquete', 'tamanos_paquete'
  ] loop
    execute format('create policy %I on public.%I as restrictive for insert to public with check (public.tenant_operativo(tenant_id))',
                   v_tabla || '_operativo_insert', v_tabla);
    execute format('create policy %I on public.%I as restrictive for update to public using (public.tenant_operativo(tenant_id)) with check (public.tenant_operativo(tenant_id))',
                   v_tabla || '_operativo_update', v_tabla);
    execute format('create policy %I on public.%I as restrictive for delete to public using (public.tenant_operativo(tenant_id))',
                   v_tabla || '_operativo_delete', v_tabla);
  end loop;
end $$;

-- tenants: configuración del residencial (nombre, logo, onboarding…).
create policy tenants_operativo_update on public.tenants as restrictive for update to public
  using (public.tenant_operativo(id)) with check (public.tenant_operativo(id));

-- Tablas sin tenant_id: el tenant se resuelve por su padre.
do $$
declare
  v_tabla text;
  v_tenant text;
begin
  for v_tabla, v_tenant in values
    ('casas', '(select u.tenant_id from public.unidades u where u.id = unidad_id)'),
    ('departamentos', '(select u.tenant_id from public.unidades u where u.id = unidad_id)'),
    ('incidencia_fotografias', '(select i.tenant_id from public.incidencias i where i.id = incidencia_id)')
  loop
    execute format('create policy %I on public.%I as restrictive for insert to public with check (public.tenant_operativo(%s))',
                   v_tabla || '_operativo_insert', v_tabla, v_tenant);
    execute format('create policy %I on public.%I as restrictive for update to public using (public.tenant_operativo(%s)) with check (public.tenant_operativo(%s))',
                   v_tabla || '_operativo_update', v_tabla, v_tenant, v_tenant);
    execute format('create policy %I on public.%I as restrictive for delete to public using (public.tenant_operativo(%s))',
                   v_tabla || '_operativo_delete', v_tabla, v_tenant);
  end loop;
end $$;

-- Storage: fotos de evidencia y logos (carpeta raíz = tenant_id). El
-- CASE garantiza que el cast a uuid solo se evalúa en esos buckets;
-- los demás buckets no cambian.
create policy objects_operativo_insert on storage.objects as restrictive for insert to public
  with check (case when bucket_id in ('evidencia', 'logos')
                   then public.tenant_operativo(((storage.foldername(name))[1])::uuid) else true end);
create policy objects_operativo_update on storage.objects as restrictive for update to public
  using (case when bucket_id in ('evidencia', 'logos')
              then public.tenant_operativo(((storage.foldername(name))[1])::uuid) else true end)
  with check (case when bucket_id in ('evidencia', 'logos')
                   then public.tenant_operativo(((storage.foldername(name))[1])::uuid) else true end);
create policy objects_operativo_delete on storage.objects as restrictive for delete to public
  using (case when bucket_id in ('evidencia', 'logos')
              then public.tenant_operativo(((storage.foldername(name))[1])::uuid) else true end);


-- ── 3. entregar_paquete: error explícito ──────────────────────
-- Mismo cuerpo que el vigente (20260715000000_notificaciones_whatsapp), más la
-- verificación ANTES del SELECT … FOR UPDATE: con el tenant no
-- operativo, FOR UPDATE ya no ve la fila (aplica la política
-- restrictiva de UPDATE) y el error sería un engañoso "no existe".
-- Sigue siendo SECURITY INVOKER: las políticas restrictivas la cubren
-- igual. entregar_grupo_paquetes la llama por paquete.
create or replace function public.entregar_paquete(p_paquete_id uuid, p_entregado_por uuid, p_entregado_a_nombre text)
 returns paquetes
 language plpgsql
as $function$
declare
  v_paquete public.paquetes;
  v_destinatario_nombre text;
  v_destinatario_user_id uuid;
  v_tenant_id uuid;
begin
  select p.tenant_id into v_tenant_id from public.paquetes p where p.id = p_paquete_id;

  if found and not public.tenant_operativo(v_tenant_id) then
    raise exception 'El servicio de este residencial no está activo.'
      using errcode = '42501';
  end if;

  select * into v_paquete from public.paquetes where id = p_paquete_id for update;

  if not found then
    raise exception 'Paquete % no existe', p_paquete_id;
  end if;

  if v_paquete.estado_id = 'entregado' then
    raise exception 'El paquete % ya fue entregado el %', v_paquete.codigo_gateflow, v_paquete.fecha_entrega
      using errcode = 'P0001';
  end if;

  perform set_config('app.allow_delivery_update', 'true', true);

  update public.paquetes
  set
    estado_id = 'entregado',
    entregado_por = p_entregado_por,
    entregado_a_nombre = p_entregado_a_nombre,
    fecha_entrega = now()
  where id = p_paquete_id
  returning * into v_paquete;

  -- Resolver a quién notificar: residente formal si existe, si no, el
  -- contacto informal de la unidad (mismo criterio que registrarPaquete
  -- en TypeScript, packages/paquetes/src/mutations.ts).
  select u.nombre_completo, u.id into v_destinatario_nombre, v_destinatario_user_id
  from public.users u where u.id = v_paquete.residente_id;

  if v_destinatario_nombre is null then
    select un.contacto_nombre into v_destinatario_nombre
    from public.unidades un where un.id = v_paquete.unidad_id;
    v_destinatario_user_id := null;
  end if;

  if v_destinatario_nombre is not null then
    insert into public.notificaciones (
      tenant_id, paquete_id, destinatario_user_id, destinatario_nombre, canal, plantilla, contenido, estado_envio
    ) values (
      v_paquete.tenant_id, v_paquete.id, v_destinatario_user_id, v_destinatario_nombre, 'whatsapp',
      'paquete_entregado',
      format('Confirmamos: tu paquete %s fue entregado el %s.', v_paquete.codigo_gateflow, to_char(now(), 'DD/MM/YYYY HH24:MI')),
      'pendiente'
    );
  end if;

  return v_paquete;
end;
$function$;

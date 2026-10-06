-- ============================================================
-- 20261007100000_integridad_multitenant.sql
--
-- Integridad referencial multi-tenant: ninguna fila de un tenant puede
-- referenciar una entidad de OTRO tenant. Es integridad de datos: la
-- hace cumplir la base para todos (authenticated, service_role,
-- funciones DEFINER), sin depender de UI, cookie gf_tenant,
-- resolverAcceso, RLS ni tenant_operativo().
--
-- Origen (TO-56c): las FK simples paquetes.unidad_id → unidades(id)
-- solo exigen que la unidad exista. Las comprobaciones de FK no pasan
-- por RLS, así que un paquete del tenant B podía apuntar a una unidad
-- del tenant A (con membresía en ambos, o conociendo el uuid).
--
--   1. FK COMPUESTAS (declarativas) (columna, tenant_id) → padre(id,
--      tenant_id) donde el padre tiene tenant_id NOT NULL. Requieren
--      UNIQUE (id, tenant_id) en el padre. Se AGREGAN junto a las FK
--      existentes, que no se tocan: ON DELETE/ON UPDATE siguen igual
--      (la compuesta es NO ACTION y se verifica al final de la
--      sentencia, después de CASCADE/SET NULL). MATCH SIMPLE: una
--      columna NULL no se verifica (igual que hoy).
--   2. TRIGGERS de integridad donde no cabe una FK compuesta:
--      catálogos con filas globales (tenant_id NULL) y casas /
--      departamentos (sin tenant_id propio: el tenant es el de su
--      unidad).
--
-- Antes de crear nada se verifica que los datos existentes cumplan;
-- si no, la migración aborta sin cambios y dice qué relación falla.
-- Independiente de 20261007000000_tenant_operativo.sql.
-- Rollback: supabase/rollback/20261007100000_integridad_multitenant.down.sql
-- ============================================================


-- ── 0. Los datos existentes deben cumplir la regla ────────────
do $$
declare
  v_fallas text := '';
  v_n bigint;
  r record;
begin
  for r in
    select * from (values
      ('paquetes.unidad_id', 'select count(*) from public.paquetes x join public.unidades p on p.id = x.unidad_id where p.tenant_id <> x.tenant_id'),
      ('paquetes.ubicacion_id', 'select count(*) from public.paquetes x join public.ubicaciones p on p.id = x.ubicacion_id where p.tenant_id <> x.tenant_id'),
      ('paquetes.grupo_entrega_id', 'select count(*) from public.paquetes x join public.paquete_grupos_entrega p on p.id = x.grupo_entrega_id where p.tenant_id <> x.tenant_id'),
      ('paquete_grupos_entrega.unidad_id', 'select count(*) from public.paquete_grupos_entrega x join public.unidades p on p.id = x.unidad_id where p.tenant_id <> x.tenant_id'),
      ('residentes_unidades.unidad_id', 'select count(*) from public.residentes_unidades x join public.unidades p on p.id = x.unidad_id where p.tenant_id <> x.tenant_id'),
      ('incidencias.paquete_id', 'select count(*) from public.incidencias x join public.paquetes p on p.id = x.paquete_id where p.tenant_id <> x.tenant_id'),
      ('notificaciones.paquete_id', 'select count(*) from public.notificaciones x join public.paquetes p on p.id = x.paquete_id where p.tenant_id <> x.tenant_id'),
      ('paquete_firmas.paquete_id', 'select count(*) from public.paquete_firmas x join public.paquetes p on p.id = x.paquete_id where p.tenant_id <> x.tenant_id'),
      ('paquete_fotografias.paquete_id', 'select count(*) from public.paquete_fotografias x join public.paquetes p on p.id = x.paquete_id where p.tenant_id <> x.tenant_id'),
      ('paquete_historial.paquete_id', 'select count(*) from public.paquete_historial x join public.paquetes p on p.id = x.paquete_id where p.tenant_id <> x.tenant_id'),
      ('paquete_ubicacion_historial.paquete_id', 'select count(*) from public.paquete_ubicacion_historial x join public.paquetes p on p.id = x.paquete_id where p.tenant_id <> x.tenant_id'),
      ('paquete_ubicacion_historial.ubicacion_anterior_id', 'select count(*) from public.paquete_ubicacion_historial x join public.ubicaciones p on p.id = x.ubicacion_anterior_id where p.tenant_id <> x.tenant_id'),
      ('paquete_ubicacion_historial.ubicacion_nueva_id', 'select count(*) from public.paquete_ubicacion_historial x join public.ubicaciones p on p.id = x.ubicacion_nueva_id where p.tenant_id <> x.tenant_id'),
      ('manzanas.calle_id', 'select count(*) from public.manzanas x join public.calles p on p.id = x.calle_id where p.tenant_id <> x.tenant_id'),
      ('ubicaciones.padre_id', 'select count(*) from public.ubicaciones x join public.ubicaciones p on p.id = x.padre_id where p.tenant_id <> x.tenant_id'),
      ('paquetes.tamano_id', 'select count(*) from public.paquetes x join public.tamanos_paquete p on p.id = x.tamano_id where p.tenant_id is not null and p.tenant_id <> x.tenant_id'),
      ('paquetes.prioridad_id', 'select count(*) from public.paquetes x join public.prioridades_paquete p on p.id = x.prioridad_id where p.tenant_id is not null and p.tenant_id <> x.tenant_id'),
      ('paquetes.empresa_paqueteria_id', 'select count(*) from public.paquetes x join public.empresas_paqueteria p on p.id = x.empresa_paqueteria_id where p.tenant_id is not null and p.tenant_id <> x.tenant_id'),
      ('casas.calle_id', 'select count(*) from public.casas x join public.unidades u on u.id = x.unidad_id join public.calles p on p.id = x.calle_id where p.tenant_id <> u.tenant_id'),
      ('casas.manzana_id', 'select count(*) from public.casas x join public.unidades u on u.id = x.unidad_id join public.manzanas p on p.id = x.manzana_id where p.tenant_id <> u.tenant_id'),
      ('departamentos.edificio_id', 'select count(*) from public.departamentos x join public.unidades u on u.id = x.unidad_id join public.edificios p on p.id = x.edificio_id where p.tenant_id <> u.tenant_id')
    ) as t(relacion, consulta)
  loop
    execute r.consulta into v_n;
    if v_n > 0 then
      v_fallas := v_fallas || format(' %s=%s', r.relacion, v_n);
    end if;
  end loop;
  if v_fallas <> '' then
    raise exception 'integridad_multitenant: hay referencias cruzadas entre tenants; no se aplica nada:%', v_fallas;
  end if;
end $$;


-- ── 1. UNIQUE (id, tenant_id) en los padres ───────────────────
alter table public.unidades               add constraint uq_mt_unidades_id_tenant unique (id, tenant_id);
alter table public.ubicaciones            add constraint uq_mt_ubicaciones_id_tenant unique (id, tenant_id);
alter table public.paquete_grupos_entrega add constraint uq_mt_grupos_entrega_id_tenant unique (id, tenant_id);
alter table public.paquetes               add constraint uq_mt_paquetes_id_tenant unique (id, tenant_id);
alter table public.calles                 add constraint uq_mt_calles_id_tenant unique (id, tenant_id);


-- ── 2. FK compuestas (NO ACTION; las FK originales no cambian) ─
alter table public.paquetes
  add constraint fk_mt_paquetes_unidad foreign key (unidad_id, tenant_id) references public.unidades (id, tenant_id),
  add constraint fk_mt_paquetes_ubicacion foreign key (ubicacion_id, tenant_id) references public.ubicaciones (id, tenant_id),
  add constraint fk_mt_paquetes_grupo_entrega foreign key (grupo_entrega_id, tenant_id) references public.paquete_grupos_entrega (id, tenant_id);

alter table public.paquete_grupos_entrega
  add constraint fk_mt_grupos_entrega_unidad foreign key (unidad_id, tenant_id) references public.unidades (id, tenant_id);

alter table public.residentes_unidades
  add constraint fk_mt_residentes_unidades_unidad foreign key (unidad_id, tenant_id) references public.unidades (id, tenant_id);

alter table public.incidencias
  add constraint fk_mt_incidencias_paquete foreign key (paquete_id, tenant_id) references public.paquetes (id, tenant_id);

alter table public.notificaciones
  add constraint fk_mt_notificaciones_paquete foreign key (paquete_id, tenant_id) references public.paquetes (id, tenant_id);

alter table public.paquete_firmas
  add constraint fk_mt_paquete_firmas_paquete foreign key (paquete_id, tenant_id) references public.paquetes (id, tenant_id);

alter table public.paquete_fotografias
  add constraint fk_mt_paquete_fotografias_paquete foreign key (paquete_id, tenant_id) references public.paquetes (id, tenant_id);

alter table public.paquete_historial
  add constraint fk_mt_paquete_historial_paquete foreign key (paquete_id, tenant_id) references public.paquetes (id, tenant_id);

alter table public.paquete_ubicacion_historial
  add constraint fk_mt_ubicacion_historial_paquete foreign key (paquete_id, tenant_id) references public.paquetes (id, tenant_id),
  add constraint fk_mt_ubicacion_historial_anterior foreign key (ubicacion_anterior_id, tenant_id) references public.ubicaciones (id, tenant_id),
  add constraint fk_mt_ubicacion_historial_nueva foreign key (ubicacion_nueva_id, tenant_id) references public.ubicaciones (id, tenant_id);

alter table public.manzanas
  add constraint fk_mt_manzanas_calle foreign key (calle_id, tenant_id) references public.calles (id, tenant_id);

alter table public.ubicaciones
  add constraint fk_mt_ubicaciones_padre foreign key (padre_id, tenant_id) references public.ubicaciones (id, tenant_id);


-- ── 3. Triggers donde no cabe una FK compuesta ────────────────
-- SECURITY DEFINER con search_path vacío: leen el padre sin RLS para
-- que la verificación sea completa para cualquier rol (falla cerrado).

-- Catálogos con filas globales (tenant_id NULL): global o del mismo tenant.
create function public.fn_mt_catalogos_paquete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tamano_id is not null and not exists (
    select 1 from public.tamanos_paquete c where c.id = new.tamano_id and (c.tenant_id is null or c.tenant_id = new.tenant_id)
  ) then
    raise exception 'tamano_id % no pertenece al tenant % del paquete', new.tamano_id, new.tenant_id using errcode = '23503';
  end if;
  if new.prioridad_id is not null and not exists (
    select 1 from public.prioridades_paquete c where c.id = new.prioridad_id and (c.tenant_id is null or c.tenant_id = new.tenant_id)
  ) then
    raise exception 'prioridad_id % no pertenece al tenant % del paquete', new.prioridad_id, new.tenant_id using errcode = '23503';
  end if;
  if new.empresa_paqueteria_id is not null and not exists (
    select 1 from public.empresas_paqueteria c where c.id = new.empresa_paqueteria_id and (c.tenant_id is null or c.tenant_id = new.tenant_id)
  ) then
    raise exception 'empresa_paqueteria_id % no pertenece al tenant % del paquete', new.empresa_paqueteria_id, new.tenant_id using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger trg_mt_paquetes_catalogos
  before insert or update of tamano_id, prioridad_id, empresa_paqueteria_id, tenant_id on public.paquetes
  for each row execute function public.fn_mt_catalogos_paquete();

-- casas: la calle y la manzana deben ser del tenant de la unidad.
create function public.fn_mt_casas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select u.tenant_id into v_tenant from public.unidades u where u.id = new.unidad_id;
  if v_tenant is null then
    raise exception 'unidad_id % no existe', new.unidad_id using errcode = '23503';
  end if;
  if new.calle_id is not null and not exists (select 1 from public.calles c where c.id = new.calle_id and c.tenant_id = v_tenant) then
    raise exception 'calle_id % no pertenece al tenant % de la unidad', new.calle_id, v_tenant using errcode = '23503';
  end if;
  if new.manzana_id is not null and not exists (select 1 from public.manzanas m where m.id = new.manzana_id and m.tenant_id = v_tenant) then
    raise exception 'manzana_id % no pertenece al tenant % de la unidad', new.manzana_id, v_tenant using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger trg_mt_casas
  before insert or update of unidad_id, calle_id, manzana_id on public.casas
  for each row execute function public.fn_mt_casas();

-- departamentos: el edificio debe ser del tenant de la unidad.
create function public.fn_mt_departamentos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select u.tenant_id into v_tenant from public.unidades u where u.id = new.unidad_id;
  if v_tenant is null then
    raise exception 'unidad_id % no existe', new.unidad_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.edificios e where e.id = new.edificio_id and e.tenant_id = v_tenant) then
    raise exception 'edificio_id % no pertenece al tenant % de la unidad', new.edificio_id, v_tenant using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger trg_mt_departamentos
  before insert or update of unidad_id, edificio_id on public.departamentos
  for each row execute function public.fn_mt_departamentos();

-- Funciones de trigger: nadie las llama por la API.
revoke all on function public.fn_mt_catalogos_paquete() from public, anon, authenticated, service_role;
revoke all on function public.fn_mt_casas() from public, anon, authenticated, service_role;
revoke all on function public.fn_mt_departamentos() from public, anon, authenticated, service_role;

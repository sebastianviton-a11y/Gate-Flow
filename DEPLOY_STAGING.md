# DEPLOY_STAGING.md

Instrucciones exactas para dejar GateFlow publicado en un entorno de staging: Supabase (backend) + Netlify ×2 (admin y guard) + GitHub (fuente de despliegue continuo). Pensado para seguirse en orden, sin improvisar pasos.

**Antes de empezar:** necesitas cuentas en GitHub, Netlify y Supabase (los tres tienen tier gratuito suficiente para esto). Tiempo estimado: 30-40 minutos si no hay imprevistos.

---

## 0. Resumen del flujo

```
GitHub (tu repo) → Netlify detecta push → build → publica
                  ↘
                    Supabase (proyecto de staging, independiente)
```

Dos sitios de Netlify (`gateflow-admin`, `gateflow-guard`) apuntan al **mismo repositorio**, cada uno construyendo solo su parte del monorepo — no hay dos repos, no hay código duplicado.

---

## 1. GitHub

```bash
cd gateflow
git init
git add .
git commit -m "GateFlow — versión inicial para staging"
```

Crea un repositorio vacío en GitHub (privado, recomendado — sigue siendo staging, no expongas el código innecesariamente) y súbelo:

```bash
git remote add origin https://github.com/TU_USUARIO/gateflow.git
git branch -M main
git push -u origin main
```

`.gitignore` ya excluye `node_modules/`, `.next/`, `.env*` — verificado, no hace falta tocarlo.

---

## 2. Supabase — proyecto de staging

1. En [supabase.com](https://supabase.com), crea un **proyecto nuevo** exclusivo para staging (no reutilices uno existente). Región sugerida: la más cercana a México (`us-east-1` si no hay una específica de México/LatAm disponible en tu plan).
2. Anota **Project URL** y **anon public key** (Settings → API) — los necesitas en el paso 4.
3. Instala el CLI si no lo tienes: `npm install -g supabase`.
4. Vincula y aplica las migraciones (12 archivos, en orden por nombre):
   ```bash
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase db push
   ```
5. Ejecuta los catálogos globales y los datos demo, en este orden:
   ```bash
   psql "$(supabase db remote-connection-string)" -f supabase/seed.sql
   psql "$(supabase db remote-connection-string)" -f supabase/seed-staging.sql
   ```
   La segunda ejecución imprime un `NOTICE` con el UUID del tenant demo (`Residencial Demo GateFlow`) — **cópialo**, lo necesitas en el paso 5.

### Storage

El bucket `evidencia` y sus políticas ya se crean con las migraciones (`20260716000000_storage_evidencia.sql`) — no requiere pasos manuales adicionales. Verifica en el dashboard (Storage) que el bucket `evidencia` existe y está marcado como **privado** (no público).

### Auth

No se requiere configuración especial para email+password. Antes de usar las URLs de Netlify:
- Authentication → URL Configuration → **Site URL**: la URL de `gateflow-admin` (paso 4).
- **Redirect URLs**: agrega ambas URLs de Netlify (`admin` y `guard`), cada una con `/**` al final (ej. `https://gateflow-admin.netlify.app/**`).

---

## 3. Netlify — por qué "Base directory" queda vacío

Confirmé esto contra la documentación actual de Netlify para monorepos antes de escribirlo, no de memoria: la recomendación vigente es **dejar "Base directory" sin definir** (apunta a la raíz del repo, donde vive `pnpm-workspace.yaml`) y usar **"Package directory"** para indicar de qué app es cada sitio — así la instalación de dependencias del workspace se resuelve correctamente. `apps/admin/netlify.toml` y `apps/guard/netlify.toml` ya están escritos asumiendo exactamente esto (rutas relativas a la raíz del repo, no a la carpeta de la app).

### Sitio 1 — gateflow-admin

1. Netlify → Add new site → Import an existing project → conecta el repo de GitHub.
2. **Package directory:** `apps/admin`. **Base directory:** déjalo vacío.
3. Netlify detectará `apps/admin/netlify.toml` automáticamente — build command y publish path ya vienen definidos ahí.
4. Nombre del sitio: `gateflow-admin` (o el que prefieras — la URL final depende de esto).

### Sitio 2 — gateflow-guard

Repite exactamente el mismo procedimiento, con **Package directory:** `apps/guard`, mismo repo.

---

## 4. Variables de entorno en Netlify

En **cada uno** de los dos sitios (Site configuration → Environment variables), agrega:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | La Project URL de tu proyecto Supabase de staging (paso 2). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La anon public key del mismo proyecto. |

**Nunca agregues `SERVICE_ROLE_KEY` en Netlify para estos dos sitios** — ni `apps/admin` ni `apps/guard` la necesitan; ambos usan exclusivamente el cliente `anon` protegido por RLS. Detalle completo de por qué, y de qué variable va dónde, en `ENVIRONMENT_VARIABLES.md`.

Tras guardar las variables, dispara un deploy manual (Deploys → Trigger deploy) en ambos sitios — las variables de entorno no aplican retroactivamente a un build ya iniciado.

---

## 5. Usuarios demo — crearlos y vincularlos

Los usuarios demo no se crean por SQL directo (requieren el sistema de Auth, no solo una fila en una tabla). En el dashboard de Supabase:

**Authentication → Users → Add user**, dos veces:

1. Admin: correo `admin-demo@gateflow.test`, contraseña que definas, **Auto Confirm User: sí**.
2. Guardia: correo `guardia-demo@gateflow.test`, contraseña que definas, **Auto Confirm User: sí**.

Copia el **UUID** de cada usuario creado (columna `id` en la tabla de usuarios del dashboard). Luego, en el SQL Editor de Supabase, ejecuta (reemplazando los tres UUID por los reales — el del tenant lo obtuviste en el paso 2):

```sql
-- Vincular ambos usuarios demo al tenant demo, cada uno con su rol.
insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
select 'UUID_DEL_ADMIN'::uuid, 'UUID_DEL_TENANT'::uuid, id, true
from public.roles where clave = 'admin_residencial';

insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
select 'UUID_DEL_GUARDIA'::uuid, 'UUID_DEL_TENANT'::uuid, id, true
from public.roles where clave = 'guardia';

-- Ahora sí, el paquete demo — recién es posible porque ya existe un
-- guardia real al que atribuirlo (recibido_por).
insert into public.paquetes (tenant_id, unidad_id, empresa_paqueteria_id, estado_id, ubicacion_id, tamano_id, prioridad_id, recibido_por, fecha_recepcion)
select
  'UUID_DEL_TENANT'::uuid,
  (select id from public.unidades where tenant_id = 'UUID_DEL_TENANT'::uuid and identificador = 'Casa 12'),
  (select id from public.empresas_paqueteria where nombre = 'DHL' and tenant_id is null),
  'recibido',
  (select id from public.ubicaciones where tenant_id = 'UUID_DEL_TENANT'::uuid and nombre = 'Estante A'),
  (select id from public.tamanos_paquete where clave = 'mediano' and tenant_id is null),
  (select id from public.prioridades_paquete where clave = 'normal' and tenant_id is null),
  'UUID_DEL_GUARDIA'::uuid,
  now() - interval '3 hours';
```

**Las credenciales demo (correo + contraseña de ambos usuarios) te las entrego por separado, no en este archivo ni en ningún archivo del repositorio** — ver el mensaje de cierre de esta entrega.

---

## 6. Verificación final

No declares esto terminado sin pasar `STAGING_TEST_CHECKLIST.md` completo. Los puntos mínimos irrenunciables:

1. Ambas URLs de Netlify cargan y redirigen a `/login` sin sesión.
2. Login con el usuario admin funciona en `gateflow-admin`.
3. Login con el usuario guardia funciona en `gateflow-guard`.
4. El paquete demo aparece en el dashboard y en el listado de admin.
5. Registrar un paquete nuevo desde guard funciona y aparece en admin.
6. Entregarlo funciona y no se puede entregar dos veces.

## 7. Rollback

Netlify conserva cada deploy — Deploys → selecciona uno anterior → "Publish deploy" revierte al instante, sin tocar Git. Para revertir el código fuente: `git revert` del commit problemático y push — dispara un nuevo build automáticamente.

## 8. Errores encontrados y corregidos durante esta preparación

- **Storage nunca tuvo bucket ni políticas** (`paquete_fotografias.storage_path` existía desde Sprint 02 sin nada detrás) — corregido con la migración 12.
- **El seed original de datos demo intentaba insertar un paquete referenciando un usuario que todavía no existía** en ese punto de la secuencia (los usuarios de Auth se crean después, no por SQL) — corregido separando la creación del tenant/unidades (`seed-staging.sql`, sin dependencia de usuarios) del paquete demo (§5 de este documento, después de crear las cuentas).

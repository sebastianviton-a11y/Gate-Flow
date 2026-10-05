# STAGING_SETUP.md — staging real e independiente de Gate Flow

Checklist para crear el entorno de staging. **Todavía no se ha creado
nada**: cada paso remoto espera aprobación explícita.

> El proyecto Supabase `xlozkpygubyiuxopmdxw` ("Gate Flow- Staging") es
> **PRODUCCIÓN**: lo usan gateflow.mx y guard.gateflow.mx. Está
> congelado. Nada de este documento lo toca, ni para leer datos.

## Entornos

| Entorno | Supabase | Sitio Netlify | URL | Rama Git |
|---|---|---|---|---|
| Producción Admin | `xlozkpygubyiuxopmdxw` | `startling-torrone-ff60f7` | https://gateflow.mx | `main` |
| Producción Guard | `xlozkpygubyiuxopmdxw` | `loquacious-paletas-bf35a2` | https://guard.gateflow.mx | `main` |
| **Staging Admin** | **`gateflow-staging`** (nuevo) | **`gateflow-admin-staging`** (nuevo) | https://gateflow-admin-staging.netlify.app | **`staging`** |
| **Staging Guard** | **`gateflow-staging`** (nuevo) | **`gateflow-guard-staging`** (nuevo) | https://gateflow-guard-staging.netlify.app | **`staging`** |
| Landing preview | ninguno | `gateflow-web-preview` | https://gateflow-web-preview.netlify.app | `claude/eloquent-tesla-qv0p3r` |

Reglas fijas:
- Ninguna URL, clave ni credencial se usa en dos entornos.
- Staging solo contiene datos ficticios. No se copia ninguna fila, ningún archivo de storage ni ninguna cuenta de producción.
- Las variables de Netlify van siempre a nivel de sitio, nunca a nivel de team.
- Antes de cualquier comando contra Supabase, se verifica que el project ref sea el de staging.

---

## 0. Prerrequisitos (bloquean todo lo demás)

- [ ] **Admin producción** (`startling-torrone-ff60f7`): Project configuration → Build & deploy → Continuous deployment → Branches and deploy contexts. "Branch deploys" debe decir **Deploy only the production branch**.
- [ ] **Guard producción** (`loquacious-paletas-bf35a2`): lo mismo.
  Sin esto, hacer push de `staging` o de cualquier otra rama podría construir Admin/Guard con las variables de producción.
- [ ] Netlify → Team settings → Environment variables: no hay ninguna variable `NEXT_PUBLIC_SUPABASE_*` ni `SUPABASE_SERVICE_ROLE_KEY` a nivel de team, porque se heredarían en los sitios nuevos.

## 1. Crear el proyecto Supabase de staging

- [ ] Organización `sebastianviton@hotmail.com's Org` (plan Pro). Costo: **$10 USD/mes**.
- [ ] Nombre del proyecto **`gateflow-staging`**, región **ca-central-1** (igual que producción), contraseña de la base nueva y guardada solo en un gestor de contraseñas.
- [ ] Anotar el **project ref** de staging. Debe ser distinto de `xlozkpygubyiuxopmdxw`.
- [ ] Settings → API Keys: usar las claves **legacy** `anon` y `service_role` (JWT), para tener paridad con producción.
- [ ] **PUNTO DE DETENCIÓN.** Si el proyecto entrega **solo** claves del formato nuevo (`sb_publishable_…` / `sb_secret_…`), **no se configuran las apps**. Antes hay que validar y reportar:
  - la versión instalada de `@supabase/supabase-js` (declarada `^2.45.4`) y de `@supabase/ssr` (`^0.5.1`);
  - cómo se consumen `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`packages/supabase/src/env.ts`) y `SUPABASE_SERVICE_ROLE_KEY` (`packages/supabase/src/service.ts`);
  - si el formato nuevo funciona sin cambios, incluida la API de administración de Auth (`inviteUserByEmail`, `deleteUser`) con la clave secreta;
  - si hay que renombrar variables o adaptar código.
  No se asume compatibilidad ni se cambia nada hasta tu aprobación.
- [ ] Database → Extensions: nada manual. Las migraciones crean lo necesario.

## 2. Migraciones (orden exacto)

Se aplican con el CLI para que `supabase_migrations.schema_migrations` quede con los mismos nombres que los archivos del repo. Primero se aplican **solo las 23 actuales**, sin la fase A. La fase A se aplica en el paso E4 de las pruebas.

```
 1 20260713230000_extensions_and_utils.sql
 2 20260713230100_core_platform.sql
 3 20260713230200_packages_module.sql
 4 20260713230300_search_and_dashboard.sql
 5 20260713230400_rls_policies.sql
 6 20260713230500_auth_provisioning.sql
 7 20260714000000_paquetes_sprint02.sql
 8 20260714010000_dashboard_promedio_entrega.sql
 9 20260714020000_unidades_contacto_informal.sql
10 20260714030000_notificaciones_demo.sql
11 20260715000000_notificaciones_whatsapp.sql
12 20260716000000_storage_evidencia.sql      (bucket evidencia, privado)
13 20260717000000_agregar_mercado_libre.sql
14 20260719000000_pickup_token.sql
15 20260721000000_bodega_ubicaciones.sql
16 20260722000000_editar_unidades.sql
17 20260722010000_logos_tenant.sql           (bucket logos)
18 20260723000000_super_admin.sql
19 20260724000000_empresas.sql
20 20260725000000_onboarding_invitaciones.sql
21 20260726000000_riesgos_criticos_auditoria.sql
22 20260728000000_grupos_entrega.sql
23 20260729000000_incidencias_historial.sql
--- después, en E4 ---
24 20260930000000_privilegios_fase_a.sql
--- después, en E7 ---
25 20261005180000_privilegios_fase_c.sql
```

- [ ] El repo no tiene `supabase/config.toml`. Correr `supabase init` en una copia de trabajo, sin commitear el archivo generado (o decidir versionarlo aparte).
- [ ] `supabase link --project-ref <REF_STAGING>`
- [ ] **Verificar** `cat supabase/.temp/project-ref` = `<REF_STAGING>`. Si dice `xlozkpygubyiuxopmdxw`, **detenerse**.
- [ ] Para aplicar solo las 23: hacer checkout de `main` (no contiene la fase A) y correr `supabase db push`.
- [ ] Comprobar en el dashboard que existen los buckets `evidencia` (privado) y `logos`.

## 3. Datos ficticios

- [ ] `supabase/seed.sql`: catálogos globales (roles, permisos, estados, tamaños, prioridades, paqueterías).
- [ ] `supabase/seed-staging.sql`: empresa E, tenants P / A / B, ubicaciones y unidades con nombres y teléfonos inventados. Es idempotente y **aborta si la base ya tiene otros datos**.
- Se ejecutan por el SQL Editor de staging o con `psql` usando la cadena de conexión de staging (Dashboard → Connect).
- [ ] **Super admin inicial.** Es el único vínculo que se hace a mano, porque aún no existe nadie que pueda otorgarlo.
  1. Authentication → Users → Add user: `sebastianviton+gf-super@gmail.com`, **Auto Confirm**, contraseña en el gestor.
  2. SQL Editor de staging:
     ```sql
     insert into public.user_tenants (user_id, tenant_id, rol_id, activo)
     select u.id, '5a000000-0000-4000-8000-000000000000', r.id, true
     from auth.users u, public.roles r
     where u.email = 'sebastianviton+gf-super@gmail.com' and r.clave = 'super_admin';
     ```
- Todas las demás cuentas se crean **por invitación desde Admin**. Así las pruebas ejercitan el flujo real.
- Correos de prueba: alias de tu Gmail (`sebastianviton+gf-admin1@gmail.com`, `+gf-guard1`, …). No se usan correos de personas reales.

## 4. Auth del proyecto staging

**URL Configuration**
- [ ] Site URL: `https://gateflow-admin-staging.netlify.app`
- [ ] Redirect URLs (solo estas):
  ```
  https://gateflow-admin-staging.netlify.app/aceptar-invitacion
  https://gateflow-admin-staging.netlify.app/restablecer-password
  https://gateflow-admin-staging.netlify.app/**
  https://gateflow-guard-staging.netlify.app/restablecer-password
  https://gateflow-guard-staging.netlify.app/**
  http://localhost:3000/**
  http://localhost:3001/**
  ```
  Sin ninguna URL de `gateflow.mx` ni de producción.

**Providers / Sign In**
- [ ] Email habilitado y "Confirm email" activado.
- [ ] Anonymous sign-ins desactivado.
- [ ] "Allow new users to sign up" **ACTIVADO al inicio**, igual que producción, para la línea base E2. Se desactiva en E3, que es el paso 0 (a).
- [ ] Longitud mínima de contraseña y expiración de JWT/OTP: los mismos valores que producción. Tú los lees en el dashboard de producción, solo lectura.

**Email templates**
- [ ] Invite user, Reset password y Confirm signup: copiar el texto desde el dashboard de producción (solo lectura, lo haces tú) y anteponer **`[STAGING]`** al asunto.

**SMTP**: ver §5.

## 5. Resend (SMTP de staging)

**Decisión aprobada:** remitente **`staging@mail.gateflow.mx`**, sobre el dominio ya verificado `mail.gateflow.mx`.
- Sin subdominio nuevo.
- Sin tocar DNS.
- **Nunca** se reutiliza la API key de producción.

- [ ] Resend → API Keys → crear **`gateflow-staging-smtp`**, exclusiva de staging, con permiso **Sending access** limitado al dominio `mail.gateflow.mx`.
- [ ] Remitente: `Gate Flow STAGING <staging@mail.gateflow.mx>`.
- Comparte la reputación del dominio con producción. Se mitiga enviando solo a tus alias de Gmail (sin rebotes).

**Supabase staging** → Authentication → Emails → SMTP Settings:
- [ ] Enable custom SMTP.
- [ ] Host `smtp.resend.com`, Port `465`, Username `resend`, Password = API key `gateflow-staging-smtp`.
- [ ] Sender email `staging@mail.gateflow.mx`, Sender name `Gate Flow STAGING`.
- [ ] Authentication → Rate Limits → emails: 30 por hora (suficiente para E2E).

## 6. Rama Git `staging`

- [ ] Crear `staging` desde `main` (`59cd426`, el mismo código que producción).
- [ ] Hacer push de `staging` **solo después del §0** (Branch deploys de producción confirmados).
- El trabajo de seguridad (`1807d82`) entra a `staging` en E6 con `git cherry-pick 1807d82`. No se hace merge de `claude/eloquent-tesla-qv0p3r`, para no mezclar los cambios de la landing.

## 7. Sitios Netlify (en este orden)

1. [ ] **gateflow-admin-staging**
   1. Add new project → Import from Git → `sebastianviton-a11y/Gate-Flow`.
   2. Branch to deploy: **`staging`**. Base directory vacío. Package directory **`apps/admin`** (el `netlify.toml` de la app define build y publish).
   3. **Antes del primer deploy**, cargar las variables del §8 a nivel de sitio.
   4. Tras crearlo, en Branches and deploy contexts: Branch deploys = **Deploy only the production branch**; Deploy Previews = **Don't deploy pull requests**.
   5. Sin dominio personalizado.
2. [ ] **gateflow-guard-staging**: igual, con Package directory **`apps/guard`**.
3. [ ] Si los nombres no están disponibles, actualizar las URLs del §4 y del §8 con los nombres reales antes de probar.

## 8. Variables de entorno (a nivel de sitio, valores de staging)

**Admin staging**

| Variable | Valor | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<REF_STAGING>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon de staging | |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role de staging | **Secreta**, marcar "Contains secret values". La usan las server actions de invitación. |
| `NEXT_PUBLIC_ADMIN_APP_URL` | `https://gateflow-admin-staging.netlify.app` | redirect de invitación y de recuperación |
| `NEXT_PUBLIC_GUARD_APP_URL` | `https://gateflow-guard-staging.netlify.app` | URL del QR de retiro |

**Guard staging**

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<REF_STAGING>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon de staging |
| `NEXT_PUBLIC_GUARD_APP_URL` | `https://gateflow-guard-staging.netlify.app` |

Guard no necesita la service role. `NODE_VERSION` ya viene en `netlify.toml`.

- [ ] Verificación tras el primer deploy: en DevTools → Network, todas las llamadas van a `<REF_STAGING>.supabase.co` y **ninguna** a `xlozkpygubyiuxopmdxw`.

## 9. Pruebas E2E iniciales

| # | Estado del staging | Prueba | Esperado |
|---|---|---|---|
| E0 | código `main`, 23 migraciones | Admin y Guard cargan; login del super admin → /superadmin | Todo va a staging |
| E1 | ídem | Registrar un paquete como guardia | **Falla** (bug previo `paquete_historial`, pendiente documentado). Se confirma que también pasa aquí |
| E2 | ídem, signup activado | Línea base: super admin crea "Residencial Prueba 1" e invita a `+gf-admin1` → llega el correo `[STAGING]` → acepta → crea contraseña → login → onboarding → invita a `+gf-guard1` → el guardia acepta → login en Guard | Todo funciona (referencia) |
| E3 | **signup desactivado** | **Paso 0 a–g**: (a) desactivar signup; `POST /auth/v1/signup` con la anon key → rechazado. (b)–(g) repetir E2 con `+gf-admin2` / `+gf-guard2` | a: 422 signup deshabilitado; b–g: igual que E2 |
| E4 | **+ Migración A**, código `main` | Repetir E2 con `+gf-admin3`. Regresión: admin edita unidades, activa/desactiva usuarios, sube logo; guardia entrega; super admin ve todos los tenants | La invitación funciona por el trigger transitorio; regresión igual que E2 |
| E5 | ídem | Con el JWT del admin de A: `POST /rest/v1/user_tenants` → rechazado; `PATCH` de `rol_id` → rechazado. Usuario mixto (admin en A, guardia en B): `PATCH /rest/v1/unidades` de B → 0 filas | E2/E4 cerrados en staging |
| E6 | **+ código fase B** (cherry-pick `1807d82` en `staging`) | Repetir E2 con `+gf-admin4`. SQL: `raw_user_meta_data` **sin** `tenant_id`/`rol_clave`; membresía creada; `audit_log` con `membresia.otorgada` | Funciona sin metadata |
| E7 | **+ Migración C** | Repetir E2 con `+gf-admin5`. Crear un usuario por la Auth admin API con metadata `{tenant_id, rol_clave}` → 0 membresías | E1 cerrado por completo |
| E8 | opcional | Simulacro: C.down → E2 → reaplicar C | Rollback verificado en un Supabase real |

Cada paso se registra en este documento (fecha, resultado, observaciones) antes de pasar al siguiente. Si algo falla, se detiene y se reporta.

## 10. Desmontaje (si hiciera falta)

- Pausar o borrar el proyecto `gateflow-staging` (deja de costar al borrarlo).
- Borrar los sitios `gateflow-admin-staging` y `gateflow-guard-staging`.
- Revocar la API key `gateflow-staging-smtp` en Resend.
- Borrar la rama `staging`.
- Ninguno de estos pasos afecta a producción.

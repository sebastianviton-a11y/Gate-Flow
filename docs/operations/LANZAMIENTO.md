# Lanzamiento comercial autónomo — plan de publicación

Meta: compartir **https://gateflow.mx** y que un residencial complete todo
solo, sin tarjeta y sin demostración:

landing → «Probar 30 días gratis» → **app.gateflow.mx/registro** → confirma
su correo → onboarding guiado → unidades, residentes, guardias y bodegas →
registra, avisa y entrega paquetes.

Contacto y demostración son secundarios: WhatsApp **+52 55 2324 8345**
(página Ayuda del panel y «Contacto»/«Soporte» de la landing).

## 0. Estado al 2026-10-19

- **Base de producción:** sin las 18 migraciones del registro autónomo y
  sin registro de versiones (se construyó a mano). Huella de estructura
  verificada en solo lectura el 2026-10-19: idéntica a la ensayada.
- **Datos de producción:** 3 residenciales **ficticios** (`estado_servicio`
  piloto), 8 cuentas, ningún cliente real. Se conservan.
- **Código de producción:** Admin y Guard sirven el código del 6 de agosto
  (`59cd426`, rama `main`).
- **PR #15** (`release/lanzamiento-2026-10` → `main`): todo `staging` más los
  dos workflows de `main`. CI verde, sin fusionar.
- **Landing:** `gateflow-web` publica la rama `publicacion/landing` en modo
  demo («Solicitar demo»), sin dominio propio.
- **Registro público:** cerrado. El signup de Supabase Auth está apagado
  desde el 2026-10-13 y `/registro` no abre sin pepper y Turnstile (§2).
- **Documentos legales:** no hay textos (§8).

## 1. Piezas

| Pieza | Producción | Staging |
|---|---|---|
| Base y Auth | Supabase `xlozkpygubyiuxopmdxw` (plan Pro, PostgreSQL 17) | Supabase `sfuckzzqejerrifuypby` |
| Landing | `gateflow-web`, rama `publicacion/landing`, sin dominio (destino: **gateflow.mx** y **www**) | `gateflow-web-preview` (previews) |
| Admin | `startling-torrone-ff60f7`, rama `main`, hoy en **gateflow.mx** (destino: **app.gateflow.mx**) | `gateflow-admin-staging` (rama `staging`) |
| Guard | `loquacious-paletas-bf35a2`, rama `main` → **guard.gateflow.mx** | `gateflow-guard-staging` (rama `staging`) |
| Correo | Resend, dominio `mail.gateflow.mx` (verificado) | el mismo, remitente de staging |
| Cobro | **Ninguno** (sin `STRIPE_*`): no hay cobro automático | Stripe TEST |

Deploys vigentes antes de la ventana (para volver atrás con «Publish
deploy»): Admin `6a74becd18122a0008bbdead`, Guard `6a74becd75ee23000810f771`,
landing `6ad651702d7fabe3618db6a0`.

## 2. Variables por sitio (Netlify, a nivel de sitio)

| Sitio | Variable | Valor | Cuándo |
|---|---|---|---|
| Admin | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | proyecto de producción | verificar antes del deploy |
| Admin | `SUPABASE_SERVICE_ROLE_KEY` | service_role de producción (secreta; solo Functions) | verificar antes del deploy |
| Admin | `NEXT_PUBLIC_ADMIN_APP_URL` | `https://app.gateflow.mx` | antes del deploy, con el dominio ya agregado (§5, C1) |
| Admin | `NEXT_PUBLIC_GUARD_APP_URL` | `https://guard.gateflow.mx` | antes del deploy |
| Admin | `REGISTRO_HASH_PEPPER` | `openssl rand -hex 32` (secreta, ≥16) | **al abrir el registro** (§5, E1) |
| Admin | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | widget de Cloudflare para `app.gateflow.mx` (la segunda, secreta) | **al abrir el registro** (§5, E1) |
| Admin | `REGISTRO_PAISES` | **no definir** (sin valor: solo México; `MX,AR` abre Argentina en la segunda etapa) | — |
| Admin | `STRIPE_*` | **no definir** | — |
| Guard | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | proyecto de producción | verificar antes del deploy |
| Guard | `NEXT_PUBLIC_GUARD_APP_URL` | `https://guard.gateflow.mx` | antes del deploy |
| Landing | `NEXT_PUBLIC_ADMIN_APP_URL` | `https://app.gateflow.mx` | ya definida |
| Landing | `NEXT_PUBLIC_LANDING_MODO` | hoy `demo`; **borrar** al abrir el registro | §5, E3 |
| Landing | `GF_LANDING_INDEXAR` | `1` al abrir el registro (antes: sin valor, `noindex`) | §5, E3 |

`/registro` falla cerrado: sin pepper, sin URL pública o sin claves reales
de Turnstile muestra «El registro no está disponible por ahora». Por eso el
código nuevo se puede publicar sin abrir el registro. Ningún archivo de
runtime depende de staging: `lib/entorno.ts` solo usa el ref de staging
para **reconocer** staging.

## 3. Supabase Auth de producción

- **Site URL:** `https://app.gateflow.mx`.
- **Redirect URLs:** `https://app.gateflow.mx/**`, `https://guard.gateflow.mx/**`
  y, durante la transición, `https://gateflow.mx/**` (enlaces ya enviados).
- **Allow new users to sign up:** sigue **OFF**. El alta la crea el
  servidor y el correo de confirmación sale con `auth.resend`.
  **Confirm email:** ON.
- **SMTP:** Resend con remitente de producción en `mail.gateflow.mx`
  (p. ej. `Gate Flow <no-reply@mail.gateflow.mx>`).
- **Plantillas en español:** «Confirm signup» con
  `supabase/templates/confirmar-registro.html`. «Invite user» y «Reset
  password» también en español (ver `supabase/templates/README.md`).
- **Rate limits → emails por hora:** subir el valor por defecto, para que
  una ola de registros no corte los correos de confirmación.

Enlaces que salen del panel: confirmación → `/confirmar-cuenta`, invitación →
`/aceptar-invitacion`, recuperación → `/restablecer-password` del mismo sitio
donde se pidió. Todos quedan dentro de las Redirect URLs de arriba.

## 4. Bloqueos del lanzamiento público

1. **Documentos legales (bloquea solo el paso E: abrir el registro).** No
   existe ningún texto, ni en `legal/` ni en otra rama. Ver §8.
2. **Base de producción sin las 18 migraciones (bloquea todo lo demás).**
   Scripts de la ventana preparados y ensayados (§5, B).
3. **Código de producción del 6 de agosto.** El PR #15 lo actualiza. Debe
   fusionarse **después** de aplicar las migraciones.
4. **Dominios.** `app.gateflow.mx` todavía no existe y gateflow.mx apunta
   al panel.

Resuelto desde la versión anterior de este plan: la aceptación con
evidencia (Fase 3, `20261017000000`) y la eliminación asistida
(`20261018000000`) están en las 18 migraciones y en el código del PR #15.
Quedan activas cuando haya documentos publicados y requisitos cargados (§8).

## 5. Orden de ejecución

Cada paso requiere autorización. Las fases B–D no abren el registro.

### A. Preparación (sin tocar producción)

| # | Paso | Comprobación |
|---|---|---|
| A1 | Revisar el PR #15 (sin fusionar) | CI verde |
| A2 | Respaldo disponible (§6): Dashboard → Database → Backups | hay un backup diario de las últimas 24 h |
| A3 | (Recomendado) Ensayo de recuperación: «Restore to a New Project» con ese backup y PROD_00 en la copia; después borrar la copia | PROD_00 da 11/11 ok y la misma huella de datos que producción |
| A4 | Preparar, sin cargarlos: pepper, widget de Turnstile para `app.gateflow.mx`, remitente de Resend | — |
| A5 | Textos legales en revisión jurídica (§8) | — |

### B. Ventana de base de datos (SQL Editor de producción, rol postgres)

Scripts entregados fuera del repositorio; verificar su md5 antes de usarlos.

| # | Script | md5 | Resultado esperado | Si falla |
|---|---|---|---|---|
| B1 | `PROD_00_precheck_solo_lectura.sql` | `757c35d38ff802cc465b84b611684123` | filas 1–15 sin `ok = false`; guardar la fila 99 | no seguir |
| B2 | `PROD_01_aplicar_18_migraciones.sql` | `ab890b1d47be4c4678781581f986f714` | «PROD_01 aplicada y registrada \| 20261018000000 \| 41 \| 3» | no se aplicó nada: `rollback;` y copiar el mensaje |
| B3 | `PROD_02_verificar_solo_lectura.sql` | `67f0727676b5db4cd83fbbbe90e5915b` | filas 1–14 ok; fila 99 igual a la de B1 | restaurar el respaldo (§6) |
| B4 | `PROD_03_execute_por_defecto_OPCIONAL.sql` | `0430d937d1e225bd238bd18b2e9df88f` | «PROD_03 aplicada \| postgres=X» (§11) | no se aplicó nada: `rollback;` |

PROD_01 es una sola transacción:
- precondiciones exactas: rol, versión, sin registro previo, huella de estructura y 0 referencias cruzadas;
- las 18 migraciones sin cambios;
- verificaciones antes del commit: estructura resultante, ninguna fila existente cambia, una suscripción `active`/`alta_manual` por residencial, cada membresía activa sigue operando;
- registro de las 41 versiones, con la misma huella que staging.

Ensayo local sobre la forma de producción: 38/38. Incluye abortos limpios por repetición, deriva de estructura, datos cruzados, falla a mitad de camino y bloqueo de la app.

Reemplaza a `supabase/tests/produccion/verificacion_produccion.sql`, que
lee `supabase_migrations` y falla antes de la ventana.

### C. Código y configuración (el registro sigue cerrado)

| # | Paso | Comprobación | Si falla |
|---|---|---|---|
| C1 | Agregar `app.gateflow.mx` como dominio adicional del sitio Admin (DNS + HTTPS) | https://app.gateflow.mx/login responde (código viejo) | quitar el dominio |
| C2 | Variables de Admin y Guard (§2, columna «antes del deploy») | — | — |
| C3 | Fusionar el PR #15 con «Create a merge commit», sin quitar `[skip netlify]` del mensaje: el merge **no** despliega | `main` contiene el merge | — |
| C4 | Deploy manual de Admin y Guard desde `main` (Trigger deploy) | login de un usuario ficticio en Admin y Guard; `/registro` muestra «no disponible» | «Publish deploy» del deploy anterior (§1) |
| C5 | Supabase Auth (§3) | correo de recuperación a una cuenta propia llega con enlace a app.gateflow.mx | volver a los valores anotados |

### D. Dominios

| # | Paso | Comprobación | Si falla |
|---|---|---|---|
| D1 | Mover gateflow.mx y www al sitio `gateflow-web` (sigue en modo demo) | gateflow.mx muestra la landing; `gateflow.mx/login` → `app.gateflow.mx/login` (308) | devolver el dominio al Admin |
| D2 | (Opcional) `gateflow-web` a la rama `main`, que ya incluye `apps/web` después de C3 | mismo resultado que D1 | volver a `publicacion/landing` |

### E. Abrir el registro (con los legales ya aprobados; se publican en E3)

E1 y E2 dejan `/registro` accesible por URL, sin anunciarlo: la landing
sigue en modo demo hasta E4.

| # | Paso | Comprobación |
|---|---|---|
| E1 | Admin: `REGISTRO_HASH_PEPPER`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y redeploy | https://app.gateflow.mx/registro muestra el formulario |
| E2 | Prueba controlada (§7), **antes** de publicar los legales, y su limpieza | 0 residuos |
| E3 | Publicar los legales en producción y cargar los requisitos (§8) | `/terminos?pais=MX` muestra la versión vigente |
| E4 | Landing: borrar `NEXT_PUBLIC_LANDING_MODO`, `GF_LANDING_INDEXAR=1`, redeploy | CTA «Probar 30 días gratis» → app.gateflow.mx/registro |

## 6. Respaldo y recuperación

- **Plan Pro:** backup diario automático, 7 días disponibles, físico
  (PostgreSQL 17). No incluye los archivos de Storage, pero las
  migraciones no los tocan.
- **Recuperación en el mismo proyecto:** Dashboard → Database → Backups →
  restaurar. Deja el proyecto inaccesible mientras dura. Como los datos son
  ficticios, perder lo posterior al backup no tiene costo.
- **Ensayo sin tocar producción:** «Restore to a New Project» (pestaña de
  la misma página) crea una copia independiente, con costo mientras exista.
  Sirve para verificar el backup con PROD_00 y después borrarla.
- **Opcional:** dump lógico propio con la CLI de Supabase (`supabase db
  dump`), ejecutado por quien tiene la contraseña.
- **Reversa de la base:** restaurar el backup. No hay reversión SQL de
  PROD_01: los rollbacks del repo no devuelven producción a su forma exacta.
- **Reversa del código:** en Netlify, «Publish deploy» del deploy anterior
  de cada sitio (ids en §1).

## 7. Prueba controlada en producción (solo con autorización)

Envía correos reales a un alias que controla el dueño (p. ej.
`<alias>+gf-lanzamiento@…`). Se hace en E2, **antes** de publicar los
legales: con documentos publicados, el alta deja evidencia de aceptación
inmutable y el script de limpieza se detiene a propósito.

1. app.gateflow.mx/registro → residencial **«ZZ PRUEBA CONTROLADA MX»**,
   país México.
2. Confirmar el correo → onboarding: 2 unidades, 1 residente, 1 ubicación, y
   la invitación a un guardia `<alias>+gf-lanzamiento-guardia@…`.
3. El guardia acepta, registra un paquete (**sin foto**), avisa por WhatsApp
   a un número propio y lo entrega con firma. Revisar el historial.
4. Recuperar la contraseña desde «¿Olvidaste tu contraseña?».
5. Limpieza: `supabase/tests/produccion/limpieza_prueba_controlada.sql`,
   primero con `ejecutar='no'` (simulacro) y después con `ejecutar='si'`. Se
   detiene si el residencial tiene miembros ajenos, aceptaciones legales,
   cobros o archivos en Storage. Verifica 0 residuos y que los demás
   residenciales no cambiaron.

## 8. Documentos legales

**Estado:** no existe ningún borrador. `legal/` tiene solo la plantilla y
los README, igual en todas las ramas. Staging tiene las 4 claves del
catálogo, sin versiones ni requisitos; producción todavía no tiene las
tablas (las crea PROD_01).

**Qué falta para publicar (México):**
1. Textos de Términos y Condiciones, Aviso de Privacidad (LFPDPPP) y Acuerdo
   de Tratamiento de Datos, redactados y aprobados por la revisión jurídica,
   con estos datos del titular:
   - razón social y RFC;
   - domicilio;
   - canal y plazo para derechos ARCO;
   - correos verificados;
   - jurisdicción;
   - plazo de conservación y eliminación a los 30 días;
   - transferencias internacionales (Canadá, EE. UU.).
2. Incorporarlos tal cual como `legal/<carpeta>/v1.0-mx.md`, con su
   frontmatter: `estado: publicado`, `vigente_desde` con zona y la
   referencia de `aprobacion`. Pasar `node scripts/legal/documentos-legales.mjs
   validar` (rechaza marcadores pendientes) por PR.
3. `sql-carga --publicar` y `sql-verificar`, primero en staging y después
   en producción (SQL Editor).
4. Decidir y cargar los **requisitos** por rol y país (`requisitos_legales`,
   hoy vacía): qué acepta el administrador al registrarse, qué acusa el
   guardia. Sin requisitos el alta registra lo que se muestra pero no exige
   nada. No hay script para esto todavía: es una carga corta que se prepara
   cuando exista la decisión.

Argentina (Ley 25.326) queda para la segunda etapa: el registro solo ofrece
México mientras `REGISTRO_PAISES` no la incluya. Ningún texto se redacta
aquí: se incorpora tal como lo entregue la revisión jurídica. Formato y
ciclo: `legal/README.md` y `docs/operations/LEGAL.md`.

## 9. Al día 30

La prueba vence, el residencial deja de operar y **conserva sus datos**; no
hay cobro automático. Con montos sin aprobación comercial, `/suscripcion`
muestra «La contratación en línea todavía no está disponible» y el WhatsApp
+52 55 2324 8345 para contratar. La continuidad es manual: Super Admin →
activar suscripción manual. Ninguna pantalla del panel muestra un correo de
contacto: todo el contacto comercial y de soporte es por WhatsApp.

## 10. Token de retiro expuesto en el video anterior (RETIRO-000018)

El video de la landing publicado hasta el PR #10 mostraba el enlace
`/escanear/<token>` del Guard de producción (el prefijo no se copia aquí).
El video entró al repo el 2026-10-08: si el token del grupo es anterior a esa
fecha, sigue siendo el del video. Qué expone:

- **Sin sesión:** nada. `/escanear/<token>` muestra «Presenta este código al
  personal de seguridad» sin consultar la base; `/escanear/<token>/qr` solo
  dibuja el QR del mismo enlace.
- **Con sesión de guardia:** solo un guardia del **mismo** residencial (RLS)
  ve el grupo; si ya se entregó, ve «Este paquete ya fue entregado».

Comprobación de solo lectura (producción, SQL Editor):

```sql
select g.codigo_grupo, g.estado, g.cantidad_total, g.cantidad_entregada,
       g.fecha_entrega is not null as entregado, g.token_created_at::date as token_desde,
       g.token_created_at < date '2026-10-09' as sigue_el_token_del_video,
       t.nombre as residencial
from public.paquete_grupos_entrega g join public.tenants t on t.id = g.tenant_id
where g.codigo_grupo = 'RETIRO-000018';
```

Invalidación sin tocar el historial (solo con confirmación): rotar el token
del grupo. `codigo_grupo`, paquetes, firmas e historial no cambian; el enlace
viejo deja de encontrar el grupo.

```sql
begin;
update public.paquete_grupos_entrega
-- misma fórmula que producción (migración 20260729200000): 64 hex, sin pgcrypto
set token = pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
         || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    token_created_at = now()
where codigo_grupo = 'RETIRO-000018' and token_created_at < date '2026-10-09';
-- debe decir UPDATE 1; si dice 0, ya se había rotado o no existe: rollback
commit;
```

Si el grupo sigue pendiente, el residente necesita un aviso nuevo (el
guardia lo reenvía desde el paquete). Si ya se entregó, rotar es opcional.

## 11. Permisos EXECUTE por defecto (PROD_03)

**Diferencia entre proyectos:**
- Producción es un proyecto Supabase antiguo: cada función nueva que
  postgres cree en `public` recibe EXECUTE explícito para anon,
  authenticated y service_role.
- Staging (proyecto nuevo) solo se lo da al dueño.

**Por qué importa:** con las 18 migraciones, las 92 funciones existentes
quedan con los mismos permisos efectivos que en staging. Solo
`fn_tenant_id_inmutable()` y `handle_new_auth_user()` conservan EXECUTE
para service_role; son funciones de trigger y no se pueden invocar. El
riesgo es para las **funciones futuras**: una migración que revocara solo
`from public` dejaría la función abierta a anon en producción y cerrada en
staging, y las pruebas de staging no lo verían.

**Corrección:** PROD_03 es una sola sentencia, sin tocar las migraciones
ensayadas: `alter default privileges for role postgres in schema public
revoke execute on functions from anon, authenticated, service_role`.
- Deja producción igual a staging en este punto.
- No cambia ninguna función existente.
- Se revierte con el `grant` inverso.
- Ensayo local: 13/13.

La convención de las migraciones (revocar siempre `from public, anon,
authenticated`) se mantiene. Pendiente: registrar la sentencia como
migración del repositorio después del lanzamiento (en staging no tiene
efecto).

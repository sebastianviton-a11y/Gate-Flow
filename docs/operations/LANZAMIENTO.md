# Lanzamiento comercial autónomo — plan de publicación

Meta: compartir **https://gateflow.mx** y que un residencial complete todo
solo, sin tarjeta y sin demostración:

landing → «Probar 30 días gratis» → **app.gateflow.mx/registro** → confirma
su correo → onboarding guiado → unidades, residentes, guardias y bodegas →
registra, avisa y entrega paquetes.

Contacto y demostración son secundarios: WhatsApp **+52 55 2324 8345**
(página Ayuda del panel y «Contacto»/«Soporte» de la landing).

## 1. Piezas

| Pieza | Producción | Staging |
|---|---|---|
| Base y Auth | Supabase `xlozkpygubyiuxopmdxw` | Supabase `sfuckzzqejerrifuypby` |
| Landing | `gateflow-web` → **gateflow.mx** y **www.gateflow.mx** (rama `main`) | `gateflow-web-preview` (previews) |
| Admin | `startling-torrone-ff60f7` → **app.gateflow.mx** (rama `main`) | `gateflow-admin-staging` (rama `staging`) |
| Guard | `loquacious-paletas-bf35a2` → **guard.gateflow.mx** (rama `main`) | `gateflow-guard-staging` (rama `staging`) |
| Correo | Resend, dominio `mail.gateflow.mx` (verificado) | el mismo, remitente de staging |
| Cobro | **Ninguno** (sin `STRIPE_*`): no hay cobro automático | Stripe TEST |

Hoy (2026-10-16) producción sirve el código del 6 de agosto (`59cd426`),
no tiene las 16 migraciones del registro autónomo y gateflow.mx es el panel.

## 2. Variables por sitio (Netlify, a nivel de sitio)

| Sitio | Variable | Valor | Alcance |
|---|---|---|---|
| Admin | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | proyecto de producción | Builds + Functions |
| Admin | `NEXT_PUBLIC_ADMIN_APP_URL` | `https://app.gateflow.mx` | Builds + Functions |
| Admin | `NEXT_PUBLIC_GUARD_APP_URL` | `https://guard.gateflow.mx` | Builds + Functions |
| Admin | `SUPABASE_SERVICE_ROLE_KEY` | service_role de producción (secreta) | Functions, solo Production |
| Admin | `REGISTRO_HASH_PEPPER` | `openssl rand -hex 32` (secreta, ≥16) | Functions, solo Production |
| Admin | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | widget de Cloudflare para `app.gateflow.mx` (la secreta, secreta) | Functions, solo Production |
| Admin | `REGISTRO_PAISES` | **no definir** (sin valor: solo México). `MX,AR` abre Argentina en la segunda etapa | Functions |
| Admin | `STRIPE_*` | **no definir** | — |
| Guard | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | proyecto de producción | Builds + Functions |
| Guard | `NEXT_PUBLIC_GUARD_APP_URL` | `https://guard.gateflow.mx` | Builds + Functions |
| Guard | `SUPABASE_SERVICE_ROLE_KEY` | service_role de producción (secreta) | Functions, solo Production |
| Landing | `NEXT_PUBLIC_ADMIN_APP_URL` | `https://app.gateflow.mx` | Builds |
| Landing | `GF_LANDING_INDEXAR` | `1` | Builds + Functions |
| Landing | `NEXT_PUBLIC_LANDING_MODO` | **borrar** (hoy vale `demo` en `gateflow-web`) | — |

`/registro` falla cerrado: sin pepper, sin URL pública o sin claves reales
de Turnstile queda deshabilitado (nunca abierto sin desafío). Ningún archivo
de runtime depende de staging: `lib/entorno.ts` solo usa el ref de staging
para **reconocer** staging.

## 3. Supabase Auth de producción

- **Site URL:** `https://app.gateflow.mx`.
- **Redirect URLs:** `https://app.gateflow.mx/**`, `https://guard.gateflow.mx/**`
  y, durante la transición, `https://gateflow.mx/**` (enlaces ya enviados).
- **Allow new users to sign up:** OFF (el alta la crea el servidor; el correo
  de confirmación sale con `auth.resend`). **Confirm email:** ON.
- **SMTP:** Resend con remitente de producción en `mail.gateflow.mx`
  (p. ej. `Gate Flow <no-reply@mail.gateflow.mx>`).
- **Plantillas en español:** «Confirm signup» con
  `supabase/templates/confirmar-registro.html`; «Invite user» y «Reset
  password» en español (ver `supabase/templates/README.md`).
- **Rate limits → emails por hora:** subir el valor por defecto para que una
  ola de registros no corte los correos de confirmación.

Enlaces que salen del panel: confirmación → `/confirmar-cuenta`, invitación →
`/aceptar-invitacion`, recuperación → `/restablecer-password` del mismo sitio
donde se pidió. Todos quedan dentro de las Redirect URLs de arriba.

## 4. Bloqueos del lanzamiento público

1. **Documentos legales.** `legal/` no tiene ningún texto: faltan Términos y
   Condiciones, Aviso de Privacidad y Acuerdo de Tratamiento de Datos para
   México (y para Argentina si se abre ese país). Sin ellos, `/terminos`,
   `/privacidad` y `/acuerdo-datos` muestran «Documento pendiente de
   publicación» y la landing enlaza a esas páginas. Ver §8.
2. **Aceptación con evidencia.** Hoy el alta guarda solo la fecha de
   aceptación (`users.terminos_aceptados_en`). Registrar qué versión (y su
   hash) se aceptó requiere conectar `registrar_aceptaciones` en el alta y en
   la invitación (Fase 3 de `docs/operations/LEGAL.md`), una vez que existan
   documentos publicados.
3. **Base de producción sin las 16 migraciones.** Ensayadas sobre la forma de
   producción (`supabase/tests/produccion/README.md`): aplican sin cambiar
   filas existentes y con 0 FAIL de seguridad. Requieren respaldo y ventana.
4. **Código de producción del 6 de agosto.** Hay que llevar `staging` a
   `main` (incluye el PR #9 y esta preparación).
5. **Dominios.** `app.gateflow.mx` todavía no existe; gateflow.mx apunta al
   panel. El sitio `gateflow-web` no tiene repositorio conectado ni deploys.

## 5. Plan de publicación (cada paso con su comprobación)

**Antes de la ventana (sin tocar producción)**

| # | Paso | Comprobación |
|---|---|---|
| 0.1 | Merge del PR #9 y del PR de esta preparación a `staging` | CI verde; Admin y Guard de staging publicados con ese commit |
| 0.2 | Prueba manual en staging desde iPad: landing de staging → registro → onboarding → guardia → paquete | sin errores |
| 0.3 | Documentos legales aprobados en `legal/` → validar, cargar y **publicar en staging** | `/terminos?pais=MX` muestra la versión vigente |
| 0.4 | Preparar: claves Turnstile de `app.gateflow.mx`, pepper, remitente Resend, plantillas | — |
| 0.5 | `gateflow-web`: conectar el repo (rama `main`, Package directory `apps/web`, Base directory vacío), variables de §2 y borrar `NEXT_PUBLIC_LANDING_MODO` | el deploy de `gateflow-web.netlify.app` pasa `tests/landing/produccion-local.mjs` en local |

**Ventana en producción**

| # | Paso | Comprobación | Si falla |
|---|---|---|---|
| 1 | Respaldo: backup del panel de Supabase del día **y** `pg_dump` lógico | archivo del dump con tamaño > 0 | no seguir |
| 2 | `supabase/tests/produccion/verificacion_produccion.sql` (solo lectura) | conteos y 0 violaciones de FK | no seguir |
| 3 | Aplicar las 16 migraciones en el orden de `ensayo.sh` | ninguna con error | restaurar el respaldo |
| 4 | Repetir `verificacion_produccion.sql`, con la consulta de `suscripciones` descomentada | mismos conteos; cada residencial con suscripción `active`/`alta_manual` y sin proveedor | restaurar el respaldo |
| 5 | Variables de Admin y Guard (§2) | — | — |
| 6 | Supabase Auth (§3) | — | volver a los valores anotados |
| 7 | PR `staging` → `main`, merge | Netlify publica Admin y Guard con ese commit | redeploy del deploy anterior en Netlify |
| 8 | Dominio `app.gateflow.mx` en el sitio Admin | https://app.gateflow.mx/login responde | — |
| 9 | Publicar documentos legales en producción (mismo SQL que en staging) | `/terminos?pais=MX` en app.gateflow.mx | retirar la versión |
| 10 | Mover gateflow.mx y www al sitio `gateflow-web` | gateflow.mx muestra la landing; `gateflow.mx/login` → `app.gateflow.mx/login` (308) | devolver el dominio al Admin |
| 11 | Prueba controlada (§7) | todo el recorrido y limpieza con 0 residuos | — |

Pasos 3 a 7 seguidos y en minutos: el código nuevo necesita las migraciones,
y las migraciones conservan el acceso de los residenciales existentes.

## 6. Respaldo y recuperación

- Antes del paso 3: backup del día en **Database → Backups** y un dump lógico
  propio (`pg_dump` con la cadena de conexión de producción, ejecutado por
  quien tiene la contraseña).
- Reversa de la base: **restaurar el respaldo**. Los rollbacks del repo no
  devuelven producción a su forma exacta (diferencias conocidas en
  rollback_O/T/C/A).
- Reversa del código: en Netlify, «Publish deploy» del deploy anterior de
  cada sitio.
- Integridad antes y después: `verificacion_produccion.sql` (sin datos
  personales).

## 7. Prueba controlada en producción (solo con autorización)

Envía correos reales a un alias que controla el dueño (p. ej.
`<alias>+gf-lanzamiento@…`).

1. gateflow.mx → «Probar 30 días gratis» → registro con residencial
   **«ZZ PRUEBA CONTROLADA MX»**, país México.
2. Confirmar el correo → onboarding: 2 unidades, 1 residente, 1 ubicación, y
   la invitación a un guardia `<alias>+gf-lanzamiento-guardia@…`.
3. El guardia acepta, registra un paquete (**sin foto**), avisa por WhatsApp
   a un número propio y lo entrega con firma. Revisar el historial.
4. Recuperar la contraseña desde «¿Olvidaste tu contraseña?».
5. Limpieza: `supabase/tests/produccion/limpieza_prueba_controlada.sql`,
   primero con `ejecutar='no'` (simulacro) y después con `ejecutar='si'`. Se
   detiene si el residencial tiene miembros ajenos, aceptaciones legales,
   cobros o archivos en Storage, y verifica 0 residuos y los demás
   residenciales sin cambios.

## 8. Documentos legales

Formato, ciclo y carga en `legal/README.md`:
`node scripts/legal/documentos-legales.mjs validar | sql-carga [--publicar] | sql-verificar`.

Faltan, para México: Términos y Condiciones, Aviso de Privacidad (LFPDPPP) y
Acuerdo de Tratamiento de Datos. Argentina (Ley 25.326) queda para la segunda
etapa: el registro solo ofrece México mientras `REGISTRO_PAISES` no la incluya. Datos del titular que el texto
tiene que traer y no están en el repositorio: razón social, RFC (o CUIT),
domicilio, medio para ejercer derechos ARCO, jurisdicción y plazo de
conservación (pendiente en `LEGAL.md`). Ningún texto se redacta aquí: se
incorpora tal como lo entregue la revisión jurídica.

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

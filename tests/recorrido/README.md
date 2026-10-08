# Recorrido de prueba gratuita (local)

Prueba de punta a punta, en navegador **desktop (1366×900) y móvil
(iPhone 13; Guard en Pixel 7)**, del camino de un cliente nuevo de
Argentina que no paga nada:

1. Landing V2 (`/`, de `apps/web`):
   - textos de 30 días, sin "7 días";
   - honesta para Argentina: sin importes en USD, sin prometer que al
     terminar se puede contratar, sin borrado automático de datos;
   - preview sin indexar (meta robots, `robots.txt` y `X-Robots-Tag`);
   - "Probar gratis" lleva a `/registro` del panel; Ingresar y Privacidad
     apuntan al panel.
2. `/registro`: sin país preseleccionado; sin país no se crea nada.
   Turnstile (claves de prueba de Cloudflare): sin token el botón está
   deshabilitado; forzando el envío sin token el servidor rechaza antes
   de verificar o crear nada; cada envío verifica el token en siteverify
   y el widget se reinicia tras un rechazo. Con Argentina → "Revisa tu
   correo". En la base:
   - residencial AR, zona de Buenos Aires;
   - suscripción `trialing` de 30 días, sin proveedor de pago;
   - correo sin confirmar.
3. Login antes de confirmar → mensaje para personas.
4. Correo de confirmación (buzón local) → `/confirmar-cuenta` →
   `/onboarding`, sin tokens en la URL.
5. Onboarding:
   - datos del residencial;
   - CSV de 2 unidades con teléfonos de Argentina;
   - invitación de un guardia;
   - primera ubicación.

   Termina en el panel con la prueba en curso. El dashboard carga completo:
   el gráfico de 30 días aparece vacío ("Todavía no hay datos para
   mostrar.") porque `authenticated` no lee `mv_dashboard_diario`, igual
   que en staging.
6. `/suscripcion` durante la prueba: "no se cobra nada ni se pide tarjeta",
   sin planes ni botones de pago.
7. Guardia:
   - correo de invitación → `/aceptar-invitacion` (sin consola de
     diagnóstico ni tokens);
   - su nombre y la aceptación de términos quedan guardados;
   - login de Guard → registra un paquete;
   - el aviso por WhatsApp sale a `wa.me/549…`.
8. Login del administrador con contraseña (si es incorrecta, mensaje claro).
9. La prueba vence (con SQL local):
   - `/suscripcion` dice que la contratación en línea todavía no está
     disponible y que la información se conserva, sin "Activar plan",
     Stripe ni tarjeta;
   - la server action del checkout, llamada directamente, se rechaza con
     `error=pais`: no se crea ningún `billing_checkout` ni sale ninguna
     petición a Stripe;
   - unidades y paquetes se conservan;
   - Guard pasa a `/servicio-inactivo`.

10. Entorno de clientes: el MISMO build de Admin arrancado con
    `NEXT_PUBLIC_ADMIN_APP_URL=https://gateflow.mx` (en tiempo de ejecución):
    - con las claves de prueba de Turnstile, `/registro` está cerrado y la
      acción del servidor, invocada directamente, no registra;
    - un residencial de México con la prueba vencida no ve precios ni
      planes y el servidor rechaza el checkout (`error=precios`); en local
      sigue viendo sus planes en MXN;
    - una suscripción existente con proveedor conserva el acceso y la
      gestión, sin montos.

México se valida además en la capa C-local (`tests/billing/e2e/run-local.mjs`):
planes, "Activar plan" y el checkout de Stripe en MXN siguen igual.

## Qué es real y qué está simulado

| Pieza | Real o simulado |
| --- | --- |
| Auth (registro, confirmación, invitación, contraseñas, sesiones) | **Real**: GoTrue, el servidor de Auth de Supabase, compilado localmente. Registro público desactivado, confirmación obligatoria, lista de redirecciones Admin/Guard |
| Base de datos y RLS | **Real**: Postgres 17 local con las migraciones del repo y los permisos tipo staging; PostgREST real |
| Admin, Guard y landing | **Reales**: `next build` + `next start` del código de la rama |
| Navegador | **Real**: Chromium (Playwright) en perfiles desktop y móvil |
| Correo | **Simulado**: buzón SMTP local (`smtp-local.mjs`) que solo acepta `@gateflow.invalid`; cualquier otro destinatario se rechaza con 550 |
| Stripe | **Simulado**: configurado con claves ficticias (`sk_test_ZZ…`), salida a `stripe.com` bloqueada y registrada (`sin-red-stripe.cjs`) |
| WhatsApp | **Simulado**: `wa.me` interceptado en el navegador; solo se lee la URL |
| Turnstile | **Simulado**: el script de Cloudflare se sirve emulado (`turnstile-widget-local.js`, claves de sitio de prueba) y siteverify lo emula `turnstile-local.cjs` (claves secretas de prueba `1x/2x/3x`; una clave real no se puede verificar aquí) |
| API gateway | **Simulado**: `tests/billing/e2e/gateway.mjs` (`/rest/v1`, `/auth/v1`; responde el preflight CORS como el de Supabase) |
| Vencimiento de la prueba | **Simulado**: fechas movidas con SQL |

Fixtures `ZZ_AUTOTEST_…`, borrados por ids al final. Se verifica que no
quedan residuos y que `tenants` queda igual que antes.

## Cómo correrlo

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres \
GF_POSTGREST_BIN=/ruta/postgrest \
GF_GOTRUE_BIN=/ruta/auth GF_GOTRUE_MIGRACIONES=/ruta/auth/migrations \
GF_PLAYWRIGHT_CORE_DIR=/ruta/con/node_modules/playwright-core \
GF_CHROMIUM=/ruta/chrome \
node tests/recorrido/run-local.mjs
```

- La landing se toma de `apps/web`. `GF_LANDING_DIR` apunta a otro checkout.
- `GF_RECORRIDO_SIN_BUILD=1` reutiliza los builds anteriores.
- `GF_RECORRIDO_CAPTURAS=<dir>` guarda capturas (PNG, texto y HTML) en
  los puntos clave.
- `GF_RECORRIDO_OMITIR_DESDE=<versión>` arma la base sin esa migración ni
  las posteriores.
- Sin Postgres, PostgREST o GoTrue, la capa queda en SKIP (nunca en PASS).
- También corre como capa `C-prueba` de `node tests/billing/run.mjs --e2e`
  (escenarios 31–37).

GoTrue: `go build` del módulo `github.com/supabase/auth`; sus
migraciones están en `migrations/`. `construir-base-auth.sh` crea la base,
los roles de Supabase y aplica las migraciones de Auth y las del repo.

## Lo que esta prueba no cubre

- El proyecto de Supabase real: plantillas de correo (las de GoTrue están
  en inglés), SMTP, Site URL y lista de redirecciones se configuran en el
  panel de Supabase.
- Stripe real: la capa S (Stripe TEST) y los workflows manuales.

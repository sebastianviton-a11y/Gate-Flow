# /registro: alta pública con trial de 30 días

Landing → "Probar gratis" → `https://<admin>/registro` → cuenta +
residencial creados por el servidor → "Revisa tu correo" → el enlace
confirma el correo y abre sesión → `/onboarding` (el existente) →
Gate Flow completo 30 días, sin tarjeta. El trial empieza al crear la
cuenta, no al confirmar el correo.

Migración: `supabase/migrations/20261006000000_registro_trial.sql`
(rollback en `supabase/rollback/`). Código: `apps/admin/app/registro`,
`apps/admin/app/confirmar-cuenta`, `apps/admin/lib/registro`,
`packages/paquetes/src/suscripciones.ts`.

## Reglas

| Regla | Dónde se aplica |
|---|---|
| Campos visibles: nombre y apellido, correo, contraseña, residencial, país (MX/AR), viviendas, checkbox de términos | `registro-form.tsx`, `validacion.ts` |
| Viviendas 1–150; más de 150 no crea nada y muestra "contáctanos" | `validacion.ts` (antes de cualquier llamada) y `crear_cuenta_prueba` |
| "Allow new users to sign up" sigue OFF; el usuario lo crea el servidor con la clave secreta (`auth.admin.createUser`, `email_confirm: false`) | `actions.ts` |
| El navegador nunca decide tenant, empresa, rol, plan, estado ni fechas | `leerCampos` solo lee los campos conocidos; la RPC no tiene esos parámetros |
| Primer usuario = `admin_residencial`, siempre | `crear_cuenta_prueba` (rol fijo; rechaza usuarios con membresías) |
| Suscripción `trialing` / `registro_publico` / `now()` → `now() + 30 days` | `crear_cuenta_prueba` |
| Residenciales existentes: `active` / `alta_manual`, sin trial, sin cambios | backfill idempotente de la migración |
| Zona horaria: la del navegador si es IANA válida; si no, MX → `America/Mexico_City`, AR → `America/Argentina/Buenos_Aires` | `validacion.ts` + `crear_cuenta_prueba` |
| Términos: obligatorio; al completar el alta `users.terminos_aceptados_en = now()` | `validacion.ts` + `crear_cuenta_prueba` |
| Correo duplicado: misma respuesta pública ("Revisa tu correo. Si ya tienes una cuenta, puedes iniciar sesión.") | `alta.ts` |

## Orden del alta y compensación

```
1. registro_intento_permitido(email_hash, ip_hash)   → bloqueado: fin
2. honeypot + token de tiempo                        → bot: respuesta genérica
3. auth.admin.createUser (sin confirmar)             → duplicado: respuesta genérica
4. RPC crear_cuenta_prueba                           → falla: deleteUser
5. correo de confirmación (auth.resend signup)       → falla: revertir_cuenta_prueba + deleteUser
6. registro_intento_resultado(exito)
```

`revertir_cuenta_prueba` solo borra si: el usuario tiene exactamente
una membresía y es `admin_residencial`; la suscripción es
`registro_publico` y sigue `trialing`; el tenant tiene
`onboarding_completado = false`, `plan = 'trial'` y
`estado_servicio = 'activo'`; es el único miembro; la empresa solo
tiene ese residencial; la auditoría lo marca como usuario inicial; y
no hay filas en ninguna tabla operativa. Si se niega, el servidor NO
borra el usuario de Auth (quedaría un residencial sin dueño) y deja
`registro.compensacion_incompleta` en el log.

## Correo de confirmación

`lib/registro/confirmacion.ts` encapsula el envío: hoy
`auth.resend({ type: 'signup', options: { emailRedirectTo: <admin>/confirmar-cuenta } })`
con el SMTP ya configurado (staging: Resend, `staging@mail.gateflow.mx`).
`/confirmar-cuenta` acepta `?code=` o `#access_token=` (igual que
`/aceptar-invitacion`) y manda a `/onboarding`.

Si `resend` no funcionara con signups OFF, el reemplazo es
`auth.admin.generateLink({ type: 'signup' })` + envío server-side; solo
cambia esa función. Nunca se activa el signup público.

## Antiabuso

- `registro_intentos`: solo `email_hash` e `ip_hash` (HMAC-SHA256 con
  `REGISTRO_HASH_PEPPER`), estado, motivo. Sin correo ni IP en claro.
- Límites: 3/h por correo, 5/h por IP, 20/24 h por IP (advisory locks
  por correo e IP; el intento siempre se registra).
- Honeypot `sitio_web`; token de tiempo firmado: mínimo 4 s, máximo 1 h.
- Turnstile (`lib/registro/antibot.ts`, widget `app/registro/turnstile-widget.tsx`):
  el formulario no deja enviar sin token; el servidor lo verifica en
  siteverify antes de tocar la base o Auth; cada token sirve una vez (el
  widget se reinicia tras un rechazo). Por entorno (`lib/entorno.ts`,
  según el host de `NEXT_PUBLIC_ADMIN_APP_URL`):
  - **clientes** (gateflow.mx o cualquier host que no sea de pruebas,
    también sin URL): las dos claves son obligatorias y **no** pueden ser
    las claves de prueba de Cloudflare (`1x…`, `2x…`, `3x…`). Si faltan,
    están incompletas o son de prueba, `/registro` queda deshabilitado
    (formulario y servidor): nunca abierto sin desafío real.
  - **pruebas** (localhost, staging, Deploy Previews): sin claves se omite
    (aviso en el log); con claves, de prueba o reales, se exige.
- Logs: solo eventos y códigos; nunca correo, IP ni contraseña.

## Variables de entorno (Admin)

| Variable | Obligatoria | Uso |
|---|---|---|
| `REGISTRO_HASH_PEPPER` | sí (≥ 16 caracteres, secreta) | hashes del rate limit y token de tiempo; sin ella `/registro` se deshabilita |
| `SUPABASE_SERVICE_ROLE_KEY` | ya existe | createUser/deleteUser y las RPC service-only |
| `NEXT_PUBLIC_ADMIN_APP_URL` | ya existe | `redirectTo` de la confirmación |
| `TURNSTILE_SITE_KEY` | sí en clientes (pública) | clave del widget; la lee el servidor y se la pasa al formulario |
| `TURNSTILE_SECRET_KEY` | sí en clientes (secreta) | verificación del token (siteverify) |

Auth (Supabase): signups OFF; Confirm email ON; Redirect URLs deben
cubrir `<admin>/confirmar-cuenta`.

## Trial

`situacionSuscripcion()` → `trial_activo | activa | vencida |
sin_suscripcion` (`past_due` cuenta como activa). Todavía no bloquea
nada al vencer: esa es la siguiente fase.

Estado normal de cada residencial:

| Alta | estado | origen | trial |
|---|---|---|---|
| `/registro` | `trialing` | `registro_publico` | `now()` → `+30 días` |
| Super Admin (`invitarAdministrador`) | `active` | `alta_manual` | sin fechas |
| Existentes al migrar (backfill) | `active` | `alta_manual` | sin fechas |

La alta manual llama, con la clave de servicio, a
`crear_suscripcion_alta_manual(tenant_id)` justo después de crear el
residencial; si falla, el residencial se elimina (misma regla de
atomicidad que el resto de ese flujo). La RPC no acepta estado, origen
ni fechas, es idempotente (no pisa una suscripción existente, p. ej.
la `trialing` de `crear_cuenta_prueba`) y `unique(tenant_id)` impide
dos suscripciones por residencial. Se eligió esta vía y no un trigger
genérico sobre `tenants` para que el registro público nunca pueda
quedar `active` por accidente. `sin_suscripcion` solo puede darse en
un tenant insertado por SQL a mano.

## Legal

`/terminos` y `/privacidad` son rutas públicas enlazadas por separado
desde el checkbox único de `/registro`. **Ninguna de las dos tiene
todavía texto legal aprobado**: el repo no contiene un Aviso de
Privacidad (SECURITY_ARCHITECTURE.md §7, DECISIONS.md D008) y ambas
páginas muestran la misma leyenda de referencia. Hay que reemplazarlas
por el texto revisado legalmente antes de comercializar.

## Tests

- SQL: `supabase/tests/security/70_registro_trial.sql` (fase T del
  runner) y `supabase/tests/grants/70_registro_trial.sql` (fase GRACT).
- TS: `apps/admin/lib/__tests__/registro-*.test.ts`,
  `suscripcion-situacion.test.ts` (`npx tsx <archivo>`).
- E2E en staging (a mano): registro real, correo, `/confirmar-cuenta`,
  `/onboarding`; `curl /auth/v1/signup` debe seguir devolviendo 422.

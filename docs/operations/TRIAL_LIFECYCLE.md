# Ciclo de vida del trial

Qué pasa durante los 30 días de prueba, cuando faltan pocos días y cuando
vence. Sin pagos todavía: la pantalla de planes queda preparada.

- Fuente de verdad: `public.suscripciones` (nunca `tenants.plan`, metadata
  ni valores del cliente).
- Lógica única de acceso (Admin y Guard): `packages/auth/src/acceso.ts`.
- Bloqueo de datos: `supabase/migrations/20261007000000_tenant_operativo.sql`
  (rollback en `supabase/rollback/20261007000000_tenant_operativo.down.sql`).

## Estados efectivos

| `suscripciones.estado` | Condición | Estado efectivo | ¿Opera? |
|---|---|---|---|
| `active` (alta manual o registro) | — | `activa` | sí |
| `trialing` | `now() < trial_ends_at` | `trial_activo` | sí |
| `trialing` | `now() >= trial_ends_at`, o sin fecha | `vencida` | no |
| `expired` | — | `vencida` | no |
| `past_due`, `canceled` | — | `inactiva` | no |
| sin fila / estado desconocido | — | `sin_suscripcion` | no (falla cerrado) |

La expiración compara el instante exacto (`timestamptz`); la zona horaria
no la cambia. El estado almacenado no se modifica al vencer: se calcula
en cada petición, en el servidor y en la base (`tenant_operativo`).

## Residencial seleccionado (multi-tenant)

Toda decisión se evalúa sobre UNA membresía elegida explícitamente
(`packages/auth/src/membresias.ts`): usuario → residencial seleccionado →
membresía de ese residencial → tenant → suscripción → rol → `resolverAcceso`.
Nunca `limit(1)`, `ORDER BY` ni "primera fila".

- Cookie `gf_tenant` por app/dominio (Admin y Guard tienen la suya):
  httpOnly, Secure, SameSite=Lax, path=/, solo el `tenant_id`. Se valida
  siempre contra las membresías activas del usuario.
- Cookie válida → ese residencial. Cookie sin membresía activa → falla
  cerrado (se borra) y `/seleccionar-residencial`. Sin cookie: 0
  membresías → `/sin-acceso`; 1 → esa; más de 1 → `/seleccionar-residencial`.
- `super_admin` (una membresía super_admin): flujo separado, sin cambios
  (`gf_soporte_tenant` aparte).
- Admin: elegir admin_residencial guarda `gf_tenant` y entra; elegir
  guardia NO guarda nada en Admin y va a Guard, que hace su propia
  selección y guarda su propia cookie.
- Guard: lista solo membresías que operan en Guard; tras elegir, `/guard`
  si el residencial opera o `/servicio-inactivo` si no.
- "Cambiar residencial" (header de Admin y de Guard) reemplaza la cookie;
  cerrar sesión la borra.

## Orden de resolución (UI)

1. Sin usuario → `/login`.
2. Error leyendo membresía, tenant o suscripción → `/sin-acceso?motivo=error`.
3. Sin membresía activa → `/sin-acceso`.
4. Tenant o rol ilegible → `/sin-acceso?motivo=error`.
5. `super_admin` → excepción administrativa: no lo bloquean la suspensión
   ni la suscripción.
6. Tenant suspendido → Admin `/residencial-suspendido`; Guard
   `/servicio-inactivo`.
7. Suscripción no operativa:
   - `admin_residencial` → `/suscripcion`;
   - guardia en Admin → app Guard (`/guard`), que muestra `/servicio-inactivo`;
   - guardia en Guard → `/servicio-inactivo`;
   - cualquier otro rol → `/sin-acceso?motivo=rol`.
8. Rol / destino: super_admin y admin_residencial → Admin; guardia con
   residencial `piloto`/`activo` → Guard; el resto → `/sin-acceso?motivo=rol`.
9. Onboarding pendiente → `/onboarding` (solo Admin).

`tenants.estado_servicio = 'cancelado'` no se redefine en esta fase:
mantiene su comportamiento anterior.

## Admin

- Trial vigente: acceso completo. Aviso solo para `admin_residencial`
  (nunca en modo soporte):
  - más de 7 días: línea discreta "Prueba gratuita · X días restantes";
  - 4–7 días: banner "Tu prueba gratuita termina en X días.";
  - 2–3 días: el mismo banner, más visible;
  - 1 día: "Tu prueba termina mañana."; último día: "Tu prueba termina hoy."
  Los días son de calendario en `tenants.timezone`.
- No operativo → `/suscripcion`:
  - vencida: "Tu prueba gratuita terminó" + planes;
  - inactiva: "Tu suscripción no está activa" + planes;
  - sin suscripción: problema de configuración + soporte, sin planes.
- Los planes salen de `apps/admin/lib/planes.ts`. "Elegir plan" está
  deshabilitado ("Pagos disponibles próximamente"); más de 150 →
  `mailto:soporte@gateflow.mx`. Para conectar Stripe o Mercado Pago, se
  cambia la acción del plan a `checkout` y se implementa su handler.
- `/suscripcion` exige sesión pero el middleware no la redirige
  (`RUTAS_CUENTA`); la página decide con la misma lógica: sin bucles.
- Las server actions que escriben con la clave de servicio
  (`invitarUsuarioResidencial`, `actualizarNombreUsuario`) verifican
  `residencialPuedeOperar()`, porque no pasan por RLS.

## Guard

Suspendido, trial vencido, suscripción inactiva o sin suscripción →
`/servicio-inactivo` ("El servicio de este residencial no está activo." /
"Contacta al administrador del residencial."), solo con "Cerrar sesión" y
sin precios. Lo aplican el layout de `/guard/*` y `/escanear/[token]` con
sesión.

## Base de datos: qué se protege

`tenant_operativo(tenant_id)` es `SECURITY DEFINER` con `search_path` vacío
y EXECUTE solo para `authenticated` y `service_role`. Falla cerrado: es
`true` solo para `super_admin`, o para un miembro activo de un tenant no
suspendido (`piloto`/`activo`/`cancelado`) con suscripción `active` o un
trial vigente.

Se aplica con políticas **RESTRICTIVAS** de INSERT/UPDATE/DELETE, que se
combinan con AND con las existentes (esas no se tocan; E1/E2/E4 quedan
igual). Las lecturas no cambian: los datos se conservan y al reactivar la
suscripción todo vuelve a funcionar sin recrear nada.

| Objeto | Operaciones |
|---|---|
| paquetes, paquete_fotografias, paquete_firmas, paquete_grupos_entrega | INSERT/UPDATE/DELETE |
| notificaciones, incidencias, incidencia_fotografias | INSERT/UPDATE/DELETE |
| unidades, residentes_unidades, casas, departamentos, calles, manzanas, edificios | INSERT/UPDATE/DELETE |
| ubicaciones, empresas_paqueteria, plantillas_notificacion, prioridades_paquete, tamanos_paquete | INSERT/UPDATE/DELETE |
| tenants (configuración del residencial) | UPDATE |
| storage.objects, buckets `evidencia` y `logos` | INSERT/UPDATE/DELETE |
| `entregar_paquete` (y por ella `entregar_grupo_paquetes`) | error explícito 42501 |
| `crear_grupo_entrega_separado`, `obtener_o_crear_grupo_entrega`, `recalcular_grupo_entrega`, `registrar_paquete_con_incidencia`, `refrescar_search_vectors` | SECURITY INVOKER: las cubren las políticas de sus tablas |

### Fuera a propósito

| Escritura | Motivo |
|---|---|
| `users` (perfil propio) | No es operación del residencial; la aceptación de invitación lo necesita. |
| `user_tenants.activo` | Revocar accesos debe seguir siendo posible con el servicio inactivo. |
| `audit_log` vía `registrar_auditoria` | Registro, no operación. |
| `suscripciones` | Sin políticas de escritura: solo funciones de servicio. |
| empresas; alta y baja de tenants | Solo super_admin (excepción administrativa). |
| `refrescar_dashboard` | Solo refresca vistas materializadas. |
| RPC de registro y alta (`crear_cuenta_prueba`, `otorgar_membresia`, …) | Solo `service_role`; el registro nuevo no cambia. |
| `service_role` y funciones DEFINER internas | No pasan por RLS (procesos del servidor). |

## Pruebas

- SQL: `supabase/tests/security/80_tenant_operativo.sql` (fase O del
  runner) y `supabase/tests/grants/80_tenant_operativo.sql` (fase GRACTO);
  el rollback deja el catálogo idéntico al de la fase T.
- TS: `apps/admin/lib/__tests__/acceso-trial.test.ts`.

## Fase posterior (no implementada)

Retención de datos 30 días después del fin del servicio: hoy nada se
borra al vencer, y no hay ningún proceso de borrado.

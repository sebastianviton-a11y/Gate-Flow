# Eliminación de datos de un residencial (opción A: manual asistida)

Procedimiento para borrar los datos operativos de un residencial **30 días
después** de que terminó su prueba o su suscripción. Lo ejecuta una
persona del equipo, a mano, con un script que se apoya en tres funciones
de la base (migración `20261018000000_eliminacion_residencial.sql`). Nada
se dispara solo.

> **Estado:** preparado y probado solo en local con datos sintéticos. La
> migración **no está aplicada** en staging ni en producción. No usar
> contra datos reales hasta que se apruebe aplicarla y se cierren las
> decisiones legales del final.

## Qué se borra y qué se conserva

| | |
|---|---|
| **Se borra (base)** | El residencial y todo lo que cuelga de él con `ON DELETE CASCADE`: unidades, calles, manzanas, edificios, residentes y sus unidades, enlaces y solicitudes de residentes, paquetes, fotografías y firmas (filas), incidencias, historial, notificaciones, plantillas, ubicaciones, catálogos propios, membresías, suscripción, checkouts, `audit_log` del residencial y sus filas en los agregados del panel. La empresa, si no tiene otros residenciales. |
| **Se borra (Storage, por la API)** | Todo lo que está bajo `<tenant_id>/` en cualquier bucket (hoy `evidencia`, privado, y `logos`). |
| **Se borra (Auth, por la API)** | Las cuentas **exclusivas** del residencial: su perfil (`public.users`) en la base y su cuenta de Auth. |
| **Cuentas compartidas** | Si la persona tiene membresía o unidad en otro residencial (o es Super Admin), conserva su cuenta y su perfil; solo pierde el acceso a este. |
| **Cuentas con rastro en otro residencial** | Una cuenta exclusiva que dejó filas en otro residencial (p. ej. su `audit_log`) se **conserva** y se cuenta como `conservadas_por_referencias` para revisarla a mano. |
| **Se conserva** | `aceptaciones_legales` (evidencia de aceptación; inmutable) y `billing_eventos` (registro de pagos; su `tenant_id` queda en null por su FK). |
| **No lo toca** | `registro_intentos` (hashes antiabuso sin residencial), copias de seguridad de Supabase, logs de Supabase/Netlify, `auth.audit_log_entries`, datos en Stripe/Mercado Pago/Resend y mensajes de WhatsApp ya enviados desde los teléfonos. Ver «Decisiones pendientes». |

## Cuándo es elegible

La base lo decide (`eliminacion_residencial_servicio`), nunca el script:

| Motivo de rechazo | Qué significa |
|---|---|
| `prueba_en_curso` | La prueba no terminó. |
| `menos_de_30_dias` | Terminó hace menos de 30 días (fin = la fecha más tardía entre fin de prueba, fin del período pagado y impago + 7 días de gracia). |
| `suscripcion_activa` | Tiene suscripción activa (aunque esté por cancelarse). |
| `suscripcion_en_impago` | Está en impago: primero debe cancelarse en el proveedor. |
| `contratacion_en_curso` | Hay un checkout abierto o uno que pudo pagarse en los últimos 7 días, aunque figure vencido o cancelado: el pago puede estar hecho en el proveedor con su aviso (webhook) todavía pendiente. |
| `sin_suscripcion` | Alta antigua sin suscripción: se decide a mano, no con este procedimiento. |
| `fin_desconocido` | No hay fecha de fin. |
| `residencial_de_plataforma` | Es el residencial del Super Admin. |

## Requisitos

* La migración `20261018000000` aplicada en el proyecto (requiere autorización).
* Node 18 o superior y una copia del repositorio.
* La clave **service_role** del proyecto, en una variable de entorno de la
  terminal. Nunca en el chat, en el ticket, en un archivo del repositorio
  ni en logs. El script no la imprime.
* Un **alias o número de ticket** para `--operador` (sin espacios ni `@`):
  el registro no guarda nombres ni correos de quien opera.
* El `id` del residencial (panel de Super Admin) y su nombre exacto.

```bash
export GF_ELIMINACION_SUPABASE_URL="https://<ref>.supabase.co"
read -rs GF_ELIMINACION_SERVICE_ROLE_KEY && export GF_ELIMINACION_SERVICE_ROLE_KEY   # se pega sin que se vea
```

## Plazos — qué vence y desde cuándo (semanal)

Las fechas salen de la base; nadie tiene que recordarlas:

```bash
node scripts/eliminacion/eliminar-residencial.mjs pendientes
```

No borra nada. Lista:

* **Elegibles hoy**: terminaron hace 30 días o más (nombre, país, fin del
  servicio y fecha desde la que se pueden eliminar);
* **Todavía no**: sin servicio o con cancelación programada, con la fecha
  en que serán elegibles (y los que están en impago: primero hay que
  cancelar en el proveedor);
* **Eliminaciones a medias**: con el comando `reanudar` para cada una.

Rutina recomendada: correrlo una vez por semana (el mismo día) y abrir un
ticket por cada elegible. La fecha exacta la decide la base al simular.

## Super Admin ya no borra residenciales con datos

El botón «Eliminar residencial» de la ficha del residencial se quitó
(borraba la fila y dejaba fotos en Storage y cuentas en Auth). Además, la
política `tenants_delete_super_admin` ahora solo permite borrar un
residencial **vacío** (sin membresías, datos ni archivos: el caso de
revertir un alta con invitación que falló). Cualquier otro borrado pasa
por este procedimiento.

## Paso 0 — verificar a mano

1. Confirmar con quien atiende al cliente que no contrató ni pidió más tiempo.
2. Revisar en el proveedor de pagos que no haya suscripción activa ni cobros pendientes.
3. Confirmar que el `id` corresponde al residencial correcto (nombre, país) y que el proyecto es el correcto (el script muestra su host).

## Paso 1 — simulación (obligatoria)

```bash
node scripts/eliminacion/eliminar-residencial.mjs simular --residencial <uuid> --operador <ticket>
```

No borra nada. Muestra el proyecto, el residencial (nombre, país,
estado), la suscripción y su fin, cuántas filas y archivos se borrarían,
cuántas cuentas son exclusivas o compartidas y qué se conserva. Si es
elegible entrega un **código válido 30 minutos** y el comando para
ejecutar. Cada simulación queda registrada (`simulada` o `no_elegible`).

## Paso 2 — ejecución

```bash
node scripts/eliminacion/eliminar-residencial.mjs ejecutar --eliminacion <id de la simulación> --codigo <código>
```

El script pide **escribir el nombre exacto del residencial** (vacío
cancela). La base, con la suscripción bloqueada:

* comprueba código, vigencia y nombre (si no coinciden, no borra nada);
* vuelve a evaluar la elegibilidad: si el cliente contrató o la
  suscripción cambió desde la simulación → **CANCELADA** sin borrar nada
  (hay que simular de nuevo si corresponde). Una contratación que empieza
  mientras tanto espera a que esto termine (residencial y suscripción
  quedan bloqueados) y después falla porque ya no hay suscripción; nunca
  queda un checkout de un residencial eliminado;
* borra los datos de la base en **una sola transacción** y verifica que
  no quede ninguna fila con ese `tenant_id`. Ante cualquier error deshace
  todo → **FALLÓ**, sin borrar nada; el registro guarda solo el código de
  error (nunca el mensaje, que puede traer datos).

Después el script borra los archivos de Storage y, solo con Storage ya
vacío, las cuentas exclusivas de Auth (por la API de Supabase: borrar
`storage.objects` por SQL deja los archivos huérfanos). Termina pidiendo a
la base que confirme que no queda nada. Solo entonces informa
**COMPLETADA**.

## Paso 3 — si dice «La eliminación NO terminó»

Los datos de la base ya se borraron pero quedan archivos o cuentas
(Storage o Auth fallaron). El registro sigue `en_curso`. Repetir:

```bash
node scripts/eliminacion/eliminar-residencial.mjs reanudar --eliminacion <id>
```

Es idempotente; sobre una eliminación completada vuelve a confirmar
**COMPLETADA**. Si no hay avance entre dos rondas se detiene y lo dice.

## Códigos de salida

| Código | Significado |
|---|---|
| 0 | `pendientes` leído, simulación elegible, o eliminación **COMPLETADA**. |
| 1 | Uso incorrecto o configuración faltante (no llamó a la base). |
| 2 | No elegible, o la base rechazó la ejecución: **no se borró nada**. |
| 3 | **CANCELADA** (el cliente contrató o algo cambió): no se borró nada. |
| 4 | **FALLÓ** en la base: se deshizo todo, no se borró nada. |
| 5 | **NO terminó**: base borrada, Storage o Auth pendientes → `reanudar`. |

## Registro auditable

Tabla `public.eliminaciones_residencial` (sin acceso desde la API; se lee
desde el SQL Editor):

```sql
select id, tenant_id, estado, motivo, operador, fin_servicio, creada_en,
       ejecutada_en, completada_en, simulacion, resultado, error_sqlstate, error_objeto
from public.eliminaciones_residencial order by creada_en desc limit 20;
```

Guarda: residencial y empresa (ids), estado, motivo, operador (alias),
fin del servicio, conteos de la simulación y del resultado (filas por
tabla, archivos por bucket, cuentas exclusivas/compartidas/conservadas,
lo conservado), hash del código y fechas. **No guarda** nombres,
correos, teléfonos ni el código. `cuentas_pendientes` (ids de Auth) se
vacía al completar. El rollback de la migración aborta si hay registros.

## Pruebas (locales, datos sintéticos)

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh   # fase ER (99_eliminacion_residencial.sql y concurrencia_eliminacion.sh)
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/grants/run-local.sh     # grants de staging (99_eliminacion_residencial.sql)
node tests/eliminacion/script.test.mjs                                          # script con una API falsa
PGHOST=/tmp PGPORT=54329 PGUSER=postgres GF_POSTGREST_BIN=/ruta/postgrest \
  node tests/eliminacion/integracion-local.mjs                                  # script real + PostgREST real
```

## Decisiones pendientes (legal / negocio)

1. Confirmar el plazo de 30 días y desde qué fecha se cuenta (MX: LFPDPPP; AR: Ley 25.326).
2. Plazo de conservación de `aceptaciones_legales` y de `billing_eventos` (obligaciones fiscales), y su depuración posterior.
3. Datos fiscales del cliente (RFC, razón social): confirmar que viven en el sistema de facturación y no hace falta conservar `empresas`.
4. Copias de seguridad de Supabase: los datos borrados siguen en los backups hasta que vencen; decidir si basta con declararlo en el Aviso de Privacidad.
5. `auth.audit_log_entries`, logs de Supabase/Netlify y datos en Stripe/Mercado Pago/Resend: plazo y procedimiento propios.
6. `registro_intentos` (hashes de correo e IP para antiabuso): plazo propio.
7. Si se avisa al cliente antes de borrar (y con cuánta anticipación) y si se le ofrece una exportación previa.

# Registro de residentes por enlace

El administrador comparte un enlace en el grupo del residencial y cada
residente, propietario o inquilino, carga sus propios datos. Nada entra
al listado operativo sin la aprobación del administrador. La carga
manual y la importación Excel/CSV siguen igual (sin la columna Tipo).
En pantallas y plantillas, el identificador de la vivienda se llama
**Dirección** (la columna de la base sigue siendo `unidades.identificador`;
los datos no cambian).

> **PENDIENTE ANTES DE PRODUCCIÓN**
> - Turnstile: el formulario usa la misma configuración que `/registro`.
>   En staging, sin claves, se omite. En el entorno de clientes es
>   obligatorio con claves reales; sin ellas el formulario queda
>   cerrado. Antes de abrirlo hay que cargar las claves reales y
>   probarlo allí.
> - Revisar los textos legales y de privacidad (ver «Pendientes»).

## Arquitectura

```
Admin (authenticated) ──RPC──▶ residentes_enlace_generar / _desactivar
                               residentes_solicitudes_revision
                               residentes_solicitud_aprobar / _rechazar
                               residentes_adicional_actualizar / _quitar

Navegador ── /alta-residente#<token> ──▶ server action del panel (service_role)
                                           ├─ residentes_enlace_publico(token)
                                           └─ residentes_solicitud_crear(token, …, ip_hash)

Guard (authenticated) ── SELECT unidades + residentes_unidades (RLS) ──▶ destinatarios
                      ── INSERT paquetes (destinatario_*) ──▶ trigger: misma vivienda
```

- **El navegador nunca elige el residencial.** El token del enlace
  determina el residencial en la base (`residentes_enlaces.token →
  tenant_id`). Las funciones públicas no reciben `tenant_id`.
- **El token viaja en el fragmento** (`#`): el navegador no lo manda al
  servidor en la URL, así que no queda en registros de acceso ni en
  `Referer`. La acción del servidor lo recibe en el cuerpo de la
  petición. Son 64 caracteres hex de dos `gen_random_uuid()`: **244 bits
  aleatorios efectivos** (12 de los 256 son fijos por versión y variante).
- **`service_role` solo en el servidor del panel** (runtime de la acción
  `app/alta-residente/actions.ts`). Ni `anon` ni `authenticated` pueden
  ejecutar las funciones públicas.
- **El país** (AR/MX) sale de `tenants.pais`: el formulario lo recibe del
  servidor (por el token) y Admin y Guard lo toman de la sesión
  (`session.tenant.pais`).

### Modelo (migración `20261011000000_residentes_enlace`)

| Objeto | Qué guarda |
|---|---|
| `unidades.tipo` | Ahora opcional. Se conservan los valores existentes; nunca se asigna uno por defecto |
| `residentes_unidades` | También personas **sin cuenta** (`origen = 'enlace'`, `user_id` NULL): nombre, apellido y WhatsApp normalizado; `tipo_relacion` vacío si no se conoce |
| `residentes_enlaces` | Un enlace activo por residencial. Sin vencimiento: vale hasta que se regenera, se desactiva o el residencial deja de estar operativo |
| `residentes_solicitudes` | Pendiente → aprobada o rechazada, con el resultado y quién la revisó |
| `paquetes.destinatario_*` | A quién avisó la guardia: nombre, WhatsApp y, si no es el contacto, la persona (`destinatario_residente_id`). Un trigger exige que sea de la misma vivienda. Las filas existentes quedan en NULL |

### Funciones

| Función | Quién la llama | Qué hace |
|---|---|---|
| `residentes_enlace_publico`, `residentes_solicitud_crear` | solo `service_role` | Toman el residencial del token; validan datos con el país del residencial; aplican límites |
| `residentes_enlace_generar` | admin del residencial (exige operativo) | Revoca el enlace activo y crea otro en la misma transacción |
| `residentes_enlace_desactivar` | admin del residencial | Revoca sin crear otro |
| `residentes_solicitudes_revision` | admin | Pendientes con vivienda sugerida y coincidencias **del mismo residencial** |
| `residentes_solicitud_aprobar` / `_rechazar` | admin (exige operativo) | Serializadas: `FOR UPDATE` sobre la solicitud y un advisory lock por dirección nueva |
| `residentes_adicional_actualizar` / `_quitar` | admin (exige operativo) | Quitar deja fecha de fin, como historial |

Todas son `SECURITY DEFINER` con `search_path` vacío. Las de
administración validan el rol **en ese residencial**
(`has_role_in_tenant(… admin_residencial, super_admin)` o
`is_super_admin()`): quien es admin en A y guardia en B no aprueba en B.

## Operación

1. **Admin → Residentes** (y el paso 3 del onboarding): «Crear enlace»,
   «Copiar enlace», «Compartir» (menú del teléfono) o «Compartir por
   WhatsApp» (en la compu abre WhatsApp con el texto y el enlace; el
   administrador elige el grupo y envía), «Regenerar enlace» y
   «Desactivar enlace», con confirmación. Copiar y compartir solo actúan
   cuando el administrador los toca. Regenerar o desactivar invalida el
   enlace anterior en el acto: el siguiente envío con él responde «Este
   enlace ya no está activo».
2. **Formulario público** `/alta-residente#<token>`: sin cuenta ni
   contraseña, adaptado a móvil, con el nombre del residencial. Pide
   nombre, apellido, dirección y WhatsApp. El prefijo (+54 9 o +52) sale
   del residencial y no se puede cambiar. Antes de enviar, un resumen
   destaca Dirección y WhatsApp.
3. **Envío**: «Tus datos fueron enviados…» aparece **solo** si la base
   devolvió el id de una solicitud guardada (la nueva o, en un reenvío
   idéntico, la que ya estaba pendiente). Debajo, el «qué sigue»:
   «Cuando la administración apruebe tus datos, la guardia podrá
   avisarte por WhatsApp cuando llegue un paquete. No necesitas crear
   una cuenta.»
   - Enviado en menos de 4 s: no se guarda; pide esperar y volver a
     enviar, con los datos en pantalla.
   - Formulario abierto más de una hora: token de tiempo nuevo, sin
     recargar.
   - Campo trampa lleno: error genérico, nada guardado.
   - Enlace revocado o residencial no operativo (prueba vencida,
     suspendido, impago fuera de gracia): mensaje claro, nada guardado.
4. **Revisión** (Admin → Residentes, «Solicitudes por revisar», con el
   número de pendientes): corregir, elegir vivienda (existente o nueva), aprobar o
   rechazar (duplicado, datos incorrectos, no vive en el residencial,
   otro). Los posibles duplicados (mismo WhatsApp, nombre en la misma
   dirección, otra pendiente) se ven solo en la revisión y piden
   confirmación.
5. **Al aprobar**:
   - dirección nueva → vivienda nueva con la persona como contacto;
   - vivienda sin contacto → la persona pasa a ser el contacto;
   - vivienda con contacto → residente adicional. No reemplaza a nadie
     ni asume propietario o inquilino.
6. **Guard**: al registrar un paquete elige a quién avisar entre el
   contacto y cada persona aprobada de la vivienda. Las pendientes o
   rechazadas nunca aparecen. El destinatario queda en el paquete y se
   ve en el detalle, en Guard y en Admin. El enlace `wa.me` usa el país
   del residencial: los números aprobados ya están normalizados
   (`52…` / `549…`) y llegan intactos.
7. **Plantillas** (Excel y CSV, en Unidades, Residentes y onboarding):
   columnas «Dirección», «Nombre del residente» y «Teléfono»; el ejemplo
   de teléfono sigue el país del residencial. El importador sigue
   aceptando archivos anteriores («Identificador», «Tipo» o las claves
   técnicas `identificador`, `residente_nombre`, `residente_telefono`).

No se envían WhatsApp ni correos automáticos. La aprobación no se
notifica al residente.

### Configuración

- `REGISTRO_HASH_PEPPER` (la misma de `/registro`, ≥ 16 caracteres) en
  el contexto de producción del sitio de Admin. Sin ella el formulario
  responde «no disponible».
- `SUPABASE_SERVICE_ROLE_KEY` solo en ese mismo contexto (funciones del
  servidor), nunca en Deploy Previews.
- `NEXT_PUBLIC_ADMIN_APP_URL`: base del enlace que se copia (si falta,
  se usa el sitio abierto) y, como en `/registro`, lo que distingue un
  entorno de pruebas del de clientes.
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`: las de `/registro`.
  Staging: ninguna (se omite) o las dos de prueba de Cloudflare. Entorno
  de clientes: las dos reales; sin ellas el formulario queda cerrado.
- Ninguna variable nueva.

## Seguridad

**Protección del formulario público.**
- Turnstile con la configuración de `/registro`
  (`lib/registro/antibot.ts`): se verifica después de la trampa y del
  tiempo mínimo (un envío demasiado rápido no gasta el desafío). En
  staging sin claves se omite y quedan los controles siguientes.
- Campo trampa y token de tiempo firmado (mínimo 4 s, máximo 1 h).
- Límites en la base, que escalan con el tamaño del residencial
  (N = la mayor entre viviendas declaradas y activas), porque el enlace
  se comparte en un grupo y varios vecinos envían desde el mismo wifi:

| Control | Límite | N = 40 | N = 150 |
|---|---|---|---|
| Conexión en el residencial, por hora | max(40, ⌈N/2⌉) | 40 | 75 |
| Conexión en el residencial, por día | max(120, 2N) | 120 | 300 |
| Conexión en todos los residenciales, por día | 600 | 600 | 600 |
| Enlace, por día | max(300, 4N) | 300 | 600 |
| Pendientes sin revisar del residencial | max(300, 4N) | 300 | 600 |

- Revisión obligatoria: nada llega a Guard sin que un administrador lo
  apruebe.
- Riesgo aceptado para staging: sin desafío, un bot que respete el
  tiempo mínimo puede llenar la cola de pendientes hasta el límite y
  bloquear envíos legítimos de ese residencial hasta que el
  administrador rechace o regenere. Por eso en el entorno de clientes
  el formulario no abre sin Turnstile.

**Datos y aislamiento.**
- La conexión se guarda solo como HMAC con `REGISTRO_HASH_PEPPER`
  (`x-nf-client-connection-ip` de Netlify); las de más de 24 h no
  cuentan.
- Las tablas nuevas tienen RLS y solo SELECT para `authenticated`; las
  políticas limitan la lectura a `admin_residencial`/`super_admin` del
  residencial. La guardia no ve enlaces ni solicitudes. Con los grants
  de staging nadie escribe las tablas de residentes directo.
- Coincidencias y reenvíos idénticos se buscan **solo dentro del mismo
  residencial**: el mismo WhatsApp puede existir en A y en B sin cruce.
- La vivienda elegida al aprobar debe ser del mismo residencial y estar
  activa; el destinatario de un paquete, de la misma vivienda.
- No se crean `auth.users`, `public.users` ni `user_tenants`: las
  personas del enlace no tienen cuenta ni rol.
- Auditoría (`audit_log`) sin datos personales: solo resultado,
  vivienda o motivo.
- Logs del servidor: solo evento y motivo. Nunca nombres, teléfonos,
  direcciones, IP ni token.

## Rollback

`supabase/rollback/20261011000000_residentes_enlace.down.sql`

- Sin datos nuevos (ninguna solicitud, persona sin cuenta, vivienda sin
  tipo ni paquete con destinatario) revierte todo y deja el catálogo
  idéntico al de `20261009000000`.
- Con alguno de esos datos **aborta sin cambiar nada**. En ese caso se
  restaura el respaldo.
- Orden del despliegue: la migración va **antes** del código. El código
  actual de staging funciona con el esquema nuevo (todo lo agregado es
  opcional o nuevo; contrato verificado). El código nuevo, en cambio, lee
  columnas y funciones que solo existen después de la migración: si se
  revierte la migración, primero hay que volver el código.

## Pruebas

```bash
npx tsx apps/admin/lib/__tests__/residentes-enlace.test.ts   # validación, servidor con y sin Turnstile, compartir, destinatarios de Guard
npx tsx apps/admin/lib/__tests__/residentes-import.test.ts   # plantillas con Dirección, importación sin Tipo y archivos anteriores
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh   # fase RE + concurrencia_residentes.sh
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/grants/run-local.sh     # grants de staging + contrato código ↔ esquema
```

- Suite RE (`94_residentes_enlace.sql`): permisos, paridad con
  `tenant_operativo`, validaciones, enlace, envíos y límites, revisión,
  mismo WhatsApp en A y B, regenerar invalida en el acto, residencial
  suspendido, guardia sin revisión, sin cuentas ni membresías,
  destinatario en el paquete.
- `concurrencia_residentes.sh`: dos sesiones reales aprueban la misma
  solicitud, aprueban y rechazan a la vez, o aprueban la misma dirección
  nueva desde dos solicitudes.
- El recorrido de navegador no vive en esta rama: se validó con un
  arnés local temporal (Auth, PostgREST, Admin y Guard reales, datos
  `ZZ_AUTOTEST_`, limpieza por id).

## Pendientes

**Antes de producción:**
- Turnstile: claves reales en el entorno de clientes (las mismas de
  `/registro`) y una prueba allí; sin ellas el formulario queda cerrado.
- Texto legal. El aviso del formulario es informativo y enlaza a
  `/privacidad`, que sigue siendo texto de referencia. Falta definir con
  asesoría legal:
  - quién es responsable de los datos (la administración del
    residencial o Gate Flow) y el rol del otro;
  - si hace falta un consentimiento expreso, según la ley de cada país;
  - el plazo de conservación de las solicitudes rechazadas;
  - el canal para ejercer derechos de acceso, rectificación y supresión.
- Aplicar la migración en producción después de las migraciones
  pendientes, con respaldo y su propia autorización.

**Sin probar todavía:** WebKit (Safari) y dispositivos reales; la
cabecera `x-nf-client-connection-ip` de Netlify con un wifi compartido
real.

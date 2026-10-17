# Documentos legales y evidencia de aceptaciones — Fases 1 y 2 (aceptación inactiva)

Migración: `supabase/migrations/20261014000000_documentos_legales.sql`
(rollback: `supabase/rollback/20261014000000_documentos_legales.down.sql`).

La Fase 1 crea **solo la estructura**. No publica ningún documento, no
carga ningún requisito, no concede permisos a la API y no cambia el
registro, las invitaciones, los accesos ni ningún objeto existente. Para
los usuarios actuales no hay ningún cambio visible ni exigencia nueva.

## Qué agrega

| Objeto | Función |
|---|---|
| `documentos_legales` | Catálogo fijo: `terminos`, `privacidad`, `acuerdo_tratamiento`, `aviso_residentes`. Sin UPDATE ni DELETE. |
| `documentos_legales_versiones` | Versiones por documento y **un país** (MX o AR). Ciclo `borrador → aprobado → publicado → retirado`. |
| `requisitos_legales` | Qué rol debe aceptar, reconocer o consentir qué documento, por país. **Vacía.** |
| `aceptaciones_legales` | Evidencia inmutable: quién, qué versión (y su hash), tipo, alcance, origen y hora del servidor. |
| `documentos_legales_vigentes(pais)` | Versión vigente de cada documento. |
| `documento_legal_publicado(version_id)` | Texto de una versión publicada o retirada (nunca un borrador). |
| `documentos_pendientes(tenant)` | Qué le falta a `auth.uid()` en un residencial donde es miembro activo. |
| `registrar_aceptaciones(tenant, ids, origen, declara_facultades)` | Registro idempotente, todo o nada. |
| `descartar_aceptaciones_alta_fallida(user, tenant)` | Única vía de borrado de evidencia (ver conservación). |

Todas las funciones son `SECURITY DEFINER` con `search_path` vacío y,
en esta fase, **sin EXECUTE** para `anon`, `authenticated` ni
`service_role`. Las tablas tienen RLS activo, ninguna política y ningún
privilegio para la API (también se quitan los que dan por defecto los
proyectos Supabase nuevos). Cada fase posterior concederá solo lo que
use, con su prueba en la matriz de permisos.

## Tres conceptos distintos

| `tipo` | Qué es | Ejemplo |
|---|---|---|
| `aceptacion` | Aceptación contractual expresa. | Términos y Condiciones; Acuerdo de Tratamiento de Datos. |
| `acuse` | Acuse de recepción. **No es consentimiento.** | Aviso de Privacidad. |
| `consentimiento` | Solo cuando la revisión jurídica determine que un tratamiento concreto lo exige, por país. | (ninguno definido) |
| `revocacion` | Retiro de un consentimiento: una fila nueva que apunta al consentimiento retirado; nada se modifica. | — |

El tipo y el alcance de cada documento salen de `requisitos_legales`,
nunca del llamador.

## Inmutabilidad de las versiones

* Toda versión nace como borrador. El hash (`sha256` del texto en UTF-8)
  lo calcula el servidor.
* Fuera del borrador no cambian el texto, el hash, el número de versión,
  el país, `requiere_nueva_aceptacion`, el resumen de cambios ni los
  datos de la aprobación. Un aprobado solo puede fijar su vigencia y
  publicarse; un publicado solo puede retirarse. Solo un borrador se
  borra. Corregir un texto aprobado o publicado = crear otra versión.
* Publicar exige vigencia, no retroactiva (tolerancia de 5 minutos) y
  posterior a la de las versiones ya publicadas del mismo documento y
  país. Una publicación a la vez por documento y país (lock).
* Cada alta, edición de borrador, cambio de estado o de vigencia y borrado
  de borrador queda en `audit_log` (solo el hash, no el texto). Lo mismo
  para las altas, cambios y bajas de requisitos.
* `TRUNCATE` está prohibido en las cuatro tablas, incluso para `postgres`.
* Un CHECK obliga a que el hash corresponda siempre al texto. Si un rol
  privilegiado salta los triggers (`session_replication_role = replica`,
  `DISABLE TRIGGER`), no puede cambiar el texto conservando el hash: la
  diferencia queda a la vista frente al hash copiado en cada aceptación.
  Ese bypass sigue siendo posible para el dueño de la base y no se puede
  impedir desde SQL (ver riesgos).

## Aceptaciones

* **Alcance `usuario`**: una fila por persona y versión. Vale para todos
  los residenciales de esa persona **en el mismo país**.
* **Alcance `residencial`** (Acuerdo de Tratamiento): una fila por
  residencial y versión. Solo un `admin_residencial` con membresía
  activa, y solo si **declara** tener facultades de representación
  (`declara_facultades = true`).
  **La declaración NO está validada.** La validación de facultades queda
  pendiente de decisión legal y, cuando exista, se registrará aparte, sin
  modificar la evidencia. Antes de activar el requisito del Acuerdo hay
  que decidir si una declaración sin validar basta para darlo por
  aceptado.
* Al insertar (aunque inserte `postgres`) se valida: versión publicada y
  vigente; usuario y residencial existentes; membresía activa; país del
  residencial igual al de la versión. La hora y el hash los fija el
  servidor.
* Una versión nueva con `requiere_nueva_aceptacion = true` vuelve a dejar
  pendiente el documento; con `false` (corrección menor) basta lo ya
  aceptado.
* Una versión con vigencia futura no queda pendiente ni se puede aceptar
  antes de su vigencia.

### Idempotencia y concurrencia

* Índices únicos parciales (`(user_id, version_id)` para aceptación/acuse
  por persona y `(tenant_id, version_id)` para el alcance de residencial)
  + `INSERT … ON CONFLICT DO NOTHING`: dos aceptaciones simultáneas dejan
  una sola fila; la segunda espera y responde `ya_existentes`.
* Los consentimientos se serializan con un lock por persona y versión. Un
  consentimiento se revoca una sola vez (índice único).
* `registrar_aceptaciones` valida la lista completa antes de escribir
  (todo o nada) y bloquea la membresía en modo compartido mientras
  registra.

## Mínimo privilegio y aislamiento

* Ningún rol de la API lee las tablas. Ningún administrador puede ver el
  historial de aceptaciones de otras personas.
* `documentos_pendientes` solo devuelve **qué** falta, nunca quién aceptó.
  Para el Acuerdo de Tratamiento, otro admin del mismo residencial deja
  de verlo pendiente, pero no sabe quién lo aceptó.
* Las aceptaciones no se copian en `audit_log` (la tabla ya es el
  registro): así el historial de una persona no queda donde lo lean los
  administradores del residencial.
* Solo consulta o registra quien tiene membresía activa en ese residencial.
  La aceptación del Acuerdo en A no cubre B.

## Conservación y borrado de la evidencia

* `user_id` y `tenant_id` **no tienen clave foránea**, a propósito. Borrar
  una cuenta (`auth.users` → `users` → membresías en cascada) o un
  residencial **no** borra su evidencia.
* La fila guarda solo identificadores, versión, hash, tipo, alcance,
  origen y hora: ni correo, ni nombre, ni IP, ni navegador. Tras borrar
  la cuenta queda un identificador seudónimo.
* Sin UPDATE nunca. DELETE solo mediante
  `descartar_aceptaciones_alta_fallida`, que exige **todo** esto, o falla
  sin borrar nada:
  * la cuenta nunca confirmó el correo ni inició sesión
    (`email_confirmed_at` y `last_sign_in_at` nulos);
  * no tiene otras membresías;
  * toda su evidencia es de origen `registro` de ese residencial;
  * no hay evidencia de otra persona en ese residencial.

  Es el caso de `revertir_cuenta_prueba` (correo de confirmación que no
  se pudo enviar). Una cuenta real nunca entra aquí.
* **Pendiente (decisión legal):** el plazo de conservación (MX: LFPDPPP;
  AR: Ley 25.326) y el mecanismo de depuración posterior. Hasta entonces
  todo se conserva. La depuración, cuando se decida, será una migración
  nueva con su prueba.

## Fase 2 — lectura pública y páginas (la aceptación sigue inactiva)

Migración: `supabase/migrations/20261015000000_documentos_legales_lectura_publica.sql`
(rollback: `supabase/rollback/20261015000000_documentos_legales_lectura_publica.down.sql`).
**No está aplicada en ningún proyecto.** Sin ella, las páginas muestran
el estado pendiente (nunca un texto).

### Qué cambia

* `/terminos`, `/privacidad` y `/acuerdo-datos` (Admin) muestran la
  versión **publicada y vigente** de cada documento para el país
  (`?pais=MX|AR`, México por defecto), con título, versión, fecha de
  vigencia, país y huella SHA-256, y el historial de versiones publicadas
  (vigente, anterior, retirada y la próxima programada, cada una marcada).
  `?version=<id>` abre una versión del historial.
* Sin versión vigente para el país: «Documento pendiente de publicación ·
  no definitivo», sin ningún texto. Un documento publicado en un país no
  se muestra en el otro.
* `?version=` de un borrador, de un aprobado sin publicar, de otro
  documento o inexistente → «No encontramos esa versión», sin texto.
* `/registro` enlaza los documentos del país elegido en el formulario
  (`?pais=`).
* `/aceptar-invitacion` enlaza los Términos del país del residencial de la
  invitación. Lo decide el servidor (`app/aceptar-invitacion/actions.ts`,
  server action sin argumentos): valida la sesión con `getUser()` y lee
  con RLS las membresías activas y el país de su residencial (la
  membresía se otorga al invitar; el enlace del correo no lleva el
  residencial). El navegador no envía país ni residencial, y lo que se le
  mande se ignora. Si no hay un único país (sin membresía, residenciales
  de México y Argentina, error de lectura): aviso «No pudimos confirmar el
  país de tu residencial», sin enlace y sin poder aceptar; «Reintentar»
  si fue pasajero. Nunca se supone México. La aceptación (checkbox,
  `terminos_aceptados_en`, contraseña) no cambia.
* `/suscripcion`, `/alta-residente` y la landing siguen enlazando las
  rutas (México por defecto).
* No se registra ninguna aceptación nueva, no hay requisitos cargados y
  nadie queda bloqueado: el checkbox actual de `/registro` y de la
  invitación no cambia.

### Lectura controlada (por qué estos permisos)

* La migración crea `documentos_legales_historial(clave, pais)` y concede
  EXECUTE a `anon` y `authenticated` **solo** en las tres lecturas:
  `documentos_legales_vigentes(pais)`, `documento_legal_publicado(id)` y
  `documentos_legales_historial(clave, pais)`. Son `SECURITY DEFINER`,
  `search_path` vacío y devuelven únicamente versiones `publicado` o
  `retirado` con `publicado_en`: nunca un borrador ni un aprobado sin
  publicar, ni quién aprobó, ni nada de residenciales o aceptaciones.
* Las tablas siguen sin ningún privilegio para la API; `service_role` no
  recibe nada; `documentos_pendientes`, `registrar_aceptaciones` y el
  resto siguen cerrados. Las tablas y permisos de la Fase 1 no cambian.
* Qué versión está vigente lo decide la base con `now()` del servidor
  (columna `situacion` del historial, misma regla que `vigentes`); la
  página no compara fechas y el navegador no decide nada. Las páginas son
  dinámicas y sus lecturas no pasan por la caché de datos de Next
  (`fetchCache = "force-no-store"` y `noStore()`; con solo
  `force-dynamic`, Next 14 guardaba las RPC sin vencimiento): una versión
  programada pasa a vigente sola y un retiro se ve en la siguiente
  petición.
* Las páginas leen en el servidor con el cliente anónimo
  (`createAnonServerClient`, sin cookies ni sesión) y solo por RPC; con o
  sin sesión, de cualquier residencial, todos ven lo mismo. Son rutas
  siempre públicas (`lib/rutas-publicas.ts`): sin sesión no redirigen a
  `/login`.
* Si la lectura falla (migración sin aplicar, red), se muestra el estado
  pendiente y el servidor registra solo el código de error.
* El texto (Markdown limitado) se pinta con elementos de React, nunca
  como HTML: no puede inyectar marcado, scripts ni enlaces que no sean
  `http(s)`, `mailto:` o anclas.

### Cómo se cargan los textos reales

Fuente: `legal/` (formato y ciclo en `legal/README.md`). Resumen:

1. El texto entregado por la revisión jurídica se copia tal cual en
   `legal/<carpeta>/v<versión>[-mx|-ar].md` como `borrador` (un archivo
   por país si el texto difiere). Los borradores nunca se cargan.
2. Con la aprobación jurídica: `estado: aprobado` y `aprobacion` (la
   referencia verificable); revisión por PR.
3. `node scripts/legal/documentos-legales.mjs validar` y
   `sql-carga --salida carga.sql` (sin `--publicar`: llega a `aprobado`,
   nada visible). Se ejecuta en el SQL Editor **de staging** y se
   comprueba con `sql-verificar`.
4. Para publicar: `estado: publicado` y `vigente_desde` futura (la Fase 1
   rechaza vigencias de más de 5 minutos atrás y anteriores a la última
   publicada del mismo documento y país), `sql-carga --publicar`, y la
   misma secuencia (staging primero). Requiere 20261015 aplicada para que
   se vea.
5. Retirar: `estado: retirado` y `sql-carga --publicar`. La versión debe
   haberse publicado antes (no se carga como retirada una versión que
   nunca se publicó con vigencia pasada).

La carga es una transacción idempotente que aborta sin cambios ante
cualquier diferencia (otro texto, otra referencia de aprobación, otra
vigencia, repositorio atrasado respecto de la base, script editado).

### Pendiente (Fase 2)

* Aplicar 20261015 (con autorización; primero staging).
* Los textos reales (no están en el repositorio) y su aprobación.
* La aceptación obligatoria, los requisitos y el registro de evidencia
  siguen inactivos (fases siguientes).
* Probado en Chromium (escritorio y móvil emulado); falta Safari/WebKit y
  dispositivos reales.

## Fase 3 — evidencia en el registro y en las invitaciones

Migración `20261017000000_aceptaciones_registro_invitacion.sql` (para
revisión; **no aplicada**). Rollback:
`supabase/rollback/20261017000000_aceptaciones_registro_invitacion.down.sql`.

* **Registro** (`/registro`): la página lee las versiones vigentes del país
  y el formulario envía las que MOSTRÓ (`version_ids`), con enlaces a esa
  versión exacta. `crear_cuenta_prueba` (nueva sobrecarga de 8 argumentos,
  solo `service_role`) valida ANTES de crear nada: si una versión ya no es
  la vigente → `documento_cambiado`; si falta un requisito obligatorio de
  `admin_residencial` para el país → `aceptacion_faltante`; si el Acuerdo
  de Tratamiento (alcance residencial) va sin la declaración de facultades
  → `falta_declaracion_facultades`. Registra la evidencia con origen
  `registro` en la misma transacción que la cuenta; versión, hash y hora
  los pone la base. Si los documentos cambiaron mientras se llenaba el
  formulario, la pantalla muestra los nuevos y pide aceptarlos de nuevo.
  La sobrecarga de 6 argumentos sigue (delega con lista vacía): solo sirve
  mientras no haya requisitos cargados.
* **Alta fallida**: `revertir_cuenta_prueba` descarta la evidencia con
  `descartar_aceptaciones_alta_fallida` antes de borrar; si no puede
  (cuenta ya usada), no borra nada (`evidencia_conservada`).
* **Invitación** (`/aceptar-invitacion`): la nueva
  `aceptar_documentos_invitacion(tenant, versiones)` (solo
  `authenticated`, con membresía activa) registra los documentos de
  alcance usuario con origen `invitacion` y fija
  `users.terminos_aceptados_en = now()` del servidor. El navegador ya no
  escribe esa fecha: el trigger `users_terminos_solo_servidor` lo impide
  a `anon`/`authenticated`. La aceptación se registra antes de fijar la
  contraseña; si falla, el alta no continúa.
* El Acuerdo de Tratamiento se acepta solo en el registro (es del
  residencial); en la invitación, solo Términos y Aviso de Privacidad.
* **Orden de despliegue**: primero la migración, después la app (la app
  llama a la RPC de 8 argumentos y a la de invitación). La app con la
  migración ya aplicada y sin requisitos cargados se comporta como hoy.
* Pruebas: `supabase/tests/security/97_aceptaciones_registro.sql` (fase
  F3), `supabase/tests/grants/99_aceptaciones_registro.sql`,
  `apps/admin/lib/__tests__/aceptacion-legal.test.ts` y los casos 7P–7U
  de `tests/legal/paginas-local.mjs` (documentos ficticios «ZZ»).

## Pendiente para fases posteriores (nada de esto está activo)

1. Textos aprobados por la revisión jurídica (domicilio de la prestadora,
   `privacidad@`/`soporte@` verificados) y su carga como versiones (el
   mecanismo de carga ya existe: Fase 2).
2. Decidir los requisitos por rol y país (tabla vacía hoy) y si algún
   tratamiento exige consentimiento. Sin requisitos cargados, la Fase 3
   registra lo que se muestra pero no exige nada.
3. Validación de facultades de representación para el Acuerdo de
   Tratamiento (hoy: declaración en una casilla).
4. Aceptación posterior (versiones nuevas para cuentas existentes) y su
   interfaz; cualquier bloqueo de acceso por pendientes se decidirá y
   probará en su propia fase.
5. Plazo de conservación y depuración.

## Pruebas

* `supabase/tests/security/92_documentos_legales.sql` (fase LG del runner):
  inactividad, permisos, ciclo de versiones, inmutabilidad, auditoría,
  TRUNCATE, requisitos, vigentes, pendientes y registro (multitenant,
  país, versiones nuevas, alcance de residencial), consentimiento y
  revocación, validaciones de la evidencia, supervivencia a la baja de
  cuenta y residencial, y descarte de alta fallida.
* `supabase/tests/security/concurrencia_aceptaciones.sh`: dos sesiones
  reales, en una copia desechable de la base (la evidencia no se puede
  borrar).
* `supabase/tests/grants/97_documentos_legales.sql`: con los default
  privileges de un proyecto nuevo, ningún privilegio ni EXECUTE para la
  API.
* Los dos runners aplican, revierten y reaplican la migración y comparan
  el catálogo. Con datos cargados, el rollback aborta sin cambios.
* Fase 2: `supabase/tests/security/91_documentos_legales_lectura.sql`
  (fase LP: qué devuelve cada lectura a anon/authenticated, borradores y
  aprobados nunca, vigente decidida por la base, sin acceso a tablas ni a
  escrituras, leer no escribe, aislamiento entre residenciales),
  `supabase/tests/grants/98_documentos_legales_lectura.sql` (EXECUTE
  exacto con los default privileges de staging), `tests/legal/` (cargador
  contra el esquema real y páginas en navegador; ver `tests/legal/README.md`)
  y `apps/admin/lib/__tests__/legal-paginas.test.ts`.

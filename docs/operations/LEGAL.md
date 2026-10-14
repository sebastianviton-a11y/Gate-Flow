# Documentos legales y evidencia de aceptaciones — Fase 1 (inactiva)

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

## Pendiente para fases posteriores (nada de esto está activo)

1. Textos aprobados por la revisión jurídica (domicilio de la prestadora,
   `privacidad@`/`soporte@` verificados) y su carga como versiones.
2. Decidir los requisitos por rol y país (tabla vacía hoy) y si algún
   tratamiento exige consentimiento.
3. Validación de facultades de representación para el Acuerdo de
   Tratamiento.
4. Fase de registro: `crear_cuenta_prueba` registrará las aceptaciones
   con origen `registro`; `revertir_cuenta_prueba` deberá llamar a
   `descartar_aceptaciones_alta_fallida` antes de borrar el usuario.
5. Permisos para la API (solo las funciones necesarias) y la interfaz.
   Cualquier bloqueo de acceso por pendientes se decidirá y probará en su
   propia fase.
6. Plazo de conservación y depuración.

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

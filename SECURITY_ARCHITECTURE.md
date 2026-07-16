# SECURITY_ARCHITECTURE.md

**Rol:** CTO de GateFlow.
**Naturaleza de este documento:** arquitectura, no auditoría. La auditoría de implementación (qué se construyó, qué bugs se corrigieron) vive en `SPRINT_02_DELIVERY.md §5-7`. Este documento define cómo debe comportarse el sistema de aquí en adelante, independientemente de qué sprint lo implemente.

**Convención de estado usada en todo el documento:**
- ✅ **Implementado** — ya existe en el código/esquema actual.
- 🔶 **Diseñado, no implementado** — la decisión está tomada aquí; se construye en un sprint futuro.
- ⚠️ **Requiere decisión de negocio/legal** — no es una decisión puramente técnica; señalado explícitamente, no resuelto en silencio.

No se escribe código en este documento. Nada de lo marcado 🔶 se implementa hasta que este documento quede aprobado.

---

## 1. Arquitectura Multi-Tenant

**Decisión: shared database, shared schema, aislamiento por Row Level Security.** ✅ Un único proyecto Supabase, una única base de datos, todas las tablas de negocio compartidas entre tenants, separadas por `tenant_id`.

**Por qué no schema-per-tenant ni database-per-tenant:** a la escala actual (decenas a un par de cientos de residenciales), esos modelos multiplican el costo operativo (una migración se aplica N veces, no una), sin ninguna ganancia de seguridad real frente a RLS bien implementado — el aislamiento que dan es organizativo, no criptográfico ni más fuerte en la práctica si RLS está correctamente probado.

**Cuándo reconsiderar esto:** si un cliente exige contractualmente aislamiento físico de datos (típico en sectores regulados, no en portería residencial), la respuesta correcta no es migrar todo el modelo — es ofrecer un proyecto Supabase dedicado para ese cliente específico, como tier premium, manteniendo el resto de la plataforma como está. Esto no se construye ahora porque no hay un cliente que lo exija todavía.

## 2. Modelo de aislamiento entre residenciales

**Regla única, sin excepciones: ningún dato de negocio se filtra por tenant en el código de la aplicación — se filtra en la base de datos, vía RLS.** ✅ El código de la aplicación (Next.js, ambas apps) nunca es la autoridad de seguridad; es, en el mejor de los casos, una segunda capa de UX (ocultar lo que el usuario no debería ver) que nunca sustituye a RLS.

**Mecanismo:** tres funciones `SECURITY DEFINER` (`current_tenant_ids()`, `is_super_admin()`, `has_role()`) son el único punto donde se resuelve "¿a qué tenant(s) pertenece este usuario?" — todas las políticas de todas las tablas las consultan, en vez de reimplementar esa lógica tabla por tabla. Esto significa que si mañana cambia cómo se determina la pertenencia a un tenant, se cambia en tres funciones, no en 27 policies.

**Lección ya incorporada como regla, no como anécdota:** en Sprint 02 encontré que mis primeras vistas de dashboard no heredaban RLS — en Postgres/Supabase, una vista se ejecuta con los permisos de su dueño por defecto, no del usuario que consulta. Esto ya no es un hallazgo aislado: es la regla #1 de la sección 3.

**Verificación de aislamiento — estado actual y objetivo:**
- ✅ Verificado por script estático que las 27 tablas + vistas tienen RLS habilitado.
- 🔶 **No verificado por prueba de ejecución real** (crear dos tenants, confirmar que ninguno ve datos del otro) — esto es lo más importante pendiente de todo el proyecto, y debe ser la primera prueba automatizada que exista, antes que cualquier otra.

## 3. Estrategia completa de RLS

**Regla #1 — Toda vista nueva declara `security_invoker = true` explícitamente, sin excepción.** ✅ Ya aplicado a las 3 vistas existentes. Se agrega a la checklist de migración de `CLAUDE.md §10` como ítem obligatorio.

**Regla #2 — RLS se habilita en la misma migración que crea la tabla, nunca después.** ✅ Cumplido hasta ahora. Una tabla sin RLS, aunque sea por minutos entre migraciones, es una ventana de exposición real en un sistema con `service_role` circulando en CI/Edge Functions.

**Regla #3 — Patrón por tipo de tabla** (referencia rápida, ya aplicado):

| Tipo de tabla | Patrón de policy |
|---|---|
| Tabla con `tenant_id` directo (calles, unidades, paquetes, etc.) | `tenant_id in (select current_tenant_ids())` |
| Tabla sin `tenant_id` propio, relacionada por join (casas, departamentos, incidencia_fotografias) | Subquery vía la tabla padre |
| Catálogo con `tenant_id` nullable (tamaños, prioridades, empresas de paquetería) | `tenant_id is null or tenant_id in (...)` — global + propio |
| Catálogo global fijo (roles, permisos, estados_paquete) | `auth.role() = 'authenticated'`, solo lectura |
| Tabla sin acceso de cliente en absoluto (reservas_codigo_gateflow) | RLS habilitado, **cero** policies para `authenticated` — solo `service_role` (que bypasa RLS por diseño de Supabase) puede tocarla |
| Auditoría (audit_log) | Lectura solo para admin/super_admin de su propio tenant; escritura únicamente vía función `SECURITY DEFINER` |

**Regla #4 — Toda función `SECURITY DEFINER` es la excepción controlada, no la norma.** ✅ Hoy existen 5: `current_tenant_ids()`, `is_super_admin()`, `has_role()`, `registrar_auditoria()`, `handle_new_auth_user()`. Cada una tiene un propósito único y acotado, documentado en su propio comentario SQL. **Ninguna función nueva se marca `SECURITY DEFINER` sin que este documento se actualice para justificarla** — es la puerta de entrada más peligrosa de un sistema con RLS, porque por definición bypasa lo que RLS protege.

**Regla #5 — `entregar_paquete()` es `SECURITY INVOKER`, no definer, a propósito.** ✅ Las mutaciones de negocio normales (no las de autorización/auditoría) deben seguir pasando por RLS del usuario que las invoca. Solo la resolución de "quién soy y a qué pertenezco" y la escritura de auditoría necesitan bypasear RLS — el resto de la lógica de negocio no.

**Regla #6 — RLS no sustituye la validación en el backend.** ✅ (`fn_validar_residente_mismo_tenant()`, `fn_proteger_campos_paquete()`) — RLS decide *qué filas puede ver/tocar* un usuario; los triggers de validación deciden *si el contenido de esa fila es válido*. Son capas distintas, ambas necesarias.

## 4. Roles y permisos

**Cuatro roles** (`super_admin`, `admin_residencial`, `guardia`, `residente`) ✅, resueltos por `user_tenants.rol_id`, un rol por persona por tenant (BR-45).

**Estado actual — importante ser honesto sobre esto:** las políticas RLS de hoy verifican **rol** (`has_role()`), no **permiso individual**. Las tablas `permisos`/`rol_permisos` existen y tienen datos semilla, pero no son todavía la fuente de verdad de ninguna policy — son la base para una futura autorización granular (ej. un rol "supervisor" que pueda ver reportes pero no editar catálogos), no algo que hoy esté "a medio implementar de forma insegura". Rol es suficiente para los 4 roles actuales; permisos graduales se activan el día que un rol necesite matices dentro de sí mismo.

**Defensa en dos capas, para acceso a páginas (no a datos):**
1. RLS decide qué **datos** puede ver/tocar un usuario — siempre activa, sin importar por dónde entre.
2. `requireRole()` en Server Components decide qué **páginas** puede cargar — es UX, no seguridad; si se rompiera, RLS seguiría protegiendo los datos.

**Principio de mínimo privilegio:** ningún rol tiene más acceso del que su función requiere. `guardia` no puede leer `audit_log` ni editar catálogos. `admin_residencial` no puede ver tenants ajenos ni escalar a `super_admin`. `super_admin` es el único rol con alcance multi-tenant — su gobierno se define en la sección 5.

## 5. Acceso temporal del equipo GateFlow para soporte

Este es el tema que más me preocupa dejar mal definido, porque es el que más fácil es resolver mal: "dale `super_admin` a todo el equipo de soporte" es la solución más simple y la más peligrosa.

**Principios no negociables:**
- **No hay acceso permanente de "solo por si acaso".** `super_admin` se asigna a personas específicas, no a un equipo entero, y su lista se revisa periódicamente.
- **Todo acceso de soporte es intencional, acotado en el tiempo, y con motivo registrado** — no "porque puedo entrar", sino "porque este ticket específico lo requiere, y por esta ventana de tiempo".
- **El cliente puede ver que se accedió a su cuenta.** No es un requisito legal en todos los casos, pero es la diferencia entre una plataforma que un residencial confía con datos de sus residentes y una que no.

**Diseño propuesto (🔶 no implementado):**

Una tabla `soporte_sesiones` (tenant_id, solicitado_por, motivo, creado_en, expira_en, revocado_en nullable). Las políticas RLS de las tablas de negocio, para el caso específico de `super_admin` accediendo a un tenant que no es el suyo, exigirían además una fila activa y no expirada en `soporte_sesiones` para ese tenant — es decir, **`super_admin` por sí solo no basta para ver datos de un tenant ajeno; hace falta además una sesión de soporte abierta y vigente**. Esto convierte el acceso de super_admin de "interruptor permanente" a "llave que hay que insertar y que expira sola".

Complementos de este diseño:
- Notificación automática al `admin_residencial` del tenant cuando se abre una sesión de soporte sobre su cuenta (visibilidad, no solo auditoría interna).
- Duración máxima corta por defecto (ej. 4 horas), renovable explícitamente, nunca indefinida.
- Toda acción durante una sesión de soporte activa queda en `audit_log` igual que cualquier otra (BR-52 ya lo exige) — la sesión de soporte no es una forma de saltarse auditoría, es una forma de acotar cuándo el acceso *elevado* existe en absoluto.

**Por qué no se implementa todavía:** es infraestructura de gobierno, no de producto — no bloquea que un residencial use GateFlow hoy, y construirla antes de tener un equipo de soporte real que la use sería anticipar un proceso operativo que todavía no existe (mismo principio de "no sobre-construir" aplicado aquí). Se implementa antes de que GateFlow tenga clientes reales en producción con acceso de soporte activo — no después.

## 6. Auditoría

**Dos registros de auditoría, con propósitos distintos, ambos ✅ implementados:**
- `audit_log` — genérico, para acciones administrativas (cambios de configuración, ediciones fuera del flujo normal de paquetes, acceso de super_admin). Solo lectura vía API; escritura únicamente vía `registrar_auditoria()`.
- `paquete_historial` — específico del dominio, automático (trigger), registra cada cambio de estado de un paquete sin que ninguna capa de aplicación tenga que acordarse de invocarlo.

**Retención — ⚠️ requiere decisión de negocio, propuesta como punto de partida:** sugiero retención indefinida mientras el tenant esté activo, y un mínimo de 2 años después de que un tenant se dé de baja, antes de considerar purga — es un período razonable para disputas contractuales, pero es una decisión que debería confirmarse con quien lleve el aspecto legal/comercial de GateFlow, no algo que yo fije unilateralmente como arquitectura técnica.

**Qué NO se audita hoy y debería considerarse:** lecturas (quién vio qué) no quedan registradas, solo escrituras. Para datos de portería esto es razonable — pero si en el futuro se maneja información más sensible (ej. datos de acceso vehicular con placas, cámaras), auditar lecturas de datos sensibles específicos pasa a ser necesario. No se implementa ahora porque no hay ese tipo de dato todavía.

## 7. Política de privacidad

⚠️ **Aclaración importante: no soy abogado, y el texto legal de una política de privacidad requiere revisión de alguien que sí lo sea** — particularmente porque GateFlow opera en México, donde aplica la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), con sus propios requisitos de aviso de privacidad y derechos ARCO (Acceso, Rectificación, Cancelación, Oposición). Lo que sigue es la arquitectura **técnica** que cualquier política de privacidad necesitaría para ser cumplible en la práctica, no el texto legal en sí.

**Datos personales que GateFlow procesa hoy:** nombre y teléfono de residentes y personal (guardias/admins), fotografías de evidencia de paquetes (pueden incluir personas de fondo), firmas digitales, y en el futuro, números de teléfono enviados a la API de WhatsApp Business (un tercero — Meta) para notificaciones.

**La tensión real que hay que resolver: BR-13/BR-49 dicen "los datos no se eliminan" — un derecho de cancelación (ARCO) puede exigir eliminar datos personales de una persona específica.** Esto no es un conflicto que deba resolverse ignorando una de las dos reglas — se resuelve así:

🔶 **Anonimización, no eliminación, como mecanismo de cumplimiento.** Ante una solicitud válida de cancelación, el registro estructural (el paquete existió, se entregó tal día) se conserva —porque tiene valor de auditoría e integridad del historial de otros residentes de la misma unidad—, pero los campos que identifican a la persona (`nombre_completo`, `telefono`, `avatar_url` en `users`; `entregado_a_nombre` en `paquetes` si corresponde a esa persona) se reemplazan por un valor no identificable ("Usuario eliminado a solicitud"). Esto satisface BR-13/BR-49 (nada se borra estructuralmente) y a la vez hace honrable un derecho de cancelación real. No implementado todavía porque no hay flujo de solicitud de derechos ARCO construido — se construye junto con esa función, no antes.

**Exportación de los propios datos (derecho de acceso):** ver sección 8 — la exportación por tenant ya cubre técnicamente la mayor parte de lo que un derecho de acceso individual necesitaría, filtrando a la persona específica.

## 8. Importación y exportación masiva

**Importación** (🔶 diseñado, no implementado — mencionado ya en el roadmap de V1.0 para altas de unidades/residentes):
- Vía un formulario en `apps/admin` que sube un CSV; el procesamiento ocurre en una Edge Function, nunca insertando directo desde el navegador fila por fila (evita 500 requests individuales y permite validar el archivo completo antes de comprometerse a nada).
- El `tenant_id` de cada fila se toma **siempre** de la sesión del administrador que sube el archivo, nunca de una columna del CSV — un archivo no puede, ni por error ni por manipulación, crear datos en un tenant distinto al de quien lo sube.
- Idempotencia: la restricción `unique (tenant_id, identificador)` en `unidades` ya hace que re-subir el mismo CSV no duplique — actualiza o falla la fila duplicada, según se decida.
- Se audita como cualquier otra acción administrativa (`registrar_auditoria`), incluyendo cuántas filas se procesaron.

**Exportación** (🔶 diseñado, no implementado):
- Un `admin_residencial` puede exportar los datos de **su propio tenant** — RLS ya garantiza que no puede exportar de otro, sin necesitar lógica adicional.
- Una exportación completa de un tenant es, en sí misma, un evento sensible (si la cuenta de un admin se compromete, exportar todo es el ataque más eficiente) — se audita explícitamente y se recomienda limitar la frecuencia (ej. rate limit de una exportación completa por hora).
- **Exportación cruzada de tenants por el equipo de GateFlow no está contemplada como funcionalidad de producto.** Si alguna vez es necesaria (ej. requerimiento legal), pasa por el mecanismo de sesión de soporte de la sección 5, nunca por una herramienta de exportación masiva de propósito general.

## 9. Backups y recuperación

**Base de datos:** ✅ Supabase gestiona backups automáticos; el nivel de garantía (frecuencia, Point-in-Time Recovery) depende del plan contratado — esto es una decisión de plan/costo, no de arquitectura de GateFlow, pero **la arquitectura sí debe fijar un objetivo**:

- 🔶 **Propuesta de RPO/RTO** (a confirmar contra el plan de Supabase real que se contrate): RPO objetivo ≤ 24 horas en el plan base, mejorable a minutos si se activa Point-in-Time Recovery (disponible en planes superiores de Supabase). RTO objetivo ≤ 4 horas para restaurar el servicio ante una pérdida total de la base.
- ⚠️ **Nadie ha probado un restore todavía.** Un backup que nunca se restauró de prueba es una promesa, no una garantía. Esto debe hacerse al menos una vez antes de tener el primer cliente en producción, y luego periódicamente (ej. cada trimestre), no asumirse.

**Storage (evidencia fotográfica, firmas):** ⚠️ **Gap real, no cubierto todavía.** Supabase Storage no tiene el mismo mecanismo de Point-in-Time Recovery que Postgres — es un bucket de archivos, con su propio ciclo de vida. Antes de depender de fotos de evidencia como prueba legal de entrega, hace falta definir explícitamente la estrategia de respaldo de Storage (replicación, o al menos backups periódicos exportados), porque hoy no está definida y es una laguna real, no una omisión menor.

## 10. Gestión de secretos

**Aclaración que vale la pena dejar explícita: las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` NO son secretos.** ✅ Están diseñadas para viajar al navegador — la seguridad no depende de ocultarlas, depende de que RLS haga su trabajo con ellas. Confundir esto (tratar el anon key como si fuera sensible, o peor, asumir que porque no es sensible nada lo es) es un error común que vale la pena prevenir por escrito.

**Secretos reales** (nunca en el repositorio, nunca en el cliente):
- `service_role` key de Supabase — solo en Edge Functions y en entornos de CI/CD, nunca en `apps/admin` ni `apps/guard`.
- Tokens de la API de WhatsApp Business (futuro).
- Cualquier credencial de servicios de terceros futuros (OCR, etc.).

**Dónde viven:** variables de entorno del proveedor de despliegue (Vercel/Netlify, cifradas en reposo por la plataforma) para el frontend; configuración de proyecto de Supabase para Edge Functions; secretos de GitHub Actions (o el CI que se use) para el pipeline — nunca en un archivo versionado, ni siquiera cifrado dentro del repo.

**Rotación:** 🔶 no hay política formal todavía. Propuesta: rotación anual de rutina para credenciales de larga vida, rotación inmediata ante cualquier sospecha de compromiso o cuando una persona con acceso a secretos deja el equipo.

## 11. Riesgos conocidos (consolidado)

| Riesgo | Severidad | Estado |
|---|---|---|
| Aislamiento multi-tenant nunca probado en ejecución real (solo verificado estáticamente) | Alta | Pendiente — primera prueba a escribir |
| Nombres de constraint de FK auto-generados, no verificados contra Postgres real | Media | Pendiente de validación en primera ejecución |
| Sin backup/restore de Storage (evidencia fotográfica) definido | Alta | Gap de diseño, sección 9 |
| Acceso de soporte de GateFlow sin mecanismo de sesión acotada (hoy: solo el rol super_admin, sin ventana de tiempo) | Alta | Diseño propuesto, sección 5, no implementado |
| Tensión BR-13/49 vs. derechos ARCO sin mecanismo de anonimización implementado | Media | Diseño propuesto, sección 7, no implementado |
| Sin CI que ejecute lint/typecheck/build/pruebas en cada cambio | Media | No implementado, ningún sprint hasta ahora tuvo ejecución real |
| Refresh de vistas materializadas (dashboard histórico) no automatizado | Baja | Heredado de Sprint 01 |
| Retención de auditoría sin política formal confirmada | Baja | Requiere decisión de negocio |

## 12. Escalabilidad

Marco de referencia por etapas — para no sobre-construir para una etapa en la que GateFlow no está todavía:

- **Etapa actual (decenas de tenants):** arquitectura tal cual existe. Suficiente.
- **Etapa de crecimiento (cientos de tenants):** activar particionamiento de `paquetes`/`audit_log` por rango de fecha (ya preparado desde `03-DATABASE.md`, no activado); subir tier de cómputo de Supabase; automatizar el refresh de vistas materializadas.
- **Etapa de escala mayor (miles de tenants / expansión geográfica):** considerar proyectos Supabase dedicados para tenants grandes o por región; herramienta de soporte más sofisticada que la sesión simple de la sección 5.

No se construye infraestructura de la etapa 3 mientras GateFlow esté en la etapa 1 — es el mismo principio aplicado en cada sprint anterior.

## 13. Buenas prácticas de Supabase (checklist vigente)

- ✅ RLS habilitado en toda tabla de negocio, sin excepción.
- ✅ `security_invoker = true` en toda vista, sin excepción (regla añadida tras el hallazgo de Sprint 02).
- ✅ `service_role` nunca en código de cliente.
- ✅ Funciones `SECURITY DEFINER` mínimas y documentadas, nunca como atajo general.
- ✅ URLs firmadas de corta duración para acceso a evidencia en Storage, nunca buckets públicos.
- 🔶 MFA para roles `admin_residencial` y `super_admin` — no implementado; recomendado antes de manejar datos de clientes reales en producción, dado que esos roles son los que administran configuración y, en el caso de super_admin, cruzan tenants.
- 🔶 Connection pooling explícito para funciones de alta concurrencia — Supabase ya provee un pooler; confirmar que Edge Functions lo usan correctamente cuando se implementen.

## 14. Decisiones técnicas y su justificación (resumen ejecutivo)

- **RLS vía funciones `SECURITY DEFINER` en vez de claims JWT custom:** funciona sin configurar un Auth Hook manual en el dashboard, a costa de un subquery extra por fila — aceptable al volumen actual, reconsiderar si el volumen de tenants/consultas lo justifica.
- **Shared schema, no schema-per-tenant:** costo operativo proporcional al tamaño real de la plataforma, no al peor caso hipotético.
- **Anonimización en vez de eliminación para cumplir derechos de privacidad:** resuelve la tensión con BR-13/49 sin violar ninguna de las dos necesidades.
- **Sesión de soporte acotada en vez de `super_admin` permanente:** el acceso elevado debe ser la excepción visible, no el estado por defecto de nadie.
- **No se construye nada marcado 🔶 hasta que este documento esté aprobado** — es exactamente la instrucción que diste, y la razón de que este documento exista separado de la auditoría de implementación.

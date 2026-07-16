# CLAUDE.md — Contexto Permanente de GateFlow

**Versión 1.2** · v1.1 incorporó MISION.md a la jerarquía documental y precisó las reglas de dependencias externas. v1.2 corrige la convención de nombre de archivo de componentes (kebab-case, no PascalCase) para que el documento no contradiga el código real de Sprint 01. Ninguna otra decisión de versiones previas se modifica.

Este documento es de lectura y cumplimiento obligatorio en toda conversación, sprint o tarea de desarrollo sobre GateFlow. No es un resumen opcional — es la referencia que garantiza que cualquier sesión futura, con o sin memoria de las sesiones anteriores, produzca resultados consistentes con lo ya decidido.

---

## 1. Identidad del proyecto

**Nombre:** GateFlow.

**Definición:** GateFlow es una plataforma SaaS multi-tenant para digitalizar las operaciones de portería de residenciales, condominios y urbanizaciones privadas.

**Problema que resuelve:** la gestión manual de la portería (bitácoras en papel, mensajes sueltos de WhatsApp, ausencia de evidencia) produce paquetes perdidos, disputas de entrega sin respaldo, y residentes que se enteran de sus paquetes por casualidad.

**Usuario operativo primario:** el guardia de seguridad. Trabaja bajo presión de tiempo, con las manos ocupadas, en condiciones de campo (sol, poca señal, turnos largos). Toda decisión de producto se evalúa primero por su costo para este usuario.

**Alcance actual:** un único módulo en desarrollo — Gestión de Paquetes.

**Visión futura:** plataforma modular de operaciones de portería, con módulos futuros de Visitantes, Accesos, Correspondencia, Incidencias, Reservas, Comunicados, Proveedores y Vehículos, construidos sobre el mismo núcleo de tenant, usuarios, roles y unidades.

> **GateFlow no es una app de paquetería con funciones adicionales. Es una plataforma de operaciones de portería cuyo primer módulo es Paquetes.**

Toda decisión de arquitectura, nomenclatura o modelo de datos debe tomarse pensando en esta identidad, no solo en el módulo que se esté construyendo hoy.

---

## 2. Jerarquía documental

Orden de autoridad, de mayor a menor:

1. `01-BUSINESS_RULES.md`
2. `00-PRD.md`
3. `MISION.md`
4. `02-ARCHITECTURE.md`
5. `03-DATABASE.md`
6. `04-API.md`
7. Documentos de UX y operativos (`05-UX.md` y siguientes)
8. Código existente

`MISION.md` gobierna la filosofía, los principios y la orientación de largo plazo del producto — es la referencia para evaluar si una decisión "encaja" con lo que GateFlow debe ser. `01-BUSINESS_RULES.md` sigue siendo, sin excepción, la máxima autoridad sobre comportamiento funcional: ante cualquier conflicto entre lo que la misión inspira y lo que una regla de negocio exige, prevalece la regla de negocio, y la tensión se señala como candidata a revisión de la misión o de la regla, no se resuelve improvisando.

**Regla de resolución de conflictos:**
- Si el código contradice la documentación aprobada, **se corrige el código**.
- Si dos documentos aprobados se contradicen entre sí, Claude debe **detenerse, describir la contradicción explícitamente y solicitar una decisión humana**. Nunca debe resolver la contradicción de forma silenciosa ni asumir cuál documento prevalece por su propia cuenta, incluso si el orden de esta jerarquía sugiere una respuesta — el orden resuelve autoridad de contenido, no autoriza a inventar una solución sin señalar el conflicto primero.

---

## 3. Principios inmutables de GateFlow

- El guardia es el usuario prioritario del sistema.
- La velocidad de campo está por encima de la complejidad funcional.
- El registro de un paquete debe completarse en menos de 20 segundos.
- Las tareas frecuentes deben resolverse en tres interacciones o menos, cuando sea posible.
- Nunca se pide escritura manual si el dato puede seleccionarse o escanearse.
- La aplicación del guardia es offline-first.
- La administración y los reportes son cloud-first.
- La evidencia (foto, firma, registro auditado) reemplaza a la memoria de las personas.
- Los datos de negocio no se eliminan.
- Toda acción relevante queda auditada.
- El aislamiento multi-tenant se garantiza en PostgreSQL mediante RLS, no en el código de la aplicación.
- La arquitectura es modular por diseño.
- El costo operativo debe ser proporcional al uso real, no a una proyección especulativa.
- No se sobre-construye para escenarios todavía no validados.

Estos principios no se negocian dentro de una tarea individual. Un cambio a cualquiera de ellos es una decisión de producto, no una decisión de implementación, y requiere aprobación humana explícita.

---

## 4. Arquitectura obligatoria

Decisiones ya aprobadas, vigentes salvo ADR que las modifique explícitamente:

- Monorepo.
- Next.js y TypeScript para interfaces web.
- PWA local-first para la aplicación de guardias.
- Supabase como backend principal (PostgreSQL, Auth, Storage, Edge Functions).
- Shared schema multi-tenant.
- Row Level Security en todas las tablas con datos de negocio.
- PowerSync o herramienta equivalente aprobada para sincronización offline — **no se construye un motor de sincronización propio**.
- Postgres Full Text Search para la búsqueda universal — **sin Elasticsearch en el MVP**.
- Edge Functions únicamente para lógica que no pueda resolverse mediante PostgREST, SQL directo o el propio mecanismo de sincronización.
- Sin microservicios, sin Kafka, sin infraestructura distribuida innecesaria.

Ninguna integración externa (WhatsApp, futuro OCR, futuras integraciones de control de acceso) puede contaminar la lógica del dominio — toda integración externa se conecta mediante un adaptador (ver sección 6), nunca referenciada directamente desde las reglas de negocio.

---

## 5. Organización modular

**Núcleo compartido** (usado por todos los módulos, presentes y futuros):
Tenants, Usuarios, Roles, Permisos, Unidades, Residentes, Auditoría, Infraestructura de notificaciones.

**Módulo Paquetes** (dominio específico, no reutilizable directamente por otros módulos):
Paquetes, Estados, Fotografías, Firmas, Incidencias, Ubicaciones, Tamaños, Prioridades, Empresas de paquetería, Historial, Código GateFlow.

**Prohibición explícita:** un módulo futuro no debe duplicar entidades del núcleo (no se crea un segundo sistema de usuarios o de roles) ni depender directamente de tablas internas de otro módulo (Visitantes no consulta tablas de Paquetes; ambos consultan Unidades).

---

## 6. Arquitectura interna del código

Se adopta una organización por capas inspirada en Clean Architecture / Ports and Adapters, aplicada con moderación — el objetivo es separar responsabilidades, no construir abstracciones que el MVP no necesita.

**Capas conceptuales:**
- **Domain** — reglas de negocio puras (las `BR-XX`). No conoce Supabase, PowerSync, WhatsApp ni el framework de UI.
- **Application** — casos de uso que orquestan el dominio (ej. "registrar recepción de paquete").
- **Infrastructure** — adaptadores concretos: acceso a Postgres/Supabase, cliente de sincronización, cliente de WhatsApp, almacenamiento de archivos.
- **Interface/UI** — componentes de Next.js y de la app de guardia que consumen los casos de uso.

**Reglas:**
- El dominio no depende de Supabase, de PowerSync, de WhatsApp ni del framework de UI.
- Toda integración externa se implementa como un adaptador que satisface un contrato definido por el dominio/aplicación, nunca al revés.
- Las reglas de negocio deben poder probarse sin red, sin base de datos real y sin servicios externos.
- No se crean abstracciones (interfaces, capas, patrones) sin un caso real que las justifique hoy. Preparar para el futuro no es excusa para abstraer algo que solo tiene una implementación conocida.

---

## 7. Reglas de negocio

Toda implementación debe referenciar explícitamente el identificador `BR-XX` correspondiente de `01-BUSINESS_RULES.md`. Ejemplos de referencia esperada:

- En una prueba: *"implements BR-14"*.
- En un caso de uso: *"enforces BR-15"*.
- En una migración: *"supports BR-17"*.

**Prohibiciones que ninguna implementación puede violar, bajo ninguna circunstancia:**

- Entregar un paquete dos veces (BR-14).
- Eliminar paquetes (BR-13).
- Eliminar evidencia — fotos o firmas (BR-28, BR-49).
- Registrar un paquete en estado "recibido" sin ubicación física asignada (BR-17).
- Entregar un paquete sin evidencia obligatoria (BR-15, BR-27).
- Cruzar información entre tenants, bajo ningún rol, incluido Super Admin (BR-01 a BR-04).
- Saltarse el registro de auditoría en una acción que lo requiere (BR-50 a BR-52).
- Agregar estados o transiciones de paquete no aprobados en `01-BUSINESS_RULES.md` (BR-16).

Si una tarea requiere un comportamiento que no está cubierto por una regla existente, esto se señala como una decisión de negocio pendiente (ver sección 26) — no se improvisa una regla nueva dentro del código.

---

## 8. Convenciones de nomenclatura

- **Documentación de producto:** español, salvo decisión explícita en contrario.
- **Código (variables, funciones, tipos, comentarios técnicos):** inglés, siempre. No se mezcla español e inglés dentro del código.
- **Base de datos:** `snake_case` para tablas y columnas.
- **Componentes React:** `PascalCase`.
- **Funciones y variables:** `camelCase`.
- **Constantes:** `UPPER_SNAKE_CASE`.
- **Archivos de componentes:** `kebab-case` (ej. `stat-card.tsx`, `tenant-switcher.tsx`), consistente con la convención del ecosistema shadcn/ui ya adoptada en el código de Sprint 01. El símbolo exportado dentro del archivo va en `PascalCase` (ej. `export function StatCard`). *(Corrección v1.2: la versión 1.1 decía `PascalCase` para nombres de archivo; el código real de Sprint 01 usó `kebab-case` consistentemente, que es además la convención más extendida en proyectos Next.js/shadcn — se corrige el documento para que no contradiga el código aprobado, en vez de forzar un rename masivo sin beneficio real.)*
- **Migraciones:** timestamp + descripción clara de lo que hace (no del ticket o tarea que la originó).
- **Entidades del dominio, casos de uso, hooks y servicios:** nombres que describan el concepto de negocio, no el mecanismo técnico (ej. `RegistrarRecepcionPaquete`, no `PaqueteHandler`).

---

## 9. TypeScript

- `strict mode` obligatorio en todo el repositorio.
- Prohibido usar `any` salvo justificación explícita documentada en el propio código.
- Preferir `unknown` combinado con validación explícita sobre `any`.
- Tipos compartidos entre frontend, backend y base de datos deben centralizarse — no se duplican definiciones de tipo por capa.
- Toda entrada externa (API, formularios, respuestas de sincronización) se valida contra un esquema explícito, no se asume su forma.
- `null` y `undefined` se manejan de forma explícita; no se dejan casos sin cubrir.
- No se ignoran errores del compilador con supresiones (`@ts-ignore` o similares) sin justificación documentada.
- No se usan casts de tipo para esconder errores de diseño subyacentes.

---

## 10. Base de datos y migraciones

- Toda modificación de esquema se realiza mediante migración versionada. Nunca se edita manualmente el esquema de producción.
- Toda tabla de negocio con necesidad de aislamiento por tenant lleva `tenant_id` directo (denormalizado cuando sea necesario para que RLS funcione sin joins costosos).
- Toda tabla relevante tiene `created_at`, y `updated_at` cuando corresponda a una entidad editable.
- Las relaciones se implementan con foreign keys reales, no solo con convención de nombres.
- Las restricciones críticas (unicidad, checks de reglas de negocio) se implementan en PostgreSQL, no únicamente validadas en la interfaz.
- Los índices se justifican por un patrón de consulta real y documentado — no se agregan índices "por si acaso".
- Las migraciones son reversibles cuando es razonable hacerlo.
- Los cambios destructivos (eliminar o renombrar una columna en uso) requieren un plan de transición explícito, nunca se aplican directamente sobre clientes activos.
- Los datos históricos no se borran, consistente con los principios inmutables.
- RLS se prueba explícitamente para cada tabla nueva o modificada — no se asume que "hereda" seguridad de otra tabla.

**Checklist mínima por migración:**
- [ ] ¿La migración es aditiva o requiere plan de transición?
- [ ] ¿Tiene foreign keys y restricciones reales, no solo convención?
- [ ] ¿Tiene `tenant_id` si aplica y política RLS correspondiente?
- [ ] ¿Se probó RLS para la tabla afectada?
- [ ] ¿Referencia el/los `BR-XX` que soporta?
- [ ] ¿Es reversible, o se documentó por qué no lo es?

---

## 11. Seguridad

- Principio de mínimo privilegio en todo acceso, humano o de sistema.
- RLS es la autoridad principal de aislamiento entre tenants — ninguna verificación de tenant se re-implementa en código de aplicación como sustituto.
- El tenant activo de una solicitud se deriva siempre del token de autenticación, nunca de un parámetro enviado por el cliente.
- Los secretos nunca viven en el repositorio; se gestionan como variables de entorno documentadas (sin exponer su valor) en la documentación de despliegue.
- La `service_role` de Supabase nunca se expone al frontend, bajo ninguna circunstancia.
- Toda subida de archivo valida tipo y tamaño real (no solo la extensión declarada por el cliente).
- El acceso a evidencia (fotos, firmas) se resuelve mediante URLs firmadas de corta duración, no URLs públicas permanentes.
- Toda acción ejecutada por un Super Admin sobre datos de un tenant queda auditada con el mismo rigor que cualquier otra acción.
- Se aplica rate limiting en autenticación y en funciones costosas (envío de notificaciones, generación de bloques de código).
- Toda entrada de usuario se sanitiza antes de procesarse o almacenarse.
- Se valida contra archivos maliciosos en cualquier flujo de subida.
- No se almacenan contraseñas ni PIN sin un mecanismo de hash/seguridad adecuado — nunca en texto plano.
- No se registran datos sensibles (contenido de paquetes, teléfonos completos, firmas, imágenes) en logs de aplicación.

---

## 12. Offline-first

- La interfaz del guardia escribe primero en almacenamiento local; la sincronización ocurre después, en segundo plano.
- Ninguna tarea crítica del flujo de guardia depende de una respuesta de red para completarse desde su perspectiva.
- Fotos y firmas se almacenan localmente antes de iniciarse su subida.
- El guardia debe poder ver en todo momento cuántos registros están pendientes de sincronizar.
- Toda operación de sincronización debe ser idempotente — reintentarla no debe duplicar el efecto.
- Cada operación offline tiene un identificador único generado en el dispositivo, no asignado por el servidor al llegar.
- El timestamp del dispositivo (creación real) y el timestamp del servidor (momento de sincronización) se conservan por separado, nunca se colapsan en un solo campo.
- Los conflictos de sincronización nunca se descartan silenciosamente — se resuelven según BR-37 y el registro en conflicto se conserva.
- Toda operación de sincronización debe tolerar reintentos sin efectos secundarios adicionales.
- Deben existir pruebas específicas de pérdida y recuperación de conectividad, no solo del camino feliz conectado.
- `localStorage` nunca se usa como base de datos operativa — el almacenamiento local es una base de datos real embebida (SQLite u equivalente aprobado).
- No se asume que todos los dispositivos tienen conectividad estable; se diseña para el caso contrario como caso normal, no excepcional.

---

## 13. Código GateFlow

- El identificador técnico interno de un paquete es un UUID; el código visible `GF-AAAA-NNNNNNN` es un identificador de negocio adicional, no un sustituto del UUID.
- El código visible debe tener un formato amigable para lectura y escritura humana.
- La generación offline se resuelve mediante bloques reservados por dispositivo (según lo definido en `03-DATABASE.md`) o un mecanismo equivalente formalmente aprobado — no se genera de forma que dependa de una consulta síncrona al servidor por cada paquete.
- El código visible nunca se usa como única identidad técnica del registro (joins, referencias internas) — esa función la cumple siempre el UUID.
- El QR debe resolver de forma segura y unívoca al paquete correcto, sin ambigüedad entre tenants.
- El mecanismo de generación debe prevenir colisiones por diseño, no por buena suerte estadística.
- Toda generación o reserva de bloques de código queda registrada de forma auditable.

---

## 14. Evidencias y almacenamiento

- Fotografías y firmas son inmutables una vez guardadas.
- Solo se pueden añadir evidencias adicionales; nunca se reemplaza una evidencia existente.
- Las imágenes se comprimen en el dispositivo antes de iniciar la subida.
- Se conservan metadatos de captura (quién, cuándo en el dispositivo) y de sincronización (cuándo llegó al servidor).
- Se almacena `storage_path`, no URLs públicas permanentes.
- El acceso a evidencia se resuelve mediante políticas de acceso y URLs temporales firmadas.
- Las rutas de almacenamiento están separadas por tenant, de forma que un error de configuración no pueda filtrar evidencia entre residenciales.
- Nunca se confía en el nombre de archivo enviado por el cliente para determinar tipo, ruta o comportamiento.
- Se valida formato, tamaño y tipo MIME real del archivo, no solo su extensión.
- La política de retención de evidencia, cuando se defina, no puede contradecir las reglas de auditoría ya establecidas (los datos no se eliminan).

---

## 15. API

- PostgREST se usa para todo CRUD sencillo que no requiera lógica adicional.
- Las Edge Functions se reservan para lógica real de aplicación (generación de códigos, notificaciones, agregaciones) — no se crean para envolver innecesariamente lo que PostgREST ya resuelve.
- Las funciones custom incompatibles con versiones anteriores se versionan explícitamente; no se sobrescribe el comportamiento de una función en uso activo.
- El `tenant_id` nunca se recibe como parámetro del cliente para definir el alcance de una consulta — siempre se deriva del token.
- Las respuestas siguen un formato consistente en todo el sistema.
- Los errores son tipados y categorizados (validación, autorización, conectividad, servidor), no mensajes de texto libre sin estructura.
- Toda colección paginada implementa paginación obligatoria, no devuelve conjuntos completos sin límite.
- Las operaciones que pueden reintentarse (por la naturaleza offline-first del sistema) deben ser idempotentes.
- Toda función custom documenta su entrada, salida, errores posibles y permisos requeridos.
- Se mantiene compatibilidad con clientes desactualizados (apps de guardia sin actualizar) durante un período de transición razonable ante cambios incompatibles.
- No se crean endpoints duplicados cuando PostgREST ya resuelve el caso correctamente.

---

## 16. Domain Events y tareas asíncronas

Eventos conceptuales del dominio de Paquetes:

- `PackageRegistered`
- `PackageReceived`
- `PackageLocationAssigned`
- `PackageNotificationRequested`
- `PackageNotificationSent`
- `PackageDelivered`
- `PackageIncidentOpened`
- `PackageIncidentResolved`

**Reglas:**
- Los eventos describen hechos que ya ocurrieron, no intenciones ni validaciones pendientes.
- Los eventos no contienen lógica de interfaz.
- El procesamiento de un evento debe ser idempotente.
- Las notificaciones y las agregaciones derivadas de un evento nunca bloquean el flujo principal de registro o entrega.
- Un fallo al enviar una notificación por WhatsApp no revierte ni bloquea el registro del paquete que la originó.
- Los reintentos de procesamiento de eventos usan backoff, no reintento inmediato indefinido.
- No se introduce una plataforma de mensajería compleja en el MVP; se empieza con los mecanismos ya disponibles en Supabase y se evoluciona solo cuando el volumen real lo justifique.

---

## 17. Observabilidad

- Logs estructurados, no texto libre sin formato.
- Cada operación relevante lleva un correlation ID que permite rastrear su ciclo completo.
- El `tenant_id` se incluye en logs técnicos cuando es seguro hacerlo (sin exponer datos sensibles del tenant).
- Usuario y dispositivo se incluyen en el log cuando corresponda a la operación.
- Se monitorean errores de forma centralizada.
- Se miden métricas específicas de sincronización (retraso, tasa de fallo) y de notificaciones (tasa de entrega).
- Existen health checks para los servicios críticos.
- Existen alertas ante fallos repetidos, no solo ante fallos aislados.
- Nunca se registra en logs contenido sensible: descripciones de paquetes, teléfonos completos, firmas o imágenes.
- Los errores se distinguen explícitamente por categoría: cliente, negocio, conectividad, servidor — no se agrupan indiferenciadamente.

---

## 18. Pruebas

**Tipos de prueba obligatorios:**
- **Unitarias** — reglas de negocio y casos de uso, sin dependencias externas.
- **Integración** — PostgreSQL, RLS, Storage, Edge Functions y sincronización.
- **End-to-end** — flujos completos de recepción y entrega.
- **Offline** — captura sin red, reintentos, duplicados y resolución de conflictos.
- **Seguridad** — aislamiento entre tenants y verificación de permisos por rol.

Toda regla `BR-XX` crítica debe tener al menos una prueba asociada que la referencie explícitamente.

**Casos mínimos obligatorios, sin excepción:**
- Un tenant no puede leer datos de otro tenant.
- Un paquete no puede entregarse dos veces.
- No se puede entregar un paquete sin evidencia.
- Un paquete en estado "recibido" requiere ubicación asignada.
- Un registro creado offline se sincroniza una sola vez, nunca duplicado.
- Un reintento de sincronización no crea duplicados.
- Un fallo de envío por WhatsApp no hace perder el registro del paquete.
- Un guardia no puede modificar catálogos de configuración (ubicaciones, tamaños, prioridades, empresas).
- Toda acción de un Super Admin sobre un tenant queda auditada.
- Las evidencias (fotos, firmas) no pueden eliminarse por ninguna vía del sistema.

---

## 19. UX

- Diseño operable con una sola mano.
- Botones grandes en toda interacción de campo.
- Alto contraste, pensado para uso bajo luz solar directa.
- Texto de al menos 16px en toda pantalla de operación de campo.
- Se evitan dropdowns extensos; se prefieren listas cortas, recientes y búsqueda tolerante a errores.
- Se evitan confirmaciones innecesarias ("¿estás seguro?") en flujos frecuentes; se prefiere "deshacer" temporal después de la acción.
- Después de una selección inequívoca, la interfaz avanza automáticamente sin requerir un toque adicional de "continuar".
- La cámara se abre automáticamente cuando el flujo la requiere.
- El estado offline es visible en todo momento para el guardia.
- El estado de sincronización (pendiente, en curso, completo) es visible.
- Las acciones destructivas o administrativas se mantienen visual y funcionalmente alejadas del flujo operativo principal.
- No se muestra información administrativa innecesaria al guardia — su interfaz se limita a lo que su rol requiere.

---

## 20. Accesibilidad

- Contraste suficiente en toda interfaz, operativa y administrativa.
- Navegación completa por teclado en el panel administrativo.
- Etiquetas accesibles en todos los controles interactivos.
- Ningún estado del sistema depende exclusivamente del color para comunicarse (siempre se acompaña de texto o ícono).
- Áreas táctiles grandes en toda interfaz de campo.
- Soporte para tamaños de texto razonables sin romper el diseño.
- Mensajes de error claros y en lenguaje humano, no códigos técnicos sin explicación.
- Indicadores visuales y textuales, combinados, para el estado de sincronización.

---

## 21. Rendimiento

- Las interacciones operativas locales (registro, foto, firma) se sienten inmediatas, sin esperar red.
- La subida de fotos en segundo plano nunca bloquea el avance del flujo de registro.
- Los listados frecuentes (recientes, pendientes de hoy) cargan rápido, favorecidos por diseño de índices y agregaciones ya definidos en `03-DATABASE.md`.
- Toda colección se pagina; no se cargan conjuntos completos sin límite.
- Las imágenes se comprimen antes de subir.
- Se evitan consultas N+1 en cualquier listado con relaciones.
- Los dashboards no consultan tablas históricas completas en tiempo real — se leen de la capa de agregación pre-calculada.
- Toda optimización se basa en medición real, no en intuición. No se optimiza sin evidencia de que existe un problema.
- No se introduce una capa de caché compleja sin evidencia de necesidad real.

---

## 22. Git y flujo de trabajo

- Ramas cortas, con alcance acotado.
- Pull requests pequeños y revisables.
- Commits descriptivos del cambio real, no genéricos.
- No se mezclan refactorizaciones grandes con nuevas funcionalidades en el mismo cambio.
- Todo PR indica qué reglas `BR-XX` afecta o implementa.
- Todo PR incluye las pruebas correspondientes.
- Todo PR que cambie comportamiento actualiza la documentación afectada en el mismo cambio.
- No se realizan cambios de arquitectura sin un ADR que los respalde.
- Nunca se incluyen secretos en el repositorio.
- No se suben archivos generados innecesarios.
- Se mantiene un `CHANGELOG` actualizado por release.

---

## 23. ADR (Architecture Decision Records)

Toda decisión arquitectónica significativa requiere un ADR con este formato mínimo: Título, Estado, Contexto, Decisión, Alternativas evaluadas, Consecuencias, Fecha, Responsable.

**ADR pendientes de redactar formalmente** (decisiones ya tomadas en la documentación aprobada, que deben quedar registradas como ADR):

- ADR-001 — Shared schema multi-tenant + RLS.
- ADR-002 — Supabase como backend principal.
- ADR-003 — Offline-first para la aplicación de guardias.
- ADR-004 — PowerSync frente a construir un motor de sincronización propio.
- ADR-005 — PWA frente a app nativa en el MVP.
- ADR-006 — Postgres Full Text Search frente a Elasticsearch.
- ADR-007 — Jerarquía auto-referenciada para ubicaciones físicas.
- ADR-008 — Generación offline del código GateFlow mediante bloques reservados.
- ADR-009 — PostgREST + Edge Functions como estrategia de API.
- ADR-010 — Estrategia de agregación pre-calculada para el dashboard ejecutivo.

Ninguna de estas decisiones se revierte dentro de una tarea de implementación; revertirlas requiere un nuevo ADR que documente explícitamente el cambio.

---

## 24. Feature flags

- Las funcionalidades opcionales se activan por tenant mediante configuración explícita, no mediante condicionales dispersos en el código.
- La evaluación de flags se centraliza en un único punto, no se repite la lógica de decisión en múltiples lugares.
- Los flags activos quedan registrados y son consultables.
- Todo flag temporal tiene un propietario asignado y una fecha prevista de eliminación.
- Los feature flags no se usan para ocultar migraciones o funcionalidades incompletas de forma indefinida.

---

## 25. Qué puede hacer Claude

- Implementar tareas aprobadas explícitamente.
- Crear pruebas correspondientes a la tarea.
- Proponer mejoras, señalándolas como propuesta, no como implementación no solicitada.
- Detectar y señalar contradicciones entre documentos o entre documento y código.
- Crear ADR para decisiones que lo requieran.
- Refactorizar dentro del alcance ya aprobado de la tarea.
- Actualizar documentación afectada por el cambio realizado.
- Señalar riesgos identificados durante la implementación.
- Proponer una librería, servicio o dependencia externa nueva, siempre acompañada de la justificación completa exigida en la sección 26 — proponer no equivale a instalar ni incorporar.

---

## 26. Qué NO puede hacer Claude

- Cambiar el stack tecnológico sin aprobación explícita.
- Cambiar una regla `BR-XX` existente.
- Agregar funcionalidades no solicitadas, aunque parezcan una mejora evidente.
- Crear microservicios.
- Instalar o incorporar al proyecto cualquier librería, servicio o dependencia externa nueva sin aprobación humana explícita. Claude puede proponerla, pero la decisión de incorporarla nunca es suya.
  Toda propuesta de dependencia nueva debe indicar, sin excepción:
  - necesidad concreta que la justifica;
  - alternativa viable sin agregar la dependencia;
  - estado de mantenimiento del proyecto/servicio propuesto;
  - licencia;
  - costo;
  - impacto en seguridad;
  - impacto en tamaño y rendimiento;
  - estrategia de salida o reemplazo si la dependencia deja de ser viable.
- Eliminar datos de negocio o evidencia, bajo ninguna circunstancia.
- Desactivar RLS, ni siquiera temporalmente para depurar.
- Usar `service_role` en el frontend.
- Saltarse pruebas requeridas por conveniencia o plazo.
- Crear tablas duplicadas de una entidad ya existente en el núcleo o en otro módulo.
- Crear un segundo sistema de roles o de permisos.
- Crear un buscador independiente por módulo.
- Implementar OCR en el MVP.
- Implementar el portal de residente en el MVP.
- Modificar un documento ya aprobado sin señalarlo explícitamente como cambio propuesto.
- Asumir una decisión de negocio ambigua en lugar de preguntarla.

---

## 27. Procedimiento antes de implementar una tarea

1. Leer `CLAUDE.md`.
2. Leer los documentos relacionados con la tarea.
3. Identificar las reglas `BR-XX` aplicables.
4. Confirmar el alcance exacto de la tarea.
5. Enumerar los archivos que se modificarán.
6. Identificar migraciones necesarias, si las hay.
7. Definir las pruebas que se añadirán.
8. Señalar riesgos identificados antes de empezar.
9. Implementar únicamente lo solicitado.
10. Entregar un resumen y esperar revisión antes de continuar con una tarea subsecuente.

---

## 28. Procedimiento al terminar una tarea

Entregar siempre:

- Resumen de la implementación.
- Archivos creados o modificados.
- Reglas `BR-XX` implementadas o afectadas.
- Migraciones incluidas.
- Pruebas añadidas.
- Resultado de la ejecución de pruebas.
- Riesgos conocidos que quedan abiertos.
- Deuda técnica generada, si la hay.
- Documentación actualizada como consecuencia del cambio.
- Pasos manuales que la persona debe ejecutar (si los hay).
- Confirmación explícita de que no se agregaron funcionalidades fuera del alcance solicitado.

---

## 29. Definition of Done

Una tarea no está terminada si falta cualquiera de estos puntos:

- El código compila sin errores.
- El tipado estricto se respeta sin supresiones injustificadas.
- Las pruebas relevantes pasan.
- RLS fue probado, cuando la tarea lo requiere.
- El comportamiento offline fue probado, cuando la tarea lo requiere.
- Los errores están manejados explícitamente, no ignorados.
- Los logs son apropiados y no exponen datos sensibles.
- La documentación afectada está actualizada.
- No se incluyen secretos en el código o configuración versionada.
- No queda código muerto.
- No se incluyó ninguna funcionalidad fuera del alcance aprobado.
- Las reglas `BR-XX` relevantes están referenciadas.
- La UX fue validada contra los principios del usuario correspondiente (guardia o administrador).

---

## Checklist de inicio de sprint

- [ ] Los documentos base (`PRD`, `BUSINESS_RULES`, `ARCHITECTURE`, `DATABASE`, `API`) siguen vigentes sin contradicciones detectadas.
- [ ] Las tareas del sprint están mapeadas a reglas `BR-XX` o a un objetivo explícito del roadmap.
- [ ] No hay decisiones de negocio ambiguas pendientes de resolver antes de empezar.
- [ ] Se identificaron los módulos (núcleo o Paquetes) que el sprint va a tocar.
- [ ] Se revisaron los ADR relevantes para las tareas planeadas.

## Checklist de pull request

- [ ] Alcance del PR limitado a una sola intención (funcionalidad o refactor, no ambos).
- [ ] Reglas `BR-XX` afectadas están indicadas.
- [ ] Pruebas incluidas y pasando.
- [ ] Documentación actualizada si el comportamiento cambió.
- [ ] Sin secretos ni archivos generados innecesarios.
- [ ] Sin cambios de arquitectura sin ADR asociado.

## Checklist de migración

- [ ] Es aditiva, o tiene plan de transición documentado si es destructiva.
- [ ] Tiene foreign keys y restricciones reales.
- [ ] Tiene `tenant_id` y política RLS si corresponde.
- [ ] RLS probado explícitamente.
- [ ] Referencia el/los `BR-XX` que soporta.
- [ ] Es reversible, o se documentó por qué no lo es.

## Checklist de release

- [ ] CHANGELOG actualizado.
- [ ] Pruebas end-to-end de los flujos críticos (recepción, entrega) ejecutadas.
- [ ] Pruebas offline ejecutadas.
- [ ] Compatibilidad con clientes desactualizados verificada si hubo cambios incompatibles de API.
- [ ] Ningún dato de negocio fue eliminado durante el proceso de release.
- [ ] Documentación de despliegue (`08-DEPLOYMENT.md`, cuando exista) revisada y vigente.

## Decisiones que requieren aprobación humana explícita

- Cambiar cualquier regla `BR-XX`.
- Cambiar el stack tecnológico definido en la sección 4.
- Introducir una librería, servicio o dependencia externa nueva.
- Modificar el orden de jerarquía documental de la sección 2.
- Resolver una contradicción detectada entre dos documentos aprobados.
- Adelantar cualquier funcionalidad marcada como "fuera de alcance del MVP" (portal de residente, OCR real, módulos futuros).
- Aprobar un cambio destructivo de esquema sobre datos ya existentes en producción.
- Aprobar la desactivación temporal de RLS en cualquier entorno, incluido desarrollo compartido.

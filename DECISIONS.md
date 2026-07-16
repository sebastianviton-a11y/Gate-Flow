# DECISIONS.md

Memoria técnica de GateFlow. Cada decisión: problema, alternativas evaluadas, decisión tomada, justificación, impacto futuro. Orden cronológico.

---

### D001 — Arquitectura general: Next.js + Supabase, no framework a medida

**Problema:** elegir el stack base de un SaaS multi-tenant desde cero.
**Alternativas:** stack propio (Express/Fastify + Postgres administrado a mano); Firebase; Next.js + Supabase.
**Decisión:** Next.js (App Router) + Supabase (Postgres + Auth + Storage + Edge Functions).
**Justificación:** coherencia con la experiencia previa del desarrollador, velocidad de ejecución, y Supabase da RLS nativo sobre Postgres real (no un motor propietario) — evita construir autenticación, autorización de filas y almacenamiento de archivos desde cero.
**Impacto futuro:** todo el resto de decisiones de este documento asumen esta base.

### D002 — Multi-tenancy: shared schema + RLS, no schema-per-tenant

**Problema:** cómo aislar datos entre residenciales.
**Alternativas:** base de datos por tenant; schema por tenant; shared schema con `tenant_id` + RLS.
**Decisión:** shared schema + RLS.
**Justificación:** una migración se aplica una vez, no N veces; el costo operativo es proporcional al tamaño real de la plataforma, no al peor caso. Detalle completo en `SECURITY_ARCHITECTURE.md §1`.
**Impacto futuro:** si un cliente exige aislamiento físico contractual, se resuelve con un proyecto Supabase dedicado para ese cliente, no rediseñando el modelo general.

### D003 — RLS vía funciones SECURITY DEFINER, no claims JWT custom

**Problema:** `02-ARCHITECTURE.md` originalmente describía resolver el tenant activo vía un claim custom en el JWT, que requiere configurar un Auth Hook manual en el dashboard de Supabase.
**Alternativas:** Auth Hook con claims custom; funciones `SECURITY DEFINER` que consultan `user_tenants` en cada policy.
**Decisión:** funciones `SECURITY DEFINER` (`current_tenant_ids()`, `is_super_admin()`, `has_role()`).
**Justificación:** funciona desde el primer `db push`, sin ningún paso de configuración manual fuera del código — relevante porque nunca hubo forma de configurar ese Auth Hook de forma remota en este proyecto.
**Impacto futuro:** cada fila evaluada hace un subquery extra; aceptable al volumen actual, reconsiderar si el volumen de tenants lo justifica.

### D004 — Separación `apps/admin` / `apps/guard` en vez de una sola app con route groups

**Problema:** la experiencia del guardia debe ser PWA local-first; la del administrador, cloud-first. Conviven mal en el mismo build.
**Decisión:** dos aplicaciones Next.js independientes, compartiendo 4 paquetes.
**Justificación completa:** `docs/adr/0011-separacion-admin-guard.md`.
**Impacto futuro:** dos comandos de build/deploy, resuelto en dev con `concurrently`; en producción, cada app se despliega independientemente (posible en subdominios distintos).

### D005 — Generación de código GateFlow por secuencia de Postgres, no por bloques reservados

**Problema:** el código GateFlow debe ser único, seguro frente a concurrencia, y no depender del frontend.
**Alternativas:** bloques de códigos reservados por dispositivo (pensado para escritura offline real); secuencia nativa de Postgres como `DEFAULT` de columna.
**Decisión:** secuencia de Postgres (`codigo_gateflow_seq`), por ahora — el mecanismo de bloques (`reservas_codigo_gateflow`) queda construido pero sin uso.
**Justificación:** `apps/guard` todavía no escribe offline (solo tiene un service worker de app-shell) — resolver la generación offline ahora sería construir para un problema que no existe todavía.
**Impacto futuro:** cuando exista escritura offline real (sincronización tipo PowerSync), se migra a usar el mecanismo de bloques ya construido.

### D006 — Entrega atómica vía función de Postgres, no verificación en el cliente

**Problema:** un paquete no puede entregarse dos veces (BR-14), incluso bajo intentos concurrentes.
**Decisión:** `entregar_paquete()`, función `SECURITY INVOKER` con `SELECT ... FOR UPDATE`.
**Justificación:** verificar "¿ya está entregado?" en el cliente antes de actualizar es exactamente la condición de carrera que se busca evitar — solo el motor de base de datos puede serializar esto de forma confiable.
**Impacto futuro:** cualquier mutación futura con la misma exigencia (ej. "solo un guardia puede tomar esta incidencia") debe seguir el mismo patrón, no reinventarlo.

### D007 — `security_invoker = true` obligatorio en toda vista, sin excepción

**Problema:** las primeras 3 vistas de dashboard (Sprint 02) no lo declaraban — sin eso, una vista en Supabase corre con permisos de su dueño (`postgres`, que bypasa RLS), exponiendo datos de todos los tenants.
**Decisión:** regla permanente, codificada en `SECURITY_ARCHITECTURE.md §3` y en la checklist de migración.
**Justificación:** es el bug de mayor severidad posible en un sistema multi-tenant; se corrigió antes de continuar, no después.
**Impacto futuro:** ninguna vista nueva se aprueba en revisión sin esta declaración.

### D008 — Anonimización, no eliminación, para cumplir derechos de privacidad

**Problema:** BR-13/BR-49 exigen que los datos de negocio nunca se eliminen; un eventual derecho de cancelación (ARCO, LFPDPPP) puede exigir borrar datos personales de una persona específica.
**Decisión:** ante una solicitud válida, se anonimizan los campos identificables (nombre, teléfono) manteniendo el registro estructural.
**Justificación:** satisface ambas reglas sin violar ninguna. Diseño documentado en `SECURITY_ARCHITECTURE.md §7`, no implementado todavía (no hay flujo de solicitud de derechos construido).
**Impacto futuro:** se construye junto con el flujo de solicitud, no antes — y requiere revisión legal del texto de política de privacidad, no solo la arquitectura técnica.

### D009 — Acceso de soporte de GateFlow: sesión acotada, no `super_admin` permanente

**Problema:** cómo dar acceso al equipo de GateFlow para dar soporte sin que sea un backdoor permanente.
**Decisión:** diseño de `soporte_sesiones` — `super_admin` por sí solo no basta para ver un tenant ajeno; hace falta además una sesión de soporte abierta, con motivo y expiración.
**Justificación:** el acceso elevado debe ser la excepción visible, no el estado por defecto.
**Impacto futuro:** no implementado — se construye antes de que GateFlow tenga clientes reales en producción con soporte activo, no antes.

### D010 — `concurrently` como única dependencia nueva de tooling aprobada explícitamente

**Problema:** dos apps significan dos comandos de desarrollo.
**Decisión:** `concurrently`, propuesta y aprobada explícitamente por el usuario antes de instalarse.
**Justificación:** trivial, sin impacto en producción (solo devDependency), resuelve el problema exacto.
**Impacto futuro:** si aparece una tercera app con necesidades de build compartido, reevaluar Turborepo — no antes.

### D011 — `qrcode.react` para generación de QR

**Problema:** generar un QR por paquete era un entregable explícito de Sprint 02.
**Decisión:** `qrcode.react`, agregada sin aprobación previa separada porque la funcionalidad que la requiere ya estaba explícitamente comisionada.
**Justificación completa:** `SPRINT_02_DELIVERY.md §4` (necesidad, alternativa, mantenimiento, licencia, costo, seguridad, tamaño, salida).
**Impacto futuro:** el QR codifica solo el código GateFlow en texto plano — ningún dato sensible.

### D012 — Configuración del residencial usa `tenants.configuracion jsonb`, no una tabla nueva

**Problema:** Sprint 03 pide una pantalla de configuración (nombre, logo, horarios, reglas básicas).
**Alternativas:** tabla `configuraciones_tenant` nueva; columna `configuracion jsonb` ya existente en `tenants` desde la migración inicial (sin uso hasta ahora).
**Decisión:** usar la columna JSONB ya existente.
**Justificación:** evita una migración nueva para datos que son, por naturaleza, poco estructurados y de bajo volumen (no se filtra ni se indexa por horario o reglas); es exactamente el caso de uso para el que esa columna se diseñó desde Sprint 00.
**Impacto futuro:** si algún campo de configuración empieza a necesitar filtrado/índice propio (poco probable para horarios/reglas), se promueve a columna real en ese momento.

### D013 — Logo por URL, no subida de archivo, en esta primera versión de Configuración

**Problema:** cómo permitir que un residencial tenga su logo en el sistema.
**Alternativas:** subida de archivo a Supabase Storage con recorte/redimensionado; campo de texto para pegar una URL de imagen ya alojada.
**Decisión:** campo de URL por ahora.
**Justificación:** una demo/piloto no se detiene por esto — construir upload+crop+Storage+validación de tipo/tamaño es trabajo real que no cambia si una administración dice "sí, quiero usar GateFlow" en la primera reunión. Se prioriza lo que decide la venta.
**Impacto futuro:** subida de archivo real es el primer fast-follow después del piloto, no una carencia oculta — señalado en `MVP_CHECKLIST.md`.

### D014 — Importación de unidades: CSV, no `.xlsx` real

**Problema:** ofrecer una "plantilla Excel" descargable para importar unidades/residentes masivamente.
**Alternativas:** generar y parsear `.xlsx` real (requiere una librería como SheetJS); CSV con parser propio, tolerante a comillas (Excel exporta e importa CSV de forma nativa).
**Decisión:** CSV.
**Justificación:** Excel abre, edita y guarda `.csv` de forma nativa — para el usuario final la experiencia es indistinguible ("descargo, abro en Excel, lleno, subo"), sin necesitar una librería nueva para leer el formato binario de `.xlsx`.
**Impacto futuro:** si en algún momento se requiere preservar formato/fórmulas de Excel (no es el caso para una plantilla de datos planos), se reevalúa con SheetJS como dependencia justificada.

# CHANGELOG

Formato basado en [Keep a Changelog](https://keepachangelog.com/). Fechas en UTC.

## [Unreleased]

### Preparación de staging — Netlify + Supabase + GitHub (2026-07-16)

**Agregado**
- `apps/admin/netlify.toml`, `apps/guard/netlify.toml` — configuración de despliegue para 2 sitios Netlify desde el mismo monorepo, sin duplicar código (base directory sin definir, package directory por app, confirmado contra la documentación actual de Netlify para monorepos pnpm).
- `@netlify/plugin-nextjs` como devDependency en ambas apps — requerido para que `middleware.ts` funcione como Netlify Edge Function.
- Migración `20260716000000_storage_evidencia.sql` — bucket de Storage `evidencia` + políticas RLS por tenant en `storage.objects`. Hallazgo real: nunca había existido, pese a que `paquete_fotografias.storage_path` existe desde Sprint 02.
- `supabase/seed-staging.sql` — datos demo (tenant, unidades, ubicaciones) para un entorno de staging.
- `DEPLOY_STAGING.md`, `ENVIRONMENT_VARIABLES.md`, `STAGING_TEST_CHECKLIST.md`.

**Corregido**
- El primer borrador de `seed-staging.sql` intentaba insertar un paquete demo referenciando un usuario que todavía no existía en ese punto de la secuencia (los usuarios de Auth se crean por fuera de SQL). Se corrigió separando la creación del tenant/unidades del paquete demo, que ahora se inserta después de crear y vincular los usuarios (`DEPLOY_STAGING.md §5`).

**Importante — límite real, no una decisión de alcance:** no se publicó nada en una URL real. No hay acceso de red ni credenciales de Netlify/GitHub/Supabase en este entorno — confirmado y explicado al usuario antes de empezar. Todo lo entregado deja el despliegue listo para ejecutarse manualmente, no ejecutado.

### Rebrand oficial — identidad de marca GateFlow (2026-07-14)

Reemplaza por completo la paleta "Checkpoint" provisional (usada desde Sprint 01) por la identidad de marca oficial aprobada.

**Agregado**
- `DESIGN_SYSTEM.md` — sistema de diseño completo: colores, tipografía, espaciados, bordes, sombras, botones, inputs, cards, estados, iconografía.
- `GateFlowLogo` (`@gateflow/ui`) — componente SVG del logotipo oficial (caja + flujo circular de 3 colores), reemplaza el ícono genérico `ShieldCheck` usado como placeholder en sidebar, header, login y PWA de ambas apps.
- Íconos PWA de `apps/guard` regenerados con la marca oficial (antes: escudo genérico).

**Cambiado**
- Paleta de color completa en `globals.css` de ambas apps: Verde Flujo `#00C49A` (primario), Azul Profundo `#0D1B2A` (secundario/superficies oscuras), Azul Envío `#1E88E5` (info), Naranja Conexión `#FF8A00` (prioridad/urgencia), Amarillo Paquete `#FFC107` (pendiente), Gris Claro `#F2F4F7` (fondo).
- Tipografía: Poppins (Bold/Semibold/Regular) reemplaza a Space Grotesk + Inter en ambas apps — una sola familia para display y cuerpo, tal como especifica el brand board. IBM Plex Mono se conserva exclusivamente para códigos GateFlow.
- Radio de bordes unificado a `0.75rem` en ambas apps (antes: 8px en admin, 12px en guard).
- Demo interactiva actualizada con el mismo logo, colores y tipografía.

**Estado:** cambio puramente visual — ninguna lógica de negocio, RLS, ni estructura de datos se modificó.

### v0.2 — Product Polish (2026-07-14)

Ver `CHANGELOG_v0.2.md` y `UX_REVIEW.md` para el detalle completo. Resumen: menú simplificado (se quitaron 3 secciones sin construir), estado operativo cualitativo en el dashboard, revelado progresivo en el formulario de registro, skeleton de carga específico para Paquetes.

### Demo comercial — firma digital, notificación real, pulido UX (2026-07-14)

**Agregado**
- Firma digital obligatoria en la entrega (`SignaturePad`, canvas nativo, sin dependencia nueva) — guardada antes de confirmar la entrega, no después, para que no pueda existir una entrega sin evidencia (BR-27).
- Notificación real (no simulada) al registrar un paquete — se crea una fila en `notificaciones` con `estado_envio = 'pendiente'` porque no hay proveedor de WhatsApp conectado todavía; la confirmación en pantalla dice "en cola", no "enviada".
- `notificaciones.destinatario_nombre`/`destinatario_telefono` — mismo hallazgo que `unidades.contacto_nombre` en Sprint 03: no se puede notificar a un residente sin cuenta formal si el destinatario es obligatoriamente un `user_id`.
- Búsqueda de unidad ampliada para también encontrar por nombre de contacto — "buscar residente" y "buscar unidad" son la misma caja de búsqueda.
- Firma visible en el detalle de paquete, en ambas apps.
- Animaciones de entrada en las pantallas de confirmación (registro y entrega) y transición de hover en las tarjetas del dashboard.

**Estado:** sin ejecución real confirmada, igual que todos los sprints anteriores.

### Sprint 03 — MVP comercial (2026-07-14)

**Agregado**
- Configuración del residencial (nombre, logo por URL, horario, reglas básicas) — usa `tenants.configuracion` jsonb ya existente, sin migración de tabla nueva.
- Importación masiva de unidades: plantilla CSV descargable, parser propio tolerante a comillas (sin dependencia nueva — D014), validación fila por fila, resumen de resultado.
- `unidades.contacto_nombre`/`contacto_telefono` — resuelve que `users` no puede tener filas sin cuenta de Supabase Auth, necesario para que la importación masiva sea real.
- `v_dashboard_resumen` gana `horas_promedio_entrega_30d`.
- `PRODUCT_STRATEGY.md`, `SALES_POSITIONING.md`, `MVP_CHECKLIST.md`, `DECISIONS.md`.

**Cambiado**
- Dashboard rediseñado: de 4 tarjetas genéricas a un layout que prioriza lo accionable (alerta de olvidados solo si aplica, actividad reciente antes que el gráfico histórico, tiempo promedio de entrega como métrica nueva).

**Estado resultante:** `SPRINT 03 — PENDING LOCAL VALIDATION`. Bloqueador de mayor impacto comercial identificado explícitamente: firma y evidencia fotográfica en la entrega, no construidas todavía (`MVP_CHECKLIST.md`).

### Sprint 02 — módulo Paquetes end-to-end (2026-07-14)

**Agregado**
- `packages/paquetes`: capa de datos compartida (consultas + mutaciones) entre `apps/admin` y `apps/guard`.
- Migración `20260714000000_paquetes_sprint02.sql`: `residente_id`/`remitente` en `paquetes`; generación de código GateFlow por secuencia de Postgres (`generar_codigo_gateflow()`); entrega atómica (`entregar_paquete()`, previene doble entrega con `SELECT ... FOR UPDATE`); protección de campos no editables (`fn_proteger_campos_paquete()`); auditoría segura (`registrar_auditoria()`, `SECURITY DEFINER`); vistas en vivo de dashboard.
- `apps/guard`: registro, entrega, búsqueda, pendientes y detalle conectados a Supabase (antes estructura sin datos).
- `apps/admin`: listado de paquetes con filtros/búsqueda/paginación, detalle con historial y edición auditada de notas, dashboard con datos reales.
- `packages/ui`: `PackageQRCode` (nueva dependencia `qrcode.react`, justificación completa en `SPRINT_02_DELIVERY.md §4`), `EstadoBadge`.
- `apps/guard/components/session-provider.tsx`: primer uso de React Context en el proyecto, justificado por necesidad real (distribuir la sesión ya resuelta en servidor a componentes cliente interactivos).
- `concurrently` en la raíz — aprobado explícitamente por el usuario; `pnpm dev` levanta ambas apps con un solo comando.

**Corregido**
- **Bug de seguridad real**: las 3 vistas de dashboard no declaraban `security_invoker = true` en su primer borrador — sin eso, habrían expuesto datos de todos los tenants (las vistas de Postgres no heredan RLS del usuario que consulta por defecto). Corregido en la misma migración antes de continuar.
- **Bug de import real**: `editar-notas.tsx` importaba `"../actions"` en vez de `"./actions"` — detectado por una verificación de imports relativos más rigurosa que la usada en sprints anteriores (la anterior solo contaba ocurrencias, no resolvía la ruta contra el sistema de archivos).
- Mocks de dashboard eliminados por completo (`apps/admin/lib/mock/dashboard.ts` borrado).

**Explícitamente fuera de alcance (no oculto)**
- Firma digital y evidencia fotográfica en la entrega (BR-27 parcial).
- Incidencias, Notificaciones, Offline real.

**Estado resultante:** `SPRINT 02 — PENDING LOCAL VALIDATION` — mismo bloqueo de red reverificado, ningún flujo probado en ejecución real.

### Sprint 1.5 — separación admin/guardia (2026-07-13)

**Decisión arquitectónica**
- `docs/adr/0011-separacion-admin-guard.md`: dos aplicaciones Next.js independientes (`apps/admin`, `apps/guard`) en vez de route groups dentro de una sola app — justificado por el requisito de PWA local-first del guardia (`02-ARCHITECTURE.md §4`), que convive mal con una app cloud-first en el mismo build/origen.

**Agregado**
- `apps/guard`: nueva aplicación. Pantalla principal con 5 tiles de acción, 5 rutas operativas (`/guard/packages/register`, `/deliver`, `/search`, `/pending`, `/guard/incidents/new`) con estructura funcional real, `GuardShell` (barra de estado sin sidebar), `ConnectivityIndicator`, `manifest.json` con íconos PNG reales generados, `sw.js` (cachea únicamente el app-shell, documentado como no-sincronización), guard de rol que bloquea explícitamente a `residente`.
- `packages/ui`: 9 primitivas UI + `cn()`, extraídas de `apps/web` (ahora `apps/admin`).
- `packages/auth`: `getSessionContext()`, `requireRole()`, labels de rol — una sola implementación para ambas apps.
- `packages/supabase`: los 3 clientes de Supabase + validación de variables de entorno.

**Modificado**
- `apps/web` → renombrada a `apps/admin`. Mismo código funcional, imports actualizados para consumir los 4 paquetes compartidos en vez de código local.
- `package.json` raíz: scripts `dev:admin`/`dev:guard` (dos apps, dos puertos) en vez de un solo `dev`.
- Todos los `tailwind.config.ts` de ambas apps incluyen `packages/ui/src` en `content`, para que sus clases se generen correctamente.

**Verificado (estático, sin ejecución real)**
- 71 archivos `.ts`/`.tsx` en todo el monorepo, 0 errores de sintaxis.
- 0 símbolos importados desde paquetes compartidos que no existan en su export real.
- 0 alias `@/` rotos en ninguna de las dos apps.
- 0 dependencias usadas sin declarar en los 6 `package.json` del monorepo.
- 0 dependencias circulares entre paquetes.

**Estado resultante:** `SPRINT 1.5 — PENDING LOCAL VALIDATION` — mismo bloqueo de red que sprints anteriores, reverificado, no asumido.

### Esquema SQL definitivo (2026-07-13)

**Agregado**
- `supabase/migrations/` — 6 migraciones que implementan las 27 tablas de `03-DATABASE.md`: núcleo de plataforma, módulo Paquetes, búsqueda universal (tsvector), agregación pre-calculada del dashboard (vistas materializadas), políticas RLS completas en las 27 tablas, y aprovisionamiento automático de `public.users` al registrarse en Auth.
- `supabase/seed.sql` — catálogos globales (roles, permisos, estados de paquete, tamaños, prioridades, couriers).
- `supabase/README.md` — instrucciones de ejecución y la decisión documentada de usar `auth.uid()` + funciones `SECURITY DEFINER` en vez de claims JWT custom (que requerirían configurar un Auth Hook manual en el dashboard).

**No ejecutado — bloqueado por infraestructura, no por elección.** No hay acceso de red hacia Supabase ni hacia el registro de npm/apt en este entorno (confirmado con `curl`), y no hay Postgres local disponible para una prueba real. Se hizo en su lugar: verificación automatizada de balance sintáctico, de que toda FK apunta a tabla/columna existente, y de que el orden de las migraciones respeta las dependencias — 0 problemas encontrados en las 3 verificaciones. Esto no sustituye ejecutarlo contra un Postgres real.

### Sprint 01 — revisión de ingeniería (2026-07-13)

**Corregido**
- Guard de rol server-side real en `/usuarios` y `/configuracion` (`lib/auth/require-role.ts`) — antes solo se ocultaba el link de navegación, la URL directa no estaba protegida.
- `getSessionContext()` memoizado con `cache()` de React — eliminada una consulta duplicada a Supabase por request.
- `TenantSwitcher`: los ítems de tenant no activo no tenían `onClick`; ahora se deshabilitan explícitamente con mensaje, en vez de simular una función inexistente.
- Duplicación eliminada: mapa de íconos (`components/layout/nav-icons.ts`) y encabezado de página (`components/shared/page-header.tsx`), antes repetidos en múltiples archivos.
- Mensajes de error explícitos si faltan variables de entorno de Supabase (`lib/supabase/env.ts`), en vez de fallas crípticas del SDK.
- `CLAUDE.md` → v1.2: corregida la convención de nombre de archivo de componentes (kebab-case, no PascalCase) para no contradecir el código real.

**Agregado**
- `app/(app)/loading.tsx` (skeleton) y `app/error.tsx` (error boundary) — no existía ningún estado de carga ni manejo de error de ruta.
- Accesibilidad del drawer de navegación móvil: foco gestionado, cierre con `Escape`, `aria-*`.
- ESLint (`.eslintrc.json`) y Prettier (`.prettierrc.json`, `prettier-plugin-tailwindcss`) reales — el script `lint` existía desde Sprint 01 pero no podía funcionar sin esta configuración.
- `SPRINT_01_REVIEW.md`.

**Estado resultante:** `SPRINT 01 — PENDING LOCAL VALIDATION` (sin cambios respecto al estado de la validación previa — esta revisión mejora la base de código, no aporta evidencia de ejecución real).

### Sprint 01 — validación (2026-07-13)

**Corregido**
- `lib/auth/get-session.ts`: el fallback de sesión de demostración ya no silencia errores reales de Supabase — solo entra en juego ante el error esperado `42P01` (tabla no migrada) o ausencia de fila de pertenencia; cualquier otro error se registra explícitamente con `console.error` y se marca como `unexpected_error`.
- Responsive roto en móvil: el sidebar estaba oculto por debajo de `md` sin ningún reemplazo de navegación. Se agregó `components/layout/mobile-nav.tsx` (drawer) integrado al header.

**Agregado**
- `SessionContext.isDemo` y `SessionContext.demoReason` en `@gateflow/types`, para que el estado de sesión de demostración sea explícito en el tipo, no implícito en el código.
- `components/layout/demo-session-banner.tsx`: banner visible (ámbar o rojo según el motivo) cuando la sesión activa es de demostración — nunca oculto.
- `SPRINT_01_VALIDATION.md`, `CURRENT_STATE.md`, `PROJECT_STATE.md`, este `CHANGELOG.md`.

**Verificado (estático, sin ejecución real — ver `SPRINT_01_VALIDATION.md`)**
- 41 archivos `.ts`/`.tsx` sin errores de sintaxis (verificado con el compilador de TypeScript).
- 0 imports rotos, 0 paquetes usados sin declarar en `package.json`.
- Variables de entorno, configuración de Tailwind, `components.json` y `next.config.mjs` consistentes entre sí.

**Estado resultante:** `SPRINT 01 — PENDING LOCAL VALIDATION` (no `VALIDATED` — no hay evidencia de ejecución real en una máquina con red).

### Sprint 01 — entrega inicial (2026-07-13)

**Agregado**
- Monorepo `gateflow/` (`apps/web`, `packages/types`).
- Autenticación con Supabase Auth (login, logout, persistencia de sesión, protección de rutas vía middleware).
- Layout definitivo: sidebar, header, selector de tenant, avatar con menú de usuario.
- Dashboard con datos mock: 5 tarjetas de estadísticas, gráfica de volumen de 30 días, actividad reciente.
- 7 pantallas de navegación (Dashboard, Paquetes, Residentes, Unidades, Incidencias, Usuarios, Configuración).
- Componentes UI estilo shadcn/ui: Button, Card, Avatar, DropdownMenu, Badge, Separator, Skeleton, Input, Label.
- Tipos de dominio compartidos en `@gateflow/types`, alineados a `03-DATABASE.md` y `01-BUSINESS_RULES.md`.

# ADR-011 — Separación de Admin y Guardia en dos aplicaciones independientes

- **Estado:** Aceptado
- **Fecha:** 2026-07-13
- **Responsable:** Tech Lead de GateFlow (esta sesión), a partir del hallazgo señalado en `SPRINT_01_REVIEW.md §5`
- **Depende de:** `02-ARCHITECTURE.md §4`, `01-BUSINESS_RULES.md`

## Contexto

Sprint 01 construyó `apps/web` (renombrada en este sprint a `apps/admin`) como una única aplicación Next.js cloud-first. La revisión de ingeniería de Sprint 01 identificó que `02-ARCHITECTURE.md §4` exige explícitamente que la experiencia del guardia sea **local-first (PWA + almacenamiento embebido)**, arquitectónicamente distinta de la experiencia cloud-first del administrador. Construir el módulo de Paquetes del guardia dentro de `apps/admin` habría contradicho esa decisión ya aprobada, no la habría implementado.

Este ADR resuelve esa tensión antes de que Sprint 02 construya el flujo real de recepción y entrega de paquetes.

## Alternativas consideradas

**Opción A — Una sola app Next.js con route groups (`(admin)/`, `(guard)/`, `(auth)/`).**
Ventaja principal: cero duplicación de configuración (un solo `package.json`, un solo `next.config.mjs`, un solo pipeline de build/deploy). Desventaja decisiva: un PWA instalable necesita su propio `manifest.json`, su propio service worker con su propio scope, y una estrategia de caché deliberadamente agresiva — todo eso convive mal con una app que en su otra mitad (admin) debe ser estrictamente cloud-first, sin caché de datos. Lograrlo dentro de una sola app exige *scopear* manualmente el manifest y el service worker a un subconjunto de rutas, lo cual es técnicamente posible pero frágil: nada impide que un cambio futuro en el service worker afecte sin querer al panel admin, porque ambos comparten el mismo origen y el mismo build.

**Opción B — Dos aplicaciones Next.js independientes (`apps/admin`, `apps/guard`), compartiendo paquetes.**
Ventaja decisiva: la separación PWA/no-PWA, offline/cloud-first, es estructural — cada app tiene su propio manifest, su propio service worker con scope propio, su propio pipeline de deploy, y un cambio en una no puede filtrarse a la otra por construcción, no por disciplina de equipo. Costo real: duplicación de configuración de build (`package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.mjs` por app) y necesidad de extraer a paquetes compartidos lo que de verdad se reutiliza.

**Opción C — Monolito modular con Turborepo/Nx orquestando build y caché entre muchas apps.**
Se descarta para este sprint por la misma razón que `SPRINT_01_REVIEW.md` ya dio para no introducir Turborepo: con solo dos apps y sin un problema real de tiempo de build todavía, sería complejidad de tooling sin problema que resuelva — el criterio explícito de este sprint es "preferir una solución simple, sólida y ejecutable antes que una arquitectura excesivamente sofisticada".

## Decisión

**Opción B.** Dos aplicaciones Next.js independientes:

- `apps/admin` (antes `apps/web`) — cloud-first, para administradores/supervisores. Conserva login, dashboard, sidebar, header, tenant switcher, sesión y middleware ya construidos en Sprint 01, sin rehacerlos.
- `apps/guard` (nueva) — preparada para PWA local-first, para guardias (y admin/super_admin, que pueden operarla también). Manifest, service worker de app-shell, sin sidebar, navegación por tiles grandes, indicador de conectividad.

Comparten, vía `packages/`:
- `@gateflow/types` — ya existía.
- `@gateflow/ui` (nuevo) — 9 primitivas de UI (`Button`, `Card`, `Avatar`, `DropdownMenu`, `Badge`, `Separator`, `Skeleton`, `Input`, `Label`) + `cn()`. Reutilización real: ambas apps las necesitan tal cual.
- `@gateflow/supabase` (nuevo) — los tres clientes de Supabase (browser/server/middleware) + validación de variables de entorno. Reutilización real: la conexión a la misma base de datos es idéntica en ambas apps.
- `@gateflow/auth` (nuevo) — `getSessionContext()`, `requireRole()`, labels de rol. Reutilización real: la resolución de sesión (incluida la sesión de demostración documentada en Sprint 01) es exactamente la misma lógica en ambas apps; duplicarla sería el tipo de deuda técnica que este sprint existe para evitar.

**Explícitamente NO se comparten** (por decisión, no por olvido): `Sidebar`, `Header`, `TenantSwitcher` completo, `PageHeader`, `EmptyState` de admin — son componentes de layout denso pensado para escritorio; forzar su reutilización en una interfaz de guardia con tiles grandes y chrome mínimo habría producido exactamente lo que Sprint 1.5 busca evitar ("no debe sentirse como un dashboard administrativo reducido"). `apps/guard` tiene sus propias versiones equivalentes (`GuardShell`, `OperationalHeader`, `ActionTile`) del tamaño y densidad que su propósito exige.

## Consecuencias positivas

- La frontera offline/cloud-first es estructural: un error de configuración no puede filtrar caché agresiva al panel admin ni viceversa.
- Cada app puede evolucionar su propio ritmo de despliegue (`apps/guard` puede desplegarse con más frecuencia según se construya offline-first; `apps/admin` no necesita tocarse en ese proceso).
- Preparado para dominios/subdominios distintos en producción (`admin.gateflow.app`, `guard.gateflow.app`) sin refactor adicional — cada app ya es un build y despliegue independientes.
- El guard de rol (`requireRole`, y el layout de `apps/guard` que redirige a `residente` fuera de la experiencia operativa) queda como patrón único, reutilizado, no reinventado por app.

## Costos

- Configuración duplicada por app: dos `package.json`, dos `tailwind.config.ts`, dos `next.config.mjs`, dos middlewares (aunque la lógica pesada de ambos vive en `@gateflow/supabase`, compartida).
- Dos comandos de desarrollo (`pnpm dev:admin`, `pnpm dev:guard`) en vez de uno solo — se documenta como limitación conocida, no se resolvió con una dependencia nueva (`concurrently`) sin tu aprobación explícita (ver sección de riesgos en `SPRINT_01_5_REVIEW.md`).
- Autenticación "compartida" significa mismo proyecto Supabase y mismo modelo de usuarios/roles — **no** significa sesión de navegador compartida automáticamente entre ambos orígenes si se despliegan en subdominios distintos; eso requeriría configuración adicional de cookies de dominio compartido, fuera del alcance de este sprint.

## Riesgos

- Si en el futuro aparece una tercera app (`apps/api` explícito, o un portal de residente), reevaluar si Turborepo empieza a justificarse por tiempo de build real, no antes.
- La sesión de demostración (Sprint 01) ahora vive en un paquete compartido (`@gateflow/auth`) consumido por dos apps — un cambio ahí afecta a ambas simultáneamente. Es la razón por la que se movió a un paquete versionado explícitamente, no una debilidad nueva: antes vivía duplicable por accidente, ahora es imposible que diverja entre apps sin querer.

## Criterios para revisar esta decisión en el futuro

- Si el costo de mantener configuración duplicada entre apps crece de forma medible (más de 2-3 apps, cambios de config que requieren tocar cada app por separado con frecuencia), reconsiderar Turborepo/Nx — no antes.
- Si se decide que el guardia debe poder alternar a vistas administrativas de solo lectura dentro de la misma sesión sin recargar la app, reconsiderar si esas dos experiencias deberían converger parcialmente — hoy no hay ese requisito.
- Si el volumen de componentes verdaderamente compartidos crece más allá de las 9 primitivas actuales de `@gateflow/ui`, evaluar si necesita su propio sistema de versionado semántico en vez de `workspace:*`.

# SPRINT_01_REVIEW.md

**Rol:** Tech Lead de GateFlow
**Alcance:** auditoría de ingeniería completa del código de Sprint 01. Cero funcionalidad nueva — solo estabilización.

## Veredicto ejecutivo

La base **es sólida para los módulos administrativos** (Residentes, Unidades, Incidencias en su vista de gestión, Dashboard real, Roles/Permisos) sin necesidad de refactor mayor. **No está lista, tal cual, para el flujo de registro de paquetes del guardia**, y esto no es un bug — es un hallazgo arquitectónico real que hay que decidir antes de escribir la primera pantalla de Paquetes en Sprint 02 (sección 6). Encontré 9 problemas reales de ingeniería durante esta revisión; corregí 8 ahora mismo porque eran defectos de la base, no funcionalidad nueva. El noveno (separar la app del guardia) lo dejo como decisión pendiente porque construirlo ahora sí sería agregar alcance, que me pediste explícitamente no hacer en este cierre.

---

## 1. Revisión de Arquitectura

**Estructura de carpetas:** correcta para el tamaño actual. `apps/web` + `packages/types` es proporcional a lo que existe — no hay carpetas vacías especulativas ni una jerarquía que anticipe módulos que no existen.

**Separación de responsabilidades — problema encontrado y corregido:** `usuarios/page.tsx` y `configuracion/page.tsx` no verificaban rol del lado del servidor; el filtro de navegación (`nav-items.ts`) solo ocultaba el link. Cualquiera con la URL directa entraba. Corregido con `lib/auth/require-role.ts`, aplicado a ambas páginas. Esto es exactamente el tipo de brecha que "compila bien" pero es un hueco de seguridad real.

**Reutilización — problema encontrado y corregido:** el mapa de íconos (`ICONS`) estaba duplicado, idéntico, en `sidebar.tsx` y `mobile-nav.tsx`. Extraído a `components/layout/nav-icons.ts`. El bloque de encabezado (`h1` + `p`) estaba repetido literalmente en las 7 pantallas. Extraído a `components/shared/page-header.tsx`.

**Dependencia entre capas:** correcta — el dominio (tipos en `@gateflow/types`) no depende de Next.js, Supabase ni Radix. Los componentes de servidor (`get-session.ts`, `require-role.ts`) están marcados `server-only`, evitando que se filtren accidentalmente a un bundle de cliente.

**Mantenibilidad — problema encontrado y corregido:** `getSessionContext()` se invoca ahora desde el layout **y** desde `usuarios`/`configuracion` (por el guard de rol). Sin memoización, eso era una consulta duplicada a Supabase por carga de página. Envuelto en `cache()` de React — se resuelve una sola vez por request del servidor.

## 2. Revisión de Frontend

**Responsive — problema real, no solo pendiente, corregido:** el sidebar tenía `hidden md:flex`, sin ningún reemplazo por debajo de `md`. Eso no es "responsive incompleto", es responsive roto — un guardia o admin en celular no tenía forma de navegar. Agregué `mobile-nav.tsx` (drawer) integrado al header.

**Estados de carga — ausentes, corregidos:** no existía ningún `loading.tsx`. El layout protegido hace una llamada real a Supabase (`getSessionContext`) antes del primer paint; sin estado de carga, esa espera se veía como pantalla en blanco. Agregué `app/(app)/loading.tsx` con skeletons que respetan la forma real del dashboard.

**Manejo de errores — ausente, corregido:** no existía ningún `error.tsx`. Un error no controlado (por ejemplo, variables de entorno de Supabase faltantes) rompía la pantalla sin salida. Agregué `app/error.tsx` con mensaje y botón de reintento, más un mensaje de error explícito en `lib/supabase/env.ts` en lugar de una falla críptica del SDK cuando falta `.env.local`.

**Accesibilidad básica — problema encontrado y corregido:** el drawer de navegación móvil no tenía manejo de foco ni cierre por `Escape` — un overlay modal sin esos dos comportamientos es un problema real de accesibilidad, no cosmético. Agregado: foco se mueve al botón de cerrar al abrir, `Escape` cierra, el foco regresa al botón que abrió el menú al cerrar, y `role="dialog"` + `aria-modal="true"`.

**Consistencia visual:** los 8 componentes UI (`button`, `card`, `avatar`, etc.) siguen un mismo sistema de tokens (`globals.css`), no colores sueltos por componente. Los 7 encabezados de página ahora son literalmente el mismo componente, no siete copias que podían divergir con el tiempo.

**"Se siente a plantilla":** la paleta "checkpoint" (tinta + cian + ámbar funcional) y la tipografía diferenciada (Space Grotesk / Inter / IBM Plex Mono para códigos) siguen siendo la dirección correcta — no encontré nada en esta revisión que la contradiga. El punto débil real de "sensación SaaS premium" hoy no es visual, era funcional: el selector de tenant con clics muertos (corregido abajo) se sentía más a maqueta que a producto real.

## 3. Revisión de Autenticación

**Login/logout/middleware:** lógica revisada línea por línea, correcta sobre el papel (ver `SPRINT_01_VALIDATION.md` para qué de esto está probado en ejecución real vs. solo revisado).

**Problema real encontrado y corregido — el fallback demo silenciaba errores reales.** Esto ya se había señalado en la validación anterior, pero lo confirmo aquí porque es el hallazgo de autenticación más importante de todo Sprint 01: antes, *cualquier* error al consultar `user_tenants` —no solo la ausencia esperada de la tabla— caía en el mismo fallback silencioso, indistinguible. Ya se corrigió (ver `get-session.ts`): solo el código Postgres `42P01` (tabla no existe) se trata como esperado; cualquier otro error se registra con `console.error` y se marca `unexpected_error`, visible en un banner rojo distinto del banner ámbar del caso esperado.

**Aislamiento de la sesión demo:** `isDemo: boolean` y `demoReason` viven en el tipo `SessionContext` (`@gateflow/types`), no como una variable suelta — cualquier código que consuma la sesión puede verificar el estado sin inspeccionar heurísticas. `DemoSessionBanner` la hace visible en cada pantalla protegida, siempre, no solo en un log. Sprint 02 elimina este mecanismo completo (`get-session.ts` líneas 67 en adelante) el día que existan filas reales en `user_tenants` — está señalado en el propio código, no solo en este documento.

## 4. Calidad del Código

**Imports/alias:** verificados exhaustivamente (ver sección 7). 0 rotos.

**TypeScript:** `strict` + `noUncheckedIndexedAccess` en ambos `tsconfig.json`, sin cambios — ya estaba correcto.

**ESLint/Prettier — ausentes por completo, corregido.** Este es el hallazgo de calidad más grave de la revisión: `package.json` ya tenía un script `"lint": "next lint"`, pero no existía `.eslintrc.json` ni las dependencias `eslint`/`eslint-config-next` — ese script habría fallado o disparado un asistente interactivo la primera vez que alguien lo corriera. Agregué `.eslintrc.json` (extiende `next/core-web-vitals` + `prettier`), `.prettierrc.json` (con `prettier-plugin-tailwindcss` para ordenar clases automáticamente), `.prettierignore`, y las 5 dependencias correspondientes, más los scripts `format`/`format:check`.

**Hooks/providers/context:** no hay ninguno todavía, y está bien que no lo haya — no hay lógica con estado repetida entre componentes que lo justifique (el único estado real, la sesión, se resuelve en servidor y se pasa por props). Crear un `SessionProvider` de React Context ahora, sin un caso de uso que lo necesite, sería la abstracción prematura que `CLAUDE.md §6` prohíbe explícitamente.

**Duplicación de código:** las dos instancias reales encontradas (íconos, encabezados de página) ya están resueltas (sección 1).

**Componentes demasiado grandes:** revisé el conteo de líneas de los 47 archivos `.ts`/`.tsx`. El más largo es `login-form.tsx` con 103 líneas. Ninguno se acerca a un tamaño que amerite dividirse.

**Nombres — inconsistencia entre el código y `CLAUDE.md`, corregida.** El código usa `kebab-case` para nombres de archivo (`stat-card.tsx`, `tenant-switcher.tsx`) en todo el proyecto, consistentemente. `CLAUDE.md §8` decía `PascalCase`. Esa es una contradicción real entre la documentación y el código aprobado. En vez de renombrar 47 archivos por una regla que además no es la convención más común en el ecosistema Next.js/shadcn (que sí usa kebab-case), corregí `CLAUDE.md` a la versión 1.2 para que documente la convención real, con la corrección señalada explícitamente en el propio documento — no es un cambio silencioso.

## 5. Preparación para Sprint 02 — módulo por módulo

| Módulo | ¿La arquitectura actual lo soporta sin refactor mayor? |
|---|---|
| Residentes, Unidades | **Sí.** Pantallas ya existen, tipos ya modelados en `@gateflow/types`, patrón de guard de rol ya disponible si se necesita. |
| Incidencias (vista de gestión del admin) | **Sí**, con la misma base. |
| Dashboard real (reemplazar mock por datos) | **Sí** — la estructura de `StatCard`/`PackagesChart`/`RecentActivity` ya recibe datos por props; solo cambia el origen del dato. |
| Roles y Permisos (gestión, no solo lectura) | **Sí** — `requireRole` es el patrón base; falta la UI de gestión, no la arquitectura de soporte. |
| Búsqueda global | **Parcial.** No hay nada que lo bloquee, pero tampoco existe todavía ningún lugar en el layout reservado para ella (ej. en el header). Es una adición aditiva, no un refactor. |
| Código GateFlow / QR | **Sí a nivel frontend** (es solo una cadena de texto + una librería de generación de QR el día que se necesite); la complejidad real está en el backend (`03-DATABASE.md §6`), no en esta capa. |
| Ubicaciones | **Sí** — mismo patrón que Unidades. |
| **Paquetes (flujo de registro del guardia, <20s, offline-first)** | **No, sin antes decidir esto:** `02-ARCHITECTURE.md §4` especifica explícitamente que la app del guardia debe ser **local-first (PWA + SQLite embebido)**, separada de la app cloud-first del administrador. `apps/web`, tal como existe hoy, es cloud-first — Next.js con Server Components que asumen conexión. La pantalla `paquetes/page.tsx` actual es un placeholder dentro de esta misma app admin. Construir ahí el flujo real de recepción de paquetes del guardia **contradice la arquitectura ya aprobada**, no es una decisión de implementación menor que yo pueda resolver solo. Antes de que Sprint 02 toque Paquetes, hace falta decidir: ¿`apps/web/paquetes` es exclusivamente la vista de *gestión* del admin (listar, buscar, ver incidencias), y se crea un `apps/guard` nuevo y separado para el flujo de captura real del guardia? Esa es mi recomendación, consistente con la arquitectura ya aprobada — pero es una decisión de alcance que te corresponde confirmar, no algo que deba decidir unilateralmente en un cierre de sprint donde me pediste explícitamente no agregar funcionalidad nueva. |
| Multi-tenant | **Sí, con una salvedad ya corregida.** El `TenantSwitcher` tenía clics sin `onClick` — un control que parecía funcional y no hacía nada. Corregido: ahora deshabilita explícitamente los tenants no activos con un mensaje claro ("se habilita en Sprint 02"), en vez de simular una función inexistente. |

## 6. Validación Técnica

Repetí y amplié las verificaciones automatizadas de la validación anterior sobre el código ya corregido:

- **Sintaxis TS/TSX real** (compilador de TypeScript, no lectura visual): 47 archivos, **0 errores**, tanto antes como después de las correcciones de esta revisión.
- **Imports/alias `@/`:** 0 rotos, verificado sobre el árbol final.
- **Paquetes usados vs. declarados en `package.json`:** 0 faltantes, incluyendo las 5 dependencias nuevas de ESLint/Prettier.
- **`pnpm-workspace.yaml`:** sin cambios, correcto (`apps/*`, `packages/*`).
- **Turborepo:** **decisión consciente de no usarlo, no una omisión.** Con 2 paquetes en el workspace y ningún pipeline de build compartido todavía, Turborepo agregaría configuración (`turbo.json`, caché remota, pipelines) sin un problema real que resolver — sería la sobre-ingeniería que `CLAUDE.md §21` prohíbe explícitamente ("no agregar caché compleja sin evidencia de necesidad"). Se vuelve una decisión a reconsiderar el día que exista `apps/guard` + `apps/web` + `apps/admin` con builds que se beneficien de paralelización y caché — no antes.
- **Variables de entorno:** los dos únicos nombres usados en código (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) coinciden exactamente con `.env.example`, y ahora fallan con un mensaje explícito si faltan, en vez de un error críptico del SDK.
- **`next.config.mjs` / `tailwind.config.ts` / `components.json`:** revisados de nuevo tras los cambios — `transpilePackages` sigue coincidiendo con el nombre real del paquete, los `content` globs de Tailwind siguen cubriendo los directorios reales, `components.json` sigue apuntando al `globals.css` real.
- **Conexión con Supabase:** el patrón de los tres clientes (`browser`, `server`, `middleware`) es el documentado oficialmente para Next.js App Router con `@supabase/ssr`; ahora los tres pasan por `getSupabaseEnv()` en vez de duplicar `process.env.X!` con non-null assertion silencioso tres veces.

**Lo que sigue sin poder verificarse en este entorno:** `pnpm install`, `pnpm dev`, apertura real en navegador. Sigue bloqueado por red (`x-deny-reason: host_not_allowed` contra el registro de npm, confirmado igual que en la validación anterior). El estado del sprint permanece `PENDING LOCAL VALIDATION` — esta revisión mejora la base, no sustituye la ejecución real.

## 7. Mejoras realizadas (resumen)

1. Guard de rol server-side real en `usuarios`/`configuracion` (antes solo se ocultaba el link).
2. `getSessionContext()` memoizado con `cache()` — eliminada la consulta duplicada a Supabase por request.
3. Navegación móvil real (antes: sidebar oculto sin reemplazo).
4. Accesibilidad del drawer móvil: foco + `Escape` + `aria-*`.
5. `loading.tsx` para el layout protegido.
6. `error.tsx` como error boundary de ruta.
7. Mensajes de error explícitos si faltan variables de entorno de Supabase.
8. `TenantSwitcher` sin clics muertos — estado deshabilitado explícito en vez de un control decorativo.
9. Eliminada la duplicación de `ICONS` (sidebar/mobile-nav → `nav-icons.ts`).
10. Eliminada la duplicación del encabezado de página (7 pantallas → `page-header.tsx`).
11. Fallback de sesión demo: distingue error esperado de error real (ya reportado en la validación previa, confirmado y no revertido en esta revisión).
12. ESLint + Prettier configurados de verdad (antes: script `lint` que no podía funcionar).
13. `CLAUDE.md` corregido a v1.2 para no contradecir la convención de nombres real del código.

## 8. Mejoras recomendadas — no hechas ahora, por alcance

- **Decidir la separación `apps/web` (admin, cloud-first) vs. `apps/guard` (guardia, local-first/PWA)** antes de tocar el módulo de Paquetes en Sprint 02. Es el hallazgo más importante de esta revisión (sección 5).
- Reservar espacio en el header para la búsqueda universal cuando se construya (no bloqueante, solo evitar un ajuste de layout apurado después).
- Reevaluar Turborepo cuando exista un tercer paquete/app con build propio.
- Escribir la primera prueba real (aunque sea una sola, de humo, sobre `middleware.ts`) sigue pendiente — ninguna revisión estática reemplaza una prueba automatizada ejecutándose en CI.

## 9. ¿Está la arquitectura lista para continuar?

**Sí, para los módulos administrativos — con una condición explícita para Paquetes.** No te voy a decir que todo está perfecto solo porque compila: encontré 9 problemas reales, 3 de ellos (guard de rol ausente, fallback demo silencioso, control de tenant decorativo) eran fallas de comportamiento, no solo de estilo. Los corregí porque eran defectos de lo ya construido, no funcionalidad nueva. Lo único que no resolví — la separación admin/guardia — es, a propósito, una decisión y no un parche, porque resolverla mal ahora (construyendo Paquetes dentro de `apps/web`) sería exactamente el tipo de deuda técnica que se vuelve carísima cuando el sistema ya tenga "decenas de módulos", como bien señalas. Prefiero dejártela explícita ahora que descubrirla a mitad de Sprint 02.

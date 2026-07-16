# SPRINT_01 — Entrega

**Rol:** Lead Software Engineer de GateFlow
**Alcance:** primera versión navegable del producto — autenticación, layout definitivo, dashboard con datos mock, 7 pantallas de navegación.

## 1. Resumen de la implementación

Se construyó el monorepo `gateflow/` con `apps/web` (Next.js 14 App Router + TypeScript estricto) y `packages/types` (tipos de dominio compartidos). Incluye: login con Supabase Auth real, logout, persistencia de sesión y protección de rutas vía middleware; layout definitivo (sidebar + header + selector de tenant + avatar); dashboard con 5 tarjetas de estadísticas, gráfica de volumen de 30 días y actividad reciente, todo con datos mock explícitamente señalados como tales; y las 6 pantallas de navegación restantes (Paquetes, Residentes, Unidades, Incidencias, Usuarios, Configuración) con estado vacío contextual, respetando el layout definitivo y el filtrado de navegación por rol.

## 2. Archivos creados

47 archivos nuevos. Estructura completa en `README.md`. Los de mayor relevancia arquitectónica:

- `packages/types/src/index.ts` — tipos de dominio (núcleo + módulo Paquetes), fuente única para toda la app.
- `apps/web/middleware.ts` + `apps/web/lib/supabase/middleware.ts` — protección de rutas.
- `apps/web/lib/auth/get-session.ts` — resolución de sesión server-side (con fallback documentado, ver sección 5).
- `apps/web/components/layout/*` — Sidebar, Header, TenantSwitcher, configuración de navegación.
- `apps/web/components/ui/*` — primitivas estilo shadcn/ui (Button, Card, Avatar, DropdownMenu, Badge, Separator, Skeleton, Input, Label).
- `apps/web/components/dashboard/*` — StatCard, PackagesChart (recharts), RecentActivity.
- `apps/web/app/(app)/*` — layout protegido + 7 pantallas.

## 3. Reglas BR-XX implementadas o consideradas

Ninguna regla funcional del módulo Paquetes se implementa todavía (ese es el alcance de Sprint 02). Lo que sí queda estructuralmente resuelto en este sprint:

- **BR-01 / BR-02** (aislamiento por tenant): el layout protegido y `get-session.ts` derivan el tenant activo del lado del servidor, nunca de un parámetro del cliente — consistente con `04-API.md §3`, aunque la resolución real contra `user_tenants` queda pendiente de datos (ver sección 5).
- **BR-45** (un rol por tenant): `SessionContext` modela un único `role` activo, no una lista acumulable.

## 4. Migraciones

Ninguna. Este sprint no toca la base de datos. Las migraciones del esquema de `03-DATABASE.md` (tenants, roles, user_tenants, unidades, etc.) siguen pendientes y son requisito para que la resolución de sesión real (no la de demostración) funcione en Sprint 02.

## 5. Riesgos conocidos y deuda técnica

- **Sesión de demostración como fallback.** Documentado en `apps/web/lib/auth/get-session.ts` y en el `README.md`. Es una decisión menor no documentada que resolví para que el sprint fuera navegable sin bloquear en ausencia de migraciones — **no debe llegar a producción**; Sprint 02 debe eliminar este fallback en cuanto existan filas reales en `user_tenants`.
- **Sin pruebas en este sprint.** El pedido del Sprint 01 fue explícitamente de scaffolding/UI; no se escribieron pruebas unitarias, de integración ni E2E. Esto no cumple technically la Definition of Done de `CLAUDE.md §29` ("las pruebas relevantes pasan") — lo señalo en vez de dar por cumplido el punto. Antes de Sprint 02 conviene al menos una prueba de humo del middleware de protección de rutas.
- **`apps/api` y `apps/admin` no existen.** La estructura de repositorio original los mencionaba; no se crean porque no hay lógica de servidor propia que los justifique todavía (CLAUDE.md §6).
- **No pude ejecutar `pnpm install` ni `next build` en este entorno** (sin acceso de red saliente). Las dependencias y versiones se declararon con cuidado y se verificaron manualmente los imports cruzados (ver checklist), pero la primera ejecución real de `pnpm dev` debe hacerse en tu máquina.

## 6. Checklist de validación

Verificado en este entorno (sin poder ejecutar el proyecto):
- [x] Todos los imports internos (`@/components/...`, `@/lib/...`) resuelven a un archivo existente.
- [x] Todos los símbolos importados desde `@gateflow/types` existen como export en `packages/types/src/index.ts`.
- [x] Todas las dependencias usadas en el código están declaradas en el `package.json` correspondiente.
- [x] TypeScript estricto activado en ambos `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`).
- [x] Ninguna regla de negocio, nombre de tabla, endpoint o estructura de carpetas de la documentación aprobada fue modificada.

Pendiente de verificar en tu máquina (requiere ejecutar el proyecto):
- [ ] `pnpm install` sin errores.
- [ ] `pnpm dev` levanta en `http://localhost:3000`.
- [ ] Login con un usuario real de Supabase Auth funciona y redirige a `/dashboard`.
- [ ] Acceder a `/dashboard` sin sesión redirige a `/login`.
- [ ] Acceder a `/login` con sesión activa redirige a `/dashboard`.
- [ ] Logout redirige a `/login` y una nueva visita a `/dashboard` vuelve a pedir login.
- [ ] Las 7 pantallas de navegación cargan sin error de consola.
- [ ] `pnpm typecheck` pasa sin errores.
- [ ] Responsive: sidebar se oculta correctamente por debajo de `md` (queda pendiente para Sprint 02 un menú móvil — hoy no existe, es la limitación responsive más importante a señalar).

## 7. Instrucciones exactas para ejecutar y verificar

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# completar NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev
```

Abrir `http://localhost:3000` → debe redirigir a `/login`. Iniciar sesión con un usuario existente del proyecto Supabase (créalo desde el dashboard de Supabase si no tienes uno) → debe redirigir a `/dashboard` con el layout completo, tarjetas mock y navegación funcional a las 6 pantallas restantes.

## 8. Confirmación de alcance

No se agregó ninguna funcionalidad fuera de lo solicitado en el Sprint 01. No se tocaron reglas de negocio, nombres de tablas, endpoints ni la estructura de carpetas de la documentación aprobada. La única decisión no documentada resuelta fue el fallback de sesión de demostración, señalada explícitamente en la sección 5 y en el código.

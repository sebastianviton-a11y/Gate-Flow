# SPRINT_01_5_REVIEW.md

**Rol:** Tech Lead de GateFlow
**Alcance:** separar la experiencia administrativa de la operativa de guardia, sin construir todavía el módulo de Paquetes.
**Decisión completa y justificada en:** `docs/adr/0011-separacion-admin-guard.md`

---

## 1. Decisión arquitectónica (resumen — ver ADR-011 para el detalle completo)

**Opción B: dos aplicaciones Next.js independientes** (`apps/admin`, `apps/guard`), compartiendo 4 paquetes (`@gateflow/types`, `@gateflow/ui`, `@gateflow/auth`, `@gateflow/supabase`).

La razón que decide entre las tres opciones evaluadas: un PWA instalable con service worker y caché agresiva (lo que `02-ARCHITECTURE.md §4` exige para el guardia) convive mal, dentro de una sola app Next.js, con un panel que debe seguir siendo estrictamente cloud-first. Separar en dos apps hace esa frontera estructural — un error de configuración no puede filtrar caché offline al panel admin, porque no comparten build ni origen.

## 2. Qué se conservó intacto (nada se rehizo innecesariamente)

Login, dashboard, sidebar, header, navegación administrativa, tenant switcher, sesión, middleware, integración con Supabase y los 9 componentes UI de Sprint 01 **siguen siendo el mismo código** — se movieron de ubicación (varios a paquetes compartidos) y se actualizaron sus imports, pero ninguna lógica se reescribió. La verificación de esto no es una afirmación — la sección 6 muestra cómo se comprobó.

## 3. Qué se construyó nuevo

**`packages/ui`, `packages/auth`, `packages/supabase`** — extracción real, no por "orden": los tres se extrajeron porque ambas apps necesitan exactamente la misma implementación (mismos clientes de Supabase, misma resolución de sesión, mismas primitivas de botón/card/etc.), no como preparación especulativa. Deliberadamente **no** se compartieron `Sidebar`, `Header`, `TenantSwitcher`, `PageHeader`, `EmptyState` — son componentes de densidad administrativa; forzarlos en la experiencia de guardia habría producido justo lo que este sprint busca evitar.

**`apps/guard`** — nueva aplicación:
- Pantalla principal (`/guard`) con 5 tiles grandes de acción (Registrar, Entregar, Buscar, Pendientes, Incidencia) — un toque, un destino, sin menús intermedios.
- Rutas `/guard/packages/register`, `/guard/packages/deliver`, `/guard/packages/search`, `/guard/packages/pending`, `/guard/incidents/new` — cada una con estructura funcional real (inputs controlados, no `<div>Próximamente</div>`), conectada a Sprint 02 para los datos, no todavía.
- `GuardShell`: barra de estado (tenant, usuario, conectividad, logout) — no un sidebar reducido.
- `ConnectivityIndicator`: refleja `navigator.onLine` en tiempo real — base para el futuro indicador de "N pendientes de sincronizar", no ese indicador todavía.
- PWA: `manifest.json` con íconos PNG reales (generados, no referencias rotas), `sw.js` que cachea únicamente el app-shell (documentado explícitamente como no-sincronización-de-datos).
- Layout con verificación de rol real: `residente` recibe una pantalla de "esta app es para portería", no un error genérico ni acceso silencioso.

## 4. Autenticación y autorización

- Compartida en el sentido que importa: mismo proyecto Supabase, mismo modelo de `user_tenants`/roles, misma función `getSessionContext()` (ahora en `@gateflow/auth`, una sola implementación consumida por ambas apps — no duplicada).
- `apps/admin`: acceso completo para `admin_residencial`/`super_admin`; `guardia` no tiene rutas administrativas ocultas especiales todavía (eso se resuelve caso por caso en Sprint 02 con `requireRole`, igual que ya se hizo con `/usuarios` y `/configuracion` en la revisión de Sprint 01).
- `apps/guard`: acceso para `guardia`, `admin_residencial`, `super_admin`. `residente` queda explícitamente bloqueado con una pantalla clara, no con un error.
- La sesión de demostración de Sprint 01 **sigue existiendo y sigue igual de visible** (`GuardDemoBanner` en guard, `DemoSessionBanner` en admin) — no se ocultó, no se hizo "silenciosa" al moverla a un paquete compartido. Un error real de Supabase (no la ausencia esperada de tablas) se sigue distinguiendo y registrando con `console.error`, igual que en Sprint 01.

## 5. Componentes compartidos — criterio aplicado, no "orden por orden"

Ver tabla en el ADR-011. Regla aplicada: algo se comparte solo si **ambas apps necesitan exactamente la misma implementación hoy**, no "podrían necesitarla algún día". Verificado que no hay dependencias circulares entre los 6 `package.json` del monorepo (`@gateflow/types` y `@gateflow/ui` no dependen de nada interno; `@gateflow/supabase` no depende de nada interno; `@gateflow/auth` depende de `types` + `supabase`; ambas apps dependen de los 4 — grafo acíclico, verificado por script, no de memoria).

## 6. Preparación PWA/offline-first — qué existe y qué no

**Existe:** manifest válido con íconos reales, service worker que cachea el app-shell (para que la app abra sin señal), indicador de conectividad en tiempo real, estructura de carpetas y layout ya separados de la app cloud-first.

**No existe todavía, a propósito:** cola de operaciones pendientes, sincronización real, resolución de conflictos, almacenamiento local de datos de negocio. Esto es explícitamente Sprint 03+ vía el motor de sincronización dedicado (`02-ARCHITECTURE.md §5`) — no se construyó una solución offline improvisada que luego habría que descartar, que es exactamente lo que se pidió evitar.

## 7. Validación técnica

**Verificado con evidencia real de herramienta (no lectura visual):**
- Sintaxis TS/TSX sobre las 71 archivos `.ts`/`.tsx` del monorepo completo (admin + guard + 4 paquetes): **0 errores**.
- Cada símbolo importado desde `@gateflow/ui`, `@gateflow/auth`, `@gateflow/supabase`, `@gateflow/types` existe realmente en el `export` de ese paquete: verificado por script, **0 problemas**.
- Cada alias `@/` dentro de `apps/admin` (29 archivos) y `apps/guard` (21 archivos) resuelve a un archivo real: **0 rotos**.
- Cada paquete usado en código está declarado en el `package.json` correspondiente, en los 6 `package.json` del monorepo: **0 faltantes**.
- Grafo de dependencias `workspace:*` entre los 6 paquetes: **sin ciclos**.
- `transpilePackages` en ambos `next.config.mjs` coincide exactamente con los paquetes compartidos realmente importados.

**No pude ejecutar** (mismo bloqueo que en sprints anteriores, reverificado ahora mismo, no asumido):
```
$ curl -sI https://registry.npmjs.org/
HTTP/2 403
x-deny-reason: host_not_allowed
```
`pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm dev` — ninguno se ejecutó contra un entorno real. **No marco este sprint como validado en ejecución.**

## 8. Archivos

**Creados (101):** 39 en `apps/admin` (movidos desde `apps/web` con imports actualizados — ver categorización completa abajo), 35 en `apps/guard` (nuevo), 13 en `packages/ui` (nuevo), 7 en `packages/supabase` (nuevo), 6 en `packages/auth` (nuevo), 1 en `docs/adr` (nuevo).

**Modificados (1):** `package.json` raíz (scripts `dev:admin`/`dev:guard` en vez de un solo `dev`).

**Eliminados (55):** todo `apps/web/*` — no es contenido perdido, es la ruta anterior; el contenido vive ahora en `apps/admin/*` (con imports actualizados) y en los 3 paquetes nuevos.

## 9. Checklist de validación

Verificado en este entorno:
- [x] 71 archivos `.ts`/`.tsx` sin errores de sintaxis.
- [x] 0 imports/alias rotos en ambas apps.
- [x] 0 símbolos importados desde paquetes compartidos que no existan en su export real.
- [x] 0 dependencias usadas sin declarar, en los 6 `package.json`.
- [x] 0 dependencias circulares entre paquetes.
- [x] `manifest.json` de `apps/guard` referencia íconos que existen realmente en disco (generados, no placeholder).

Pendiente de verificar en tu máquina:
- [ ] `pnpm install` sin errores (ahora con 6 paquetes en el workspace, no 2).
- [ ] `pnpm dev:admin` levanta en `:3000`, `pnpm dev:guard` levanta en `:3001`, simultáneamente.
- [ ] Login en `apps/admin` con rol `admin_residencial` → dashboard accesible.
- [ ] Login en `apps/guard` con el mismo usuario → `/guard` accesible, tiles funcionando.
- [ ] Un usuario con rol `residente` (cuando exista esa fila real) recibe la pantalla de bloqueo en `apps/guard`, no un error.
- [ ] El manifest de `apps/guard` es instalable como PWA (Chrome DevTools → Application → Manifest, sin errores).
- [ ] `pnpm typecheck` pasa en los 6 paquetes.

## 10. Riesgos o pendientes reales

- **Dos comandos de desarrollo en vez de uno.** No agregué `concurrently` (ni Turborepo) para combinarlos en un solo `pnpm dev` sin tu aprobación explícita — es exactamente la regla que `CLAUDE.md §26` fija ("Claude puede proponer una dependencia, no instalarla sin aprobación"). Lo dejo como propuesta: `concurrently` es una devDependency trivial, sin impacto en producción, que resolvería esto en una línea. Dime si la apruebas.
- **Autenticación "compartida" no es sesión de navegador compartida entre subdominios todavía.** Si en producción `apps/admin` y `apps/guard` viven en subdominios distintos, cada una pedirá login por separado (mismo usuario, misma cuenta — solo no hay SSO automático entre orígenes). Es una decisión de deployment pendiente, no un bug de este sprint.
- **`packages/ui`/`auth`/`supabase` ahora son código crítico compartido.** Un cambio ahí afecta a ambas apps a la vez — es la consecuencia esperada de compartir código real, no una debilidad nueva (antes el riesgo era el opuesto: duplicación silenciosa que podía divergir sin que nadie lo notara).
- Sigue pendiente, heredado de sprints anteriores: ejecución real (`pnpm install`/`dev`/`build`) nunca confirmada en un entorno con red.

## 11. Recomendación para Sprint 02

**Empezar por `apps/guard/packages/register`, no por `apps/admin`.** Es donde vive el requisito más restrictivo del producto (<20 segundos, offline-first eventual) y donde la arquitectura recién separada demuestra si realmente sostiene ese flujo. Construir primero la vista de gestión en `apps/admin` sería más fácil, pero validaría lo menos incierto del sistema. Antes de escribir código de Sprint 02, confirma los 7 puntos pendientes de la sección 9 — específicamente que ambas apps corren simultáneamente sin conflicto de puerto y que el login funciona en las dos por separado, ya que Sprint 02 va a construir sobre ambas al mismo tiempo (registro en guard, vista de gestión en admin).

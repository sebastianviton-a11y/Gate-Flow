# SPRINT_01_VALIDATION.md

**Estado final: `SPRINT 01 — PENDING LOCAL VALIDATION`**

No lo marco como `VALIDATED`. No pude ejecutar `pnpm install` ni `pnpm dev` en este entorno — lo explico en la sección 5 con evidencia técnica del bloqueo, no como suposición. Según tu propia instrucción, ausencia de ejecución real = `PENDING LOCAL VALIDATION`, sin excepción.

---

## 1. Versión base sobre la que aplica este ZIP

**Base: ninguna — repositorio vacío.** Sprint 01 es la primera entrega de código de GateFlow; no existe un commit ni un ZIP anterior sobre el cual "aplicar un parche". El ZIP adjunto (`gateflow-sprint01-delta.zip`) es la **entrega completa y autocontenida**, no un diff — se extrae directamente, no se aplica sobre otra cosa.

Dicho esto, sí hubo una entrega previa de Sprint 01 (antes de esta validación) que este ZIP **reemplaza por completo**. Los cambios realizados durante esta validación, sobre esa entrega previa, fueron:

| Archivo | Cambio |
|---|---|
| `apps/web/components/layout/mobile-nav.tsx` | **Creado.** Navegación móvil (drawer) — el sidebar estaba `hidden` por debajo de `md` sin ningún reemplazo; era responsive roto, no responsive real. |
| `apps/web/components/layout/demo-session-banner.tsx` | **Creado.** Banner visible cuando la sesión activa es de demostración (ver sección 6). |
| `apps/web/lib/auth/get-session.ts` | **Modificado.** Reescrito para distinguir el error esperado (`42P01`, tabla no migrada) de cualquier otro error real de Supabase, que antes se silenciaba igual que el caso esperado. |
| `packages/types/src/index.ts` | **Modificado.** `SessionContext` gana `isDemo: boolean` y `demoReason`. |
| `apps/web/components/layout/header.tsx` | **Modificado.** Integra el trigger de navegación móvil. |
| `apps/web/app/(app)/layout.tsx` | **Modificado.** Integra `DemoSessionBanner`, padding responsive (`p-4 md:p-6`). |

Ningún archivo fue eliminado.

## 2. Inventario completo de archivos (Sprint 01, versión final)

**41 archivos `.ts`/`.tsx`** más configuración (`package.json` ×2, `tsconfig.json` ×2, `tailwind.config.ts`, `postcss.config.js`, `next.config.mjs`, `components.json`, `pnpm-workspace.yaml`, `.env.example`, `.gitignore`, `README.md`, `SPRINT_01_DELIVERY.md`) — **56 archivos en total**, todos "creados" respecto a la base vacía. El árbol completo está en `README.md` dentro del ZIP.

## 3. Verificaciones realizadas — con evidencia, no solo lectura

Herramientas reales disponibles en este entorno (sin red saliente, ver sección 5): Node 22, TypeScript 6.0.3 instalado globalmente.

**3.1 Sintaxis TS/TSX real (no visual).** Escribí un script que corre `ts.transpileModule` sobre los 41 archivos del proyecto — parsea JSX, genéricos, tipos, todo. Resultado: **41/41 archivos sin errores de sintaxis**, ejecutado dos veces (antes y después de las correcciones de esta validación).

**3.2 Imports y alias `@/`.** Extraje por regex todos los imports no relativos y todos los `@/...` del código, y verifiqué contra el sistema de archivos real que cada uno resuelve a un archivo existente. Resultado: **0 imports rotos**.

**3.3 Dependencias declaradas vs. usadas.** Comparé cada paquete externo importado en el código contra `apps/web/package.json`. Resultado: **0 paquetes usados sin declarar**. Los declarados-pero-no-importados directamente (`@supabase/supabase-js`, `@types/*`, `autoprefixer`, `postcss`, `react-dom`, `tailwindcss-animate`, `typescript`) son todos justificables (peer dependency, tooling de build, o requerido vía `require()` en `tailwind.config.ts` en vez de `import`).

**3.4 Type-check con dependencias externas simuladas.** Intenté un `tsc --noEmit` real usando stubs de tipos para next/react/radix/supabase/lucide/recharts (porque no hay `node_modules` reales sin red). Produjo ~90 errores, pero **los revisé uno por uno y son artefactos de mis stubs**, no bugs reales: mi stub de `lucide-react` no declaraba exports nombrados individuales (el paquete real sí los tiene: `Package`, `Users`, `Settings`, etc. son nombres reales y estándar de esa librería), mi stub de `React` no replicaba el mecanismo de `key` que TypeScript+React manejan de forma especial, y los `Cannot find name 'process'`/`'require'` son por no tener `@types/node` resuelto en el stub. Ninguno de estos es un problema del código de GateFlow — son limitaciones de simular 6 librerías a mano. **Esto no sustituye un `tsc` real con `node_modules` instalados**, y lo digo explícitamente en vez de presentarlo como una validación completa.

**3.5 Revisión manual de props entre componentes.** Crucé a mano cada sitio donde se invoca un componente propio (`StatCard`, `EmptyState`, `TenantSwitcher`, `PackagesChart`, `RecentActivity`, `NavLink`) contra su firma de props declarada. Los 41 archivos son pocos — es factible hacerlo exhaustivamente, no por muestreo. No encontré mismatches.

**3.6 Variables de entorno.** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son las únicas dos usadas en código (`grep` sobre `process.env.`), y las dos están en `.env.example` con los mismos nombres exactos.

**3.7 Tailwind y `components.json`.** El `content` de `tailwind.config.ts` apunta a `./app/**/*.{ts,tsx}` y `./components/**/*.{ts,tsx}` — coinciden con la ubicación real de esos directorios. `components.json` declara `"css": "app/globals.css"` — el archivo existe en esa ruta exacta.

**3.8 `next.config.mjs`.** `transpilePackages: ["@gateflow/types"]` coincide exactamente con el campo `"name"` de `packages/types/package.json`.

## 4. Protección de rutas, persistencia de sesión y navegación — revisión de lógica

- **Protección de rutas:** `middleware.ts` llama a `updateSession()`, obtiene el usuario real vía `supabase.auth.getUser()`, y redirige a `/login` si no hay usuario en cualquier ruta fuera de `PUBLIC_PATHS`. Redirige a `/dashboard` si hay usuario y la ruta es `/login`. La lógica es correcta sobre el papel; **no ejecutada contra un navegador real** (sección 5).
- **Persistencia de sesión:** se apoya en `@supabase/ssr`, que administra la sesión vía cookies HTTP-only gestionadas tanto por el cliente de servidor (`lib/supabase/server.ts`) como por el middleware (`lib/supabase/middleware.ts`). El patrón (get/set/remove cookie con manejo de excepción en Server Components) es el patrón documentado oficialmente para Next.js App Router. No hay uso de `localStorage` para nada operativo.
- **Navegación:** `NAV_ITEMS` es la única fuente de verdad (`components/layout/nav-items.ts`), consumida tanto por `Sidebar` (desktop) como por el nuevo `MobileNav`, filtrada por rol con la misma función (`navItemsForRole`) en ambos casos — no hay una segunda lista duplicada que pueda desincronizarse.

## 5. Lo que NO pude verificar — y por qué, con evidencia

No hay acceso de red saliente en este entorno. Verificación real, no supuesta:

```
$ curl -sI https://registry.npmjs.org/
HTTP/2 403
x-deny-reason: host_not_allowed
```

Como consecuencia, **no pude ejecutar, ni una vez**:
- `pnpm install` (pnpm ni siquiera está instalado en este entorno; solo `npm`, que además está bloqueado a nivel de red).
- `pnpm dev` / `next dev`.
- Apertura real en navegador.
- Login end-to-end contra un proyecto Supabase real.
- Logout end-to-end.
- Inspección de consola del navegador en runtime.

Esto es exactamente la brecha entre "revisión estática exhaustiva" (sección 3, con evidencia real de herramientas) y "validación de ejecución" (lo que tu criterio de `VALIDATED` exige). Son cosas distintas y no quiero que una se confunda con la otra.

## 6. Comportamiento si `tenants`, `user_tenants` o `roles` no existen

Cuando el usuario inicia sesión correctamente (Supabase Auth responde con un usuario válido) pero la consulta a `user_tenants` falla porque la tabla no existe (`código Postgres 42P01`), la app entra en **sesión de demostración**:

- Se usa un tenant ficticio (`Residencial Demo`) y rol `admin_residencial`, para que el layout y el dashboard mock sean navegables.
- **Esto ahora es visible en la interfaz**, no solo en un comentario de código: agregué `DemoSessionBanner`, una franja ámbar fija debajo del header en cada pantalla protegida, con el texto "Sesión de demostración (Sprint 01)" y el motivo exacto.
- **Corrección importante de esta validación:** antes, *cualquier* error de la consulta a `user_tenants` —no solo la ausencia esperada de la tabla— caía en el mismo fallback silencioso. Ya no. Ahora se distingue:
  - `schema_not_migrated` (código `42P01`) → caso esperado en Sprint 01, banner ámbar.
  - `unexpected_error` (cualquier otro error: RLS mal configurado, falla de red hacia Supabase, credenciales inválidas del proyecto) → se registra con `console.error` en el servidor con código y mensaje reales, y el banner se muestra en **rojo**, no ámbar, para que no se confunda con el caso esperado.
  - `no_membership_row` (la tabla existe, la consulta no falla, pero el usuario no tiene fila todavía) → también demo, con su propio mensaje.

Un error de credenciales incorrectas en el login (`signInWithPassword` fallido) **nunca llega a este mecanismo** — se maneja antes, en `login-form.tsx`, y se muestra como error de login normal. La sesión demo solo entra en juego después de una autenticación exitosa.

## 7. Qué falta para pasar a `VALIDATED`

Exactamente lo que pediste, sin ambigüedad:
1. `pnpm install` completado sin errores, en tu máquina.
2. `pnpm dev` inicia sin errores.
3. La app abre en `http://localhost:3000` y redirige a `/login`.
4. Login exitoso con un usuario real de Supabase Auth redirige a `/dashboard`.
5. Dashboard navegable (las 7 pantallas cargan).
6. Sin errores críticos en la consola del navegador.

En cuanto confirmes estos 6 puntos (o me compartas la salida si alguno falla), actualizo el estado a `SPRINT 01 — VALIDATED` en `CURRENT_STATE.md` y `PROJECT_STATE.md`.

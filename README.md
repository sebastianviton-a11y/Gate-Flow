# GateFlow

Plataforma SaaS multi-tenant de operaciones de portería. Este repositorio contiene el código — la documentación de producto y arquitectura (`PRD`, `BUSINESS_RULES`, `ARCHITECTURE`, `DATABASE`, `API`, `CLAUDE.md`) vive fuera de este ZIP y debe consolidarse aquí como paso posterior.

## Estructura

```
gateflow/
  apps/
    admin/    — Next.js 14, cloud-first. Panel administrativo. Puerto 3000.
    guard/    — Next.js 14, preparada para PWA. App operativa de guardia. Puerto 3001.
  packages/
    types/     — Tipos de dominio compartidos (@gateflow/types).
    ui/         — 9 primitivas UI + cn() + EstadoBadge + PackageQRCode (@gateflow/ui).
    auth/        — Sesión, guard de rol (@gateflow/auth).
    supabase/     — Clientes de Supabase + validación de env (@gateflow/supabase).
    paquetes/      — Consultas y mutaciones del módulo Paquetes, compartidas entre ambas apps (@gateflow/paquetes).
  supabase/
    migrations/    — Esquema SQL definitivo (27 tablas, RLS completo).
    seed.sql
  docs/
    adr/             — Decisiones arquitectónicas formales.
```

Por qué dos apps y no una: ver `docs/adr/0011-separacion-admin-guard.md`.

## Requisitos

- Node.js 20+
- pnpm 9+
- Un proyecto Supabase (URL + anon key) — mismo proyecto para ambas apps.

## Puesta en marcha

```bash
# 1. Instalar dependencias de todo el monorepo (6 paquetes: 2 apps + 4 packages)
pnpm install

# 2. Configurar variables de entorno (mismas credenciales en ambas apps)
cp apps/admin/.env.example apps/admin/.env.local
cp apps/guard/.env.example apps/guard/.env.local
# Editar ambos .env.local con la URL y anon key de tu proyecto Supabase.

# 3. Levantar ambas apps con un solo comando (usa concurrently)
pnpm dev
# admin → http://localhost:3000   ·   guard → http://localhost:3001

# Alternativa: cada app en su propia terminal, si prefieres logs separados
pnpm dev:admin
pnpm dev:guard
```

No hay conflicto de puertos: cada app fija su puerto explícitamente en su propio `package.json` (`next dev -p 3000` / `-p 3001`), no depende del puerto por defecto de Next.js.

## Autenticación

Mismo proyecto Supabase Auth para ambas apps. Las tablas del núcleo (`user_tenants`, `tenants`, `roles`) descritas en `03-DATABASE.md` **no se han ejecutado todavía** contra un proyecto real — mientras no existan, ambas apps usan una sesión de demostración claramente señalada en pantalla (banner ámbar) y en el código (`packages/auth/src/get-session.ts`). Un error real de Supabase (no la ausencia esperada de tablas) se distingue y se muestra en rojo, nunca se confunde con el caso esperado.

`apps/guard` bloquea explícitamente a cualquier usuario con rol `residente` — esa app es solo para `guardia`, `admin_residencial` y `super_admin`.

## Módulo de Paquetes (Sprint 02)

Registro, entrega, búsqueda y dashboard están conectados a Supabase de extremo a extremo — no hay mocks. Requiere que las migraciones de `supabase/migrations/` ya estén aplicadas contra tu proyecto (ver `supabase/README.md`). Sin eso, ambas apps siguen funcionando en modo demo (banner visible), pero registrar un paquete fallará porque las tablas no existirán todavía.

## Scripts disponibles

- `pnpm dev` — **ambas apps a la vez** (vía `concurrently`, logs prefijados `[admin]`/`[guard]`).
- `pnpm dev:admin` / `pnpm dev:guard` — cada app por separado.
- `pnpm build` — build de ambas apps. `pnpm build:admin` / `pnpm build:guard` por separado.
- `pnpm lint` — lint de ambas apps. `pnpm lint:admin` / `pnpm lint:guard` por separado.
- `pnpm typecheck` — chequeo de tipos en todo el workspace (6+ paquetes).

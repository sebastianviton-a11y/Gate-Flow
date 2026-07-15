# GateFlow

Plataforma SaaS multi-tenant para digitalizar las operaciones de portería de residenciales, condominios y urbanizaciones privadas.

Este repositorio se encuentra en construcción bajo el proceso definido en Sprint 0 (fundación técnica y organizacional). La documentación completa del proyecto (`CLAUDE.md`, PRD, reglas de negocio, arquitectura, etc.) se incorpora a este repositorio en tareas posteriores del mismo sprint.

## Estructura

- `apps/` — Aplicaciones (`guard`: PWA de guardias, `admin`: panel administrativo Next.js).
- `packages/` — Paquetes compartidos por capas (`domain`, `application`, `infrastructure`, `sync`, `ui`, `types`, `validation`, `config`, `testing`).
- `supabase/` — Configuración y migraciones de Supabase.
- `docs/` — Documentación del proyecto (producto, arquitectura, ADR, operaciones, sprints).
- `scripts/` — Scripts de build, despliegue y utilidades de desarrollo.

Cada carpeta contiene un `README.md` explicando su propósito específico.

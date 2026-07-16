# ENVIRONMENT_VARIABLES.md

Ninguna de las variables aquí listadas tiene un valor real — solo nombre, propósito, dónde se configura y su nivel de sensibilidad. Los valores reales viven exclusivamente en Netlify (UI) y en el proyecto Supabase, nunca en este repositorio.

## Reglas obligatorias (ya aplicadas, verificadas)

- `.gitignore` excluye `.env`, `.env.local` y variantes en ambas apps — confirmado.
- `.env.example` de cada app contiene solo nombres de variable, nunca valores — confirmado.
- Ninguna variable que empiece con `SERVICE_ROLE` o equivalente aparece en `NEXT_PUBLIC_*` en ningún archivo del repositorio — confirmado por búsqueda.
- `apps/admin/netlify.toml` y `apps/guard/netlify.toml` no contienen ningún valor de variable — solo declaran qué variables de entorno de build usar (`NODE_VERSION`), que no es sensible.

## Variables por aplicación

### `apps/admin` y `apps/guard` (ambas, idénticas)

| Variable | Sensibilidad | Dónde se configura | Propósito |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Pública (no es secreto — diseñada para viajar al navegador) | Netlify → Site configuration → Environment variables, en cada uno de los dos sitios | URL del proyecto Supabase de staging. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública (protegida por RLS, no por ocultarla — ver `SECURITY_ARCHITECTURE.md §10`) | Igual que arriba | Clave anónima del mismo proyecto. |

Estas dos son las **únicas** variables que ambas apps necesitan en este sprint. Ninguna otra.

### Exclusivas del servidor (no usadas todavía por el código actual, documentadas para cuando se conecte WhatsApp)

| Variable | Sensibilidad | Dónde debe vivir cuando exista | Nunca debe estar en |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta — máxima sensibilidad** | Configuración de Supabase Edge Functions únicamente (`supabase secrets set`) | Netlify, `NEXT_PUBLIC_*`, cualquier archivo versionado |
| `WHATSAPP_CLOUD_TOKEN` / `TWILIO_AUTH_TOKEN` (proveedor de notificaciones, en construcción) | Secreta | Supabase Edge Functions (`supabase secrets set`) | Frontend, Netlify |

Ninguna de estas se usa en este sprint de staging — WhatsApp sigue en modo demo/mock. Se documentan aquí para que, cuando se conecten, quede claro de antemano dónde deben vivir.

## URLs públicas (se completan tras el deploy, no son secretas)

| Referencia | Valor |
|---|---|
| Admin | `https://gateflow-admin.netlify.app` (o el dominio que hayas elegido) |
| Guardia | `https://gateflow-guard.netlify.app` |
| Supabase (dashboard del proyecto de staging) | `https://supabase.com/dashboard/project/TU_PROJECT_REF` |

Estas tres URLs deben registrarse también en **Supabase → Authentication → URL Configuration** (Site URL + Redirect URLs) — ver `DEPLOY_STAGING.md §2`.

## Variables separadas por entorno

Este proyecto Supabase es **exclusivo de staging** — no se reutiliza el mismo proyecto para producción más adelante. Cuando exista un entorno de producción, será un proyecto Supabase distinto, con sus propias `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`, configuradas en los mismos dos sitios de Netlify pero bajo un contexto de build distinto (Netlify soporta variables por "deploy context" si en el futuro se decide servir ambos entornos desde los mismos sitios).

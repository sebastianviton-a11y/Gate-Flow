# Rollout de privilegios E1/E2/E4 en staging

Staging: `sfuckzzqejerrifuypby` (Gate Flow - Staging), sitios
`gateflow-admin-staging` y `gateflow-guard-staging` (rama `staging`).
Ya aplicadas: grants de mínimo privilegio (`20260729100000`),
reconciliación (`20260729200000`) y migración A (`20260930000000`,
verificada en SA: 44 checks, único pendiente E1-03).

## Orden

**A → código → C**

1. **A** — `supabase/migrations/20260930000000_privilegios_fase_a.sql`
2. **Código** — un solo push a `staging` (Admin y Guard se reconstruyen):
   - fase B: `invitar-usuario-action.ts`, `superadmin/invitacion-actions.ts`
     (sin metadata, `otorgar_membresia` como service_role);
   - sesión fail-closed: `get-session.ts`, `middleware.ts` de Admin y Guard,
     `/sin-acceso`, panel Admin solo para `super_admin` y `admin_residencial`
     (cualquier otro rol, vacío o desconocido → `/sin-acceso`).
3. **C** — `supabase/pending/privilegios_fase_c.sql` (se mueve a
   `migrations/` con timestamp nuevo al aplicarse). Además de quitar el
   vínculo por metadata y `has_role`, limita `otorgar_membresia` a los
   flujos actuales: guardia (admin del residencial o super_admin) y
   admin_residencial (solo super_admin).

## Roles

| App / flujo | Roles |
|---|---|
| Panel Admin | `super_admin`, `admin_residencial` |
| Guard | `guardia`, `admin_residencial`, `super_admin` |
| Invitación desde el residencial (onboarding, /usuarios) | `guardia` |
| Invitación desde Super Admin | `admin_residencial` |

`supervisor` y `recepcion` no se invitan (no tienen app). Nadie invita
`super_admin`, `residente` ni `admin_empresa`. En SA la app ya aplica
estas reglas (`ROLES_INVITABLES`, `puedeInvitar`); la base las aplica
desde C.

## Por qué

| Combinación | Resultado (test) |
|---|---|
| Código B antes de A | `otorgar_membresia` no existe → toda invitación falla (`RO-06` en S0: 42883) |
| A con código viejo | El trigger transitorio `vincular_membresia_heredada` sigue creando la membresía de la invitación por metadata, solo para roles de lista blanca (`RO-05` en SA) |
| A con código B | `otorgar_membresia` crea la membresía (`RO-06`, `RO-06b`, `RO-07` en SA) |
| C con código B | Igual que antes; la metadata ya no crea nada (`RO-05` en SC) y `otorgar_membresia` rechaza supervisor/recepcion y admin→admin (`RO-13`..`RO-15`) |
| C con código viejo | Las invitaciones viejas ya no crean membresía → **no volver al código viejo después de C** |

El cambio de sesión (fail-closed) no depende de ninguna migración: funciona
en S0, SA y SC.

## Ventana entre A y C

Con A queda un residuo de E1 hasta C: un `signUp` público con metadata
`{tenant_id, rol_clave: admin_residencial}` crea esa membresía en cualquier
tenant (`E1-03`). Mitigación: registros públicos de Auth deshabilitados
durante la ventana y aplicar C en cuanto el código B esté publicado (staging
no tiene invitaciones viejas pendientes).

## Rollback

| Paso que falla | Acción | Seguro porque |
|---|---|---|
| A al aplicar | Nada: la migración corre en una transacción | atómica |
| A después de aplicada | `supabase/rollback/20260930000000_privilegios_fase_a.down.sql` (con código viejo) | el código viejo no usa nada de A |
| Código | Netlify → *Publish deploy* del deploy anterior en ambos sitios | código viejo compatible con A (`RO-05` en SA) |
| C | `supabase/rollback/privilegios_fase_c.down.sql` | código B no depende del trigger ni de `has_role` |

Orden inverso obligatorio: C → código → A. Nunca revertir A con el código B
publicado, ni el código con C aplicada.

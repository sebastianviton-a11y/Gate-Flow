# Drift producción ↔ repo (octubre 2026)

Comparación de catálogos de **solo lectura** entre producción
(`xlozkpygubyiuxopmdxw`) y el repo/staging (`sfuckzzqejerrifuypby`,
creado desde `supabase/migrations`). Producción no se modificó.

Clasificación:

- **A — paridad necesaria**: el código actual lo necesita y producción ya lo tiene.
- **B — seguridad/arquitectura nueva**: no se copia producción; una migración del repo lo resuelve mejor.
- **C — sin explicar / cosmético**: no cambia el comportamiento o su intención no está demostrada.

## Columnas

| Diferencia | Clase | Resolución |
|---|---|---|
| `incidencias.nivel_danio text` (solo producción) | A | `20260729200000_reconciliacion_paridad_produccion.sql` |

El resto de columnas de `public` es idéntico.

## Constraints

| Diferencia | Clase | Resolución |
|---|---|---|
| `incidencias_nivel_danio_check` (`leve`/`moderado`/`grave`) | A | reconciliación |
| `incidencias_tipo_check`: producción 13 tipos, repo 8 | A | reconciliación |

## Funciones

| Función | Diferencia | Clase | Resolución |
|---|---|---|---|
| `registrar_paquete_con_incidencia(...)` | solo en producción; la llama `registrarPaqueteConIncidencia` | A | reconciliación (con `search_path` fijo y EXECUTE solo `authenticated`) |
| `fn_registrar_historial_paquete()` | producción `SECURITY DEFINER`, repo INVOKER (registrar/entregar fallan con 42501) | A | reconciliación (con `search_path = ''` y sin EXECUTE para la API) |
| `has_role_in_tenant(uuid, text[])` | solo en producción, `search_path = public`, EXECUTE para todos | B | la crea la migración A (`search_path = ''`, EXECUTE solo `authenticated`); A ahora usa `create or replace` para no fallar en producción |
| `crear_grupo_entrega_separado`, `obtener_o_crear_grupo_entrega` | token: repo `encode(gen_random_bytes(24),'hex')`, producción `gen_random_uuid()` ×2 | A | reconciliación, sección 5 (fórmula de producción, `search_path = ''`, EXECUTE solo `authenticated`) |
| `entregar_paquete`, `fn_proteger_campos_paquete`, `refrescar_search_vectors` | solo comentarios (producción los perdió al pegarse a mano) | C cosmético | nada |
| 9 funciones con `\r\n` en staging | finales de línea del pegado manual | C cosmético | nada |

### Grupos de entrega (`gen_random_bytes`)

En Supabase pgcrypto vive en el schema `extensions`. Las dos funciones fijan
`search_path = public`, así que `gen_random_bytes()` no resuelve y fallan con
`42883` (comprobado en staging). Guard las llama al registrar paquetes
(`apps/guard/app/guard/packages/register/page.tsx:212` →
`obtenerOCrearGrupoEntrega`). Producción lo corrigió cambiando a
`replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')`
(64 hex, 244 bits aleatorios de un CSPRNG; el repo da 48 hex, 192 bits).

- **Qué resuelve**: que el registro de paquetes con grupo funcione en Supabase.
- **Más correcta**: producción funciona; el repo no. Alternativa equivalente: calificar `extensions.gen_random_bytes(24)`.
- **Conflicto con la fase A**: ninguno.
- **Estado**: aprobado y resuelto en la sección 5 de la reconciliación con la
  fórmula de producción (token de 64 hex en minúsculas), endurecida con
  `search_path = ''` y EXECUTE solo para `authenticated`. Tests `G-01`…`G-19`.

## Triggers

Idénticos (13, mismo `pg_get_triggerdef`).

## Políticas (20 distintas en public, todas el mismo patrón)

Producción reemplazó a mano `has_role(...)` por
`has_role_in_tenant(<tenant de la fila>, ...)` en:

`audit_log_read_admin`, `empresas_paqueteria_write_admin`,
`grupos_entrega_delete_admin`, `grupos_entrega_update`,
`paquetes_delete_admin`, `paquetes_update`,
`plantillas_notificacion_write_admin`, `plantillas_notificacion_update_admin`,
`prioridades_paquete_write_admin`, `prioridades_paquete_update_admin`,
`tamanos_paquete_write_admin`, `tamanos_paquete_update_admin`,
`tenants_update_admin`, `ubicaciones_insert_admin`, `ubicaciones_update_admin`,
`ubicaciones_delete_admin`, `unidades_insert_admin`, `unidades_update_admin`,
`unidades_delete_admin`, `user_tenants_write_admin`.

Las políticas de `storage` (logos) no se compararon.

- **Qué resuelve**: E4a — un admin de A que además es guardia en B no debe tener poderes de admin en B.
- **Clase B**: la migración A hace lo mismo y es más estricta:
  - repite la condición en el `WITH CHECK` de los UPDATE de admin (producción solo la pone en `USING` en `tenants`, `unidades`, `ubicaciones`, `tamanos`, `prioridades`, `plantillas`);
  - reemplaza `user_tenants_write_admin` (producción todavía deja a un admin insertar/borrar membresías desde el navegador, salvo `super_admin`) por solo `UPDATE (activo)` + `otorgar_membresia()` vía `service_role` (E2).
- **Conflicto con la fase A**: A usa `ALTER POLICY` (funciona sobre la versión de producción) y `drop policy user_tenants_write_admin` (existe en ambos). La única colisión era `create function has_role_in_tenant`, ya cambiada a `create or replace`.
- **Estado**: no se copian; las cubre la migración A.

## Grants

| Diferencia | Clase | Resolución |
|---|---|---|
| Producción: `arwdDxtm` para `anon`/`authenticated`/`service_role` en todo `public` (incluidas las vistas materializadas sin RLS) | B | `20260729100000_grants_minimo_privilegio.sql`; no aplicar en producción sin revisión |
| Funciones de producción con EXECUTE explícito para `anon` | B | migración A + reconciliación revocan donde corresponde |

## Rollbacks y producción

Los rollbacks de la reconciliación y de la migración A son para entornos
creados desde el repo: en producción borrarían objetos que ya existían antes
(`registrar_paquete_con_incidencia`, `has_role_in_tenant`).

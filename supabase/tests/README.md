# supabase/tests

Pruebas de integración y de RLS contra PostgreSQL.

## security/ — privilegios E1 / E2 / E4

Verifican que la metadata de un signUp no otorga roles (E1), que nadie
fabrica membresías desde el cliente (E2), que los permisos de admin se
evalúan en el tenant de la fila (E4a) y que `tenant_id` es inmutable
(E4b), además del endurecimiento de funciones y una regresión del uso
real de Admin y Guard.

| Archivo | Contenido |
|---|---|
| `harness/supabase_stub.sql` | Emula roles, `auth` y `storage` de Supabase sobre un Postgres pelado. **Nunca** contra un proyecto real. |
| `00_fixtures.sql` | Tenants P/A/B y usuarios (super, admins, guardias, mixto, admin_ab, solo). |
| `01_helpers.sql` | Esquema `tests` con `pass/fail/como/debe_fallar/debe_funcionar/filas/igual`. |
| `10_…` a `60_…` | Suites. Cada caso corre en su transacción con `ROLLBACK`. |
| `run-local.sh` | Recrea la base, aplica todo y recorre base → A → C → rollbacks. |

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh
```

Requiere un PostgreSQL 15+ local desechable (el script hace `dropdb`/
`createdb` de `$GF_TEST_DB`, por defecto `gf_security_test`). La fase
"0" (esquema sin la migración A) es informativa: sus FAIL muestran los
riesgos que la migración cierra. Las demás deben terminar en 0 FAIL, y
cada rollback debe dejar el catálogo idéntico al estado anterior.

## Pendientes conocidos (fuera del alcance de E1/E2/E4)

- **Guardia no puede registrar paquetes con INSERT directo.**
  `fn_registrar_historial_paquete()` (trigger `trg_paquetes_historial`)
  no es `SECURITY DEFINER` y `paquete_historial` solo tiene política de
  SELECT, así que el INSERT del historial que dispara el trigger viola
  RLS (`42501`) cuando lo ejecuta `authenticated`
  (`packages/paquetes/src/mutations.ts → registrarPaquete`). Existía
  antes de estos cambios; se reproduce en la base local. Está excluido
  de `60_regresion.sql` (ver R-03). Pendiente: verificarlo en staging
  y corregirlo en una migración propia.

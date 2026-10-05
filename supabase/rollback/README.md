# supabase/rollback

Scripts para deshacer migraciones a mano. **No** son migraciones: el
CLI de Supabase no los ejecuta.

| Script | Deshace |
|---|---|
| `20260930000000_privilegios_fase_a.down.sql` | `migrations/20260930000000_privilegios_fase_a.sql` |
| `privilegios_fase_c.down.sql` | `pending/privilegios_fase_c.sql` (una vez movida a `migrations/`) |

## Orden (privilegios E1/E2/E4)

Despliegue: **A** (migración) → **B** (código de Admin) → **C** (migración).

Reversión, siempre en orden inverso:

1. Revertir **C** con `privilegios_fase_c.down.sql`. Hace falta antes de
   revertir B: sin el trigger transitorio, el código anterior a B deja
   las invitaciones sin membresía.
2. Revertir **B** (commit de código). Solo es válido mientras C no esté
   aplicada.
3. Revertir **A** con `20260930000000_privilegios_fase_a.down.sql`. Hace
   falta revertir B antes: B llama a `otorgar_membresia()`, que A.down
   borra.

Después de ejecutar un `.down.sql`, hay que borrar la fila de la
migración en el historial para que el CLI no la considere aplicada:

```sql
delete from supabase_migrations.schema_migrations where version = '<timestamp>';
```

`supabase/tests/security/run-local.sh` comprueba que cada rollback deja
el catálogo (políticas, funciones, grants, triggers) idéntico al
estado anterior.

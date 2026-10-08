# Ensayo de las migraciones de producción

Producción (`xlozkpygubyiuxopmdxw`) no tiene historial de migraciones:
se armó a mano. Su forma se reconstruyó desde el catálogo, con lecturas
de solo lectura y sin filas de datos.

**Forma de producción (2026-10-08).**
- Repo hasta `20260729000000`, más el drift de `docs/operations/DRIFT_PRODUCCION.md`.
- Más las políticas de logos en `storage.objects` con `has_role_in_tenant`.
- Huella por tipo de objeto igual a la de producción, salvo 7 triggers internos de Supabase Storage.

**Pendientes.** Las 12 migraciones posteriores, en el mismo orden que en staging (lista en `ensayo.sh`).

| Archivo | Para qué |
|---|---|
| `huella_objetos.sql` | Huella de catálogo por objeto. La misma consulta en producción y en local; se compara por tipo y se baja al detalle solo donde difiere |
| `parche_forma_produccion.sql` | Lleva la base local a la forma de producción. Solo pruebas |
| `datos_sinteticos_forma_prod.sql` | Datos sintéticos con la forma y el volumen de producción: 3 residenciales MX (2 «piloto», 1 «trial»), 8 usuarios, unos 600 registros. Ningún dato real |
| `ensayo.sh` | Forma + datos → 12 migraciones → comprueba que ninguna fila existente cambie y verifica el comportamiento (`verificacion_post.sql`) |
| `verificacion_produccion.sql` | Consultas de **solo lectura** para producción, a correr antes y después de la ventana: conteos y violaciones de FK, sin datos personales |

```bash
PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/produccion/ensayo.sh
GF_BASE_PRODUCCION=1 PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/security/run-local.sh
```

**Resultado (2026-10-08).**
- Las 12 migraciones aplican en unos 0,8 s.
- `D0`: ninguna fila existente cambia. `D1–D12` PASS:
  - backfill `active`/`alta_manual`;
  - los residenciales siguen operativos, incluido el de plan «trial»;
  - admin, guardia y super_admin conservan sus permisos;
  - aislamiento entre residenciales.
- Suites de seguridad desde la forma de producción: 0 FAIL en las fases A…IM.
- Los rollbacks del repo **no** devuelven producción a su forma exacta (las diferencias aparecen en rollback_O/T/C/A). En producción, la reversa es restaurar el respaldo.

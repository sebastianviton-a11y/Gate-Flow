# Pruebas de documentos legales (Fase 2)

Todo es local y con documentos **ficticios** (marcas `ZZ_…`); ninguna
prueba se conecta a un proyecto Supabase. Las bases se llaman
`gf_legal_*`, se crean con `construir-base.sh` y se eliminan al final.

| Prueba | Qué cubre |
|---|---|
| `cargador.test.mjs` | Validación de los archivos de `legal/` (campos, nombres, países, marcadores pendientes, vigencias), normalización y hash (Node = Postgres, CRLF, acentos), SQL generado (borradores nunca, `--publicar`, transacción con guarda). Con Postgres: carga hasta `aprobado` (nada visible), publicación y retiro, repetición sin cambios, y aborto sin cambios ante otro texto, script editado, otra referencia de aprobación, otra vigencia, repositorio atrasado, vigencia retroactiva o base sin el esquema; verificación `OK`/`DIFERENTE`/`SOLO_EN_BASE`. |
| `paginas-local.mjs` | Admin compilado + PostgREST + navegador (escritorio y móvil): sin 20261015 (staging hoy) las páginas muestran "pendiente" aunque haya publicados; con 20261015, vigente por país, historial (anterior, retirada, programada), pendientes, versiones que no deben verse, país por URL, con y sin sesión de dos residenciales, `/registro` y `/aceptar-invitacion`, API sin tablas ni escrituras, leer no escribe; ninguna lectura queda en la caché de datos de Next; tras el rollback vuelve "pendiente". |

```bash
export PGHOST=/tmp PGPORT=54329 PGUSER=postgres
node tests/legal/cargador.test.mjs                 # sin Postgres: solo la parte A
GF_POSTGREST_BIN=/ruta/postgrest GF_PLAYWRIGHT_CORE_DIR=/ruta/con/playwright-core \
  node tests/legal/paginas-local.mjs               # compila apps/admin (next build)
npx tsx apps/admin/lib/__tests__/legal-paginas.test.ts   # lectura y Markdown (sin base)
```

Las pruebas SQL de la lectura pública están en `supabase/tests/security/91_*`
y `supabase/tests/grants/98_*` (fase LP de los runners).

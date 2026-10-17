# legal/ — documentos legales versionados

Fuente de los textos que publican `/terminos`, `/privacidad` y
`/acuerdo-datos` (Admin). **Este repositorio no contiene todavía ningún
texto legal:** los borradores se preparan fuera y se incorporan aquí tal
cual, sin cambios de redacción.

| Carpeta | Documento | `identificador` | Página |
|---|---|---|---|
| `terminos/` | Términos y Condiciones | `terminos` | `/terminos` |
| `privacidad/` | Aviso de Privacidad | `privacidad` | `/privacidad` |
| `dpa/` | Acuerdo de Tratamiento de Datos | `acuerdo_tratamiento` | `/acuerdo-datos` |

## Un archivo por versión

`legal/<carpeta>/v<versión>.md` (aplica a los países de `jurisdicciones`)
o `legal/<carpeta>/v<versión>-mx.md` / `-ar.md` (un solo país). Si el
texto de México y el de Argentina difieren, van en archivos separados; si
es el mismo, un solo archivo con `jurisdicciones: [MX, AR]` (se cargan dos
versiones con el mismo hash). No se asume que las obligaciones de ambos
países sean iguales.

```markdown
---
identificador: terminos
version: "1.0"
jurisdicciones: [MX]
estado: borrador
vigente_desde: 2026-11-01T00:00:00-06:00
aprobacion: "Referencia de la aprobación jurídica (quién, documento, fecha)"
requiere_nueva_aceptacion: true
resumen_cambios: "Primera versión."
---
# Título del documento

Texto…
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `identificador` | sí | Debe coincidir con la carpeta (tabla de arriba). |
| `version` | sí | `N.N` (p. ej. `"1.0"`, `"1.1"`). Única por documento y país. |
| `jurisdicciones` | sí | `[MX]`, `[AR]` o `[MX, AR]`. |
| `estado` | sí | `borrador`, `aprobado`, `publicado` o `retirado`. |
| `vigente_desde` | para publicar | Fecha y hora **con zona** (`-06:00` CDMX, `-03:00` Buenos Aires). |
| `aprobacion` | desde `aprobado` | Referencia verificable de la aprobación jurídica. No se inventa. |
| `requiere_nueva_aceptacion` | no (por defecto `true`) | `false` solo para correcciones menores que no exigen volver a aceptar. |
| `resumen_cambios` | no | Se muestra en el historial público. |

El cuerpo admite títulos (`#`, `##`, `###`), párrafos, listas (`-`, `1.`),
**negrita**, *cursiva*, enlaces `[texto](https://…)` o `mailto:` y
separadores (`---`). Se guarda y se hashea (SHA-256) exactamente como
queda tras normalizar saltos de línea; ese hash es el que queda en cada
aceptación.

Un texto con marcadores pendientes solo puede estar en `borrador`: el
validador rechaza aprobarlo, publicarlo o retirarlo y muestra los marcadores
encontrados (los cinco primeros y cuántos más hay).
Cuentan como pendientes, en el cuerpo, en `aprobacion` y en `resumen_cambios`:

- cualquier texto entre corchetes que no sea el de un enlace `[texto](url)`:
  `[NOMBRE LEGAL DEL PRESTADOR]`, `[DOMICILIO LEGAL]`, `[PENDIENTE: …]`,
  `[Razón social]`, `[…]`, `[ ]`. Solo se admiten `[1]` (llamadas numéricas)
  y `[sic]`;
- `{{…}}`, `<<…>>`, `TODO`, `TBD` y líneas para llenar (`____`, cuatro o más).

## Ciclo y carga

1. **Borrador**: el archivo entra con `estado: borrador`. Los borradores
   nunca se cargan en la base ni se muestran en las páginas.
2. **Aprobado**: tras la revisión jurídica, `estado: aprobado` y
   `aprobacion: "…"`. Revisión por PR.
3. **Publicado**: `estado: publicado` y `vigente_desde` (no retroactiva y
   posterior a la versión publicada anterior del mismo documento y país).
4. **Retirado**: `estado: retirado` (sigue consultable en el historial).
   Solo se retira una versión que ya se publicó en la base: una versión
   con vigencia pasada que nunca se publicó no se puede cargar como
   retirada (la base no publica con vigencia retroactiva).

```bash
node scripts/legal/documentos-legales.mjs validar
node scripts/legal/documentos-legales.mjs sql-carga --salida carga.sql             # hasta "aprobado"
node scripts/legal/documentos-legales.mjs sql-carga --publicar --salida carga.sql  # incluye publicar/retirar
node scripts/legal/documentos-legales.mjs sql-verificar [--publicar] --salida verificar.sql
```

El script no se conecta a ninguna base: genera SQL para revisarlo y
ejecutarlo en el SQL Editor del proyecto correcto (primero staging). La
carga es una sola transacción e idempotente: lo que ya está igual no
cambia; si una versión existe con **otro** texto, otra referencia de
aprobación u otra vigencia, aborta sin tocar nada (una versión aprobada o
publicada no se corrige: se crea otra). `sql-verificar` es de solo
lectura y lista `OK`, `DIFERENTE`, `FALTA` o `SOLO_EN_BASE` por versión.

Detalle técnico y seguridad: `docs/operations/LEGAL.md`.

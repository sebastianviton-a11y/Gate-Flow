# Arquitectura de Empresas — cambio estructural

**Fecha:** julio 2026
**Alcance:** preparación de arquitectura para multi-empresa. Sin funciones visibles nuevas en el panel de residencial, admin ni guardia.

## Qué cambió

Se agregó una capa nueva, **Empresa**, por encima de lo que el sistema ya llamaba `tenant` (residencial). Un residencial (`tenants`) ahora pertenece a exactamente una empresa (`empresas`); una empresa puede tener uno o cientos de residenciales.

```
GateFlow
  └─ Empresa               (tabla nueva: empresas)
      └─ Residencial       (tabla existente: tenants, sin cambios de nombre)
          └─ Usuarios      (sin cambios: user_tenants)
              └─ Residentes / Paquetes / Bodega   (sin cambios)
```

## Decisión de arquitectura más importante

**No se renombró `tenants` ni ninguna de sus columnas, políticas RLS o consultas existentes.**

La alternativa —renombrar `tenants` a `residenciales`— habría tocado decenas de archivos: cada `.from("tenants")`, cada columna `tenant_id`, la función `current_tenant_ids()`, cada política de RLS que la usa. Es exactamente el riesgo que la instrucción original pedía evitar ("no romper compatibilidad", "no modificar el flujo de paquetes, residentes, QR, WhatsApp, bodega ni usuarios").

En su lugar: se creó `empresas` como tabla nueva, y se agregó una sola columna nueva, `tenants.empresa_id`, con su llave foránea. Cero líneas de código existente necesitaron cambiar su forma de consultar `tenants` — solo se les agregó información adicional cuando fue necesario mostrarla (ej. qué empresa es dueña de cada residencial en el listado de Super Admin).

## Migración de datos existentes

Automática, dentro de la misma migración SQL (`20260724000000_empresas.sql`):

1. Por cada fila existente en `tenants`, se crea una fila nueva en `empresas` con el mismo nombre, ciudad, estado geográfico y país.
2. Se vincula ese `tenant` a la empresa recién creada.
3. Solo después de que **todos** los residenciales existentes quedan vinculados, la columna `empresa_id` se vuelve obligatoria (`not null`) — así ningún residencial puede quedar nunca sin empresa, ni durante la migración ni después.

No se perdió ningún dato. No se modificó ninguna relación existente (paquetes, unidades, usuarios, historial siguen exactamente igual, todavía enlazados por `tenant_id`).

## Roles preparados para el futuro

Se agregaron 3 claves de rol nuevas al catálogo (`admin_empresa`, `supervisor`, `recepcion`), más las 4 que ya existían (`super_admin`, `admin_residencial`, `guardia`, `residente`). **Solo se agregaron como valores válidos en la base de datos** — ninguno tiene pantallas, permisos ni comportamiento propio todavía. Se agrega `current_empresa_ids()` como función helper (paralela a `current_tenant_ids()`), lista para cuando `admin_empresa` empiece a usarse de verdad, sin necesitar otra migración ese día.

## Qué es visible ahora

- **Super Admin → Empresas** es la nueva pantalla principal (antes era directo a Residenciales). Al entrar a una empresa, se muestran sus residenciales reutilizando la misma tabla que ya existía.
- **Crear residencial** ahora exige elegir a qué empresa pertenece.
- El listado general de Residenciales muestra a qué empresa pertenece cada uno.

## Qué NO cambió

Ningún flujo de paquetes, registro, QR, WhatsApp, bodega, edición de unidades o permisos de guardia/admin_residencial existente. Ningún dato se movió de tabla. Ninguna URL, consulta ni componente de esas áreas fue tocado.

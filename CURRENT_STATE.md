# CURRENT_STATE.md

**Última actualización:** cierre de Sprint 03 (MVP comercial).
**Estado del sprint activo:** `SPRINT 03 — PENDING LOCAL VALIDATION`
**Sprints previos:** 01, 1.5 y 02, todos `PENDING LOCAL VALIDATION` (sin cambios).

## Qué existe ahora mismo en el código

- Dashboard rediseñado: menos tarjetas, tiempo promedio de entrega, alerta de olvidados solo cuando aplica, actividad reciente priorizada sobre el gráfico histórico.
- Configuración del residencial: nombre, logo (por URL), horario de recepción, reglas básicas — conectado a Supabase, usando la columna `tenants.configuracion` ya existente.
- Importación masiva de unidades: plantilla CSV, validación fila por fila, resumen de resultado — conectado a Supabase.
- Nueva columna `unidades.contacto_nombre`/`contacto_telefono` — resuelve la imposibilidad real de crear residentes formales sin cuenta de Auth durante una importación.
- 4 documentos estratégicos nuevos: `PRODUCT_STRATEGY.md`, `SALES_POSITIONING.md`, `MVP_CHECKLIST.md`, `DECISIONS.md`.

## Qué NO existe todavía (bloqueadores reales para un piloto, no solo para la demo)

- Firma digital y evidencia fotográfica en la entrega — el hueco más visible frente a la promesa de venta ("evidencia real").
- Ejecución confirmada de nada, en ningún sprint.
- Notificación real al residente (WhatsApp Business API sin conectar a un proveedor).

Detalle completo, ítem por ítem: `MVP_CHECKLIST.md`.

## Bloqueo activo para pasar a `VALIDATED`

El mismo de siempre — sin red saliente en este entorno.

## Próximo paso

Ejecutar las 9 migraciones, correr `pnpm install && pnpm dev`, validar el flujo real, y decidir si Sprint 04 ataca firma/evidencia fotográfica (el bloqueador de mayor impacto comercial) antes que cualquier otra cosa.

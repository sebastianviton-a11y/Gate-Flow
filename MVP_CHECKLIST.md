# MVP_CHECKLIST.md

Qué tan listo está GateFlow para presentarse a la administración de un residencial piloto. No es un checklist de "sistema terminado" — es de "listo para demo y para operar un piloto real acotado a paquetería".

**Leyenda:** ✅ Terminado · 🔶 Parcial · ⛔ Pendiente · 🚧 Bloqueador real para el piloto (no solo para la demo)

## Flujo de recepción

| Ítem | Estado | Prioridad |
|---|---|---|
| Buscar unidad en segundos | ✅ | — |
| Registrar paquete conectado a Supabase | ✅ | — |
| Código GateFlow único generado automáticamente | ✅ | — |
| QR de confirmación | ✅ | — |
| Asignación a residente formal (con cuenta) | 🔶 — funciona si existe `residentes_unidades`, pero el portal de residente no existe, así que casi nunca habrá una cuenta real todavía | Media |
| Contacto informal (nombre/teléfono sin cuenta) | ✅ (agregado este sprint) | — |

## Flujo de entrega

| Ítem | Estado | Prioridad |
|---|---|---|
| Buscar paquete pendiente | ✅ | — |
| No permitir doble entrega (a nivel de base de datos) | ✅ | — |
| Registrar quién entregó y cuándo | ✅ | — |
| Firma digital | ⛔ | 🚧 — es el hueco más visible frente a BR-27; una administración probablemente pregunte por esto en la primera demo |
| Evidencia fotográfica | ⛔ | 🚧 — mismo caso que firma |

## Dashboard

| Ítem | Estado | Prioridad |
|---|---|---|
| Pendientes, recibidos hoy, entregados hoy | ✅ | — |
| Tiempo promedio de entrega | ✅ (agregado este sprint) | — |
| Alerta de paquetes olvidados (solo cuando aplica) | ✅ (agregado este sprint) | — |
| Actividad reciente | ✅ | — |
| Gráfica de 30 días | 🔶 — depende de refresh manual de la vista materializada, no automatizado | Media |

## Configuración del residencial

| Ítem | Estado | Prioridad |
|---|---|---|
| Nombre editable | ✅ (nuevo) | — |
| Logo por URL | ✅ (nuevo) | — |
| Subida real de archivo de logo | ⛔ | Baja — no bloquea una demo ni un piloto corto |
| Horario de recepción | ✅ (nuevo) | — |
| Reglas básicas para portería | ✅ (nuevo) | — |

## Importación masiva

| Ítem | Estado | Prioridad |
|---|---|---|
| Plantilla descargable | ✅ (nuevo) | — |
| Subida y parseo con validación de errores por fila | ✅ (nuevo) | — |
| Resumen post-importación | ✅ (nuevo) | — |
| Importación de residentes con cuenta formal | ⛔ — no existe portal de residente, así que no hay cuenta que crear | No aplica a este MVP |
| Importación de estructura calle/manzana/edificio | ⛔ — se importa solo el identificador de unidad | Baja, ver `DECISIONS.md` |

## Experiencia visual y de navegación

| Ítem | Estado | Prioridad |
|---|---|---|
| Sistema de diseño consistente (paleta, tipografía) | ✅ | — |
| Dashboard rediseñado para sentirse "ejecutivo" | ✅ (este sprint) | — |
| Auditoría visual completa de las 12 pantallas | ⛔ — se priorizaron las de mayor visibilidad en demo, no las 12 | Media, ver nota abajo |
| Responsive completo en ambas apps | ✅ (Sprint 01/1.5) | — |

**Nota sobre la auditoría visual:** no se rediseñaron las 12 pantallas del sistema en este sprint — se priorizaron dashboard, configuración, unidades e importación, que son las que una demo realmente muestra. Las pantallas de Residentes e Incidencias (todavía stubs vacíos) no se tocaron porque mostrarlas vacías en una demo es una decisión de guion de venta, no un defecto de diseño.

## Bloqueadores reales para un piloto (no solo para la demo)

1. 🚧 **Ningún flujo se ha ejecutado nunca contra un Supabase real** — sigue siendo cierto desde Sprint 01. Antes de la primera reunión con un cliente, esto tiene que dejar de ser cierto.
2. 🚧 **Firma y evidencia fotográfica en la entrega** — no es solo "falta una funcionalidad", es la pieza que sostiene la promesa central de venta ("evidencia real, no solo un registro" — `PRODUCT_STRATEGY.md`).
3. 🔶 **Notificación al residente** — el trigger de negocio (BR-30) exige notificación automática al recibir un paquete; el canal (WhatsApp Business API) sigue sin conectarse a un proveedor real.

## Explícitamente fuera de este sprint (por instrucción directa)

Visitantes, proveedores, amenidades, incidencias completas, reservaciones — no se tocaron, no se evaluaron para este MVP.

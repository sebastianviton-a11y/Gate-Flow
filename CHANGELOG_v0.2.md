# CHANGELOG_v0.2.md — Product Polish

Todos los cambios de este ciclo parten de `UX_REVIEW.md`, la auditoría de producto completa. Aplicado tanto en la app real (`apps/admin`, `apps/guard`) como en la demo interactiva que puedes recorrer ahora mismo.

## Navegación

- **Se quitaron `Incidencias`, `Residentes` y `Usuarios` del menú principal.** No estaban construidas — mostrarlas vacías transmitía "a medio hacer", no "listo para usarse". Las rutas siguen existiendo en el código, no están en el menú. Menú nuevo: `Dashboard`, `Paquetes`, `Unidades`, `Configuración`.
- Justificación completa: `UX_REVIEW.md §1`.

## Dashboard

- **Nueva línea de estado operativo**, en lenguaje natural, arriba de las tarjetas de métricas — "Portería funcionando con normalidad" o "N paquetes requieren atención", calculada a partir de los mismos datos que ya existían. Responde directamente la pregunta que un administrador se hace al abrir el sistema, sin tener que interpretar cuatro números primero.
- La alerta de paquetes olvidados ahora se anuncia a lectores de pantalla (`aria-live="polite"`).

## Flujo de recepción (app de guardia)

- **Reestructurado con revelado progresivo.** Antes, seis campos aparecían todos a la vez apenas se elegía la unidad. Ahora solo **empresa de paquetería** y **ubicación física** (obligatoria) quedan siempre visibles; remitente, número de guía, tamaño, prioridad y notas se agrupan bajo **"Más detalles"**, colapsado por defecto.
- Justificación: menos decisiones visibles = más rápido y con menos carga cognitiva, sin quitar ningún campo que ya existía — solo se reordenó cuándo se ve cada uno.

## Flujo de entrega (app de guardia)

- **Revisado, sin cambios estructurales.** Ya era el flujo más corto posible sin sacrificar evidencia obligatoria (firma). Una auditoría honesta a veces concluye que no hay nada que cambiar — se documenta esa conclusión en vez de cambiar algo por cambiar.

## Microinteracciones y feedback

- Skeleton de carga específico para el listado de Paquetes en admin (antes solo existía uno genérico a nivel de layout).

## Documentos nuevos

- `UX_REVIEW.md` — la auditoría completa que originó estos cambios.
- Este archivo.

---

## Pendiente para v0.3

Ordenado por lo que más se acerca a "listo para el primer cliente piloto":

1. **Firma y evidencia fotográfica completas en `apps/admin`** — hoy la firma se ve en el detalle, pero no hay flujo de captura de foto de evidencia todavía (solo firma). Sigue siendo el hueco de mayor impacto comercial identificado desde `MVP_CHECKLIST.md`.
2. **Mensajes de error más humanos.** Hoy varios errores muestran el mensaje técnico tal cual viene de la base de datos (correcto para no perder información, pero no siempre es el lenguaje que un guardia bajo presión necesita leer). Mapear los errores más frecuentes a mensajes en el tono de la interfaz.
3. **Ejecución real confirmada.** Sigue sin haber una sola corrida de `pnpm install`/`pnpm dev` contra un entorno real, en ningún ciclo hasta ahora — condición para que cualquier "mejora de producto" deje de ser teórica.
4. **Notificación WhatsApp real**, conectando la fila que ya se crea en `notificaciones` a un proveedor real, en vez de quedar en estado "pendiente" indefinidamente.
5. **Reconsiderar si `Configuración` necesita subida real de logo** (hoy es una URL) antes de la primera reunión con un cliente que sí tenga su logo como archivo, no como link.

# UX_REVIEW.md — Auditoría de producto, GateFlow v0.2

Recorrido completo de la aplicación (real + demo interactiva), no del código. Cada hallazgo indica si se implementó ahora o queda para v0.3, y por qué.

---

## 1. Navegación — el hallazgo más importante de esta auditoría

**Lo que encontré poniéndome en los zapatos de un administrador que abre el sistema por primera vez:** el menú lateral mostraba `Incidencias`, `Residentes` y `Usuarios` — tres secciones que, al hacer clic, muestran una pantalla vacía con un mensaje de "esto se conecta después". Eso no transmite "listo para usarse" — transmite "esto está a medio construir", incluso si el resto del sistema funciona perfectamente.

**Decisión: reducir el menú a lo que realmente funciona hoy.** Nuevo menú: `Dashboard`, `Paquetes`, `Unidades`, `Configuración`.

- `Incidencias` se quita — explícitamente fuera de alcance del piloto, no aporta nada mostrarla vacía.
- `Residentes` se quita — la información que mostraría (nombre y teléfono de contacto) ya es visible dentro de `Unidades`, que si está construida; una segunda pantalla para lo mismo es redundancia, no funcionalidad.
- `Usuarios` se quita — no tiene gestión real construida todavía; un administrador que hace clic ahí y ve un vacío pierde confianza en las tres pantallas que sí funcionan.

Esto es exactamente "si encuentras funcionalidades innecesarias, no las desarrolles" aplicado a la navegación: no es que Residentes/Usuarios/Incidencias sean innecesarias como producto futuro — es que *mostrarlas ahora, vacías*, es peor que no mostrarlas.

**Implementado.**

## 2. Dashboard — ¿transmite valor o solo información?

Antes de esta revisión: cuatro tarjetas con números, una gráfica, actividad reciente. Es información correcta, pero un administrador tiene que interpretarla — nadie le dice si su día va bien o mal.

**Cambio:** una línea de estado operativo, en lenguaje natural, arriba de las tarjetas — "Portería funcionando con normalidad" o "3 paquetes requieren atención", calculado a partir de los mismos datos que ya existían (olvidados > 0, o pendientes por encima de un umbral). No es una tarjeta más — es la respuesta directa a la pregunta que un administrador realmente se hace al abrir el sistema: "¿tengo algo de qué preocuparme hoy?"

**Implementado.**

## 3. Flujo de recepción — ¿casi sin pensar?

Con seis campos visibles a la vez apenas se elige la unidad (empresa, remitente, guía, tamaño, prioridad, ubicación, notas), el guardia tiene que *decidir* qué llenar y qué ignorar — eso es fricción cognitiva, aunque técnicamente sea rápido de tocar.

**Cambio:** solo dos cosas quedan siempre visibles después de elegir la unidad: **empresa de paquetería** (selección de un toque, es lo más frecuente) y **ubicación física** (obligatoria, BR-17). Remitente, número de guía, tamaño, prioridad y notas quedan agrupados bajo un enlace **"Más detalles"**, colapsado por defecto — el guardia que solo necesita registrar rápido no ve seis decisiones, ve dos.

**Implementado.**

## 4. Flujo de entrega — "debe ser todavía más simple"

Lo recorrí de nuevo con esa pregunta explícita en mente: buscar → seleccionar → nombre + firma → confirmar. Ya son tres pasos, sin campos opcionales que estorben. No encontré nada que quitar sin sacrificar BR-27 (evidencia obligatoria) — reducirlo más significaría quitar la firma, que es exactamente lo que no se debe quitar.

**No se modificó la estructura.** Es la conclusión correcta de una auditoría, no todas tienen que terminar en un cambio.

## 5. Microinteracciones y sensación de "vivo"

Ya existían animaciones de entrada en las confirmaciones (sprint anterior). Lo que faltaba: la app de administración se sentía estática al navegar entre pantallas de carga.

**Agregado:** loading skeleton específico para el listado de Paquetes (antes solo existía uno genérico a nivel de layout, que no reflejaba la forma real de una tabla).

## 6. Accesibilidad

- La alerta de "olvidados" en el dashboard no se anunciaba a lectores de pantalla al aparecer — se agregó `aria-live="polite"`.
- Revisé los botones de solo-ícono del proyecto: los que ya existían (cerrar sesión, cerrar menú móvil) ya tenían `aria-label`; no encontré ninguno nuevo sin etiquetar en este ciclo.

## 7. Consistencia entre pantallas

Verificado explícitamente: mismos tokens de color, misma tipografía (Space Grotesk/Inter/IBM Plex Mono), mismo componente `EstadoBadge`, mismo patrón de tarjeta con borde + sombra sutil, en las pantallas de ambas apps. No encontré una pantalla que "se sintiera de otro sistema" — el riesgo más real de inconsistencia (las 3 pantallas vacías) se resolvió quitándolas del recorrido normal, no maquillándolas.

## 8. Lo que audité y decidí NO cambiar

- **Paleta y tipografía:** siguen siendo la dirección correcta — cambiarlas ahora sería estética por estética, no una mejora medible.
- **Estructura de tarjetas del dashboard:** el layout (StatCards + actividad + gráfico) ya se rediseñó en el sprint anterior específicamente para sentirse ejecutivo; no encontré una razón real para tocarlo de nuevo, más allá del encabezado de estado agregado en el punto 2.
- **Longitud de los formularios de Configuración e Importación:** ya son cortos; no hay nada que colapsar ahí.

# DESIGN_SYSTEM.md — GateFlow

Sistema de diseño oficial, derivado del brand board aprobado. Reemplaza la paleta "Checkpoint" provisional usada desde Sprint 01 hasta v0.2. Toda pantalla nueva debe respetar esto — no se introducen colores, tipografías ni componentes fuera de lo aquí definido sin actualizar primero este documento.

## Logotipo

Caja central (Amarillo Paquete) rodeada de tres flechas curvas en flujo circular — Verde Flujo, Azul Envío, Naranja Conexión — sobre Azul Profundo. Wordmark: "**Gate** *Flow*" (Gate en color de texto principal/blanco, Flow en Verde Flujo).

Componente: `GateFlowLogo` (`@gateflow/ui`). Nunca se recrea el logo a mano en una pantalla nueva — se importa este componente, con `size`, `withWordmark` y `onDark` según el contexto.

Tagline oficial: *"Envíos que fluyen, conexiones que llegan."* — se usa en pantallas de entrada (login), no dentro de la aplicación autenticada.

## Colores principales

| Token | Hex | HSL | Uso |
|---|---|---|---|
| `--primary` (Verde Flujo) | `#00C49A` | `167 100% 38%` | Acción principal, navegación activa, estado "entregado" — es literalmente el significado de la marca. |
| `--secondary` (Azul Profundo) | `#0D1B2A` | `211 53% 11%` | Sidebar, superficies oscuras, texto principal. |
| `--info` (Azul Envío) | `#1E88E5` | `208 79% 51%` | Información secundaria, enlaces, estados "en tránsito"/"notificado" cuando se necesita distinguir de pendiente. |

## Colores secundarios / funcionales

| Token | Hex | Uso — nunca decorativo |
|---|---|---|
| `--warn` (Amarillo Paquete) | `#FFC107` | Exclusivo para estado "pendiente". |
| `--accent-brand` (Naranja Conexión) | `#FF8A00` | Exclusivo para prioridad/urgencia. |
| `--destructive` | `#E5484D` | Errores, rechazos — no está en el brand board original, se agregó porque todo sistema necesita un color de error; se eligió por armonía con el resto de la paleta. |
| `--success` | Verde Flujo, tono `167 100% 32%` (más oscuro) | Confirmaciones, para contraste de texto suficiente sobre fondos claros. |
| `--muted` / `--background` (Gris Claro) | `#F2F4F7` | Fondos neutros, superficies secundarias. |

**Regla de uso:** un color funcional (warn, destructive, accent-brand) nunca se usa por su valor estético — solo cuando representa exactamente el estado que nombra. El verde primario es la única acción decorativa/de marca libre de usarse en CTAs, navegación, enlaces.

## Tipografía

**Poppins** — única familia, tres pesos, tal como especifica el brand board:

| Rol | Peso | Uso |
|---|---|---|
| Display | Bold (700) / Semibold (600) | Títulos, wordmark, cifras de tarjetas de estadística. |
| Cuerpo | Regular (400) / Medium (500) | Texto de interfaz, párrafos, etiquetas. |
| Código | IBM Plex Mono (400/500) | Códigos GateFlow (`GF-2026-0001234`) — única excepción a Poppins, porque un código necesita alineación monoespaciada para leerse rápido; el brand board no cubre este caso de uso funcional. |

Variables CSS: `--font-display`, `--font-sans`, `--font-mono` — cargadas una sola vez en cada `app/layout.tsx`, nunca declaradas por componente.

## Espaciados

Escala estándar de Tailwind (múltiplos de 0.25rem), sin valores arbitrarios. Densidad por contexto:
- `apps/admin`: `p-4`/`p-5`/`p-6` según jerarquía (tarjeta interna vs. contenedor de página).
- `apps/guard`: base de texto 17px (vs. 16px en admin) y objetivos táctiles `min-h-touch` (3.5rem/56px) — mayores por el contexto de uso operativo, no decorativo.

## Bordes y radios

`--radius: 0.75rem` (12px) en ambas apps — antes 8px en admin, 12px en guard; se unificó a 12px como parte del rebrand para que ambas apps compartan la misma sensación de "suavidad" de marca. Tarjetas y botones usan `rounded-lg`/`rounded-xl` derivados de esta variable, nunca un valor de radio hardcodeado en un componente individual.

## Sombras

Sutiles, nunca decorativas: `shadow-sm` en tarjetas por defecto, `shadow-md` en hover (ej. `StatCard`) para dar sensación de interactividad sin animación. No se usan sombras de color (glow) — no es parte de esta identidad.

## Botones

Componente único: `Button` (`@gateflow/ui`), variantes `default` (Verde Flujo sólido), `secondary` (Azul Profundo), `outline`, `ghost`, `destructive`. Ningún botón se estiliza a mano fuera de este componente — si una pantalla necesita una variante nueva, se agrega al componente, no se improvisa con clases sueltas.

## Inputs

Componente `Input` (`@gateflow/ui`) — borde `border-input`, foco con anillo `--ring` (Verde Flujo). En `apps/guard`, altura mínima `h-12`/`h-14` para uso táctil.

## Cards

Componente `Card` (`@gateflow/ui`) — fondo blanco, borde `border-border`, `shadow-sm`. Las tarjetas de estadística (`StatCard`) agregan `hover:shadow-md` para sensación de vida sin necesitar color.

## Estados

- **Pendiente:** Amarillo Paquete.
- **Notificado:** Azul Envío (distinción visual clara de "pendiente" para quien revisa el dashboard).
- **Entregado:** Verde Flujo.
- **Rechazado/Devuelto:** gris neutro (no ambos ameritan destructive — no son errores del sistema).
- **Vacío:** componente `EmptyState`/patrón de página en blanco con ícono, título y descripción — nunca una tabla vacía sin explicación.
- **Cargando:** `Skeleton` con la forma real del contenido que reemplaza (ver `apps/admin/app/(app)/paquetes/loading.tsx` como referencia), nunca un spinner genérico de página completa salvo en acciones puntuales (botones enviando).

## Iconografía

`lucide-react` en todo el proyecto — trazo delgado (`strokeWidth={2}` por defecto), consistente con el estilo "outline" del brand board (Envíos/caja, Rastreo/pin, Gestión/portapapeles, Transporte/camión, Clientes/persona, Reportes/gráfica). No se mezclan sets de íconos de distinto grosor o relleno.

## Qué NO se hizo (decisión, no olvido)

- No se forzó el color en cada superficie — el fondo por defecto sigue siendo Gris Claro/blanco, no Azul Profundo; el navy vive en sidebar y pantallas de login, donde tiene sentido de marca, no en cada tarjeta.
- No se recreó el logo como imagen importada (PNG/SVG estático) — se construyó como componente SVG en código, para que escale sin pérdida de nitidez y para que el mismo componente sirva de favicon/ícono PWA sin mantener dos versiones.

import { cn } from "./utils";

interface GateFlowLogoProps {
  /** Alto del logo en px. El ancho se deriva de la proporción real del
   *  SVG oficial (nunca se deforma). */
  size?: number;
  /** Muestra el lockup completo (isotipo + wordmark "Gate Flow"). */
  withWordmark?: boolean;
  /** Variante para fondos oscuros (sidebar, login, superadmin) — usa
   *  los archivos oficiales de fondo oscuro. */
  onDark?: boolean;
  className?: string;
}

// Fuente única de verdad: los SVG oficiales entregados por Sebastián,
// servidos sin modificación desde /public/brand/ en cada app (admin y
// guard). Este componente NO dibuja el logo — solo selecciona qué
// archivo oficial mostrar y lo escala proporcionalmente. Prohibido
// reintroducir SVG inline aquí.
const ASSET_BASE = "/brand";

// Proporciones reales de los archivos oficiales. Los cinco comparten el
// mismo alto de viewBox (424.44) y el mismo margen, así que el arte
// ocupa idéntico porcentaje de la caja en todas las variantes.
//
// IMPORTANTE: el isotipo NO es cuadrado (es vertical, 361.44 x 424.44).
// Por eso hay dos constantes y no una sola: usar la del lockup para el
// isotipo lo dejaría con la caja mal dimensionada.
const WORDMARK_ASPECT_RATIO = 1257.39 / 424.44; // ≈ 2.9625
const ISOTIPO_ASPECT_RATIO = 361.44 / 424.44; //  ≈ 0.8516

export function GateFlowLogo({ size = 40, withWordmark = false, onDark = false, className }: GateFlowLogoProps) {
  const src = withWordmark
    ? onDark
      ? `${ASSET_BASE}/logo-dark.svg`
      : `${ASSET_BASE}/logo-full.svg`
    : onDark
      ? `${ASSET_BASE}/isotipo-dark.svg`
      : `${ASSET_BASE}/isotipo.svg`;

  const height = size;
  const width = Math.round(size * (withWordmark ? WORDMARK_ASPECT_RATIO : ISOTIPO_ASPECT_RATIO));

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      width={width}
      height={height}
      alt="Gate Flow"
      className={cn("shrink-0", className)}
    />
  );
}

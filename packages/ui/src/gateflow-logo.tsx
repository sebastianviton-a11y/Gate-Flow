import { cn } from "./utils";

interface GateFlowLogoProps {
  /** Alto del logo en px. El ancho se deriva de la proporción real del
   *  SVG oficial (nunca se deforma). */
  size?: number;
  /** Muestra el lockup completo (isotipo + wordmark "Gate Flow"). */
  withWordmark?: boolean;
  /** Variante para fondos oscuros (sidebar, login, superadmin) — usa
   *  los archivos oficiales de fondo oscuro (wordmark en blanco). */
  onDark?: boolean;
  className?: string;
}

// Fuente única de verdad: los 5 SVG oficiales entregados por Sebastián
// (gateflow-brand-assets.zip), servidos sin modificación desde
// /public/brand/ en cada app (admin y guard). Este componente NO dibuja
// el logo — solo selecciona qué archivo oficial mostrar y lo escala
// proporcionalmente. Prohibido reintroducir SVG inline aquí.
const ASSET_BASE = "/brand";

// Proporción real del lockup horizontal (viewBox 720x220 en los 3
// archivos con wordmark). El isotipo solo es cuadrado (viewBox 200x200).
const WORDMARK_ASPECT_RATIO = 720 / 220;

export function GateFlowLogo({ size = 40, withWordmark = false, onDark = false, className }: GateFlowLogoProps) {
  const src = withWordmark
    ? onDark
      ? `${ASSET_BASE}/logo-dark.svg`
      : `${ASSET_BASE}/logo-full.svg`
    : onDark
      ? `${ASSET_BASE}/isotipo-dark.svg`
      : `${ASSET_BASE}/isotipo.svg`;

  const height = size;
  const width = withWordmark ? Math.round(size * WORDMARK_ASPECT_RATIO) : size;

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

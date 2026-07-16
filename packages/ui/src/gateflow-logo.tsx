import { cn } from "./utils";

interface GateFlowLogoProps {
  /** Tamaño del ícono en px. El texto (si se muestra) escala junto con él. */
  size?: number;
  /** Muestra el wordmark "Gate Flow" junto al ícono. */
  withWordmark?: boolean;
  /** Variante para fondos oscuros (sidebar, login) — el wordmark pasa a blanco/verde. */
  onDark?: boolean;
  className?: string;
}

/**
 * Marca oficial de GateFlow: una caja rodeada de tres flechas curvas en
 * flujo circular (verde, azul, naranja) — la identidad de marca aprobada,
 * reemplaza el ícono genérico (ShieldCheck) usado como placeholder hasta
 * v0.2. El ícono se construye en SVG propio, no como imagen importada,
 * para que escale con nitidez a cualquier tamaño (sidebar, login, favicon).
 */
export function GateFlowLogo({ size = 40, withWordmark = false, onDark = false, className }: GateFlowLogoProps) {
  const boxSize = size * 0.42;

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* Verde Flujo — arco superior */}
        <path d="M 50 8 A 42 42 0 0 1 89 45" stroke="#00C49A" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M 84 33 L 92 47 L 76 46 Z" fill="#00C49A" />
        {/* Azul Envío — arco izquierdo */}
        <path d="M 11 45 A 42 42 0 0 1 37 10" stroke="#1E88E5" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M 25 12 L 8 17 L 18 31 Z" fill="#1E88E5" />
        {/* Naranja Conexión — arco inferior */}
        <path d="M 63 91 A 42 42 0 0 1 12 57" stroke="#FF8A00" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M 76 79 L 68 92 L 58 80 Z" fill="#FF8A00" />
        {/* Caja central */}
        <rect x="30" y="30" width="40" height="40" rx="6" fill="#FFC107" stroke="#0D1B2A" strokeWidth="4" />
        <path d="M30 40 L50 48 L70 40 M50 48 L50 70" stroke="#0D1B2A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>

      {withWordmark && (
        <span className={cn("gf-display text-xl font-bold leading-none tracking-tight", onDark ? "text-white" : "text-secondary")}>
          Gate<span style={{ color: "#00C49A" }}> Flow</span>
        </span>
      )}
    </div>
  );
}

import GateFlowV2 from "@/components/v2/GateFlowV2";

/**
 * Landing pública: la V2 (prueba gratuita de 30 días; "Probar gratis" →
 * /registro del panel Admin). La V1 (components/DesktopLanding.tsx y
 * MobileLanding.tsx, con textos de 7 días) ya no se sirve en ninguna ruta.
 */
export default function LandingPage() {
  return <GateFlowV2 />;
}

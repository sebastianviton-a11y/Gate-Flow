import type { Metadata } from "next";
import GateFlowV2 from "@/components/v2/GateFlowV2";

// Ruta de prueba AISLADA para la V2 en construccion — NO reemplaza ni
// modifica app/page.tsx (que sigue sirviendo la V1 activa). Existe solo
// para poder revisar/testear V2 visualmente contra reference/index.html
// antes de autorizar el cambio V1 -> V2.
export const metadata: Metadata = {
  title: "Gate Flow V2 — Vista previa (no publicada)",
  robots: { index: false, follow: false },
};

export default function V2PreviewPage() {
  return <GateFlowV2 />;
}

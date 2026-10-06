import { AlertTriangle } from "lucide-react";
import { esEntornoStaging } from "@/lib/entorno";

export const TEXTO_AVISO_STAGING_LEGAL = "Documento pendiente de texto legal definitivo. No usar en producción.";

/**
 * Advertencia visible SOLO en staging sobre /terminos y /privacidad:
 * ambos documentos son marcadores sin texto legal aprobado. En
 * producción no se renderiza nada.
 */
export function AvisoStagingLegal() {
  if (!esEntornoStaging()) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm font-medium text-warn">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{TEXTO_AVISO_STAGING_LEGAL}</span>
    </div>
  );
}

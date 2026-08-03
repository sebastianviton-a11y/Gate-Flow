import Link from "next/link";
import { ChevronLeft } from "lucide-react";

interface OperationalHeaderProps {
  title: string;
  backHref?: string;
  /** Cuando se provee, el botón de volver usa el historial del
   * navegador (router.back()) en vez de un href fijo — así se regresa
   * a la pantalla real de origen (por ejemplo, Buscar paquete con su
   * texto y filtro intactos) en vez de siempre ir a /guard. */
  onBack?: () => void;
}

/**
 * Distinto de PageHeader de apps/admin a propósito: incluye navegación
 * de regreso (el guardia no tiene sidebar desde donde volver) y es más
 * compacto — esta app prioriza la acción sobre la descripción.
 */
export function OperationalHeader({ title, backHref = "/guard", onBack }: OperationalHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      {onBack ? (
        <button
          onClick={onBack}
          aria-label="Volver"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : (
        <Link
          href={backHref}
          aria-label="Volver"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
    </div>
  );
}

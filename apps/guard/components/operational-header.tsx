import Link from "next/link";
import { ChevronLeft } from "lucide-react";

interface OperationalHeaderProps {
  title: string;
  backHref?: string;
}

/**
 * Distinto de PageHeader de apps/admin a propósito: incluye navegación
 * de regreso (el guardia no tiene sidebar desde donde volver) y es más
 * compacto — esta app prioriza la acción sobre la descripción.
 */
export function OperationalHeader({ title, backHref = "/guard" }: OperationalHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <Link
        href={backHref}
        aria-label="Volver"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>
    </div>
  );
}

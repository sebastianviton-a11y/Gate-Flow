import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Placeholder para las pantallas cuya data real llega en Sprint 02+.
 * No es un componente temporal descartable: es la base definitiva de
 * "estado vacío" que se reutilizará en todo el producto (listas sin
 * resultados, tenants nuevos sin datos, filtros sin coincidencias).
 */
export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-24 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={2} />
      </span>
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

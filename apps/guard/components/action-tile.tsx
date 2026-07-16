import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@gateflow/ui";

interface ActionTileProps {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone?: "primary" | "default";
}

/**
 * Un solo toque, un solo destino — sin menús intermedios. Es el patrón
 * de navegación primario de esta app (05-UX.md diseñado en la sesión de
 * UX previa: "un botón dominante" para la acción más frecuente, el resto
 * accesible sin fricción alrededor).
 */
export function ActionTile({ href, label, description, icon: Icon, tone = "default" }: ActionTileProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-touch flex-col justify-center gap-1 rounded-2xl border p-5 transition-colors active:scale-[0.98]",
        tone === "primary"
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-muted",
      )}
    >
      <Icon className="h-7 w-7" strokeWidth={2} />
      <span className="font-display text-lg font-semibold leading-tight">{label}</span>
      <span className={cn("text-sm", tone === "primary" ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {description}
      </span>
    </Link>
  );
}

"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "../utils";

/**
 * Botón «?» junto a la etiqueta de un campo que muestra u oculta una
 * explicación breve debajo. Se toca (celular) o se hace clic: no depende
 * de pasar el mouse por encima. Devuelve el botón y el texto como
 * hermanos: el contenedor de la etiqueta debe ser `flex flex-wrap`, y el
 * texto ocupa la línea completa (basis-full).
 */
export function AyudaCampo({
  id,
  etiqueta,
  children,
  className,
  claseTexto,
}: {
  /** Base para los ids (botón y texto). */
  id: string;
  /** Nombre del campo, para el lector de pantalla: «Ayuda sobre <etiqueta>». */
  etiqueta: string;
  children: React.ReactNode;
  className?: string;
  claseTexto?: string;
}) {
  const [abierta, setAbierta] = React.useState(false);
  const idTexto = `${id}-ayuda`;
  return (
    <>
      <button
        type="button"
        aria-label={`Ayuda sobre ${etiqueta}`}
        aria-expanded={abierta}
        aria-controls={idTexto}
        onClick={() => setAbierta((v) => !v)}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>
      <p id={idTexto} hidden={!abierta} className={cn("basis-full text-xs leading-relaxed text-muted-foreground", claseTexto)}>
        {children}
      </p>
    </>
  );
}

"use client";

import * as React from "react";
import { HelpCircle, X } from "lucide-react";
import { Button } from "../button";
import { cn } from "../utils";
import { almacenDelNavegador, claveGuiaVista, guardarMarca, leerMarca } from "./preferencias";

export interface ContenidoGuia {
  /** Identificador estable de la guía (p. ej. "unidades"). */
  clave: string;
  /** Subirla cuando cambie el texto: la guía vuelve a mostrarse una vez. */
  version: number;
  titulo: string;
  pasos: readonly string[];
}

/**
 * Guía breve de una sección. Cerrada se ve como un botón «Cómo funciona»;
 * abierta, como una tarjeta con 2–4 pasos y «Entendido». Con
 * `autoMostrar`, se abre sola la primera vez (y solo la primera: al
 * cerrarla queda marcada en este navegador). Nunca bloquea la pantalla.
 * Se renderiza cerrada en el servidor y decide en el navegador, para no
 * depender del almacenamiento local durante el render.
 */
export function GuiaPrimeraVisita({
  guia,
  usuarioId,
  autoMostrar,
  enlaceAyuda,
  className,
}: {
  guia: ContenidoGuia;
  usuarioId: string;
  autoMostrar: boolean;
  /** Página con toda la ayuda (opcional). */
  enlaceAyuda?: string;
  className?: string;
}) {
  const [abierta, setAbierta] = React.useState(false);
  const clave = claveGuiaVista(guia.clave, guia.version, usuarioId);
  const idPanel = `guia-${guia.clave}`;

  React.useEffect(() => {
    if (autoMostrar && !leerMarca(almacenDelNavegador(), clave)) setAbierta(true);
  }, [autoMostrar, clave]);

  function cerrar() {
    guardarMarca(almacenDelNavegador(), clave, true);
    setAbierta(false);
  }

  if (!abierta) {
    return (
      <div className={className}>
        <button
          type="button"
          data-guia={guia.clave}
          aria-expanded={false}
          onClick={() => setAbierta(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
          Cómo funciona
        </button>
      </div>
    );
  }

  return (
    <section
      id={idPanel}
      aria-label={guia.titulo}
      data-guia-abierta={guia.clave}
      className={cn("relative rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm", className)}
    >
      <button
        type="button"
        onClick={cerrar}
        aria-label="Ocultar la guía"
        className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <h2 className="flex items-center gap-1.5 pr-8 font-semibold">
        <HelpCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {guia.titulo}
      </h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        {guia.pasos.map((paso) => (
          <li key={paso}>{paso}</li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={cerrar}>
          Entendido
        </Button>
        {enlaceAyuda && (
          <a href={enlaceAyuda} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Ver toda la ayuda
          </a>
        )}
      </div>
    </section>
  );
}

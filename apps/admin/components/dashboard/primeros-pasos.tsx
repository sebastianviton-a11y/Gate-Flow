"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Circle, ListChecks } from "lucide-react";
import type { ProgresoConfiguracion } from "@gateflow/paquetes";
import { Button, almacenDelNavegador, clavePrimerosPasosOculto, guardarMarca, leerMarca } from "@gateflow/ui";

/**
 * «Primeros pasos» del Dashboard: el avance real del residencial (lo
 * calcula el servidor con sus datos) y un enlace a cada sección. Son
 * recomendaciones: nada se bloquea por un paso pendiente. Se puede
 * ocultar (por usuario y residencial, en este navegador; se vuelve a
 * mostrar desde Ayuda) y desaparece sola cuando todo está listo.
 */
export function PrimerosPasos({ progreso, usuarioId, tenantId }: { progreso: ProgresoConfiguracion; usuarioId: string; tenantId: string }) {
  const clave = clavePrimerosPasosOculto(usuarioId, tenantId);
  // Se decide en el navegador (la marca vive en localStorage): hasta
  // entonces no se dibuja, para no mostrarla y esconderla de golpe.
  const [visible, setVisible] = useState<boolean | null>(null);
  useEffect(() => setVisible(!leerMarca(almacenDelNavegador(), clave)), [clave]);

  if (progreso.completo || !visible) return null;

  function ocultar() {
    guardarMarca(almacenDelNavegador(), clave, true);
    setVisible(false);
  }

  const porcentaje = Math.round((progreso.completados / progreso.total) * 100);
  return (
    <section aria-labelledby="primeros-pasos-titulo" data-primeros-pasos className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="primeros-pasos-titulo" className="flex items-center gap-2 font-display text-base font-semibold">
            <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" />
            Primeros pasos
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {progreso.completados} de {progreso.total} listos. Son recomendaciones: puedes usar Gate Flow aunque falte alguno.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={ocultar}>
          Ocultar
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progreso.total} aria-valuenow={progreso.completados} aria-label="Avance de la configuración">
        <div className="h-full rounded-full bg-primary" style={{ width: `${porcentaje}%` }} />
      </div>
      <ol className="mt-3 divide-y divide-border">
        {progreso.pasos.map((paso) => (
          <li key={paso.clave} data-paso={paso.clave} data-listo={paso.listo ? "1" : "0"}>
            <Link href={paso.href} className="flex min-h-12 items-center gap-3 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {paso.listo ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${paso.listo ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>
                  {paso.titulo}
                  <span className="sr-only">{paso.listo ? " (listo)" : " (pendiente)"}</span>
                </span>
                <span className="block text-xs text-muted-foreground">{paso.descripcion}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-3 border-t border-border pt-3">
        <Button asChild size="sm" variant="outline">
          <Link href="/onboarding">Continuar con la configuración guiada</Link>
        </Button>
      </div>
    </section>
  );
}

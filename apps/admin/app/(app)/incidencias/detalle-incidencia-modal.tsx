"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { X, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  obtenerDetalleIncidencia,
  TIPO_INCIDENCIA_LABEL,
  NIVEL_DANIO_LABEL,
  type DetalleIncidencia,
  type EstadoIncidencia,
} from "@gateflow/paquetes";
import { EstadoBadge } from "@gateflow/ui";

const ESTADO_RESOLUCION_LABEL: Record<EstadoIncidencia, string> = {
  abierta: "Abierta",
  en_seguimiento: "En seguimiento",
  resuelta: "Resuelta",
};
const ESTADO_RESOLUCION_CLASE: Record<EstadoIncidencia, string> = {
  abierta: "bg-destructive/10 text-destructive",
  en_seguimiento: "bg-warn/10 text-warn-foreground",
  resuelta: "bg-success/10 text-success",
};

interface DetalleIncidenciaModalProps {
  incidenciaId: string;
  paqueteId: string;
  onClose: () => void;
}

/**
 * Modal autocontenido — el módulo Incidencias no necesita salir a
 * ninguna otra ruta para mostrar esto. El único enlace de salida real
 * es el botón explícito "Ir al paquete" del pie, nunca un clic sobre
 * texto dentro del modal.
 */
export function DetalleIncidenciaModal({ incidenciaId, paqueteId, onClose }: DetalleIncidenciaModalProps) {
  const supabase = createBrowserSupabaseClient();
  const [detalle, setDetalle] = useState<DetalleIncidencia | null | undefined>(undefined);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  useEffect(() => {
    obtenerDetalleIncidencia(supabase, incidenciaId, paqueteId)
      .then(setDetalle)
      .catch((e) => {
        console.error("[GateFlow] No se pudo cargar el detalle de la incidencia:", e);
        setDetalle(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidenciaId, paqueteId]);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (fotoAmpliada) setFotoAmpliada(null);
        else onClose();
      }
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onClose, fotoAmpliada]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e: MouseEvent) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-display text-lg font-semibold">Detalle de incidencia</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {detalle === undefined && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {detalle === null && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-6 w-6" />
            No se pudo cargar el detalle de esta incidencia.
          </div>
        )}

        {detalle && (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Datos del paquete
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border bg-background p-4 text-sm">
                <dt className="text-muted-foreground">Residente</dt>
                <dd className="text-right font-medium">{detalle.paquete.residenteNombre ?? "—"}</dd>

                <dt className="text-muted-foreground">Unidad</dt>
                <dd className="text-right font-medium">{detalle.paquete.unidadIdentificador}</dd>

                <dt className="text-muted-foreground">Empresa de paquetería</dt>
                <dd className="text-right font-medium">{detalle.paquete.empresaPaqueteria ?? "—"}</dd>

                <dt className="text-muted-foreground">Fecha y hora de recepción</dt>
                <dd className="text-right font-medium">
                  {new Date(detalle.paquete.fechaRecepcion).toLocaleString("es-MX")}
                </dd>

                <dt className="text-muted-foreground">Guardia que recibió</dt>
                <dd className="text-right font-medium">{detalle.paquete.recibidoPorNombre ?? "—"}</dd>

                <dt className="text-muted-foreground">Estado del paquete</dt>
                <dd className="text-right">
                  <EstadoBadge estado={detalle.paquete.estado} />
                </dd>
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Incidencia</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border bg-background p-4 text-sm">
                <dt className="text-muted-foreground">Tipo de incidencia</dt>
                <dd className="text-right font-medium">{TIPO_INCIDENCIA_LABEL[detalle.incidencia.tipo as keyof typeof TIPO_INCIDENCIA_LABEL] ?? detalle.incidencia.tipo}</dd>

                <dt className="text-muted-foreground">Nivel de daño</dt>
                <dd className="text-right font-medium">
                  {detalle.incidencia.nivelDanio
                    ? NIVEL_DANIO_LABEL[detalle.incidencia.nivelDanio as keyof typeof NIVEL_DANIO_LABEL]
                    : "—"}
                </dd>

                <dt className="col-span-2 text-muted-foreground">Descripción</dt>
                <dd className="col-span-2 font-medium">{detalle.incidencia.descripcion || "—"}</dd>

                <dt className="text-muted-foreground">Estado de resolución</dt>
                <dd className="text-right">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      ESTADO_RESOLUCION_CLASE[detalle.incidencia.estado as EstadoIncidencia]
                    }`}
                  >
                    {ESTADO_RESOLUCION_LABEL[detalle.incidencia.estado as EstadoIncidencia]}
                  </span>
                </dd>

                <dt className="text-muted-foreground">Fecha de resolución</dt>
                <dd className="text-right font-medium">
                  {detalle.incidencia.resueltaEn ? new Date(detalle.incidencia.resueltaEn).toLocaleString("es-MX") : "—"}
                </dd>

                <dt className="col-span-2 text-muted-foreground">Observaciones de resolución</dt>
                <dd className="col-span-2 font-medium">{detalle.incidencia.comentarioResolucion || "—"}</dd>
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidencia</h3>

              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Fotografía original del paquete</p>
                  {detalle.fotografiasPaquete.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin fotografía registrada.</p>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto">
                      {detalle.fotografiasPaquete.map((foto) => (
                        <button key={foto.id} onClick={() => setFotoAmpliada(foto.url)} className="flex-none">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={foto.url}
                            alt="Fotografía original del paquete"
                            className="h-40 w-auto rounded-lg border border-border object-contain"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Fotografías de la incidencia</p>
                  {detalle.incidencia.fotos.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin fotografías de evidencia.</p>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto">
                      {detalle.incidencia.fotos.map((foto) => (
                        <button key={foto.id} onClick={() => setFotoAmpliada(foto.url)} className="flex-none">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={foto.url}
                            alt="Fotografía de la incidencia"
                            className="h-40 w-auto rounded-lg border border-border object-contain"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <div className="flex justify-end border-t border-border pt-4">
              <Link
                href={`/paquetes/${detalle.paquete.id}`}
                className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Ir al paquete <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {fotoAmpliada && (
        <button
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            setFotoAmpliada(null);
          }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fotoAmpliada} alt="Evidencia ampliada" className="max-h-full max-w-full rounded-lg object-contain" />
        </button>
      )}
    </div>
  );
}

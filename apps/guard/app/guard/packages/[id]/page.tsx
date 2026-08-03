"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  obtenerPaquetePorId,
  obtenerHistorial,
  obtenerFirmaEntrega,
  obtenerFotografiasPaquete,
  listarIncidenciasDePaquete,
  type FirmaEntrega,
  type IncidenciaConFotos,
} from "@gateflow/paquetes";
import type { Paquete, PaqueteHistorialEvento, FotografiaPaquete } from "@gateflow/types";
import { EstadoBadge, PackageQRCode, Button } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { useGuardSession } from "@/components/session-provider";
import { AlertTriangle, Camera } from "lucide-react";

const ESTADO_INCIDENCIA_LABEL: Record<string, string> = {
  abierta: "Abierta",
  en_seguimiento: "En seguimiento",
  resuelta: "Resuelta",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente de recepción",
  recibido: "Recibido en portería",
  notificado: "Residente notificado",
  entregado: "Entregado",
  rechazado: "Rechazado",
  devuelto: "Devuelto",
};

export default function GuardPackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();

  const [paquete, setPaquete] = useState<Paquete | null | undefined>(undefined);
  const [historial, setHistorial] = useState<PaqueteHistorialEvento[]>([]);
  const [firma, setFirma] = useState<FirmaEntrega | null>(null);
  const [incidencias, setIncidencias] = useState<IncidenciaConFotos[]>([]);
  const [fotografiasPaquete, setFotografiasPaquete] = useState<FotografiaPaquete[]>([]);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  useEffect(() => {
    obtenerPaquetePorId(supabase, id).then(setPaquete);
    obtenerHistorial(supabase, id).then(setHistorial);
    obtenerFirmaEntrega(supabase, id).then(setFirma);
    obtenerFotografiasPaquete(supabase, id)
      .then(setFotografiasPaquete)
      .catch((e) => console.error("[GateFlow] No se pudieron cargar las fotografías del paquete:", e));
    listarIncidenciasDePaquete(supabase, id)
      .then(setIncidencias)
      .catch((e) => console.error("[GateFlow] No se pudieron cargar las incidencias del paquete:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (paquete === undefined) {
    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Paquete" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (paquete === null) {
    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Paquete" />
        <p className="p-6 text-center text-sm text-muted-foreground">
          No se encontró este paquete en {session.tenant.nombre}.
        </p>
      </div>
    );
  }

  const pendiente = paquete.estado === "recibido" || paquete.estado === "notificado";

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title={paquete.unidadIdentificador} />

      <div className="flex-1 space-y-5 p-4 pb-28">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <EstadoBadge estado={paquete.estado} />
            {incidencias.length > 0 && (
              <span className="flex items-center gap-1 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {incidencias.length === 1 ? "Incidencia" : `Incidencias (${incidencias.length})`}
              </span>
            )}
          </div>
          <span className="gf-code text-muted-foreground">{paquete.codigoGateflow}</span>
        </div>

        <div className="flex justify-center">
          <PackageQRCode codigoGateflow={paquete.codigoGateflow} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm">
          {paquete.residenteNombre && (
            <>
              <dt className="text-muted-foreground">Para</dt>
              <dd className="text-right font-medium">{paquete.residenteNombre}</dd>
            </>
          )}
          {paquete.remitente && (
            <>
              <dt className="text-muted-foreground">Remitente</dt>
              <dd className="text-right font-medium">{paquete.remitente}</dd>
            </>
          )}
          {paquete.empresaPaqueteria && (
            <>
              <dt className="text-muted-foreground">Paquetería</dt>
              <dd className="text-right font-medium">{paquete.empresaPaqueteria}</dd>
            </>
          )}
          {paquete.ubicacionDescripcion && (
            <>
              <dt className="text-muted-foreground">Ubicación</dt>
              <dd className="text-right font-medium">{paquete.ubicacionDescripcion}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Recibido</dt>
          <dd className="text-right font-medium">{new Date(paquete.fechaRecepcion).toLocaleString("es-MX")}</dd>
          {paquete.fechaEntrega && (
            <>
              <dt className="text-muted-foreground">Entregado</dt>
              <dd className="text-right font-medium">{new Date(paquete.fechaEntrega).toLocaleString("es-MX")}</dd>
            </>
          )}
          {paquete.notas && (
            <>
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="text-right font-medium">{paquete.notas}</dd>
            </>
          )}
        </dl>

        {fotografiasPaquete.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Fotografía del paquete</p>
            {fotografiasPaquete.length === 1 ? (
              <button onClick={() => setFotoAmpliada(fotografiasPaquete[0].url)} className="block w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fotografiasPaquete[0].url}
                  alt="Fotografía del paquete"
                  className="w-full rounded-xl border border-border object-contain"
                />
              </button>
            ) : (
              <div className="flex gap-2 overflow-x-auto">
                {fotografiasPaquete.map((foto) => (
                  <button key={foto.id} onClick={() => setFotoAmpliada(foto.url)} className="flex-none">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={foto.url}
                      alt="Fotografía del paquete"
                      className="h-64 w-auto rounded-xl border border-border object-contain"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {firma && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Firma de entrega</p>
            <div className="rounded-xl border border-border bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={firma.firmaData} alt={`Firma de ${firma.firmanteNombre}`} className="mx-auto h-24" />
              <p className="mt-1 text-center text-xs text-muted-foreground">
                {firma.firmanteNombre} · {new Date(firma.creadoEn).toLocaleString("es-MX")}
              </p>
            </div>
          </div>
        )}

        {incidencias.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Incidencias registradas</p>
            <div className="space-y-3">
              {incidencias.map((inc) => (
                <div key={inc.id} className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold capitalize">{inc.tipo.replace(/_/g, " ")}</p>
                    <span className="text-xs font-medium text-muted-foreground">
                      {ESTADO_INCIDENCIA_LABEL[inc.estado] ?? inc.estado}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{inc.descripcion}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {inc.reportadaPorNombre ?? "Guardia"} · {new Date(inc.createdAt).toLocaleString("es-MX")}
                  </p>

                  {inc.resueltaEn && (
                    <div className="mt-2 rounded-lg bg-success/10 p-2 text-xs">
                      <p className="font-medium text-success">
                        Resuelta {new Date(inc.resueltaEn).toLocaleString("es-MX")}
                        {inc.resueltaPorNombre ? ` · ${inc.resueltaPorNombre}` : ""}
                      </p>
                      {inc.comentarioResolucion && <p className="mt-0.5 text-muted-foreground">{inc.comentarioResolucion}</p>}
                    </div>
                  )}

                  {inc.fotos.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Camera className="h-3.5 w-3.5" />
                        Fotografías de la incidencia
                      </p>
                      <div className="flex gap-2 overflow-x-auto">
                        {inc.fotos.map((foto) => (
                          <button key={foto.id} onClick={() => setFotoAmpliada(foto.url)} className="flex-none">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={foto.url}
                              alt="Evidencia de incidencia"
                              className="h-20 w-20 rounded-lg border border-border object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {fotoAmpliada && (
          <button
            onClick={() => setFotoAmpliada(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotoAmpliada} alt="Evidencia ampliada" className="max-h-full max-w-full rounded-lg object-contain" />
          </button>
        )}

        {historial.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Historial</p>
            <div className="space-y-3 border-l-2 border-border pl-4">
              {historial.map((h) => (
                <div key={h.id}>
                  <p className="text-sm font-medium">{ESTADO_LABEL[h.estadoNuevoId] ?? h.estadoNuevoId}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.usuarioNombre} · {new Date(h.creadoEn).toLocaleString("es-MX")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pendiente && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
          <Button onClick={() => router.push("/guard/packages/deliver")} className="min-h-touch w-full text-base">
            Entregar este paquete
          </Button>
        </div>
      )}
    </div>
  );
}

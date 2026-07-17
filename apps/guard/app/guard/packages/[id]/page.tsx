"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { obtenerPaquetePorId, obtenerHistorial, obtenerFirmaEntrega, obtenerFotografiasPaquete, type FirmaEntrega } from "@gateflow/paquetes";
import type { Paquete, PaqueteHistorialEvento, FotografiaPaquete } from "@gateflow/types";
import { EstadoBadge, PackageQRCode, Button } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { useGuardSession } from "@/components/session-provider";

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
  const [fotografias, setFotografias] = useState<FotografiaPaquete[]>([]);

  useEffect(() => {
    obtenerPaquetePorId(supabase, id).then(setPaquete);
    obtenerHistorial(supabase, id).then(setHistorial);
    obtenerFirmaEntrega(supabase, id).then(setFirma);
    obtenerFotografiasPaquete(supabase, id).then(setFotografias);
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
          <EstadoBadge estado={paquete.estado} />
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

        {fotografias.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Fotografías</p>
            <div className="grid grid-cols-2 gap-2">
              {fotografias.map((foto) => (
                <a key={foto.id} href={foto.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto.url} alt={`Evidencia (${foto.tipo})`} className="aspect-square w-full rounded-xl border border-border object-cover" />
                </a>
              ))}
            </div>
          </div>
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

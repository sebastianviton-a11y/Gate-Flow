"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PackageX, Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { listarPendientes } from "@gateflow/paquetes";
import type { Paquete } from "@gateflow/types";
import { EstadoBadge, obtenerMensajeError } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { useGuardSession } from "@/components/session-provider";

function tiempoTranscurrido(fechaISO: string): string {
  const horas = Math.floor((Date.now() - new Date(fechaISO).getTime()) / 3_600_000);
  if (horas < 1) return "hace minutos";
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}

export default function PendingPackagesPage() {
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();

  const [paquetes, setPaquetes] = useState<Paquete[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarPendientes(supabase, session.tenant.id)
      .then(setPaquetes)
      .catch((e) => setError(obtenerMensajeError(e, "No se pudo cargar el listado.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Paquetes pendientes" />

      {error && <p className="m-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {paquetes === null && !error ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : paquetes && paquetes.length > 0 ? (
        <div className="space-y-2 p-4">
          {paquetes.map((p) => (
            <Link
              key={p.id}
              href={`/guard/packages/${p.id}`}
              className="flex min-h-touch items-center justify-between rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted"
            >
              <div>
                <p className="font-medium">{p.unidadIdentificador}</p>
                <p className="text-xs text-muted-foreground">
                  {p.ubicacionDescripcion ?? "Sin ubicación"} · {tiempoTranscurrido(p.fechaRecepcion)}
                </p>
              </div>
              <EstadoBadge estado={p.estado} />
            </Link>
          ))}
        </div>
      ) : (
        paquetes && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <PackageX className="h-6 w-6 text-muted-foreground" strokeWidth={2} />
            </span>
            <h2 className="font-display text-base font-semibold">Sin paquetes pendientes</h2>
          </div>
        )
      )}
    </div>
  );
}

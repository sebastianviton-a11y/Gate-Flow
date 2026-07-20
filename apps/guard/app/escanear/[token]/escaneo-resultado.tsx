"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, PackageCheck, Package } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { entregarPaquete, guardarFirmaEntrega, obtenerFotografiasPaquete } from "@gateflow/paquetes";
import type { Paquete, SessionContext } from "@gateflow/types";
import { Button, Input, EstadoBadge, obtenerMensajeError } from "@gateflow/ui";
import { SignaturePad } from "@/components/signature-pad";

export function EscaneoResultado({
  paquete,
  otrosPendientes,
  session,
}: {
  paquete: Paquete;
  otrosPendientes: Paquete[];
  session: SessionContext;
}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [confirmando, setConfirmando] = useState(false);
  const [entregadoA, setEntregadoA] = useState("");
  const [firma, setFirma] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entregado, setEntregado] = useState(false);

  async function handleConfirmarEntrega() {
    if (!entregadoA.trim() || !firma) return;
    setEnviando(true);
    setError(null);
    try {
      // Igual que en el flujo de entrega normal: la firma se guarda
      // ANTES de la transición de estado — si falla, nunca se intenta
      // la entrega, así que no puede existir una sin evidencia (BR-27).
      await guardarFirmaEntrega(supabase, {
        tenantId: session.tenant.id,
        paqueteId: paquete.id,
        firmaData: firma,
        firmanteNombre: entregadoA.trim(),
      });
      await entregarPaquete(supabase, {
        paqueteId: paquete.id,
        entregadoPor: session.user.id,
        entregadoANombre: entregadoA.trim(),
      });
      setEntregado(true);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo confirmar la entrega."));
    } finally {
      setEnviando(false);
    }
  }

  if (entregado) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-14 w-14 animate-in zoom-in-50 items-center justify-center rounded-full bg-success/10 duration-300">
          <Check className="h-7 w-7 text-success" />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold">{paquete.unidadIdentificador} — entregado</h2>
          <span className="gf-code text-muted-foreground">{paquete.codigoGateflow}</span>
        </div>
        <Button onClick={() => router.push("/guard")} className="min-h-touch w-full max-w-xs text-base">
          Volver al inicio
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4 pb-28">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <PackageCheck className="h-5 w-5 text-primary" />
        </span>
        <h1 className="font-display text-lg font-semibold">Paquete localizado</h1>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
          <div>
            <p className="font-display text-lg font-semibold">{paquete.unidadIdentificador}</p>
            <span className="gf-code text-muted-foreground">{paquete.codigoGateflow}</span>
          </div>
          <EstadoBadge estado={paquete.estado} />
        </div>

        <dl className="grid grid-cols-2 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm">
          {paquete.residenteNombre && (
            <>
              <dt className="text-muted-foreground">Residente</dt>
              <dd className="text-right font-medium">{paquete.residenteNombre}</dd>
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
        </dl>

        {otrosPendientes.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Otros paquetes pendientes para este domicilio
            </p>
            <div className="space-y-1.5">
              {otrosPendientes.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Package className="h-3.5 w-3.5" /> {p.codigoGateflow}
                  </span>
                  <EstadoBadge estado={p.estado} />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Solo se entrega el paquete escaneado — estos no se marcan automáticamente.
            </p>
          </div>
        )}

        {!confirmando ? (
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={() => router.push("/guard")}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={() => setConfirmando(true)}>
              Confirmar entrega
            </Button>
          </div>
        ) : (
          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                ¿Quién recibe? <span className="text-destructive">*</span>
              </p>
              <Input
                autoFocus
                placeholder="Nombre de quien recibe"
                value={entregadoA}
                onChange={(e) => setEntregadoA(e.target.value)}
                className="h-14 text-lg"
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                Firma <span className="text-destructive">*</span>
              </p>
              <SignaturePad onChange={setFirma} />
            </div>
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>

      {confirmando && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
          <Button
            onClick={handleConfirmarEntrega}
            disabled={!entregadoA.trim() || !firma || enviando}
            className="min-h-touch w-full text-base"
          >
            {enviando && <Loader2 className="h-5 w-5 animate-spin" />}
            {enviando ? "Confirmando…" : "Confirmar entrega"}
          </Button>
        </div>
      )}
    </div>
  );
}

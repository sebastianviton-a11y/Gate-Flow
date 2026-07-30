"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check, MapPin, TriangleAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { buscarPaquetes, entregarPaquete, guardarFirmaEntrega, listarIncidenciasDePaquete, type IncidenciaConFotos } from "@gateflow/paquetes";
import type { Paquete } from "@gateflow/types";
import { Button, Input, EstadoBadge, ejecutarConTimeout, obtenerMensajeErrorConTimeout } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { SignaturePad } from "@/components/signature-pad";
import { useGuardSession } from "@/components/session-provider";

export default function DeliverPackagePage() {
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();

  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Paquete[]>([]);
  const [buscando, setBuscando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const [seleccionado, setSeleccionado] = useState<Paquete | null>(null);
  const [entregadoA, setEntregadoA] = useState("");
  const [firmaData, setFirmaData] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entregado, setEntregado] = useState(false);

  // ── Incidencias del paquete seleccionado (punto 6) ───────────────
  const [incidencias, setIncidencias] = useState<IncidenciaConFotos[]>([]);
  const [cargandoIncidencias, setCargandoIncidencias] = useState(false);
  const [confirmoRevision, setConfirmoRevision] = useState(false);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!query.trim() || seleccionado) {
      if (!seleccionado) setResultados([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const data = await buscarPaquetes(supabase, session.tenant.id, query);
        setResultados(data.filter((p) => p.estado === "recibido" || p.estado === "notificado"));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, seleccionado]);

  // Al elegir un paquete, revisar de inmediato si tiene incidencias
  // registradas — con datos reales, nunca asumiendo que no las tiene.
  useEffect(() => {
    if (!seleccionado) {
      setIncidencias([]);
      setConfirmoRevision(false);
      return;
    }
    setCargandoIncidencias(true);
    listarIncidenciasDePaquete(supabase, seleccionado.id)
      .then(setIncidencias)
      .catch((e) => {
        console.error("[GateFlow] No se pudieron cargar las incidencias del paquete:", e);
        setIncidencias([]);
      })
      .finally(() => setCargandoIncidencias(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado]);

  const tieneIncidencias = incidencias.length > 0;

  async function handleConfirmarEntrega() {
    if (!seleccionado || !entregadoA.trim() || !firmaData) return;
    if (tieneIncidencias && !confirmoRevision) return; // No bloquea el flujo general, solo exige revisar la evidencia antes.
    setEnviando(true);
    setError(null);
    try {
      await ejecutarConTimeout(async () => {
        await guardarFirmaEntrega(supabase, {
          tenantId: session.tenant.id,
          paqueteId: seleccionado.id,
          firmaData,
          firmanteNombre: entregadoA.trim(),
        });
        await entregarPaquete(supabase, {
          paqueteId: seleccionado.id,
          entregadoPor: session.user.id,
          entregadoANombre: entregadoA.trim(),
        });
      });
      setEntregado(true);
    } catch (e) {
      setError(obtenerMensajeErrorConTimeout(e, "No se pudo registrar la entrega."));
    } finally {
      setEnviando(false);
    }
  }

  if (entregado && seleccionado) {
    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Paquete entregado" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="flex h-14 w-14 animate-in zoom-in-50 items-center justify-center rounded-full bg-success/10 duration-300">
            <Check className="h-7 w-7 text-success" />
          </span>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h2 className="font-display text-lg font-semibold">{seleccionado.unidadIdentificador} — entregado</h2>
            <span className="gf-code text-muted-foreground">{seleccionado.codigoGateflow}</span>
          </div>
          <Button
            onClick={() => {
              setSeleccionado(null);
              setEntregadoA("");
              setFirmaData(null);
              setEntregado(false);
              setQuery("");
            }}
            className="min-h-touch w-full max-w-xs text-base"
          >
            Entregar otro paquete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Entregar paquete" />

      <div className="flex-1 space-y-4 p-4 pb-28">
        {!seleccionado ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Unidad, nombre o código GateFlow…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-14 pl-11 text-lg"
              />
              {buscando && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>

            {resultados.length > 0 ? (
              <div className="space-y-2">
                {resultados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSeleccionado(p)}
                    className="flex min-h-touch w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
                  >
                    <div>
                      <p className="font-medium">{p.unidadIdentificador}</p>
                      <span className="gf-code text-muted-foreground">{p.codigoGateflow}</span>
                      {p.ubicacionDescripcion && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {p.ubicacionDescripcion}
                        </p>
                      )}
                    </div>
                    <EstadoBadge estado={p.estado} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Busca un paquete pendiente para iniciar la entrega.
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary bg-primary/5 px-4 py-3">
              <p className="font-semibold">{seleccionado.unidadIdentificador}</p>
              <span className="gf-code text-muted-foreground">{seleccionado.codigoGateflow}</span>
            </div>

            {cargandoIncidencias && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Revisando incidencias del paquete…
              </div>
            )}

            {/* ── Advertencia de incidencia (punto 6) ───────────────── */}
            {!cargandoIncidencias && tieneIncidencias && (
              <div className="space-y-3 rounded-xl border border-warn bg-warn/10 p-4">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-5 w-5 flex-none text-warn-foreground" />
                  <p className="text-sm font-medium text-warn-foreground">
                    Este paquete fue recibido con una incidencia registrada. Revisa la evidencia antes de completar la entrega.
                  </p>
                </div>

                <div className="space-y-2">
                  {incidencias.map((inc) => (
                    <div key={inc.id} className="rounded-lg bg-background/60 p-2.5 text-xs">
                      <p className="font-semibold capitalize">{inc.tipo.replace(/_/g, " ")}</p>
                      {inc.descripcion && <p className="mt-0.5 text-muted-foreground">{inc.descripcion}</p>}
                      {inc.fotos.length > 0 && (
                        <div className="mt-2 flex gap-2 overflow-x-auto">
                          {inc.fotos.map((foto) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={foto.id} src={foto.url} alt="Evidencia de incidencia" className="h-16 w-16 flex-none rounded-md border border-border object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <label className="flex min-h-touch items-start gap-2 rounded-lg border border-warn/40 bg-background px-3 py-2">
                  <input
                    type="checkbox"
                    checked={confirmoRevision}
                    onChange={(e) => setConfirmoRevision(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="text-sm">Confirmo que revisé la evidencia de la incidencia antes de entregar.</span>
                </label>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                ¿Quién recibe? <span className="text-destructive">*</span>
              </p>
              <Input autoFocus placeholder="Nombre de quien recibe" value={entregadoA} onChange={(e) => setEntregadoA(e.target.value)} className="h-14 text-lg" />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                Firma <span className="text-destructive">*</span>
              </p>
              <SignaturePad onChange={setFirmaData} />
            </div>

            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>

      {seleccionado && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
          <Button
            onClick={handleConfirmarEntrega}
            disabled={!entregadoA.trim() || !firmaData || enviando || (tieneIncidencias && !confirmoRevision)}
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

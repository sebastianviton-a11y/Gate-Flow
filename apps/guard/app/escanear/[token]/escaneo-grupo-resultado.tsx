"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, PackageCheck, Package, MapPin } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { guardarFirmaEntrega, entregarGrupoPaquetes, type GrupoConPaquetes } from "@gateflow/paquetes";
import type { SessionContext } from "@gateflow/types";
import { Button, Input, ejecutarConTimeout, obtenerMensajeErrorConTimeout } from "@gateflow/ui";
import { SignaturePad } from "@/components/signature-pad";

/**
 * Réplica intencional del patrón de EscaneoResultado (paquete
 * individual) — mismos componentes, mismo manejo de timeout/errores,
 * mismo estilo. La diferencia real es la lista con casillas de
 * selección en vez de un solo paquete, y que la firma se guarda una
 * vez por cada paquete SELECCIONADO (BR §5: "la relación debe quedar
 * registrada en cada paquete", aunque la firma sea una sola captura).
 */
export function EscaneoGrupoResultado({ datos, session }: { datos: GrupoConPaquetes; session: SessionContext }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const paquetesPendientes = datos.paquetes
    .filter((p) => p.estadoId !== "entregado")
    .sort((a, b) => (a.ubicacionRuta ?? "").localeCompare(b.ubicacionRuta ?? ""));
  const paquetesYaEntregados = datos.paquetes.filter((p) => p.estadoId === "entregado");

  // Todos los pendientes empiezan seleccionados, tal como pide la
  // especificación — el guardia desmarca los que el residente no se
  // llevará en este momento.
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set(paquetesPendientes.map((p) => p.id)));
  const [confirmando, setConfirmando] = useState(false);
  const [entregadoA, setEntregadoA] = useState("");
  const [firma, setFirma] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entregado, setEntregado] = useState(false);
  const [cantidadEntregadaAhora, setCantidadEntregadaAhora] = useState(0);

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  async function handleConfirmarEntrega() {
    const idsSeleccionados = Array.from(seleccionados);
    if (!entregadoA.trim() || !firma || idsSeleccionados.length === 0) return;
    setEnviando(true);
    setError(null);
    try {
      await ejecutarConTimeout(async () => {
        // Una sola firma capturada, pero registrada en CADA paquete
        // seleccionado — igual que pide la especificación, sin
        // inventar una tabla nueva de "firma de grupo" separada.
        for (const paqueteId of idsSeleccionados) {
          await guardarFirmaEntrega(supabase, {
            tenantId: session.tenant.id,
            paqueteId,
            firmaData: firma,
            firmanteNombre: entregadoA.trim(),
          });
        }
        await entregarGrupoPaquetes(supabase, datos.grupo.id, idsSeleccionados, session.user.id, entregadoA.trim());
      });
      setCantidadEntregadaAhora(idsSeleccionados.length);
      setEntregado(true);
    } catch (e) {
      setError(obtenerMensajeErrorConTimeout(e, "No se pudo confirmar la entrega."));
    } finally {
      setEnviando(false);
    }
  }

  if (entregado) {
    const quedanPendientes = paquetesPendientes.length - cantidadEntregadaAhora;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-14 w-14 animate-in zoom-in-50 items-center justify-center rounded-full bg-success/10 duration-300">
          <Check className="h-7 w-7 text-success" />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold">
            {datos.unidad.identificador} — {cantidadEntregadaAhora === 1 ? "1 paquete entregado" : `${cantidadEntregadaAhora} paquetes entregados`}
          </h2>
          {quedanPendientes > 0 && (
            <p className="text-sm text-muted-foreground">
              {quedanPendientes === 1 ? "Queda 1 paquete pendiente." : `Quedan ${quedanPendientes} paquetes pendientes.`} El código sigue siendo
              válido para retirarlos después.
            </p>
          )}
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
        <h1 className="font-display text-lg font-semibold">Retiro agrupado</h1>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
          <div>
            <p className="font-display text-lg font-semibold">{datos.unidad.identificador}</p>
            <span className="gf-code text-muted-foreground">{datos.grupo.codigoGrupo}</span>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            {paquetesPendientes.length === 1 ? "1 pendiente" : `${paquetesPendientes.length} pendientes`}
          </span>
        </div>

        {paquetesPendientes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No quedan paquetes pendientes en este grupo.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Paquetes pendientes — desmarca los que no se llevará ahora</p>
            {paquetesPendientes.map((p) => (
              <label
                key={p.id}
                className="flex min-h-touch items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <input
                  type="checkbox"
                  checked={seleccionados.has(p.id)}
                  onChange={() => toggleSeleccion(p.id)}
                  className="h-5 w-5 flex-none accent-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="gf-code font-medium">{p.codigoGateflow}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    {p.ubicacionRuta ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        <MapPin className="h-3 w-3" />
                        {p.ubicacionRuta}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin ubicación registrada</span>
                    )}
                    {p.empresaPaqueteriaNombre && <span className="text-xs text-muted-foreground">{p.empresaPaqueteriaNombre}</span>}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {paquetesYaEntregados.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Ya entregados en este grupo</p>
            <div className="space-y-1.5">
              {paquetesYaEntregados.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-sm opacity-60">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Package className="h-3.5 w-3.5" /> {p.codigoGateflow}
                  </span>
                  <Check className="h-3.5 w-3.5 text-success" />
                </div>
              ))}
            </div>
          </div>
        )}

        {paquetesPendientes.length > 0 && !confirmando ? (
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={() => router.push("/guard")}>
              Cancelar
            </Button>
            <Button className="flex-1" disabled={seleccionados.size === 0} onClick={() => setConfirmando(true)}>
              Entregar {seleccionados.size === 1 ? "1 paquete" : `${seleccionados.size} paquetes`}
            </Button>
          </div>
        ) : confirmando ? (
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
        ) : null}
      </div>

      {confirmando && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
          <Button
            onClick={handleConfirmarEntrega}
            disabled={!entregadoA.trim() || !firma || enviando || seleccionados.size === 0}
            className="min-h-touch w-full text-base"
          >
            {enviando && <Loader2 className="h-5 w-5 animate-spin" />}
            {enviando ? "Confirmando…" : `Entregar ${seleccionados.size === 1 ? "1 paquete" : `${seleccionados.size} paquetes`}`}
          </Button>
        </div>
      )}
    </div>
  );
}

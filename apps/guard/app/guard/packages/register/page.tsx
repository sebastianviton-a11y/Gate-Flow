"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  registrarPaquete,
  buscarUnidades,
  obtenerCatalogos,
  subirFotografiaPaquete,
  construirEnlaceWhatsApp,
  construirMensajeNotificacion,
  construirUrlEscaneo,
  construirUrlVerQr,
  type Catalogos,
  type UbicacionItem,
  type ResultadoRegistro,
} from "@gateflow/paquetes";
import type { UnidadConResidentes } from "@gateflow/types";
import { Button, Input, PickupShareCard, obtenerMensajeError } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { PhotoCapture } from "@/components/photo-capture";
import { useGuardSession } from "@/components/session-provider";

export default function RegisterPackagePage() {
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();

  const [query, setQuery] = useState("");
  const [unidades, setUnidades] = useState<UnidadConResidentes[]>([]);
  const [buscando, setBuscando] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const [unidadSeleccionada, setUnidadSeleccionada] = useState<UnidadConResidentes | null>(null);
  const [residenteId, setResidenteId] = useState<string | null>(null);

  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [empresaId, setEmpresaId] = useState<string>("");
  const [remitente, setRemitente] = useState("");
  const [numeroGuia, setNumeroGuia] = useState("");
  const [tamanoId, setTamanoId] = useState<string>("");
  const [prioridadId, setPrioridadId] = useState<string>("");
  const [ubicacionId, setUbicacionId] = useState<string>("");
  const [notas, setNotas] = useState("");
  const [foto, setFoto] = useState<File | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<ResultadoRegistro | null>(null);
  const [masDetalles, setMasDetalles] = useState(false);

  useEffect(() => {
    obtenerCatalogos(supabase, session.tenant.id)
      .then(setCatalogos)
      .catch((e) => setError(e.message ?? "No se pudieron cargar los catálogos del residencial."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (unidadSeleccionada) return;
    window.clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setUnidades([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const resultado = await buscarUnidades(supabase, session.tenant.id, query);
        setUnidades(resultado);
      } catch {
        setUnidades([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, unidadSeleccionada]);

  function reiniciar() {
    setQuery("");
    setUnidades([]);
    setUnidadSeleccionada(null);
    setResidenteId(null);
    setEmpresaId("");
    setRemitente("");
    setNumeroGuia("");
    setTamanoId("");
    setPrioridadId("");
    setUbicacionId("");
    setNotas("");
    setFoto(null);
    setError(null);
    setConfirmacion(null);
  }

  async function handleConfirmar() {
    if (!unidadSeleccionada || !ubicacionId) return; // BR-17: ubicación obligatoria
    setEnviando(true);
    setError(null);
    try {
      const resultado = await registrarPaquete(supabase, {
        tenantId: session.tenant.id,
        unidadId: unidadSeleccionada.id,
        residenteId,
        remitente: remitente || null,
        empresaPaqueteriaId: empresaId || null,
        numeroGuia: numeroGuia || null,
        tamanoId: tamanoId || null,
        prioridadId: prioridadId || null,
        ubicacionId,
        notas: notas || null,
        recibidoPor: session.user.id,
        destinatarioNombre: residenteId ? null : unidadSeleccionada.contactoNombre,
        destinatarioTelefono: residenteId ? null : unidadSeleccionada.contactoTelefono,
      });
      setConfirmacion(resultado);

      // La foto es opcional (no bloquea el registro, BR-17 solo exige
      // ubicación) — si falla la subida, el paquete ya quedó registrado
      // correctamente; se registra el error en consola, no se le muestra
      // al guardia como si el registro completo hubiera fallado.
      if (foto) {
        try {
          await subirFotografiaPaquete(supabase, {
            tenantId: session.tenant.id,
            paqueteId: resultado.paquete.id,
            tipo: "recepcion",
            archivo: foto,
            tomadaPor: session.user.id,
          });
        } catch (fotoError) {
          console.error("[GateFlow] No se pudo subir la fotografía de recepción:", fotoError);
        }
      }
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo registrar el paquete. Intenta de nuevo."));
    } finally {
      setEnviando(false);
    }
  }

  if (confirmacion) {
    const { paquete, notificacion } = confirmacion;
    const nombreDestinatario = notificacion?.destinatario ?? "residente";
    // NEXT_PUBLIC_GUARD_APP_URL es la URL pública real de este sitio en
    // Netlify — nunca un dominio temporal escrito en el código. Si
    // todavía no se configuró (ej. en desarrollo local), se usa el
    // origin del navegador como respaldo razonable.
    const baseUrl = process.env.NEXT_PUBLIC_GUARD_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
    const scanUrl = paquete.pickupToken ? construirUrlEscaneo(paquete.pickupToken, baseUrl) : "";
    const urlVerQr = paquete.pickupToken ? construirUrlVerQr(paquete.pickupToken, baseUrl) : undefined;
    const mensaje = construirMensajeNotificacion(paquete, session.tenant.nombre, nombreDestinatario, urlVerQr);
    const enlaceWhatsApp = notificacion
      ? construirEnlaceWhatsApp(paquete, session.tenant.nombre, notificacion.destinatario, urlVerQr)
      : null;

    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Paquete registrado" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="flex h-14 w-14 animate-in zoom-in-50 items-center justify-center rounded-full bg-success/10 duration-300">
            <Check className="h-7 w-7 text-success" />
          </span>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h2 className="font-display text-lg font-semibold">Registrado — {paquete.unidadIdentificador}</h2>
            {notificacion ? (
              <p className="text-sm text-muted-foreground">Notificación en cola para {notificacion.destinatario}.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Sin residente asociado — no se generó notificación.</p>
            )}
          </div>

          {scanUrl && (
            <div className="animate-in fade-in zoom-in-95 duration-300">
              <PickupShareCard
                scanUrl={scanUrl}
                codigoGateflow={paquete.codigoGateflow}
                mensaje={mensaje}
                whatsappUrl={enlaceWhatsApp?.url ?? null}
              />
            </div>
          )}

          <Button onClick={reiniciar} className="min-h-touch w-full max-w-xs text-base">
            <RotateCcw className="h-4 w-4" />
            Registrar otro paquete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Registrar paquete" />

      <div className="flex-1 space-y-5 p-4 pb-28">
        {!unidadSeleccionada ? (
          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Unidad o nombre del residente…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-14 pl-11 text-lg"
              />
              {buscando && (
                <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            {unidades.length > 0 && (
              <div className="mt-3 space-y-2">
                {unidades.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setUnidadSeleccionada(u)}
                    className="min-h-touch flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
                  >
                    <span className="font-medium">{u.identificador}</span>
                    <span className="text-sm text-muted-foreground">
                      {u.residentes.length > 0
                        ? u.residentes[0]!.nombreCompleto
                        : (u.contactoNombre ?? "Sin residente registrado")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={() => {
                setUnidadSeleccionada(null);
                setResidenteId(null);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-primary bg-primary/5 px-4 py-3 text-left"
            >
              <span className="font-semibold">{unidadSeleccionada.identificador}</span>
              <span className="text-xs text-primary">Cambiar</span>
            </button>

            {unidadSeleccionada.residentes.length > 1 && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-muted-foreground">¿Para quién es? (opcional)</p>
                <div className="flex flex-wrap gap-2">
                  {unidadSeleccionada.residentes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setResidenteId(residenteId === r.id ? null : r.id)}
                      className={`min-h-touch rounded-full border px-4 text-sm ${
                        residenteId === r.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                      }`}
                    >
                      {r.nombreCompleto}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Empresa de paquetería</p>
              <div className="flex flex-wrap gap-2">
                {(catalogos?.empresasPaqueteria ?? []).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEmpresaId(empresaId === e.id ? "" : e.id)}
                    className={`min-h-touch rounded-full border px-4 text-sm ${
                      empresaId === e.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                    }`}
                  >
                    {e.nombre}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                Ubicación física <span className="text-destructive">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {(catalogos?.ubicaciones ?? []).map((u: UbicacionItem) => (
                  <button
                    key={u.id}
                    onClick={() => setUbicacionId(ubicacionId === u.id ? "" : u.id)}
                    className={`min-h-touch rounded-full border px-4 text-sm ${
                      ubicacionId === u.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                    }`}
                  >
                    {u.nombre}
                  </button>
                ))}
                {catalogos && catalogos.ubicaciones.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Este residencial no tiene ubicaciones configuradas todavía (Configuración, en apps/admin).
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Fotografía (opcional)</p>
              <PhotoCapture onChange={setFoto} />
            </div>

            {/* UX_REVIEW.md §3: solo empresa y ubicación quedan siempre
                visibles — remitente, guía, tamaño, prioridad y notas rara
                vez son críticos para registrar en segundos, así que se
                colapsan por defecto en vez de competir por atención. */}
            <button
              type="button"
              onClick={() => setMasDetalles((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-primary"
            >
              {masDetalles ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Más detalles (opcional)
            </button>

            {masDetalles && (
              <div className="animate-in fade-in slide-in-from-top-1 space-y-4 duration-200">
                <Input
                  placeholder="Remitente (opcional, si es una persona)"
                  value={remitente}
                  onChange={(e) => setRemitente(e.target.value)}
                  className="h-12"
                />
                <Input
                  placeholder="Número de guía (opcional)"
                  value={numeroGuia}
                  onChange={(e) => setNumeroGuia(e.target.value)}
                  className="h-12"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted-foreground">Tamaño</p>
                    <div className="flex flex-wrap gap-2">
                      {(catalogos?.tamanos ?? []).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTamanoId(tamanoId === t.id ? "" : t.id)}
                          className={`min-h-touch rounded-full border px-3 text-sm ${
                            tamanoId === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                          }`}
                        >
                          {t.nombre}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted-foreground">Prioridad</p>
                    <div className="flex flex-wrap gap-2">
                      {(catalogos?.prioridades ?? []).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPrioridadId(prioridadId === p.id ? "" : p.id)}
                          className={`min-h-touch rounded-full border px-3 text-sm ${
                            prioridadId === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
                          }`}
                        >
                          {p.nombre}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <Input placeholder="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} className="h-12" />
              </div>
            )}

            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </>
        )}
      </div>

      {unidadSeleccionada && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
          <Button onClick={handleConfirmar} disabled={!ubicacionId || enviando} className="min-h-touch w-full text-base">
            {enviando && <Loader2 className="h-5 w-5 animate-spin" />}
            {enviando ? "Registrando…" : "Confirmar recepción"}
          </Button>
        </div>
      )}
    </div>
  );
}

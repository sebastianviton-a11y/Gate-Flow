"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Check, RotateCcw, ChevronDown, ChevronUp, Users, TriangleAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  registrarPaquete,
  registrarPaqueteConIncidencia,
  buscarUnidades,
  obtenerCatalogos,
  obtenerPaquetePorId,
  subirFotografiaPaquete,
  subirFotografiaIncidencia,
  construirEnlaceWhatsApp,
  construirMensajeNotificacion,
  construirUrlEscaneo,
  construirUrlVerQr,
  buscarGrupoAbiertoDeUnidad,
  obtenerOCrearGrupoEntrega,
  crearGrupoEntregaSeparado,
  ligarPaqueteAGrupo,
  obtenerGrupoEntrega,
  marcarWhatsappGrupoEnviado,
  construirMensajeNotificacionGrupo,
  construirEnlaceWhatsAppGrupo,
  TIPO_INCIDENCIA_LABEL,
  NIVEL_DANIO_LABEL,
  type Catalogos,
  type UbicacionItem,
  type ResultadoRegistro,
  type GrupoEntrega,
  type TipoIncidencia,
  type NivelDanio,
} from "@gateflow/paquetes";
import type { UnidadConResidentes } from "@gateflow/types";
import { Button, Input, PickupShareCard, ejecutarConTimeout, obtenerMensajeErrorConTimeout } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { PhotoCapture } from "@/components/photo-capture";
import { PhotoCaptureMultiple } from "@/components/photo-capture-multiple";
import { useGuardSession } from "@/components/session-provider";

type DecisionAgrupacion = "existente" | "separado";
type EstadoPaquete = "bueno" | "incidencia";

const TIPOS_INCIDENCIA_REGISTRO: TipoIncidencia[] = ["golpeado", "abierto", "roto", "mojado", "empaque_deteriorado", "contenido_incompleto", "otro"];
const NIVELES: NivelDanio[] = ["leve", "moderado", "grave"];

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

  // ── Estado del paquete / incidencia al recibir ───────────────────
  const [estadoPaquete, setEstadoPaquete] = useState<EstadoPaquete>("bueno");
  const [tipoIncidencia, setTipoIncidencia] = useState<TipoIncidencia | "">("");
  const [descripcionIncidencia, setDescripcionIncidencia] = useState("");
  const [nivelDanio, setNivelDanio] = useState<NivelDanio | "">("");
  const [fotosIncidencia, setFotosIncidencia] = useState<File[]>([]);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<ResultadoRegistro | null>(null);
  const [masDetalles, setMasDetalles] = useState(false);

  const [grupoAbierto, setGrupoAbierto] = useState<GrupoEntrega | null>(null);
  const [mostrarPromptAgrupacion, setMostrarPromptAgrupacion] = useState(false);
  const [decisionAgrupacion, setDecisionAgrupacion] = useState<DecisionAgrupacion | null>(null);
  const [grupoActivoId, setGrupoActivoId] = useState<string | null>(null);
  const [grupoActivo, setGrupoActivo] = useState<GrupoEntrega | null>(null);
  const [paquetesEnSesion, setPaquetesEnSesion] = useState(0);
  const [pasoPostGuardado, setPasoPostGuardado] = useState(false);
  const [flujoTerminado, setFlujoTerminado] = useState(false);
  const [enviandoNotificacion, setEnviandoNotificacion] = useState(false);

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

  useEffect(() => {
    if (!unidadSeleccionada) {
      setGrupoAbierto(null);
      return;
    }
    buscarGrupoAbiertoDeUnidad(supabase, session.tenant.id, unidadSeleccionada.id)
      .then((grupo) => setGrupoAbierto(grupo && grupo.cantidadTotal > 0 ? grupo : null))
      .catch(() => setGrupoAbierto(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidadSeleccionada]);

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
    setEstadoPaquete("bueno");
    setTipoIncidencia("");
    setDescripcionIncidencia("");
    setNivelDanio("");
    setFotosIncidencia([]);
    setError(null);
    setConfirmacion(null);
    setGrupoAbierto(null);
    setMostrarPromptAgrupacion(false);
    setDecisionAgrupacion(null);
    setGrupoActivoId(null);
    setGrupoActivo(null);
    setPaquetesEnSesion(0);
    setPasoPostGuardado(false);
    setFlujoTerminado(false);
  }

  function limpiarCamposPaquete() {
    setEmpresaId("");
    setRemitente("");
    setNumeroGuia("");
    setTamanoId("");
    setPrioridadId("");
    setUbicacionId("");
    setNotas("");
    setFoto(null);
    setEstadoPaquete("bueno");
    setTipoIncidencia("");
    setDescripcionIncidencia("");
    setNivelDanio("");
    setFotosIncidencia([]);
    setError(null);
  }

  function handleClickConfirmar() {
    if (!unidadSeleccionada || !ubicacionId) return;
    if (estadoPaquete === "incidencia" && (!tipoIncidencia || !nivelDanio)) return;
    if (grupoAbierto && !decisionAgrupacion) {
      setMostrarPromptAgrupacion(true);
      return;
    }
    void registrarYAgrupar();
  }

  async function registrarYAgrupar() {
    if (!unidadSeleccionada || !ubicacionId) return;
    if (estadoPaquete === "incidencia" && (!tipoIncidencia || !nivelDanio)) return;
    setEnviando(true);
    setError(null);
    try {
      let paqueteId: string;
      let resultado: ResultadoRegistro;

      if (estadoPaquete === "incidencia" && tipoIncidencia && nivelDanio) {
        // ── Registro con incidencia: transacción atómica vía RPC ──
        const { paqueteId: idCreado, incidenciaId } = await ejecutarConTimeout(() =>
          registrarPaqueteConIncidencia(supabase, {
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
            tipoIncidencia,
            descripcionIncidencia: descripcionIncidencia || null,
            nivelDanio,
          }),
        );
        paqueteId = idCreado;

        // Subir todas las fotos de evidencia — un fallo aquí no
        // revierte el paquete ni la incidencia, ya quedaron registrados
        // (mismo criterio que ya usa el flujo manual de incidencias).
        for (const archivoEvidencia of fotosIncidencia) {
          try {
            await subirFotografiaIncidencia(supabase, {
              tenantId: session.tenant.id,
              incidenciaId,
              archivo: archivoEvidencia,
              tomadaPor: session.user.id,
            });
          } catch (fotoError) {
            console.error("[GateFlow] No se pudo subir una fotografía de evidencia:", fotoError);
          }
        }

        const paquete = await obtenerPaquetePorId(supabase, paqueteId);
        if (!paquete) throw new Error("El paquete se creó pero no se pudo releer — revisar RLS de SELECT.");

        // Notificación al residente — igual criterio que registrarPaquete:
        // un fallo aquí no debe hacer fallar el registro ya consumado.
        let notificacion: ResultadoRegistro["notificacion"] = null;
        const destinatarioNombre = paquete.residenteNombre ?? (residenteId ? null : unidadSeleccionada.contactoNombre);
        if (destinatarioNombre) {
          const { error: errorNotif } = await supabase.from("notificaciones").insert({
            tenant_id: session.tenant.id,
            paquete_id: paquete.id,
            destinatario_user_id: residenteId ?? null,
            destinatario_nombre: residenteId ? null : destinatarioNombre,
            destinatario_telefono: residenteId ? null : (unidadSeleccionada.contactoTelefono ?? null),
            canal: "whatsapp",
            plantilla: "paquete_recibido",
            contenido: `Hola ${destinatarioNombre}, tu paquete con código ${paquete.codigoGateflow} llegó a portería.`,
            estado_envio: "pendiente",
          });
          if (!errorNotif) notificacion = { destinatario: destinatarioNombre, canal: "whatsapp" };
        }

        resultado = { paquete, notificacion };
      } else {
        // ── Registro normal, sin incidencia (flujo existente intacto) ──
        resultado = await ejecutarConTimeout(() =>
          registrarPaquete(supabase, {
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
          }),
        );
        paqueteId = resultado.paquete.id;
      }

      setConfirmacion(resultado);

      if (foto) {
        try {
          await subirFotografiaPaquete(supabase, {
            tenantId: session.tenant.id,
            paqueteId,
            tipo: "recepcion",
            archivo: foto,
            tomadaPor: session.user.id,
          });
        } catch (fotoError) {
          console.error("[GateFlow] No se pudo subir la fotografía de recepción:", fotoError);
        }
      }

      let idGrupo = grupoActivoId;
      if (!idGrupo) {
        const decision: DecisionAgrupacion = decisionAgrupacion ?? "existente";
        idGrupo =
          decision === "separado"
            ? await crearGrupoEntregaSeparado(supabase, session.tenant.id, unidadSeleccionada.id, residenteId)
            : await obtenerOCrearGrupoEntrega(supabase, session.tenant.id, unidadSeleccionada.id, residenteId);
        setGrupoActivoId(idGrupo);
      }
      await ligarPaqueteAGrupo(supabase, paqueteId, idGrupo);
      const grupoActualizado = await obtenerGrupoEntrega(supabase, idGrupo);
      setGrupoActivo(grupoActualizado);

      setPaquetesEnSesion((n) => n + 1);
      setMostrarPromptAgrupacion(false);
      setPasoPostGuardado(true);
    } catch (e) {
      setError(obtenerMensajeErrorConTimeout(e, "No se pudo registrar el paquete. Intenta de nuevo."));
    } finally {
      setEnviando(false);
    }
  }

  function handleAgregarOtroPaquete() {
    limpiarCamposPaquete();
    setPasoPostGuardado(false);
    setConfirmacion(null);
  }

  function nombreDestinatarioActual(): string {
    if (residenteId) {
      const r = unidadSeleccionada?.residentes.find((r) => r.id === residenteId);
      if (r) return r.nombreCompleto;
    }
    return unidadSeleccionada?.contactoNombre ?? "residente";
  }

  async function handleEnviarNotificacion() {
    if (!grupoActivo || !unidadSeleccionada) return;
    setEnviandoNotificacion(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_GUARD_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const urlVerQr = construirUrlVerQr(grupoActivo.token, baseUrl);
      const mensaje = construirMensajeNotificacionGrupo(
        grupoActivo.cantidadTotal,
        session.tenant.nombre,
        nombreDestinatarioActual(),
        grupoActivo.codigoGrupo ?? grupoActivo.token,
        urlVerQr,
      );
      const enlace = construirEnlaceWhatsAppGrupo(unidadSeleccionada.contactoTelefono ?? null, mensaje);
      if (enlace) window.open(enlace.url, "_blank");
      await marcarWhatsappGrupoEnviado(supabase, grupoActivo.id);
      setGrupoActivo({ ...grupoActivo, whatsappEnviado: true });
    } catch (e) {
      console.error("[GateFlow] No se pudo enviar la notificación agrupada:", e);
    } finally {
      setEnviandoNotificacion(false);
      setPasoPostGuardado(false);
      setFlujoTerminado(true);
    }
  }

  function handleGuardarSinNotificar() {
    setPasoPostGuardado(false);
    setFlujoTerminado(true);
  }

  if (grupoActivo && flujoTerminado) {
    const baseUrl = process.env.NEXT_PUBLIC_GUARD_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
    const scanUrl = construirUrlEscaneo(grupoActivo.token, baseUrl);
    const urlVerQr = construirUrlVerQr(grupoActivo.token, baseUrl);
    const nombreDestinatario = nombreDestinatarioActual();
    const mensaje = construirMensajeNotificacionGrupo(
      grupoActivo.cantidadTotal,
      session.tenant.nombre,
      nombreDestinatario,
      grupoActivo.codigoGrupo ?? grupoActivo.token,
      urlVerQr,
    );
    const enlaceWhatsApp = construirEnlaceWhatsAppGrupo(unidadSeleccionada?.contactoTelefono ?? null, mensaje);

    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Paquetes registrados" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="flex h-14 w-14 animate-in zoom-in-50 items-center justify-center rounded-full bg-success/10 duration-300">
            <Check className="h-7 w-7 text-success" />
          </span>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h2 className="font-display text-lg font-semibold">
              {grupoActivo.cantidadTotal === 1 ? "1 paquete" : `${grupoActivo.cantidadTotal} paquetes`} — {unidadSeleccionada?.identificador}
            </h2>
            <p className="text-sm text-muted-foreground">
              {grupoActivo.whatsappEnviado ? `Notificación enviada a ${nombreDestinatario}.` : "Sin notificación enviada."}
            </p>
          </div>
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <PickupShareCard
              scanUrl={scanUrl}
              codigoGateflow={grupoActivo.codigoGrupo ?? grupoActivo.token}
              mensaje={mensaje}
              whatsappUrl={enlaceWhatsApp?.url ?? null}
            />
          </div>
          <Button onClick={reiniciar} className="min-h-touch w-full max-w-xs text-base">
            <RotateCcw className="h-4 w-4" />
            Registrar otro paquete
          </Button>
        </div>
      </div>
    );
  }

  if (pasoPostGuardado && grupoActivo) {
    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Paquete guardado" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <Check className="h-7 w-7 text-success" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold">
              {unidadSeleccionada?.identificador} — {grupoActivo.cantidadTotal === 1 ? "1 paquete pendiente" : `${grupoActivo.cantidadTotal} paquetes pendientes`}
            </h2>
            <p className="text-sm text-muted-foreground">Paquetes registrados en esta sesión: {paquetesEnSesion}</p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button variant="outline" onClick={handleAgregarOtroPaquete} className="min-h-touch w-full text-base">
              Guardar y agregar otro paquete
            </Button>
            <Button onClick={handleEnviarNotificacion} disabled={enviandoNotificacion} className="min-h-touch w-full text-base">
              {enviandoNotificacion && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar y enviar notificación
            </Button>
            <button onClick={handleGuardarSinNotificar} className="mt-1 text-sm text-muted-foreground underline">
              Guardar sin notificar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const puedeConfirmar = !!ubicacionId && !enviando && (estadoPaquete === "bueno" || (!!tipoIncidencia && !!nivelDanio));

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Registrar paquete" />
      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-28">
        {!unidadSeleccionada ? (
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar unidad, residente o teléfono…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-14 pl-11 text-lg"
              />
              {buscando && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />}
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
                      {u.residentes.length > 0 ? u.residentes[0]!.nombreCompleto : (u.contactoNombre ?? "Sin residente registrado")}
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

            {grupoAbierto && (
              <div className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
                <Users className="h-4 w-4 flex-none text-warn-foreground" />
                <span>
                  {grupoAbierto.cantidadTotal === 1
                    ? "Esta unidad ya tiene 1 paquete pendiente."
                    : `Esta unidad ya tiene ${grupoAbierto.cantidadTotal} paquetes pendientes.`}
                  {decisionAgrupacion === "existente" && " Este se agregará al mismo grupo."}
                  {decisionAgrupacion === "separado" && " Este irá en un grupo separado."}
                </span>
              </div>
            )}

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
              <p className="text-sm font-medium text-muted-foreground">Empresa de paquetería (opcional)</p>
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
                    {u.ruta}
                  </button>
                ))}
                {catalogos && catalogos.ubicaciones.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No hay ubicaciones de bodega configuradas. Solicita al administrador crear al menos una en Configuración → Bodega.
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Fotografía (opcional)</p>
              <PhotoCapture onChange={setFoto} />
            </div>

            {/* ── Estado del paquete (punto 1 y 2 de la especificación) ── */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">Estado del paquete</p>
              <div className="flex flex-col gap-2">
                <label className="flex min-h-touch items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <input
                    type="radio"
                    name="estado-paquete"
                    checked={estadoPaquete === "bueno"}
                    onChange={() => setEstadoPaquete("bueno")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">El paquete se encuentra en buen estado</span>
                </label>
                <label className="flex min-h-touch items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <input
                    type="radio"
                    name="estado-paquete"
                    checked={estadoPaquete === "incidencia"}
                    onChange={() => setEstadoPaquete("incidencia")}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">El paquete presenta una incidencia</span>
                </label>
              </div>

              {estadoPaquete === "incidencia" && (
                <div className="animate-in fade-in slide-in-from-top-1 space-y-4 border-t border-border pt-4 duration-200">
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                      Tipo de incidencia <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {TIPOS_INCIDENCIA_REGISTRO.map((t) => (
                        <button
                          key={t}
                          onClick={() => setTipoIncidencia(t)}
                          className={`min-h-touch rounded-full border px-3 text-sm ${
                            tipoIncidencia === t ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background"
                          }`}
                        >
                          {TIPO_INCIDENCIA_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted-foreground">Descripción de la incidencia</p>
                    <textarea
                      rows={3}
                      placeholder="Detalles adicionales…"
                      value={descripcionIncidencia}
                      onChange={(e) => setDescripcionIncidencia(e.target.value)}
                      className="w-full rounded-md border border-input bg-background p-3 text-sm"
                    />
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted-foreground">
                      Nivel de daño <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {NIVELES.map((n) => (
                        <button
                          key={n}
                          onClick={() => setNivelDanio(n)}
                          className={`min-h-touch rounded-full border px-4 text-sm ${
                            nivelDanio === n ? "border-warn bg-warn/20 text-warn-foreground" : "border-border bg-background"
                          }`}
                        >
                          {NIVEL_DANIO_LABEL[n]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-medium text-muted-foreground">Fotografías de evidencia</p>
                    <PhotoCaptureMultiple onChange={setFotosIncidencia} />
                  </div>
                </div>
              )}
            </div>

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
                <Input placeholder="Remitente (opcional, si es una persona)" value={remitente} onChange={(e) => setRemitente(e.target.value)} className="h-12" />
                <Input placeholder="Número de guía (opcional)" value={numeroGuia} onChange={(e) => setNumeroGuia(e.target.value)} className="h-12" />
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

            {mostrarPromptAgrupacion && grupoAbierto && (
              <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  {grupoAbierto.cantidadTotal === 1
                    ? "Este residente ya tiene 1 paquete pendiente."
                    : `Este residente ya tiene ${grupoAbierto.cantidadTotal} paquetes pendientes.`}{" "}
                  ¿Deseas agregar este paquete al mismo grupo de entrega?
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => {
                      setDecisionAgrupacion("existente");
                      setMostrarPromptAgrupacion(false);
                      void registrarYAgrupar();
                    }}
                    className="min-h-touch w-full text-base"
                  >
                    Agregar al grupo existente
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDecisionAgrupacion("separado");
                      setMostrarPromptAgrupacion(false);
                      void registrarYAgrupar();
                    }}
                    className="min-h-touch w-full text-base"
                  >
                    Crear un grupo separado
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {unidadSeleccionada && !mostrarPromptAgrupacion && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
          <Button onClick={handleClickConfirmar} disabled={!puedeConfirmar} className="min-h-touch w-full text-base">
            {enviando && <Loader2 className="h-5 w-5 animate-spin" />}
            {!enviando && estadoPaquete === "incidencia" && <TriangleAlert className="h-5 w-5" />}
            {enviando ? "Registrando…" : "Confirmar recepción"}
          </Button>
        </div>
      )}
    </div>
  );
}

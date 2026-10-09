"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Home, Inbox, Loader2, MessageCircle, Pencil, TriangleAlert, X } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  aprobarSolicitudResidente,
  formatearWhatsApp,
  rechazarSolicitudResidente,
  validarDatosResidente,
  type CampoResidente,
  type CoincidenciaResidente,
  type MotivoRechazo,
  type PaisResidencial,
  type SolicitudResidente,
} from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

export interface ViviendaOpcion {
  id: string;
  direccion: string;
  conContacto: boolean;
}

const MOTIVOS_RECHAZO: Array<{ valor: MotivoRechazo; etiqueta: string }> = [
  { valor: "duplicado", etiqueta: "Ya está registrado (duplicado)" },
  { valor: "datos_incorrectos", etiqueta: "Datos incorrectos" },
  { valor: "no_reside", etiqueta: "No vive en el residencial" },
  { valor: "otro", etiqueta: "Otro motivo" },
];

function textoCoincidencia(c: CoincidenciaResidente): string {
  const en = c.direccion ? `«${c.direccion}»` : "otra vivienda";
  const quien = c.nombre ? ` (${c.nombre})` : "";
  switch (c.tipo) {
    case "telefono_contacto":
      return `El WhatsApp ya es el contacto de ${en}${quien}.`;
    case "telefono_residente":
      return `El WhatsApp ya está registrado como residente de ${en}${quien}.`;
    case "nombre_en_direccion":
      return `${c.nombre ?? "Esta persona"} ya es el contacto de ${en}.`;
    case "solicitud_pendiente":
      return `Otra solicitud pendiente usa el mismo WhatsApp${quien}${c.direccion ? `, dirección «${c.direccion}»` : ""}.`;
  }
}

/**
 * Solicitudes que llegaron por el enlace. Nada entra al listado operativo
 * (ni la guardia lo ve como destinatario) hasta que se aprueba. La
 * aprobación nunca reemplaza datos: si la vivienda ya tiene contacto, la
 * persona se agrega como residente adicional.
 */
export function SolicitudesResidentes({
  solicitudes,
  viviendas,
  pais,
}: {
  solicitudes: SolicitudResidente[];
  viviendas: ViviendaOpcion[];
  pais: PaisResidencial;
}) {
  if (solicitudes.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="solicitudes-residentes">
        <Inbox className="h-4 w-4 shrink-0" />
        No hay solicitudes por revisar. Las que lleguen desde el enlace aparecerán aquí.
      </section>
    );
  }
  return (
    <section className="space-y-3" data-testid="solicitudes-residentes">
      <div>
        <h2 className="font-display text-base font-semibold">
          Solicitudes por revisar <span className="ml-1 rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn-foreground">{solicitudes.length}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Llegaron desde el enlace. Solo al aprobarlas se agregan a Residentes y la guardia puede avisarles. Ninguna reemplaza datos que ya
          tengas: si la vivienda ya tiene contacto, la persona se agrega como residente adicional.
        </p>
      </div>
      {solicitudes.map((s) => (
        <TarjetaSolicitud key={s.id} solicitud={s} viviendas={viviendas} pais={pais} />
      ))}
    </section>
  );
}

function TarjetaSolicitud({ solicitud, viviendas, pais }: { solicitud: SolicitudResidente; viviendas: ViviendaOpcion[]; pais: PaisResidencial }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState({
    nombre: solicitud.nombre,
    apellido: solicitud.apellido,
    direccion: solicitud.direccion,
    whatsapp: formatearWhatsApp(solicitud.telefono, pais),
  });
  const [errores, setErrores] = useState<Partial<Record<CampoResidente, string>>>({});
  const [destino, setDestino] = useState<string>(solicitud.viviendaSugerida?.id ?? "nueva");
  const [coincidencias, setCoincidencias] = useState<CoincidenciaResidente[]>(solicitud.coincidencias);
  const [pideConfirmar, setPideConfirmar] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState<MotivoRechazo>(solicitud.coincidencias.length > 0 ? "duplicado" : "datos_incorrectos");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "aviso" | "error"; texto: string } | null>(null);
  const [terminada, setTerminada] = useState(false);

  const vivienda = useMemo(() => viviendas.find((v) => v.id === destino) ?? null, [viviendas, destino]);
  const queVaAPasar =
    destino === "nueva"
      ? "Se creará una vivienda nueva con esta dirección y la persona quedará como su contacto."
      : vivienda?.conContacto
        ? `Se agregará a «${vivienda.direccion}» como residente adicional; el contacto actual no cambia.`
        : `Quedará como contacto de «${vivienda?.direccion ?? "la vivienda elegida"}», que hoy no tiene contacto.`;

  async function aprobar(confirmar = false) {
    const v = validarDatosResidente(valores, pais);
    if (!v.ok) {
      setErrores(v.errores);
      setEditando(true);
      return;
    }
    setErrores({});
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await aprobarSolicitudResidente(createBrowserSupabaseClient(), {
        solicitudId: solicitud.id,
        ...v.datos,
        unidadId: destino === "nueva" ? null : destino,
        confirmarDuplicado: confirmar,
      });
      if (r.ok) {
        const texto =
          r.resultado === "vivienda_nueva"
            ? "Aprobada: se creó la vivienda con esta persona como contacto."
            : r.resultado === "contacto_principal"
              ? "Aprobada: quedó como contacto de la vivienda."
              : "Aprobada: se agregó como residente adicional de la vivienda.";
        setMensaje({ tipo: "ok", texto });
        setTerminada(true);
        setTimeout(() => router.refresh(), 900);
        return;
      }
      switch (r.motivo) {
        case "posible_duplicado":
          setCoincidencias(r.coincidencias ?? []);
          setPideConfirmar(true);
          setMensaje({ tipo: "aviso", texto: "Hay posibles duplicados. Revísalos antes de aprobar." });
          return;
        case "direccion_existente":
          if (r.unidadId) setDestino(r.unidadId);
          setMensaje({ tipo: "aviso", texto: `Ya existe la vivienda «${r.direccion}». La elegimos como destino: revisa y vuelve a aprobar.` });
          return;
        case "direccion_inactiva":
          setMensaje({ tipo: "error", texto: `La vivienda «${r.direccion}» está desactivada. Reactívala en Unidades o elige otra vivienda.` });
          return;
        case "ya_registrado":
          setMensaje({ tipo: "error", texto: `Este WhatsApp ya está registrado en «${r.direccion ?? "esa vivienda"}». Si es la misma persona, recházala como duplicado.` });
          return;
        case "datos_invalidos":
          setMensaje({ tipo: "error", texto: "Revisa los datos: hay un campo que no se puede guardar." });
          setEditando(true);
          return;
        case "unidad_no_valida":
          setMensaje({ tipo: "error", texto: "La vivienda elegida ya no está disponible. Elige otra." });
          return;
        case "no_operativo":
          setMensaje({ tipo: "error", texto: "El residencial no está operativo: por ahora no se pueden aprobar solicitudes." });
          return;
        case "ya_revisada":
          setMensaje({ tipo: "aviso", texto: "Esta solicitud ya fue revisada." });
          setTerminada(true);
          setTimeout(() => router.refresh(), 900);
          return;
      }
    } catch (e) {
      setMensaje({ tipo: "error", texto: obtenerMensajeError(e, "No se pudo aprobar. Inténtalo de nuevo.") });
    } finally {
      setEnviando(false);
    }
  }

  async function rechazar() {
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await rechazarSolicitudResidente(createBrowserSupabaseClient(), solicitud.id, motivo);
      if (r.ok || r.motivo === "ya_revisada") {
        setMensaje({ tipo: "ok", texto: r.ok ? "Solicitud rechazada. No se agregó a Residentes." : "Esta solicitud ya fue revisada." });
        setTerminada(true);
        setTimeout(() => router.refresh(), 900);
      } else {
        setMensaje({ tipo: "error", texto: "El residencial no está operativo: por ahora no se pueden revisar solicitudes." });
      }
    } catch (e) {
      setMensaje({ tipo: "error", texto: obtenerMensajeError(e, "No se pudo rechazar. Inténtalo de nuevo.") });
    } finally {
      setEnviando(false);
    }
  }

  const fecha = new Date(solicitud.recibidaEn).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

  return (
    <article className={`space-y-3 rounded-lg border bg-card p-4 ${terminada ? "opacity-60" : "border-border"}`} data-testid="solicitud-residente" data-solicitud={solicitud.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {solicitud.nombre} {solicitud.apellido}
          </p>
          <p className="text-xs text-muted-foreground">Recibida el {fecha}</p>
        </div>
        {!terminada && !editando && (
          <button type="button" onClick={() => setEditando(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground">
            <Pencil className="h-3 w-3" /> Corregir datos
          </button>
        )}
      </div>

      {editando ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["nombre", "apellido", "direccion", "whatsapp"] as const).map((c) => (
            <div key={c} className={c === "direccion" ? "sm:col-span-2" : ""}>
              <Label htmlFor={`${solicitud.id}-${c}`} className="text-xs">
                {c === "nombre" ? "Nombre" : c === "apellido" ? "Apellido" : c === "direccion" ? "Dirección" : "WhatsApp"}
              </Label>
              <Input
                id={`${solicitud.id}-${c}`}
                value={valores[c]}
                onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))}
                aria-invalid={errores[c] ? true : undefined}
                className={`mt-1 ${errores[c] ? "border-destructive" : ""}`}
              />
              {errores[c] && <p className="mt-1 text-xs text-destructive">{errores[c]}</p>}
            </div>
          ))}
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <Home className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <dt className="text-xs text-muted-foreground">Dirección</dt>
              <dd className="break-words font-medium">{valores.direccion}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <dt className="text-xs text-muted-foreground">WhatsApp</dt>
              <dd className="font-medium tabular-nums">{valores.whatsapp}</dd>
            </div>
          </div>
        </dl>
      )}

      {coincidencias.length > 0 && (
        <div className="space-y-1 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm" data-testid="solicitud-coincidencias">
          <p className="flex items-center gap-1.5 font-medium text-warn-foreground">
            <TriangleAlert className="h-4 w-4" /> Posible duplicado
          </p>
          {coincidencias.map((c, i) => (
            <p key={i} className="text-warn-foreground">
              {textoCoincidencia(c)}
            </p>
          ))}
        </div>
      )}

      {!terminada && (
        <div className="space-y-1.5">
          <Label htmlFor={`${solicitud.id}-destino`} className="text-xs">
            Vivienda
          </Label>
          <select
            id={`${solicitud.id}-destino`}
            value={destino}
            onChange={(e) => {
              setDestino(e.target.value);
              setPideConfirmar(false);
              setConfirmado(false);
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="nueva">Crear vivienda nueva con esta dirección</option>
            {viviendas.map((v) => (
              <option key={v.id} value={v.id}>
                {v.direccion}
                {v.conContacto ? " — ya tiene contacto" : " — sin contacto"}
                {solicitud.viviendaSugerida?.id === v.id ? " (coincide con la dirección)" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{queVaAPasar}</p>
        </div>
      )}

      {mensaje && (
        <p
          role={mensaje.tipo === "error" ? "alert" : "status"}
          className={`rounded-md px-3 py-2 text-sm ${
            mensaje.tipo === "ok" ? "bg-success/10 text-success" : mensaje.tipo === "aviso" ? "bg-warn/10 text-warn-foreground" : "bg-destructive/10 text-destructive"
          }`}
        >
          {mensaje.texto}
        </p>
      )}

      {!terminada &&
        (rechazando ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor={`${solicitud.id}-motivo`} className="text-xs">
                Motivo del rechazo
              </Label>
              <select
                id={`${solicitud.id}-motivo`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value as MotivoRechazo)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {MOTIVOS_RECHAZO.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRechazando(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button variant="destructive" size="sm" onClick={rechazar} disabled={enviando}>
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                Rechazar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 border-t border-border pt-3">
            {pideConfirmar && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-0.5 h-4 w-4" />
                Revisé las coincidencias: es otra persona o debe figurar también en esta vivienda.
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => aprobar(pideConfirmar)} disabled={enviando || (pideConfirmar && !confirmado)}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {pideConfirmar ? "Aprobar de todos modos" : "Aprobar"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRechazando(true)} disabled={enviando}>
                <X className="h-4 w-4" />
                Rechazar
              </Button>
              {editando && (
                <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={enviando}>
                  Listo
                </Button>
              )}
            </div>
          </div>
        ))}
    </article>
  );
}

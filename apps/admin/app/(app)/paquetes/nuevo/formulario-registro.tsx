"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Loader2, Check, MessageCircle } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  registrarPaquete,
  buscarUnidades,
  obtenerCatalogos,
  construirEnlaceWhatsApp,
  type Catalogos,
  type ResultadoRegistro,
} from "@gateflow/paquetes";
import type { SessionContext, UnidadConResidentes } from "@gateflow/types";
import { Button, Input, Label, PackageQRCode } from "@gateflow/ui";

export function FormularioRegistroPaquete({ session }: { session: SessionContext }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [query, setQuery] = useState("");
  const [unidades, setUnidades] = useState<UnidadConResidentes[]>([]);
  const [buscando, setBuscando] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const [unidadSeleccionada, setUnidadSeleccionada] = useState<UnidadConResidentes | null>(null);
  const [residenteId, setResidenteId] = useState<string | null>(null);

  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [empresaId, setEmpresaId] = useState("");
  const [remitente, setRemitente] = useState("");
  const [numeroGuia, setNumeroGuia] = useState("");
  const [tamanoId, setTamanoId] = useState("");
  const [prioridadId, setPrioridadId] = useState("");
  const [ubicacionId, setUbicacionId] = useState("");
  const [notas, setNotas] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<ResultadoRegistro | null>(null);

  useEffect(() => {
    obtenerCatalogos(supabase, session.tenant.id)
      .then(setCatalogos)
      .catch((e) => setError(e.message ?? "No se pudieron cargar los catálogos."));
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
        setUnidades(await buscarUnidades(supabase, session.tenant.id, query));
      } catch {
        setUnidades([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, unidadSeleccionada]);

  async function handleConfirmar() {
    if (!unidadSeleccionada || !ubicacionId) return;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el paquete.");
    } finally {
      setEnviando(false);
    }
  }

  if (confirmacion) {
    const { paquete, notificacion } = confirmacion;
    const enlaceWhatsApp = notificacion ? construirEnlaceWhatsApp(paquete, session.tenant.nombre, notificacion.destinatario) : null;

    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center">
        <span className="flex h-14 w-14 animate-in zoom-in-50 items-center justify-center rounded-full bg-success/10 duration-300">
          <Check className="h-7 w-7 text-success" />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold">Paquete registrado correctamente</h2>
          <p className="text-sm text-muted-foreground">{paquete.unidadIdentificador}</p>
        </div>
        <PackageQRCode codigoGateflow={paquete.codigoGateflow} />
        {notificacion &&
          (enlaceWhatsApp ? (
            <a
              href={enlaceWhatsApp.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-md border border-success bg-success/10 text-sm font-medium text-success"
            >
              <MessageCircle className="h-4 w-4" />
              Avisar por WhatsApp
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">Este residente no tiene un número de WhatsApp registrado.</p>
          ))}
        <div className="flex w-full max-w-xs gap-2">
          <Button variant="outline" className="flex-1" onClick={() => router.push(`/paquetes/${paquete.id}`)}>
            Ver detalle
          </Button>
          <Button className="flex-1" onClick={() => window.location.reload()}>
            Registrar otro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-5">
      {!unidadSeleccionada ? (
        <div>
          <Label htmlFor="busqueda">Vivienda o residente</Label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="busqueda"
              autoFocus
              placeholder="Calle, número, casa, depto o nombre del residente…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
            {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {unidades.length > 0 && (
            <div className="mt-2 divide-y divide-border rounded-md border border-border">
              {unidades.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setUnidadSeleccionada(u)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{u.identificador}</span>
                  <span className="text-muted-foreground">
                    {u.residentes[0]?.nombreCompleto ?? u.contactoNombre ?? "Sin residente registrado"}
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
            className="flex w-full items-center justify-between rounded-md border border-primary bg-primary/5 px-4 py-2.5 text-left"
          >
            <span className="font-medium">{unidadSeleccionada.identificador}</span>
            <span className="text-xs text-primary">Cambiar</span>
          </button>

          {unidadSeleccionada.residentes.length > 1 && (
            <div>
              <Label>Residente destinatario</Label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {unidadSeleccionada.residentes.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setResidenteId(residenteId === r.id ? null : r.id)}
                    className={`h-9 rounded-full border px-3.5 text-sm ${residenteId === r.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                  >
                    {r.nombreCompleto}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="empresa">Empresa de mensajería</Label>
              <select
                id="empresa"
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecciona…</option>
                {(catalogos?.empresasPaqueteria ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="guia">Código de seguimiento</Label>
              <Input id="guia" value={numeroGuia} onChange={(e) => setNumeroGuia(e.target.value)} className="mt-1.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tamano">Tamaño</Label>
              <select
                id="tamano"
                value={tamanoId}
                onChange={(e) => setTamanoId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecciona…</option>
                {(catalogos?.tamanos ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="prioridad">Prioridad</Label>
              <select
                id="prioridad"
                value={prioridadId}
                onChange={(e) => setPrioridadId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Normal</option>
                {(catalogos?.prioridades ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="ubicacion">
              Ubicación física <span className="text-destructive">*</span>
            </Label>
            <select
              id="ubicacion"
              value={ubicacionId}
              onChange={(e) => setUbicacionId(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecciona…</option>
              {(catalogos?.ubicaciones ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="remitente">Remitente (opcional)</Label>
            <Input id="remitente" value={remitente} onChange={(e) => setRemitente(e.target.value)} className="mt-1.5" />
          </div>

          <div>
            <Label htmlFor="notas">Observaciones (opcional)</Label>
            <textarea
              id="notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background p-2 text-sm"
            />
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex gap-3 border-t border-border pt-4">
            <Button variant="ghost" asChild>
              <Link href="/paquetes">Cancelar</Link>
            </Button>
            <Button onClick={handleConfirmar} disabled={!ubicacionId || enviando} className="flex-1">
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              {enviando ? "Registrando…" : "Registrar y avisar"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

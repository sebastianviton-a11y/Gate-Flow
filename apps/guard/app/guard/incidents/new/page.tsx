"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Check, TriangleAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { buscarPaquetes, reportarIncidencia, subirFotografiaIncidencia, TIPO_INCIDENCIA_LABEL, type TipoIncidencia } from "@gateflow/paquetes";
import type { Paquete } from "@gateflow/types";
import { Input, Button, EstadoBadge, obtenerMensajeError } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { PhotoCapture } from "@/components/photo-capture";
import { useGuardSession } from "@/components/session-provider";

const TIPOS = Object.keys(TIPO_INCIDENCIA_LABEL) as TipoIncidencia[];

/**
 * BR-21: una incidencia siempre está asociada a un paquete existente —
 * por eso el primer paso siempre es identificar el paquete, nunca crear
 * una incidencia "suelta". Conecta con datos reales — hasta ahora el
 * buscador no encontraba nada y el formulario de tipo/foto no existía.
 */
export default function NewIncidentPage() {
  const router = useRouter();
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();

  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Paquete[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [paquete, setPaquete] = useState<Paquete | null>(null);

  const [tipo, setTipo] = useState<TipoIncidencia | "">("");
  const [descripcion, setDescripcion] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportada, setReportada] = useState(false);

  async function handleBuscar(texto: string) {
    setQuery(texto);
    if (!texto.trim()) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      setResultados(await buscarPaquetes(supabase, session.tenant.id, texto));
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }

  async function handleReportar() {
    if (!paquete || !tipo) return;
    setEnviando(true);
    setError(null);
    try {
      const { id } = await reportarIncidencia(supabase, {
        tenantId: session.tenant.id,
        paqueteId: paquete.id,
        tipo,
        descripcion,
        reportadaPor: session.user.id,
      });
      if (foto) {
        try {
          await subirFotografiaIncidencia(supabase, { tenantId: session.tenant.id, incidenciaId: id, archivo: foto, tomadaPor: session.user.id });
        } catch (fotoError) {
          // La incidencia ya quedó registrada — una foto que no subió no
          // debe hacer parecer que todo el reporte falló.
          console.error("[GateFlow] No se pudo subir la foto de la incidencia:", fotoError);
        }
      }
      setReportada(true);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo reportar la incidencia."));
    } finally {
      setEnviando(false);
    }
  }

  if (reportada) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <Check className="h-7 w-7 text-success" />
        </span>
        <h2 className="font-display text-lg font-semibold">Incidencia reportada</h2>
        <p className="text-sm text-muted-foreground">{paquete?.codigoGateflow}</p>
        <Button onClick={() => router.push("/guard")} className="min-h-touch w-full max-w-xs text-base">
          Volver al inicio
        </Button>
      </div>
    );
  }

  if (!paquete) {
    return (
      <div className="flex h-full flex-col">
        <OperationalHeader title="Reportar incidencia" />
        <div className="flex-1 space-y-4 p-4">
          <p className="text-sm text-muted-foreground">Primero identifica el paquete — toda incidencia queda asociada a uno (BR-21).</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Unidad, nombre o código GateFlow…"
              value={query}
              onChange={(e) => handleBuscar(e.target.value)}
              className="h-14 pl-11 text-lg"
            />
            {buscando && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>

          {resultados.length > 0 ? (
            <div className="space-y-2">
              {resultados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPaquete(p)}
                  className="flex min-h-touch w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
                >
                  <div>
                    <p className="font-medium">{p.unidadIdentificador}</p>
                    <span className="gf-code text-muted-foreground">{p.codigoGateflow}</span>
                  </div>
                  <EstadoBadge estado={p.estado} />
                </button>
              ))}
            </div>
          ) : (
            query.trim() &&
            !buscando && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Sin resultados.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col pb-28">
      <OperationalHeader title="Reportar incidencia" />
      <div className="flex-1 space-y-5 p-4">
        <button
          onClick={() => {
            setPaquete(null);
            setTipo("");
          }}
          className="flex w-full items-center justify-between rounded-md border border-primary bg-primary/5 px-4 py-2.5 text-left"
        >
          <div>
            <p className="font-medium">{paquete.unidadIdentificador}</p>
            <span className="gf-code text-muted-foreground">{paquete.codigoGateflow}</span>
          </div>
          <span className="text-xs text-primary">Cambiar</span>
        </button>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Tipo de incidencia <span className="text-destructive">*</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`min-h-touch rounded-full border px-4 text-sm ${
                  tipo === t ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-card"
                }`}
              >
                {TIPO_INCIDENCIA_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-muted-foreground">Descripción (opcional)</p>
          <textarea
            rows={3}
            placeholder="Detalles adicionales…"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full rounded-md border border-input bg-background p-3 text-sm"
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-muted-foreground">Fotografía (opcional, recomendada)</p>
          <PhotoCapture onChange={setFoto} />
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background p-4">
        <Button onClick={handleReportar} disabled={!tipo || enviando} className="min-h-touch w-full text-base">
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <TriangleAlert className="h-5 w-5" />}
          {enviando ? "Reportando…" : "Reportar incidencia"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Link2Off, Loader2, RefreshCw, Share2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  desactivarEnlaceResidentes,
  generarEnlaceResidentes,
  TEXTO_COMPARTIR_ENLACE,
  urlCompartirEnlaceWhatsApp,
  urlEnlaceResidentes,
  type EnlaceResidentes as Enlace,
} from "@gateflow/paquetes";
import { Button, obtenerMensajeError } from "@gateflow/ui";

/**
 * Enlace para que los residentes carguen sus propios datos. Se muestra
 * en Residentes y en el paso de residentes del onboarding. Regenerar o
 * desactivar lo revoca de inmediato (la base deja de aceptarlo).
 * Copiar y Compartir solo actúan cuando el administrador los toca: nada
 * se envía solo.
 */
export function EnlaceResidentes({ tenantId, enlaceInicial }: { tenantId: string; enlaceInicial: Enlace | null }) {
  const [enlace, setEnlace] = useState<Enlace | null>(enlaceInicial);
  const [base, setBase] = useState(process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? "");
  const [copiado, setCopiado] = useState(false);
  // Menú de compartir del sistema (teléfonos); si no existe, WhatsApp.
  const [compartirNativo, setCompartirNativo] = useState(false);
  const [confirmando, setConfirmando] = useState<null | "regenerar" | "desactivar">(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const campoUrl = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!base) setBase(window.location.origin);
  }, [base]);
  useEffect(() => {
    setCompartirNativo(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const url = enlace && base ? urlEnlaceResidentes(base, enlace.token) : "";

  async function copiar() {
    if (!url) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Sin permiso de portapapeles: se selecciona el texto para copiarlo a mano.
      campoUrl.current?.select();
      const ok = document.execCommand?.("copy");
      if (!ok) {
        setError("No pudimos copiar automáticamente. El enlace quedó seleccionado: cópialo con Ctrl+C o mantén presionado.");
        return;
      }
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 3000);
  }

  async function compartir() {
    if (!url) return;
    setError(null);
    if (compartirNativo) {
      try {
        await navigator.share({ title: "Registro de residentes", text: TEXTO_COMPARTIR_ENLACE, url });
        return;
      } catch (e) {
        // La persona cerró el menú: no es un error.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    window.open(urlCompartirEnlaceWhatsApp(url), "_blank", "noopener,noreferrer");
  }

  async function ejecutar(accion: "generar" | "regenerar" | "desactivar") {
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const supabase = createBrowserSupabaseClient();
      if (accion === "desactivar") {
        await desactivarEnlaceResidentes(supabase, tenantId);
        setEnlace(null);
        setAviso("Enlace desactivado. Nadie puede enviar datos con él.");
      } else {
        setEnlace(await generarEnlaceResidentes(supabase, tenantId));
        setAviso(accion === "regenerar" ? "Enlace nuevo listo. El anterior ya no funciona: comparte este." : "Enlace listo para compartir.");
      }
      setConfirmando(null);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo actualizar el enlace. Inténtalo de nuevo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5" data-testid="enlace-residentes">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Link2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">Invita a tus residentes a cargar sus datos</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Copia este enlace y compártelo en el grupo de tu residencial. Cada residente podrá completar su información.
          </p>
        </div>
      </div>

      {enlace ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={campoUrl}
              readOnly
              value={url}
              aria-label="Enlace para residentes"
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-xs text-muted-foreground"
              data-testid="enlace-residentes-url"
            />
            {/* En el teléfono, un botón debajo del otro y a todo el ancho: nunca se cortan. */}
            <div className="grid grid-cols-1 gap-2 sm:flex sm:shrink-0">
              <Button onClick={copiar} disabled={!url} className="w-full sm:w-auto">
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiado ? "Enlace copiado" : "Copiar enlace"}
              </Button>
              <Button variant="outline" onClick={compartir} disabled={!url} className="w-full sm:w-auto" data-testid="enlace-residentes-compartir">
                <Share2 className="h-4 w-4" />
                {compartirNativo ? "Compartir" : "Compartir por WhatsApp"}
              </Button>
            </div>
          </div>
          <p aria-live="polite" className="min-h-[1rem] text-xs text-success">
            {copiado ? "Listo: pégalo en el grupo de WhatsApp del residencial." : ""}
          </p>

          {confirmando === null ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <button type="button" onClick={() => setConfirmando("regenerar")} className="inline-flex items-center gap-1 text-muted-foreground underline hover:text-foreground">
                <RefreshCw className="h-3 w-3" /> Regenerar enlace
              </button>
              <button type="button" onClick={() => setConfirmando("desactivar")} className="inline-flex items-center gap-1 text-muted-foreground underline hover:text-destructive">
                <Link2Off className="h-3 w-3" /> Desactivar enlace
              </button>
            </div>
          ) : (
            <div role="alertdialog" aria-label={confirmando === "regenerar" ? "Regenerar enlace" : "Desactivar enlace"} className="space-y-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
              <p className="text-warn-foreground">
                {confirmando === "regenerar"
                  ? "Se creará un enlace nuevo y el anterior dejará de funcionar de inmediato: quien lo tenga ya no podrá enviar datos. Tendrás que compartir el nuevo."
                  : "El enlace dejará de funcionar de inmediato: nadie podrá enviar datos hasta que generes uno nuevo. Las solicitudes ya recibidas se conservan."}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)} disabled={enviando}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant={confirmando === "desactivar" ? "destructive" : "default"}
                  onClick={() => ejecutar(confirmando)}
                  disabled={enviando}
                >
                  {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                  {confirmando === "regenerar" ? "Regenerar" : "Desactivar"}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">No hay un enlace activo.</p>
          <Button onClick={() => ejecutar("generar")} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Crear enlace
          </Button>
        </div>
      )}

      {aviso && (
        <p role="status" className="text-xs text-success">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

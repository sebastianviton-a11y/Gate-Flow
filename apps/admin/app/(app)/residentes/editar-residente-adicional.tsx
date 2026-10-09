"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  actualizarResidenteAdicional,
  formatearWhatsApp,
  quitarResidenteAdicional,
  validarDatosResidente,
  type CampoResidente,
  type PaisResidencial,
  type ResidenteAdicional,
} from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

/**
 * Edita o quita a una persona adicional de una vivienda (sin cuenta,
 * aprobada desde el enlace). Quitarla no borra el registro: queda con
 * fecha de fin y deja de aparecer como destinatario para la guardia.
 */
export function EditarResidenteAdicional({
  residente,
  direccion,
  pais,
  onGuardado,
  onCerrar,
}: {
  residente: ResidenteAdicional;
  direccion: string;
  pais: PaisResidencial;
  onGuardado: () => void;
  onCerrar: () => void;
}) {
  const [valores, setValores] = useState({
    nombre: residente.nombre,
    apellido: residente.apellido,
    whatsapp: formatearWhatsApp(residente.telefono, pais),
  });
  const [errores, setErrores] = useState<Partial<Record<CampoResidente, string>>>({});
  const [confirmandoQuitar, setConfirmandoQuitar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const v = validarDatosResidente({ ...valores, direccion }, pais);
    if (!v.ok) {
      setErrores(v.errores);
      return;
    }
    setErrores({});
    setEnviando(true);
    setError(null);
    try {
      const r = await actualizarResidenteAdicional(createBrowserSupabaseClient(), {
        id: residente.id,
        nombre: v.datos.nombre,
        apellido: v.datos.apellido,
        telefono: v.datos.telefono,
      });
      if (r.ok) onGuardado();
      else setError(r.motivo === "ya_registrado" ? "Ese WhatsApp ya está registrado en esta vivienda." : "No se pudo guardar: revisa los datos.");
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo guardar. Inténtalo de nuevo."));
    } finally {
      setEnviando(false);
    }
  }

  async function quitar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await quitarResidenteAdicional(createBrowserSupabaseClient(), residente.id);
      if (r.ok) onGuardado();
      else setError("El residencial no está operativo: por ahora no se pueden hacer cambios.");
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo quitar. Inténtalo de nuevo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-primary bg-primary/5 p-5" data-testid="editar-residente-adicional">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Residente adicional de &quot;{direccion}&quot;
        </p>
        <button onClick={onCerrar} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["nombre", "apellido", "whatsapp"] as const).map((c) => (
          <div key={c}>
            <Label htmlFor={`adicional-${c}`}>{c === "nombre" ? "Nombre" : c === "apellido" ? "Apellido" : "WhatsApp"}</Label>
            <Input
              id={`adicional-${c}`}
              value={valores[c]}
              onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))}
              aria-invalid={errores[c] ? true : undefined}
              className={`mt-1.5 ${errores[c] ? "border-destructive" : ""}`}
            />
            {errores[c] && <p className="mt-1 text-xs text-destructive">{errores[c]}</p>}
          </div>
        ))}
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {confirmandoQuitar ? (
        <div className="space-y-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm">
          <p className="text-warn-foreground">
            Dejará de figurar en esta vivienda y la guardia ya no podrá elegirla como destinataria. El registro se conserva como historial.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmandoQuitar(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button size="sm" variant="destructive" onClick={quitar} disabled={enviando}>
              {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
              Quitar de la vivienda
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button size="sm" onClick={guardar} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmandoQuitar(true)} disabled={enviando} className="sm:ml-auto">
            Quitar de la vivienda
          </Button>
        </div>
      )}
    </div>
  );
}

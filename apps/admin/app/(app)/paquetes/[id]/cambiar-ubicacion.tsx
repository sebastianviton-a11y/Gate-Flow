"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { cambiarUbicacionPaquete } from "@gateflow/paquetes";
import { obtenerMensajeError } from "@gateflow/ui";

export function CambiarUbicacion({
  paqueteId,
  ubicacionActual,
  ubicacionesDisponibles,
  puedeEditar,
}: {
  paqueteId: string;
  ubicacionActual: string;
  ubicacionesDisponibles: { id: string; ruta: string }[];
  puedeEditar: boolean;
}) {
  const supabase = createBrowserSupabaseClient();
  const [editando, setEditando] = useState(false);
  const [seleccion, setSeleccion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rutaMostrada, setRutaMostrada] = useState(ubicacionActual);

  async function handleGuardar() {
    if (!seleccion) return;
    setGuardando(true);
    setError(null);
    try {
      await cambiarUbicacionPaquete(supabase, paqueteId, seleccion);
      setRutaMostrada(ubicacionesDisponibles.find((u) => u.id === seleccion)?.ruta ?? rutaMostrada);
      setEditando(false);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo cambiar la ubicación."));
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{rutaMostrada}</span>
        {puedeEditar && (
          <button onClick={() => setEditando(true)} className="text-muted-foreground hover:text-primary" title="Cambiar ubicación">
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <select
        value={seleccion}
        onChange={(e) => setSeleccion(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">Selecciona…</option>
        {ubicacionesDisponibles.map((u) => (
          <option key={u.id} value={u.id}>
            {u.ruta}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setEditando(false)} className="text-xs text-muted-foreground">
          Cancelar
        </button>
        <button onClick={handleGuardar} disabled={!seleccion || guardando} className="text-xs font-medium text-primary disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

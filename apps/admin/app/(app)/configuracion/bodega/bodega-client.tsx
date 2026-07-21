"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Eye, EyeOff, Warehouse, TriangleAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  crearUbicacion,
  actualizarUbicacion,
  cambiarActivoUbicacion,
  eliminarUbicacion,
  detectarCiclo,
  type UbicacionAdmin,
  type UbicacionInput,
} from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

const TIPOS: { valor: string; etiqueta: string }[] = [
  { valor: "zona", etiqueta: "Zona" },
  { valor: "sector", etiqueta: "Sector" },
  { valor: "estante", etiqueta: "Estante" },
  { valor: "rack", etiqueta: "Rack" },
  { valor: "nivel", etiqueta: "Nivel" },
  { valor: "casillero", etiqueta: "Casillero" },
  { valor: "area_especial", etiqueta: "Área especial" },
  { valor: "otro", etiqueta: "Otro" },
];

const FORM_VACIO: UbicacionInput = { nombre: "", codigo: "", descripcion: "", tipoNodo: "estante", padreId: null, orden: 0 };

export function BodegaClient({
  tenantId,
  userId,
  ubicacionesIniciales,
}: {
  tenantId: string;
  userId: string;
  ubicacionesIniciales: UbicacionAdmin[];
}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<UbicacionAdmin | null>(null);
  const [form, setForm] = useState<UbicacionInput>(FORM_VACIO);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState<string | null>(null);

  const ubicaciones = ubicacionesIniciales;

  // Al editar, no se puede elegir como padre a la propia ubicación ni a
  // ninguno de sus descendientes — crearía un ciclo. Se filtra aquí, no
  // solo se valida al guardar, para no ni siquiera mostrar la opción.
  const opcionesPadre = useMemo(() => {
    if (!editando) return ubicaciones;
    return ubicaciones.filter(
      (u) => u.id === editando.id || !detectarCiclo(ubicaciones.map((x) => ({ id: x.id, padreId: x.padreId })), editando.id, u.id),
    );
  }, [ubicaciones, editando]);

  function abrirCrear() {
    setEditando(null);
    setForm(FORM_VACIO);
    setError(null);
    setAbierto(true);
  }

  function abrirEditar(u: UbicacionAdmin) {
    setEditando(u);
    setForm({ nombre: u.nombre, codigo: u.codigo ?? "", descripcion: u.descripcion ?? "", tipoNodo: u.tipoNodo, padreId: u.padreId, orden: u.orden });
    setError(null);
    setAbierto(true);
  }

  async function handleGuardar() {
    if (!form.nombre.trim()) return;
    if (detectarCiclo(ubicaciones.map((u) => ({ id: u.id, padreId: u.padreId })), editando?.id ?? "", form.padreId ?? null)) {
      setError("Esa ubicación no puede ser su propio padre ni descender de sí misma.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      if (editando) {
        await actualizarUbicacion(supabase, editando.id, form);
      } else {
        await crearUbicacion(supabase, tenantId, userId, form);
      }
      setAbierto(false);
      router.refresh();
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo guardar la ubicación."));
    } finally {
      setEnviando(false);
    }
  }

  async function handleActivarDesactivar(u: UbicacionAdmin) {
    if (u.activo && u.totalPaquetesActivos > 0) {
      const confirmar = window.confirm(
        `"${u.ruta}" tiene ${u.totalPaquetesActivos} paquete(s) pendiente(s) de entrega ahí. ¿Desactivarla igual? Los paquetes existentes no se moverán, pero ya no se podrá asignar a paquetes nuevos.`,
      );
      if (!confirmar) return;
    }
    try {
      await cambiarActivoUbicacion(supabase, u.id, !u.activo);
      router.refresh();
    } catch (e) {
      alert(obtenerMensajeError(e, "No se pudo cambiar el estado."));
    }
  }

  async function handleEliminar(u: UbicacionAdmin) {
    try {
      await eliminarUbicacion(supabase, u.id);
      setConfirmarEliminar(null);
      router.refresh();
    } catch (e) {
      alert(obtenerMensajeError(e, "No se pudo eliminar la ubicación."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={abrirCrear}>
          <Plus className="h-4 w-4" />
          {ubicaciones.length === 0 ? "Crear primera ubicación" : "Agregar ubicación"}
        </Button>
      </div>

      {abierto && (
        <div className="space-y-4 rounded-lg border border-primary bg-primary/5 p-5">
          <p className="text-sm font-medium">{editando ? `Editar "${editando.nombre}"` : "Nueva ubicación"}</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="b-nombre">
                Nombre <span className="text-destructive">*</span>
              </Label>
              <Input
                id="b-nombre"
                autoFocus
                placeholder='Ej. "Estante A" o "A1"'
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="b-codigo">Código (opcional)</Label>
              <Input id="b-codigo" value={form.codigo ?? ""} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className="mt-1.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="b-tipo">Tipo</Label>
              <select
                id="b-tipo"
                value={form.tipoNodo}
                onChange={(e) => setForm({ ...form, tipoNodo: e.target.value })}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="b-padre">Ubicación padre (opcional)</Label>
              <select
                id="b-padre"
                value={form.padreId ?? ""}
                onChange={(e) => setForm({ ...form, padreId: e.target.value || null })}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sin padre (ubicación de nivel superior)</option>
                {opcionesPadre
                  .filter((u) => !editando || u.id !== editando.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.ruta}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Label htmlFor="b-desc">Descripción (opcional)</Label>
              <Input id="b-desc" value={form.descripcion ?? ""} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="b-orden">Orden</Label>
              <Input
                id="b-orden"
                type="number"
                value={form.orden ?? 0}
                onChange={(e) => setForm({ ...form, orden: Number(e.target.value) })}
                className="mt-1.5"
              />
            </div>
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleGuardar} disabled={!form.nombre.trim() || enviando}>
              {enviando ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      )}

      {ubicaciones.length === 0 && !abierto ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
          <Warehouse className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Configura las áreas, estantes o espacios donde se almacenan los paquetes.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Ubicación</th>
                <th className="px-4 py-2 font-medium">Código</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Orden</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ubicaciones.map((u) => (
                <tr key={u.id} className={u.activo ? "" : "opacity-50"}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{u.ruta}</p>
                    {u.descripcion && <p className="text-xs text-muted-foreground">{u.descripcion}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.codigo ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{TIPOS.find((t) => t.valor === u.tipoNodo)?.etiqueta ?? u.tipoNodo}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.orden}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                        u.activo ? "bg-success/10 text-success" : "bg-muted-foreground/10 text-muted-foreground"
                      }`}
                    >
                      {u.activo ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => abrirEditar(u)} className="rounded p-1.5 text-muted-foreground hover:bg-muted" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleActivarDesactivar(u)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                        title={u.activo ? "Desactivar" : "Activar"}
                      >
                        {u.activo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      {u.totalPaquetesHistoricos === 0 ? (
                        confirmarEliminar === u.id ? (
                          <span className="flex items-center gap-1">
                            <button onClick={() => handleEliminar(u)} className="text-xs font-medium text-destructive">
                              Confirmar
                            </button>
                            <button onClick={() => setConfirmarEliminar(null)} className="text-xs text-muted-foreground">
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmarEliminar(u.id)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )
                      ) : (
                        <span title="Ya se usó en algún paquete — solo se puede desactivar, no eliminar" className="p-1.5 text-muted-foreground/40">
                          <TriangleAlert className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

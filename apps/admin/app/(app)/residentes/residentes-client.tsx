"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Pencil, Upload, Phone, Mail } from "lucide-react";
import type { UnidadListItem } from "@gateflow/paquetes";
import { Button, Input } from "@gateflow/ui";
import { ImportarUnidades } from "../unidades/importar-unidades";
import { AgregarUnidadManual } from "../unidades/agregar-manual";
import { EditarUnidad } from "../unidades/editar-unidad";

/**
 * Reutiliza los mismos 3 componentes que ya usa Unidades — no existe
 * ninguna versión propia de "crear residente" ni "editar residente"
 * separada, porque son literalmente la misma operación sobre la
 * misma fila de `unidades`. Solo se agrega la búsqueda y la
 * presentación orientada a contacto (nombre primero, no dirección).
 */
export function ResidentesClient({ tenantId, unidades }: { tenantId: string; unidades: UnidadListItem[] }) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<UnidadListItem | null>(null);
  const [mostrarAgregar, setMostrarAgregar] = useState(false);
  const [mostrarImportar, setMostrarImportar] = useState(false);

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    if (!termino) return unidades;
    return unidades.filter((u) =>
      [u.contactoNombre, u.identificador, u.contactoTelefono, u.contactoEmail].some((campo) => campo?.toLowerCase().includes(termino)),
    );
  }, [busqueda, unidades]);

  function handleActualizado() {
    setEditando(null);
    setMostrarAgregar(false);
    setMostrarImportar(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, unidad, teléfono o correo…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setMostrarImportar(true)}>
          <Upload className="h-4 w-4" />
          Importar Excel/CSV
        </Button>
        <Button onClick={() => setMostrarAgregar(true)}>
          <Plus className="h-4 w-4" />
          Nuevo residente
        </Button>
      </div>

      {mostrarImportar && (
        <div className="rounded-lg border border-border bg-card p-4">
          <ImportarUnidades tenantId={tenantId} onImportado={handleActualizado} />
          <button onClick={() => setMostrarImportar(false)} className="mt-3 text-sm text-muted-foreground underline">
            Cerrar
          </button>
        </div>
      )}

      {mostrarAgregar && (
        <div className="rounded-lg border border-border bg-card p-4">
          <AgregarUnidadManual tenantId={tenantId} onAgregada={handleActualizado} />
          <button onClick={() => setMostrarAgregar(false)} className="mt-3 text-sm text-muted-foreground underline">
            Cerrar
          </button>
        </div>
      )}

      {editando && <EditarUnidad tenantId={tenantId} unidad={editando} onGuardado={handleActualizado} onCerrar={() => setEditando(null)} />}

      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {busqueda ? "Sin resultados para esa búsqueda." : "Sin residentes todavía — agrega el primero o importa un Excel/CSV."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Unidad</th>
                <th className="px-4 py-2 font-medium">Teléfono</th>
                <th className="px-4 py-2 font-medium">Correo</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map((u) => (
                <tr key={u.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-medium">{u.contactoNombre ?? <span className="text-muted-foreground">Sin nombre</span>}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.identificador}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {u.contactoTelefono ? (
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" />
                        {u.contactoTelefono}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {u.contactoEmail ? (
                      <span className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" />
                        {u.contactoEmail}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        u.activo ? "bg-success/10 text-success" : "bg-muted-foreground/10 text-muted-foreground"
                      }`}
                    >
                      {u.activo ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setEditando(u)} className="text-muted-foreground hover:text-primary" aria-label="Editar residente">
                      <Pencil className="h-4 w-4" />
                    </button>
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import type { UnidadListItem } from "@gateflow/paquetes";
import { ImportarUnidades } from "./importar-unidades";
import { AgregarUnidadManual } from "./agregar-manual";
import { EditarUnidad } from "./editar-unidad";

export function UnidadesClient({ tenantId, unidades }: { tenantId: string; unidades: UnidadListItem[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<UnidadListItem | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <ImportarUnidades tenantId={tenantId} onImportado={() => router.refresh()} />
        <AgregarUnidadManual tenantId={tenantId} onAgregada={() => router.refresh()} />
      </div>

      {editando && (
        <EditarUnidad
          tenantId={tenantId}
          unidad={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            router.refresh();
          }}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Identificador</th>
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5">Contacto</th>
              <th className="px-4 py-2.5">Teléfono</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {unidades.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Sin unidades todavía — importa una plantilla o agrega la primera manualmente.
                </td>
              </tr>
            )}
            {unidades.map((u) => (
              <tr key={u.id} className={`hover:bg-muted/40 ${u.activo ? "" : "opacity-50"}`}>
                <td className="px-4 py-2.5 font-medium">{u.identificador}</td>
                <td className="px-4 py-2.5 capitalize text-muted-foreground">{u.tipo}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.contactoNombre ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.contactoTelefono ?? "—"}</td>
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
                  <button onClick={() => setEditando(u)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary" title="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

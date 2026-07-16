"use client";

import { useRouter } from "next/navigation";
import type { UnidadListItem } from "@gateflow/paquetes";
import { ImportarUnidades } from "./importar-unidades";

export function UnidadesClient({ tenantId, unidades }: { tenantId: string; unidades: UnidadListItem[] }) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <ImportarUnidades tenantId={tenantId} onImportado={() => router.refresh()} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Identificador</th>
              <th className="px-4 py-2.5">Tipo</th>
              <th className="px-4 py-2.5">Contacto</th>
              <th className="px-4 py-2.5">Teléfono</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {unidades.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  Sin unidades todavía — importa una plantilla o agrega la primera manualmente.
                </td>
              </tr>
            )}
            {unidades.map((u) => (
              <tr key={u.id} className="hover:bg-muted/40">
                <td className="px-4 py-2.5 font-medium">{u.identificador}</td>
                <td className="px-4 py-2.5 capitalize text-muted-foreground">{u.tipo}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.contactoNombre ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.contactoTelefono ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

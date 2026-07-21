"use client";

import Link from "next/link";
import { ESTADO_SERVICIO_LABEL, PLAN_LABEL, type EmpresaListItem, type PlanClave } from "@gateflow/paquetes";

const ESTADO_CLASE: Record<string, string> = {
  piloto: "bg-info/10 text-info",
  activo: "bg-success/10 text-success",
  suspendido: "bg-destructive/10 text-destructive",
  cancelado: "bg-muted-foreground/10 text-muted-foreground",
};

export function EmpresasTable({ empresas }: { empresas: EmpresaListItem[] }) {
  if (empresas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Sin empresas todavía — crea la primera con &quot;Nueva empresa&quot;.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Empresa</th>
            <th className="px-4 py-2 font-medium">Ciudad</th>
            <th className="px-4 py-2 font-medium">Residenciales</th>
            <th className="px-4 py-2 font-medium">Plan</th>
            <th className="px-4 py-2 font-medium">Alta</th>
            <th className="px-4 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {empresas.map((e) => (
            <tr key={e.id} className="hover:bg-muted/40">
              <td className="px-4 py-2.5">
                <Link href={`/superadmin/empresas/${e.id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                  {e.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                      {e.nombre.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {e.nombre}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {e.ciudad ?? "—"}
                {e.estadoGeografico ? `, ${e.estadoGeografico}` : ""}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{e.totalResidenciales}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{PLAN_LABEL[e.plan as PlanClave] ?? e.plan}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{new Date(e.creadaEn).toLocaleDateString("es-MX")}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[e.estadoServicio]}`}>
                  {ESTADO_SERVICIO_LABEL[e.estadoServicio]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ESTADO_SERVICIO_LABEL, PLAN_LABEL, type ResidencialListItem } from "@gateflow/paquetes";

const ESTADO_CLASE: Record<string, string> = {
  piloto: "bg-info/10 text-info",
  activo: "bg-success/10 text-success",
  suspendido: "bg-destructive/10 text-destructive",
  cancelado: "bg-muted-foreground/10 text-muted-foreground",
};

export function ResidencialesTable({ residenciales }: { residenciales: ResidencialListItem[] }) {
  if (residenciales.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Sin residenciales todavía — crea el primero con &quot;Nuevo residencial&quot;.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Residencial</th>
            <th className="px-4 py-2 font-medium">Ciudad</th>
            <th className="px-4 py-2 font-medium">Administrador</th>
            <th className="px-4 py-2 font-medium">Viviendas</th>
            <th className="px-4 py-2 font-medium">Usuarios</th>
            <th className="px-4 py-2 font-medium">Plan</th>
            <th className="px-4 py-2 font-medium">Alta</th>
            <th className="px-4 py-2 font-medium">Renovación</th>
            <th className="px-4 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {residenciales.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className="px-4 py-2.5">
                <Link href={`/superadmin/residenciales/${r.id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                  {r.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                      {r.nombre.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {r.nombre}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {r.ciudad ?? "—"}
                {r.estadoGeografico ? `, ${r.estadoGeografico}` : ""}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{r.administradorNombre ?? "Sin asignar"}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{r.totalViviendas}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{r.totalUsuarios}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{PLAN_LABEL[r.plan] ?? r.plan}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{new Date(r.creadoEn).toLocaleDateString("es-MX")}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{r.planFechaRenovacion ? new Date(r.planFechaRenovacion).toLocaleDateString("es-MX") : "—"}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[r.estadoServicio]}`}>
                  {ESTADO_SERVICIO_LABEL[r.estadoServicio]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

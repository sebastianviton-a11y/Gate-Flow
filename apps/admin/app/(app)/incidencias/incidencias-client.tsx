"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { resolverIncidencia, TIPO_INCIDENCIA_LABEL, type Incidencia, type EstadoIncidencia } from "@gateflow/paquetes";

const ESTADO_LABEL: Record<EstadoIncidencia, string> = { abierta: "Abierta", en_seguimiento: "En seguimiento", resuelta: "Resuelta" };
const ESTADO_CLASE: Record<EstadoIncidencia, string> = {
  abierta: "bg-destructive/10 text-destructive",
  en_seguimiento: "bg-warn/10 text-warn-foreground",
  resuelta: "bg-success/10 text-success",
};

export function IncidenciasClient({ incidenciasIniciales }: { incidenciasIniciales: Incidencia[] }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [filtro, setFiltro] = useState<EstadoIncidencia | "todas">("todas");
  const [resolviendo, setResolviendo] = useState<string | null>(null);

  const visibles = filtro === "todas" ? incidenciasIniciales : incidenciasIniciales.filter((i) => i.estado === filtro);

  async function handleResolver(id: string) {
    setResolviendo(id);
    try {
      // El usuario que resuelve viene de la sesión del navegador — no
      // se recibe por props para no depender de pasar session completa
      // solo para esto; se resuelve aquí mismo con getUser().
      const { data } = await supabase.auth.getUser();
      if (data.user) await resolverIncidencia(supabase, id, data.user.id);
      router.refresh();
    } finally {
      setResolviendo(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["todas", "abierta", "en_seguimiento", "resuelta"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${filtro === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}
          >
            {f === "todas" ? "Todas" : ESTADO_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Paquete</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Reportada por</th>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibles.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/paquetes/${i.paqueteId || ""}`} className="font-medium hover:text-primary">
                    {i.unidadIdentificador}
                  </Link>
                  <p className="gf-code text-xs text-muted-foreground">{i.paqueteCodigoGateflow}</p>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{TIPO_INCIDENCIA_LABEL[i.tipo]}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{i.reportadaPorNombre}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{new Date(i.creadaEn).toLocaleDateString("es-MX")}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[i.estado]}`}>{ESTADO_LABEL[i.estado]}</span>
                </td>
                <td className="px-4 py-2.5">
                  {i.estado !== "resuelta" && (
                    <button
                      onClick={() => handleResolver(i.id)}
                      disabled={resolviendo === i.id}
                      className="flex items-center gap-1 text-xs font-medium text-success disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {resolviendo === i.id ? "Resolviendo…" : "Resolver"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

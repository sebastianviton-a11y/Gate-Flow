"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock, RotateCcw } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  resolverIncidencia,
  cambiarEstadoSeguimiento,
  reabrirIncidencia,
  TIPO_INCIDENCIA_LABEL,
  NIVEL_DANIO_LABEL,
  type Incidencia,
  type EstadoIncidencia,
  type TipoIncidencia,
  type NivelDanio,
} from "@gateflow/paquetes";

const ESTADO_LABEL: Record<EstadoIncidencia, string> = { abierta: "Abierta", en_seguimiento: "En seguimiento", resuelta: "Resuelta" };
const ESTADO_CLASE: Record<EstadoIncidencia, string> = {
  abierta: "bg-destructive/10 text-destructive",
  en_seguimiento: "bg-warn/10 text-warn-foreground",
  resuelta: "bg-success/10 text-success",
};
const NIVEL_CLASE: Record<NivelDanio, string> = {
  leve: "bg-muted text-muted-foreground",
  moderado: "bg-warn/10 text-warn-foreground",
  grave: "bg-destructive/10 text-destructive",
};

export function IncidenciasClient({ incidenciasIniciales }: { incidenciasIniciales: Incidencia[] }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [filtroEstado, setFiltroEstado] = useState<EstadoIncidencia | "todas">("todas");
  const [filtroTipo, setFiltroTipo] = useState<TipoIncidencia | "todos">("todos");
  const [filtroNivel, setFiltroNivel] = useState<NivelDanio | "todos">("todos");
  const [filtroUnidad, setFiltroUnidad] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [procesando, setProcesando] = useState<string | null>(null);

  // Todo el filtrado ocurre sobre los datos ya cargados por el server
  // component (listarIncidencias sigue trayendo TODO el tenant) — no
  // se agregan consultas nuevas, solo se acota lo que ya llegó, igual
  // que hace Buscar paquete con sus filtros de estado.
  const visibles = useMemo(() => {
    return incidenciasIniciales.filter((i) => {
      if (filtroEstado !== "todas" && i.estado !== filtroEstado) return false;
      if (filtroTipo !== "todos" && i.tipo !== filtroTipo) return false;
      if (filtroNivel !== "todos" && i.nivelDanio !== filtroNivel) return false;
      if (filtroUnidad.trim() && !i.unidadIdentificador.toLowerCase().includes(filtroUnidad.trim().toLowerCase())) return false;
      if (fechaDesde && new Date(i.creadaEn) < new Date(fechaDesde)) return false;
      if (fechaHasta && new Date(i.creadaEn) > new Date(`${fechaHasta}T23:59:59`)) return false;
      return true;
    });
  }, [incidenciasIniciales, filtroEstado, filtroTipo, filtroNivel, filtroUnidad, fechaDesde, fechaHasta]);

  async function ejecutarCambio(id: string, accion: () => Promise<void>) {
    setProcesando(id);
    try {
      await accion();
      router.refresh();
    } finally {
      setProcesando(null);
    }
  }

  async function handleResolver(id: string) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const comentario = window.prompt("Comentario de resolución (opcional):") ?? undefined;
    await ejecutarCambio(id, () => resolverIncidencia(supabase, id, data.user.id, comentario || undefined));
  }

  async function handleEnSeguimiento(id: string) {
    await ejecutarCambio(id, () => cambiarEstadoSeguimiento(supabase, id));
  }

  async function handleReabrir(id: string) {
    await ejecutarCambio(id, () => reabrirIncidencia(supabase, id));
  }

  return (
    <div className="space-y-4">
      {/* ── Filtros (punto 7: residencial, fecha, tipo, gravedad, estado) ──
          "Residencial" ya está resuelto por diseño — este panel siempre
          opera dentro de un solo tenant (session.tenant.id en la página
          servidor); el filtro equivalente aquí es por unidad. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Estado</label>
          <div className="flex gap-1.5">
            {(["todas", "abierta", "en_seguimiento", "resuelta"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltroEstado(f)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${filtroEstado === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}
              >
                {f === "todas" ? "Todas" : ESTADO_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Tipo</label>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoIncidencia | "todos")} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="todos">Todos</option>
            {(Object.keys(TIPO_INCIDENCIA_LABEL) as TipoIncidencia[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_INCIDENCIA_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Gravedad</label>
          <select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as NivelDanio | "todos")} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="todos">Todas</option>
            {(Object.keys(NIVEL_DANIO_LABEL) as NivelDanio[]).map((n) => (
              <option key={n} value={n}>
                {NIVEL_DANIO_LABEL[n]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Unidad</label>
          <input
            value={filtroUnidad}
            onChange={(e) => setFiltroUnidad(e.target.value)}
            placeholder="Ej. A-101"
            className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Desde</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Paquete</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Gravedad</th>
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
                <td className="px-4 py-2.5">
                  {i.nivelDanio ? (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${NIVEL_CLASE[i.nivelDanio]}`}>{NIVEL_DANIO_LABEL[i.nivelDanio]}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{i.reportadaPorNombre}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{new Date(i.creadaEn).toLocaleDateString("es-MX")}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${ESTADO_CLASE[i.estado]}`}>{ESTADO_LABEL[i.estado]}</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-2">
                    {i.estado === "abierta" && (
                      <button onClick={() => handleEnSeguimiento(i.id)} disabled={procesando === i.id} className="flex items-center gap-1 text-xs font-medium text-warn-foreground disabled:opacity-50">
                        <Clock className="h-3.5 w-3.5" />
                        En seguimiento
                      </button>
                    )}
                    {i.estado !== "resuelta" && (
                      <button onClick={() => handleResolver(i.id)} disabled={procesando === i.id} className="flex items-center gap-1 text-xs font-medium text-success disabled:opacity-50">
                        <Check className="h-3.5 w-3.5" />
                        Resolver
                      </button>
                    )}
                    {i.estado !== "abierta" && (
                      <button onClick={() => handleReabrir(i.id)} disabled={procesando === i.id} className="flex items-center gap-1 text-xs font-medium text-destructive disabled:opacity-50">
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reabrir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Ninguna incidencia coincide con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

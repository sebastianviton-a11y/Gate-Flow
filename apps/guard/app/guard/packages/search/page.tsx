"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2, MapPin } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { buscarPaquetes } from "@gateflow/paquetes";
import type { Paquete } from "@gateflow/types";
import { Input, EstadoBadge } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { useGuardSession } from "@/components/session-provider";

type FiltroEstado = "todos" | "recibidos" | "entregados";

// Estados reales de estados_paquete (verificados contra la base de
// datos, no inventados) que corresponden a "recibido pero aún no
// entregado" — rechazado/devuelto quedan fuera a propósito, son
// paquetes cancelados, no pendientes de entrega normal.
const ESTADOS_RECIBIDOS = ["recibido", "notificado"];
const ESTADOS_ENTREGADOS = ["entregado"];

export default function SearchPackagePage() {
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();

  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Paquete[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>("todos");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!query.trim()) {
      setResultados([]);
      setBuscado(false);
      setError(null);
      return;
    }
    timer.current = setTimeout(async () => {
      setBuscando(true);
      setError(null);
      try {
        const data = await buscarPaquetes(supabase, session.tenant.id, query);
        setResultados(data);
      } catch (e) {
        setResultados([]);
        setError(e instanceof Error ? e.message : "No se pudo completar la búsqueda. Intenta de nuevo.");
      } finally {
        setBuscando(false);
        setBuscado(true);
      }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // El filtro se aplica sobre lo que YA devolvió buscarPaquetes — no
  // se duplica ni se cambia esa consulta (que ya respeta RLS y el
  // aislamiento por residencial); esto solo decide qué mostrar de lo
  // que ya llegó, tal como pidió la especificación explícitamente.
  const recibidos = useMemo(() => resultados.filter((p) => ESTADOS_RECIBIDOS.includes(p.estado)), [resultados]);
  const entregados = useMemo(() => resultados.filter((p) => ESTADOS_ENTREGADOS.includes(p.estado)), [resultados]);

  const resultadosFiltrados = filtro === "recibidos" ? recibidos : filtro === "entregados" ? entregados : resultados;

  const mensajeVacio =
    filtro === "recibidos"
      ? "No hay paquetes pendientes de entrega."
      : filtro === "entregados"
        ? "No se encontraron paquetes entregados."
        : "No se encontraron paquetes.";

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Buscar paquete" />

      <div className="flex-1 space-y-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Nombre, unidad, tracking o código GateFlow…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-14 pl-11 text-lg"
          />
          {buscando && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>

        {/* Selector segmentado — Todos / Recibidos / Entregados, con
            conteo real de la búsqueda actual junto a cada opción. */}
        <div className="flex rounded-xl border border-border bg-muted/40 p-1">
          {(
            [
              { valor: "todos" as const, etiqueta: "Todos", cantidad: resultados.length },
              { valor: "recibidos" as const, etiqueta: "Recibidos", cantidad: recibidos.length },
              { valor: "entregados" as const, etiqueta: "Entregados", cantidad: entregados.length },
            ]
          ).map((opcion) => (
            <button
              key={opcion.valor}
              onClick={() => setFiltro(opcion.valor)}
              className={`min-h-touch flex-1 rounded-lg text-sm font-medium transition-colors ${
                filtro === opcion.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {opcion.etiqueta}
              {buscado && <span className="ml-1 text-xs opacity-70">({opcion.cantidad})</span>}
            </button>
          ))}
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {resultadosFiltrados.length > 0 ? (
          <div className="space-y-2">
            {resultadosFiltrados.map((p) => {
              const yaEntregado = ESTADOS_ENTREGADOS.includes(p.estado);
              const contenido = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{p.unidadIdentificador}</p>
                      <EstadoBadge estado={p.estado} />
                    </div>
                    {p.residenteNombre && <p className="text-sm text-muted-foreground">{p.residenteNombre}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="gf-code">{p.codigoGateflow}</span>
                      {p.fechaRecepcion && <span>{new Date(p.fechaRecepcion).toLocaleString("es-MX")}</span>}
                    </div>
                    {!yaEntregado && p.ubicacionNombre && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        <MapPin className="h-3 w-3" />
                        {p.ubicacionNombre}
                      </span>
                    )}
                  </div>
                </>
              );

              // Para paquetes ya entregados: consulta histórica, sin
              // ningún camino que permita volver a "entregarlos" — no
              // se renderiza como enlace clicable en absoluto, para no
              // depender de que la pantalla de destino también lo
              // bloquee por su cuenta.
              if (yaEntregado) {
                return (
                  <div key={p.id} className="flex min-h-touch items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 opacity-80">
                    {contenido}
                  </div>
                );
              }

              return (
                <Link
                  key={p.id}
                  href={`/guard/packages/${p.id}`}
                  className="flex min-h-touch items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted"
                >
                  {contenido}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {buscado ? mensajeVacio : "Escribe cualquier dato que tengas a la mano."}
          </div>
        )}
      </div>
    </div>
  );
}

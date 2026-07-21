"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Loader2, MapPin } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { buscarPaquetes } from "@gateflow/paquetes";
import type { Paquete } from "@gateflow/types";
import { Input, EstadoBadge } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { useGuardSession } from "@/components/session-provider";

/**
 * useSearchParams() exige estar envuelto en <Suspense> en Next.js 14
 * App Router — sin esto, el build falla explícitamente para esta
 * página. Por eso la lógica real vive en un componente interno, y el
 * export default solo se encarga de envolverlo.
 */
function SearchPackageContent() {
  const session = useGuardSession();
  const supabase = createBrowserSupabaseClient();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [resultados, setResultados] = useState<Paquete[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!query.trim()) {
      setResultados([]);
      setBuscado(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const data = await buscarPaquetes(supabase, session.tenant.id, query);
        setResultados(data);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
        setBuscado(true);
      }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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

        {resultados.length > 0 ? (
          <div className="space-y-2">
            {resultados.map((p) => (
              <Link
                key={p.id}
                href={`/guard/packages/${p.id}`}
                className="flex min-h-touch items-center justify-between rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted"
              >
                <div>
                  <p className="font-medium">{p.unidadIdentificador}</p>
                  <span className="gf-code text-muted-foreground">{p.codigoGateflow}</span>
                  {p.ubicacionDescripcion && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {p.ubicacionDescripcion}
                    </p>
                  )}
                </div>
                <EstadoBadge estado={p.estado} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {buscado ? `Sin resultados para "${query}".` : "Escribe cualquier dato que tengas a la mano."}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPackagePage() {
  return (
    <Suspense fallback={null}>
      <SearchPackageContent />
    </Suspense>
  );
}

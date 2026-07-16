"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@gateflow/ui";
import type { EstadoPaquete } from "@gateflow/types";

const ESTADOS: { value: EstadoPaquete; label: string }[] = [
  { value: "recibido", label: "Recibido" },
  { value: "notificado", label: "Notificado" },
  { value: "entregado", label: "Entregado" },
  { value: "rechazado", label: "Rechazado" },
  { value: "devuelto", label: "Devuelto" },
];

/**
 * Los filtros viven en la URL (searchParams), no en estado de React —
 * así el listado es un Server Component normal que re-renderiza con
 * datos frescos en cada cambio, sin necesitar un endpoint aparte ni
 * duplicar la lógica de consulta en el cliente.
 */
export function FiltrosPaquetes({ estadoActual, textoActual }: { estadoActual?: string; textoActual?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function actualizar(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("pagina"); // toda edición de filtro reinicia la paginación
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          defaultValue={textoActual}
          placeholder="Buscar por código, unidad, residente, tracking…"
          className="pl-9"
          onKeyDown={(e) => {
            if (e.key === "Enter") actualizar("q", (e.target as HTMLInputElement).value || null);
          }}
        />
      </div>

      <select
        defaultValue={estadoActual ?? ""}
        onChange={(e) => actualizar("estado", e.target.value || null)}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Todos los estados</option>
        {ESTADOS.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </select>
    </div>
  );
}

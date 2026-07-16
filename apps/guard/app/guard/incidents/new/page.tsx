"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";

/**
 * BR-21: una incidencia siempre está asociada a un paquete existente —
 * por eso el primer paso es siempre identificar el paquete, nunca crear
 * una incidencia "suelta". Estructura consistente con ese requisito
 * aunque la conexión a datos reales llegue en Sprint 02.
 */
export default function NewIncidentPage() {
  const [query, setQuery] = useState("");

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Reportar incidencia" />

      <div className="flex-1 space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Primero identifica el paquete — toda incidencia queda asociada a uno (BR-21).
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Unidad, nombre o código GateFlow…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-14 pl-11 text-lg"
          />
        </div>

        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Al encontrar el paquete podrás elegir el tipo de incidencia (dañado, extraviado,
          etc.) y adjuntar evidencia fotográfica. Se conecta en Sprint 02.
        </div>
      </div>
    </div>
  );
}

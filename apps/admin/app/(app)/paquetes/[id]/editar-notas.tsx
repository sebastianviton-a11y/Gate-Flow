"use client";

import { useState, useTransition } from "react";
import { Button } from "@gateflow/ui";
import { actualizarNotasPaquete } from "./actions";

export function EditarNotas({ paqueteId, notasIniciales }: { paqueteId: string; notasIniciales: string }) {
  const [valor, setValor] = useState(notasIniciales);
  const [editando, setEditando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);

  if (!editando) {
    return (
      <button
        onClick={() => setEditando(true)}
        className="w-full rounded-md border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground hover:border-primary hover:text-foreground"
      >
        {valor || "Sin notas — toca para agregar"}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await actualizarNotasPaquete(paqueteId, valor);
              setGuardado(true);
              setEditando(false);
            })
          }
        >
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={pending}>
          Cancelar
        </Button>
        {guardado && <span className="self-center text-xs text-success">Guardado — queda en auditoría.</span>}
      </div>
    </div>
  );
}

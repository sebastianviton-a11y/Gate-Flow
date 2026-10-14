"use client";

import { useState } from "react";
import { Button, almacenDelNavegador, clavePrimerosPasosOculto, guardarMarca } from "@gateflow/ui";

/** Vuelve a mostrar «Primeros pasos» en el Dashboard de este residencial (si se había ocultado). */
export function MostrarPrimerosPasos({ usuarioId, tenantId }: { usuarioId: string; tenantId: string }) {
  const [listo, setListo] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        guardarMarca(almacenDelNavegador(), clavePrimerosPasosOculto(usuarioId, tenantId), false);
        setListo(true);
      }}
    >
      {listo ? "Listo: se verá en el Dashboard" : "Volver a mostrar «Primeros pasos»"}
    </Button>
  );
}

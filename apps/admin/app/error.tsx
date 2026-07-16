"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@gateflow/ui";

/**
 * Error boundary de ruta (App Router). Antes no existía ninguno — un error
 * no controlado en un Server Component (ej. variables de entorno faltantes,
 * ver packages/supabase/src/env.ts) rompía la pantalla sin ninguna salida para
 * quien la está probando por primera vez.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GateFlow] Error no controlado:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="h-5 w-5 text-destructive" />
      </span>
      <div>
        <h1 className="font-display text-lg font-semibold">Algo salió mal</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {error.message || "Ocurrió un error inesperado. Intenta de nuevo o revisa la consola del servidor."}
        </p>
      </div>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}

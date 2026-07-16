"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@gateflow/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GateFlow Guardia] Error no controlado:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="h-6 w-6 text-destructive" />
      </span>
      <div>
        <h1 className="font-display text-lg font-semibold">Algo salió mal</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {error.message || "Ocurrió un error inesperado."}
        </p>
      </div>
      <Button onClick={reset} className="min-h-touch px-8 text-base">
        Reintentar
      </Button>
    </div>
  );
}

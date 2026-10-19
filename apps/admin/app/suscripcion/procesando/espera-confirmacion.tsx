"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_MS = 3_000;
const MAX_INTENTOS = 20;

/**
 * Vuelve a pedir la página al servidor cada pocos segundos (solo
 * lectura). Cuando el webhook activa la suscripción, el servidor
 * redirige al panel. Tras ~1 minuto deja de insistir y ofrece reintentar.
 */
export function EsperaConfirmacion() {
  const router = useRouter();
  const [intentos, setIntentos] = useState(0);

  useEffect(() => {
    if (intentos >= MAX_INTENTOS) return;
    const t = setTimeout(() => {
      router.refresh();
      setIntentos((n) => n + 1);
    }, INTERVALO_MS);
    return () => clearTimeout(t);
  }, [intentos, router]);

  if (intentos < MAX_INTENTOS) {
    return <div aria-hidden className="mt-6 h-1 w-40 animate-pulse rounded bg-primary/60" />;
  }
  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <p className="text-sm text-white/70">Está tardando más de lo normal. Si ya pagaste, la confirmación llegará en breve.</p>
      <button
        type="button"
        onClick={() => setIntentos(0)}
        className="flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Volver a comprobar
      </button>
    </div>
  );
}

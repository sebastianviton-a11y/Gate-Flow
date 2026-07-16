"use client";

import { useEffect } from "react";

/**
 * Registro del service worker (public/sw.js). Vive en un componente cliente
 * separado porque `navigator.serviceWorker` no existe en el servidor —
 * mezclarlo directo en un Server Component rompería el render.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("[GateFlow Guardia] No se pudo registrar el service worker:", error);
      });
    }
  }, []);

  return null;
}

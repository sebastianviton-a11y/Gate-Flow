"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@gateflow/ui";

/**
 * Preparación arquitectónica para offline-first (02-ARCHITECTURE.md §5,
 * §10). Hoy solo refleja `navigator.onLine` — no hay cola de operaciones
 * pendientes ni sincronización real todavía; eso llega con el motor de
 * sincronización dedicado (PowerSync o equivalente) en un sprint futuro.
 * El guardia debe poder ver este estado en todo momento, incluso ahora
 * que no hace nada más que informarlo — es la base sobre la que se
 * construye el indicador real de "N registros pendientes de sincronizar".
 */
export function ConnectivityIndicator() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        online ? "bg-success/10 text-success" : "bg-warn/15 text-warn-foreground",
      )}
      role="status"
      aria-live="polite"
    >
      {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {online ? "Conectado" : "Sin conexión"}
    </div>
  );
}

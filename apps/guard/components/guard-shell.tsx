"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { GateFlowLogo } from "@gateflow/ui";
import type { SessionContext } from "@gateflow/types";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { ConnectivityIndicator } from "./connectivity-indicator";

/**
 * A propósito NO es un header con navegación — es una barra de estado.
 * El guardia navega desde los tiles grandes de la pantalla principal
 * (app/guard/page.tsx), no desde un menú persistente. Repetir el patrón
 * de sidebar/nav de apps/admin aquí sería exactamente el error que
 * Sprint 1.5 existe para evitar (UX_review previo: "no debe sentirse
 * como un dashboard administrativo reducido").
 */
export function GuardShell({ session }: { session: SessionContext }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex min-w-0 items-center gap-2">
        <GateFlowLogo size={26} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{session.tenant.nombre}</p>
          <p className="truncate text-xs leading-tight text-muted-foreground">{session.user.nombreCompleto}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ConnectivityIndicator />
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="Cerrar sesión"
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

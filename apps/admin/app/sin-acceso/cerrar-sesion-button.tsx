"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { borrarResidencialSeleccionado } from "@/app/sesion-actions";

/** `className` reemplaza el estilo por defecto (enlace subrayado). */
export function CerrarSesionButton({ className, children }: { className?: string; children?: ReactNode } = {}) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await borrarResidencialSeleccionado();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} className={className ?? "text-sm text-white/70 underline hover:text-white"}>
      {children}
      Cerrar sesión
    </button>
  );
}

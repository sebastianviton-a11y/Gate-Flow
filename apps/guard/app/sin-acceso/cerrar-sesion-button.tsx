"use client";

import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";

export function CerrarSesionButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} className="text-sm text-white/70 underline hover:text-white">
      Cerrar sesión
    </button>
  );
}

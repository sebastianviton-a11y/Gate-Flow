"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { GateFlowLogo } from "@gateflow/ui";

type Estado = "verificando" | "invalido";

/**
 * Mismo patrón que /aceptar-invitacion: el enlace de GoTrue llega con
 * `?code=` (PKCE) o con `#access_token=…` (implícito). En cuanto hay
 * sesión, se va a /onboarding (el middleware haría lo mismo con
 * cualquier ruta del panel mientras el onboarding no esté completo).
 */
export function ConfirmarCuentaForm() {
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabaseClient());
  const [estado, setEstado] = useState<Estado>("verificando");

  useEffect(() => {
    async function confirmar() {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

      if (params.get("error") || hashParams.get("error")) {
        setEstado("invalido");
        return;
      }

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("[GateFlow] confirmar-cuenta: exchangeCodeForSession falló:", error.message, error.status);
          setEstado("invalido");
          return;
        }
      } else {
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) {
            console.error("[GateFlow] confirmar-cuenta: setSession falló:", error.message, error.status);
          }
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setEstado("invalido");
        return;
      }

      // Quita el token de la URL antes de salir.
      window.history.replaceState(null, "", window.location.pathname);
      router.replace("/onboarding");
      router.refresh();
    }
    confirmar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (estado === "verificando") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-950 text-white/70">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Confirmando tu cuenta…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
        <GateFlowLogo size={48} onDark />
        <ShieldAlert className="mt-4 h-10 w-10 text-warn" />
        <p className="font-display text-lg font-semibold">Este enlace ya no es válido</p>
        <p className="text-sm text-white/60">Puede haber expirado o ya haberse usado. Si ya confirmaste tu cuenta, inicia sesión.</p>
        <div className="mt-2 flex gap-4 text-sm">
          <Link href="/login" className="text-primary underline">
            Iniciar sesión
          </Link>
          <Link href="/registro" className="text-white/60 underline">
            Registrarme de nuevo
          </Link>
        </div>
      </div>
    </div>
  );
}

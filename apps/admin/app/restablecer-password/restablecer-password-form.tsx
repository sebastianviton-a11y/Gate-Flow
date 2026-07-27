"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Label, GateFlowLogo } from "@gateflow/ui";
import { establecerPasswordInvitado } from "../establecer-password-action";

type Estado = "verificando" | "lista" | "invalida" | "enviando" | "exito";

export function RestablecerPasswordForm() {
  const router = useRouter();
  // Ver aceptar-invitacion-form.tsx — mismo motivo para usar useState
  // en vez de crear el cliente directo en el cuerpo del componente.
  const [supabase] = useState(() => createBrowserSupabaseClient());

  const [estado, setEstado] = useState<Estado>("verificando");
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verificarSesion() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { error: errorCambio } = await supabase.auth.exchangeCodeForSession(code);
        if (errorCambio) {
          console.error("[GateFlow] exchangeCodeForSession falló:", errorCambio.message, errorCambio.status);
          setEstado("invalida");
          return;
        }
      }

      const { data, error: errorSesion } = await supabase.auth.getSession();
      if (errorSesion) {
        console.error("[GateFlow] getSession falló:", errorSesion.message, errorSesion.status);
      }
      setEstado(data.session ? "lista" : "invalida");
    }
    verificarSesion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmarPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setEstado("enviando");
    setError(null);

    const resultado = await establecerPasswordInvitado(password);

    if (!resultado.ok) {
      setError(resultado.mensaje);
      setEstado("lista");
      return;
    }

    await supabase.auth.signOut();
    setEstado("exito");
    setTimeout(() => {
      router.replace("/login?password_created=1");
      router.refresh();
    }, 1500);
  }

  if (estado === "verificando") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    );
  }

  if (estado === "invalida") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
          <ShieldAlert className="h-10 w-10 text-warn" />
          <p className="font-display text-lg font-semibold">Este enlace ya no es válido</p>
          <p className="text-sm text-white/60">
            Puede haber expirado o ya haberse usado. Solicita un enlace nuevo desde &quot;¿Olvidaste tu contraseña?&quot;.
          </p>
        </div>
      </div>
    );
  }

  if (estado === "exito") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <p className="font-display text-lg font-semibold">Contraseña actualizada</p>
          <p className="text-sm text-white/60">Ahora inicia sesión con tu nueva contraseña…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center text-white">
          <GateFlowLogo size={56} onDark />
          <h1 className="mt-4 font-display text-xl font-semibold">Crea tu nueva contraseña</h1>
        </div>

        <div className="space-y-4 rounded-xl bg-white p-6">
          <div>
            <Label htmlFor="rp-password">Nueva contraseña</Label>
            <PasswordInput id="rp-password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="rp-password2">Confirmar contraseña</Label>
            <PasswordInput id="rp-password2" autoComplete="new-password" value={confirmarPassword} onChange={(e) => setConfirmarPassword(e.target.value)} className="mt-1.5" />
          </div>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Button onClick={handleSubmit} disabled={estado === "enviando"} className="w-full">
            {estado === "enviando" ? "Guardando…" : "Guardar y continuar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

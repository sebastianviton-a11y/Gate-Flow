"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Label, GateFlowLogo } from "@gateflow/ui";

type Estado = "verificando" | "lista" | "invalida" | "enviando" | "exito";

export function RestablecerPasswordForm() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [estado, setEstado] = useState<Estado>("verificando");
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Igual que en aceptar-invitacion: el token de recuperación llega
    // en el fragmento de la URL (#access_token=...), invisible para el
    // servidor a propósito — el cliente de navegador ya lo procesa
    // solo al crearse, aquí solo se confirma que quedó una sesión real.
    supabase.auth.getSession().then(({ data }) => {
      setEstado(data.session ? "lista" : "invalida");
    });
  }, [supabase]);

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

    const { error: errorPassword } = await supabase.auth.updateUser({ password });
    if (errorPassword) {
      setError(errorPassword.message);
      setEstado("lista");
      return;
    }

    setEstado("exito");
    setTimeout(() => {
      router.replace("/dashboard");
      router.refresh();
    }, 1800);
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
          <p className="text-sm text-white/60">Entrando a tu panel…</p>
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
            <PasswordInput id="rp-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="rp-password2">Confirmar contraseña</Label>
            <PasswordInput id="rp-password2" value={confirmarPassword} onChange={(e) => setConfirmarPassword(e.target.value)} className="mt-1.5" />
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

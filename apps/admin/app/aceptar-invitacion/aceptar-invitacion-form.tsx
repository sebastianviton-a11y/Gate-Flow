"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Label, GateFlowLogo } from "@gateflow/ui";

type Estado = "verificando" | "lista" | "invalida" | "enviando" | "error";

export function AceptarInvitacionForm() {
  const router = useRouter();
  // useState (no una variable normal) — createBrowserSupabaseClient()
  // llamado directo en el cuerpo del componente creaba una instancia
  // NUEVA en cada render (cada tecla escrita re-renderiza). El
  // useEffect de abajo tenía [supabase] como dependencia, así que se
  // volvía a ejecutar en cada render también, compitiendo con el
  // procesamiento del token de la URL. Con useState, la instancia se
  // crea una sola vez, en el montaje.
  const [supabase] = useState(() => createBrowserSupabaseClient());

  const [estado, setEstado] = useState<Estado>("verificando");
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verificarSesion() {
      // El enlace real que genera admin.inviteUserByEmail() con
      // redirectTo entrega el token en el FRAGMENTO de la URL
      // (#access_token=...) — @supabase/ssr lo detecta y procesa solo,
      // al crear el cliente (detectSessionInUrl, activado por
      // defecto). Por si el proyecto llegara a emitir el otro formato
      // (?code=..., típico de PKCE en flujos iniciados por el propio
      // navegador), se soporta también aquí sin necesitar una ruta
      // /auth/callback separada — ninguno de los dos casos se descarta
      // a ciegas.
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
    // Solo al montar — nunca debe repetirse por un re-render.
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
    if (!aceptaTerminos) {
      setError("Debes aceptar los términos y condiciones para continuar.");
      return;
    }

    setEstado("enviando");
    setError(null);

    const { data: dataUpdate, error: errorPassword } = await supabase.auth.updateUser({ password });

    // No basta con "sin error" — se exige explícitamente que el
    // usuario actualizado exista en la respuesta real de Supabase
    // antes de mostrar cualquier éxito.
    if (errorPassword || !dataUpdate.user) {
      console.error(
        "[GateFlow] updateUser falló al crear contraseña:",
        errorPassword?.message,
        "code:",
        (errorPassword as { code?: string } | undefined)?.code,
        "status:",
        errorPassword?.status,
      );
      setError(errorPassword?.message ?? "No se pudo guardar la contraseña. Intenta de nuevo.");
      setEstado("lista");
      return;
    }

    await supabase.from("users").update({ terminos_aceptados_en: new Date().toISOString() }).eq("id", dataUpdate.user.id);

    // Cierra la sesión temporal de la invitación a propósito, en vez
    // de continuar directo al dashboard con ella. Forzar un login
    // real con signInWithPassword aquí es la única forma de probar,
    // de punta a punta, que la contraseña que se acaba de crear es la
    // que de verdad funciona — no basta con que updateUser() no haya
    // devuelto error.
    await supabase.auth.signOut();
    router.replace("/login?password_created=1");
    router.refresh();
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
          <p className="text-sm text-white/60">Puede haber expirado o ya haberse usado. Solicita una nueva invitación.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center text-white">
          <GateFlowLogo size={56} onDark />
          <h1 className="mt-4 font-display text-xl font-semibold">Crea tu contraseña</h1>
          <p className="mt-1 text-sm text-white/60">Este es tu primer acceso a GateFlow.</p>
        </div>

        <div className="space-y-4 rounded-xl bg-white p-6">
          <div>
            <Label htmlFor="ai-password">Contraseña</Label>
            <PasswordInput id="ai-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ai-password2">Confirmar contraseña</Label>
            <PasswordInput id="ai-password2" value={confirmarPassword} onChange={(e) => setConfirmarPassword(e.target.value)} className="mt-1.5" />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={aceptaTerminos} onChange={(e) => setAceptaTerminos(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>
              Acepto los{" "}
              <a href="/terminos" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                términos y condiciones
              </a>{" "}
              de GateFlow.
            </span>
          </label>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Button onClick={handleSubmit} disabled={estado === "enviando"} className="w-full">
            {estado === "enviando" ? "Creando cuenta…" : "Crear contraseña y continuar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

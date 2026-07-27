"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Label, GateFlowLogo, DebugConsole } from "@gateflow/ui";
import { establecerPasswordInvitado } from "../establecer-password-action";

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
      console.log("STEP 1: aceptar-invitacion montado. URL completa:", window.location.href);
      console.log("STEP 1b: hash presente:", window.location.hash ? "SÍ" : "NO", "| search presente:", window.location.search ? "SÍ" : "NO");

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      console.log("STEP 2: ?code= en la URL:", code ? `presente (${code.slice(0, 8)}...)` : "ausente");

      if (code) {
        const { data: dataExchange, error: errorCambio } = await supabase.auth.exchangeCodeForSession(code);
        console.log("STEP 2b: exchangeCodeForSession data:", JSON.stringify({ hasSession: !!dataExchange?.session, userId: dataExchange?.user?.id }));
        console.log("STEP 2c: exchangeCodeForSession error:", errorCambio ? `${errorCambio.message} | status: ${errorCambio.status}` : "ninguno");
        if (errorCambio) {
          console.error("[GateFlow] exchangeCodeForSession falló:", errorCambio.message, errorCambio.status);
          setEstado("invalida");
          return;
        }
      }

      const { data, error: errorSesion } = await supabase.auth.getSession();
      console.log(
        "STEP 3: getSession() ->",
        JSON.stringify({
          haySesion: !!data.session,
          userId: data.session?.user?.id,
          email: data.session?.user?.email,
          expiresAt: data.session?.expires_at,
        }),
      );
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

    // STEP 4: confirmar, justo antes de llamar a la Server Action, que
    // el navegador SÍ tiene sesión — si esto ya sale vacío aquí, el
    // problema está antes de llegar siquiera a establecerPasswordInvitado.
    const { data: sesionAntes } = await supabase.auth.getSession();
    console.log(
      "STEP 4: sesión justo antes de establecerPasswordInvitado ->",
      JSON.stringify({ haySesion: !!sesionAntes.session, userId: sesionAntes.session?.user?.id, email: sesionAntes.session?.user?.email }),
    );

    const resultado = await establecerPasswordInvitado(password);
    console.log("STEP 5: resultado de establecerPasswordInvitado ->", JSON.stringify(resultado));

    if (!resultado.ok) {
      setError(resultado.mensaje);
      setEstado("lista");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    console.log("STEP 6: getUser() después del éxito ->", JSON.stringify({ userId: userData.user?.id, email: userData.user?.email }));
    if (userData.user) {
      const { error: errorTerminos } = await supabase
        .from("users")
        .update({ terminos_aceptados_en: new Date().toISOString() })
        .eq("id", userData.user.id);
      console.log("STEP 6b: update terminos_aceptados_en error:", errorTerminos ? errorTerminos.message : "ninguno");
    }

    // Cierra la sesión temporal de la invitación a propósito, en vez
    // de continuar directo al dashboard con ella. Forzar un login
    // real con signInWithPassword aquí es la única forma de probar,
    // de punta a punta, que la contraseña que se acaba de crear es la
    // que de verdad funciona — no basta con que updateUser() no haya
    // devuelto error.
    await supabase.auth.signOut();
    const { data: sesionDespues } = await supabase.auth.getSession();
    console.log("STEP 7: signOut() ejecutado. Sesión residual:", sesionDespues.session ? "TODAVÍA HAY SESIÓN (inesperado)" : "ninguna, correcto");
    console.log("STEP 7b: redirigiendo a /login?password_created=1");
    router.replace("/login?password_created=1");
    router.refresh();
  }

  if (estado === "verificando") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
        <DebugConsole />
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
        <DebugConsole />
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
            <PasswordInput id="ai-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ai-password2">Confirmar contraseña</Label>
            <PasswordInput id="ai-password2" autoComplete="new-password" value={confirmarPassword} onChange={(e) => setConfirmarPassword(e.target.value)} className="mt-1.5" />
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
      <DebugConsole />
    </div>
  );
}

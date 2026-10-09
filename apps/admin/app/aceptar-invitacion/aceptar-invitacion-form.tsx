"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Label, GateFlowLogo } from "@gateflow/ui";
import { establecerPasswordInvitado } from "../establecer-password-action";
import { SELECT_MEMBRESIA_PANEL, destinoTrasAutenticar } from "@/lib/acceso-panel";
import { borrarResidencialSeleccionado } from "@/app/sesion-actions";

type Estado = "verificando" | "lista" | "invalida" | "enviando" | "error";

export function AceptarInvitacionForm() {
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabaseClient());

  const [estado, setEstado] = useState<Estado>("verificando");
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [password, setPassword] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
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
      } else {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (accessToken && refreshToken) {
          const { error: errorSetSession } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (errorSetSession) console.error("[GateFlow] aceptar-invitacion: setSession falló:", errorSetSession.message, errorSetSession.status);
        }
      }

      const { data, error: errorSesion } = await supabase.auth.getSession();
      // Sin tokens en la URL ni en la consola una vez leídos.
      window.history.replaceState(null, "", window.location.pathname);
      if (errorSesion) {
        console.error("[GateFlow] getSession falló:", errorSesion.message, errorSesion.status);
      }
      setEstado(data.session ? "lista" : "invalida");
    }
    verificarSesion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    if (nombreCompleto.trim().length < 3) {
      setError("Ingresa tu nombre completo.");
      return;
    }
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

    // Perfil y destino ANTES de la contraseña: Supabase Auth cierra todas
    // las sesiones del usuario al cambiarla (admin.updateUserById), así
    // que después ya no hay sesión para leer membresías ni guardar el
    // nombre y la aceptación de términos.
    const { data: userData } = await supabase.auth.getUser();
    // Un guardia invitado inicia sesión en la app Guard, no en Admin.
    // Con membresías previas se evalúan TODAS: si alguna es de Admin, va
    // al login de Admin y después a /seleccionar-residencial.
    let destino = { enGuard: false, url: "/login?password_created=1" };
    if (userData.user) {
      const { data: membresias, error: errorMembresia } = await supabase
        .from("user_tenants")
        .select(SELECT_MEMBRESIA_PANEL)
        .eq("user_id", userData.user.id)
        .eq("activo", true);
      destino = destinoTrasAutenticar(errorMembresia, membresias ?? [], {
        admin: "/login?password_created=1",
        guard: "/login?password_created=1",
      });
    }
    if (userData.user) {
      const { error: errorPerfil } = await supabase
        .from("users")
        .update({ nombre_completo: nombreCompleto.trim(), terminos_aceptados_en: new Date().toISOString() })
        .eq("id", userData.user.id);
      if (errorPerfil) console.error("[GateFlow] aceptar-invitacion: no se guardó el perfil:", errorPerfil.message);
    }

    const resultado = await establecerPasswordInvitado(password);

    if (!resultado.ok) {
      setError(resultado.mensaje);
      setEstado("lista");
      return;
    }

    await borrarResidencialSeleccionado();
    await supabase.auth.signOut();
    if (destino.enGuard) {
      window.location.assign(destino.url);
      return;
    }
    router.replace(destino.url);
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
            <Label htmlFor="ai-nombre">Nombre completo</Label>
            <input
              id="ai-nombre"
              type="text"
              autoFocus
              autoComplete="name"
              value={nombreCompleto}
              onChange={(e) => setNombreCompleto(e.target.value)}
              className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Ej. Juan Pérez"
            />
          </div>
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
    </div>
  );
}

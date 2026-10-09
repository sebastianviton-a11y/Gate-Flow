"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, MailCheck } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Input, Label, GateFlowLogo } from "@gateflow/ui";
import { SELECT_MEMBRESIA_PANEL, destinoTrasAutenticar } from "@/lib/acceso-panel";
import { borrarResidencialSeleccionado } from "@/app/sesion-actions";
import { reenviarCorreoConfirmacion } from "@/app/login/actions";
import { ESPERA_REENVIO_MS, crearControlReenvio, ofreceReenvioConfirmacion, type ResultadoReenvio } from "@/lib/registro/reenvio";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Correo cuyo login respondió "pendiente de confirmación": solo entonces
  // se ofrece reenviar el correo (nunca para credenciales incorrectas).
  const [correoPendiente, setCorreoPendiente] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);
  const [resultadoReenvio, setResultadoReenvio] = useState<ResultadoReenvio | null>(null);
  const [reenvioEnPausa, setReenvioEnPausa] = useState(false);
  const controlReenvio = useRef(crearControlReenvio(reenviarCorreoConfirmacion));

  const passwordCreated = searchParams.get("password_created") === "1";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setCorreoPendiente(null);
    setResultadoReenvio(null);

    const supabase = createBrowserSupabaseClient();
    const emailNormalizado = email.trim().toLowerCase();
    const passwordNormalizada = password.trim();
    const { data: dataSignIn, error: signInError } = await supabase.auth.signInWithPassword({
      email: emailNormalizado,
      password: passwordNormalizada,
    });

    if (signInError) {
      console.error(
        "[GateFlow] signInWithPassword falló:",
        signInError.message,
        "code:",
        (signInError as { code?: string }).code,
        "status:",
        signInError.status,
      );
      const codigo = (signInError as { code?: string }).code;
      setError(mensajeErrorLogin(codigo));
      if (ofreceReenvioConfirmacion(codigo)) setCorreoPendiente(emailNormalizado);
      setLoading(false);
      return;
    }

    const next = searchParams.get("next") ?? "/dashboard";

    // Un guardia no usa este panel: termina en la app Guard (con varias
    // membresías, solo si todas son de guardia; si hay alguna de Admin,
    // el middleware lleva a /seleccionar-residencial). La sesión de Admin
    // no viaja a otro dominio, así que se cierra solo aquí (scope local:
    // no afecta su sesión en Guard) y allí inicia sesión.
    if (dataSignIn.user) {
      const { data: membresias, error: errorMembresia } = await supabase
        .from("user_tenants")
        .select(SELECT_MEMBRESIA_PANEL)
        .eq("user_id", dataSignIn.user.id)
        .eq("activo", true);
      const destino = destinoTrasAutenticar(errorMembresia, membresias ?? [], { admin: next, guard: "/login" });
      if (destino.enGuard) {
        await borrarResidencialSeleccionado();
        await supabase.auth.signOut({ scope: "local" });
        window.location.assign(destino.url);
        return;
      }
    }

    router.replace(next);
    router.refresh();
  }

  async function reenviarConfirmacion() {
    // Un segundo clic mientras hay una solicitud en curso, o durante la
    // pausa posterior a un envío, no llega al servidor.
    if (!correoPendiente || !controlReenvio.current.puedeIntentar()) return;
    setReenviando(true);
    const r = await controlReenvio.current.intentar(correoPendiente);
    setReenviando(false);
    if (!r) return;
    setResultadoReenvio(r);
    if (r.estado !== "error") {
      setReenvioEnPausa(true);
      window.setTimeout(() => setReenvioEnPausa(false), ESPERA_REENVIO_MS);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center text-white">
          <GateFlowLogo size={77} onDark />
          <h1 className="font-display mt-1.5 text-xl font-semibold tracking-tight">Gate Flow</h1>
          <p className="mt-1 text-xs uppercase tracking-wide text-primary">Panel de administración</p>
          <p className="mt-1 text-sm text-white/50">Control inteligente de paquetes residenciales.</p>
        </div>

        {passwordCreated && (
          <p className="mb-4 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Contraseña creada. Inicia sesión con ella a continuación.
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-white/10 bg-ink-900 p-6 shadow-xl"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-white/80">
              Correo
            </Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@residencial.com"
              className="border-white/10 bg-ink-950 text-white placeholder:text-white/30"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-white/80">
              Contraseña
            </Label>
            <PasswordInput
              id="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="border-white/10 bg-ink-950 text-white placeholder:text-white/30"
              iconClassName="text-white/50 hover:text-white"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {correoPendiente && (
            <div className="space-y-2" data-testid="reenvio-confirmacion">
              <Button
                type="button"
                variant="outline"
                onClick={reenviarConfirmacion}
                disabled={reenviando || reenvioEnPausa}
                aria-busy={reenviando}
                className="h-auto min-h-10 w-full whitespace-normal border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                {reenviando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <MailCheck className="h-4 w-4 shrink-0" />}
                {reenviando ? "Enviando..." : "Reenviar correo de confirmación"}
              </Button>
              {resultadoReenvio && (
                <p
                  role="status"
                  aria-live="polite"
                  data-estado={resultadoReenvio.estado}
                  className={`rounded-md px-3 py-2 text-sm ${
                    resultadoReenvio.estado === "enviado" ? "bg-success/10 text-success" : "bg-white/5 text-white/80"
                  }`}
                >
                  {resultadoReenvio.mensaje}
                </p>
              )}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Ingresando..." : "Ingresar"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-white/60">
          ¿Todavía no tienes cuenta?{" "}
          <a href="/registro" className="text-primary underline">
            Prueba Gate Flow 30 días gratis
          </a>
        </p>

        <p className="mt-4 text-center text-xs text-white/30">
          El acceso de guardias en campo se realiza desde la app móvil offline-first.
        </p>
      </div>
    </div>
  );
}

/** Mensaje para la persona; el detalle técnico queda solo en la consola. */
function mensajeErrorLogin(codigo: string | undefined): string {
  if (codigo === "email_not_confirmed") return "Tu correo todavía no está confirmado. Abre el enlace que te enviamos al registrarte.";
  if (codigo === "invalid_credentials") return "Correo o contraseña incorrectos.";
  if (codigo === "over_request_rate_limit" || codigo === "over_email_send_rate_limit") return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
  return "No pudimos iniciar sesión. Inténtalo de nuevo en unos minutos.";
}

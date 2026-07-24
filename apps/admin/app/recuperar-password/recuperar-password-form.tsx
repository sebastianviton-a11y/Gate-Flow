"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, Input, Label, GateFlowLogo } from "@gateflow/ui";

/**
 * No revela si el correo existe o no en el mensaje final — mismo
 * principio de seguridad que ya aplica el login ("No pudimos iniciar
 * sesión" sin distinguir la causa). Supabase, por diseño, no indica
 * si el correo existe en la respuesta de resetPasswordForEmail
 * tampoco, así que este comportamiento es consistente de punta a
 * punta, no solo en apariencia.
 */
export function RecuperarPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabaseClient();
    const { error: errorEnvio } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${process.env.NEXT_PUBLIC_ADMIN_APP_URL ?? ""}/restablecer-password`,
    });

    setLoading(false);

    if (errorEnvio) {
      // Un error aquí normalmente es de red/servidor, no de "correo no
      // encontrado" (eso Supabase lo trata como éxito silencioso, a
      // propósito, por seguridad) — por eso el mensaje habla de
      // intentarlo de nuevo, no de verificar el correo.
      setError("No se pudo enviar el correo en este momento. Intenta de nuevo en unos minutos.");
      return;
    }

    setEnviado(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center text-white">
          <GateFlowLogo size={56} onDark />
          <h1 className="font-display mt-3 text-xl font-semibold tracking-tight">Recuperar contraseña</h1>
          <p className="mt-1 text-sm text-white/50">Te enviaremos un enlace para crear una nueva.</p>
        </div>

        {enviado ? (
          <div className="space-y-4 rounded-lg border border-white/10 bg-ink-900 p-6 text-center shadow-xl">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <p className="text-sm text-white/80">
              Si <strong>{email}</strong> tiene una cuenta en GateFlow, recibirás un correo con instrucciones en los próximos minutos. Revisa
              también la carpeta de spam.
            </p>
            <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-primary/80 underline hover:text-primary">
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-white/10 bg-ink-900 p-6 shadow-xl">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-white/80">
                Correo
              </Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@residencial.com"
                className="border-white/10 bg-ink-950 text-white placeholder:text-white/30"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Enviando..." : "Enviar enlace de recuperación"}
            </Button>

            <p className="text-center text-sm">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-white/50 underline hover:text-white/80">
                <ArrowLeft className="h-3.5 w-3.5" />
                Volver a iniciar sesión
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

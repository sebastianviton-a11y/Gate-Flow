"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, PasswordInput, Input, Label, GateFlowLogo } from "@gateflow/ui";

export function GuardLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordCreated = searchParams.get("password_created") === "1";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: password.trim(),
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
      setError("No pudimos iniciar sesión. Verifica tu correo y contraseña.");
      setLoading(false);
      return;
    }

    const next = searchParams.get("next") ?? "/guard";
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center text-white">
          <GateFlowLogo size={64} onDark />
          <h1 className="font-display mt-3 text-2xl font-semibold tracking-tight">Gate Flow</h1>
          <p className="mt-1 text-xs uppercase tracking-wide text-primary">Portería</p>
          <p className="mt-1 text-sm text-white/50">Envíos que fluyen, conexiones que llegan.</p>
        </div>

        {passwordCreated && (
          <p className="mb-4 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Contraseña creada. Inicia sesión con ella a continuación.
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-xl"
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
              placeholder="guardia@residencial.com"
              className="h-12 border-white/10 bg-ink-950 text-base text-white placeholder:text-white/30"
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
              className="h-12 border-white/10 bg-ink-950 text-base text-white placeholder:text-white/30"
              iconClassName="text-white/50 hover:text-white"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="min-h-touch w-full text-base">
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Ingresando..." : "Ingresar"}
          </Button>

          <p className="text-center text-sm">
            <Link href="/recuperar-password" className="text-primary/80 underline hover:text-primary">
              ¿Olvidaste tu contraseña?
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

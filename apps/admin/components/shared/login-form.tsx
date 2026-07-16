"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase";
import { Button, Input, Label, GateFlowLogo } from "@gateflow/ui";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createBrowserSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError("No pudimos iniciar sesión. Verifica tu correo y contraseña.");
      setLoading(false);
      return;
    }

    const next = searchParams.get("next") ?? "/dashboard";
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center text-white">
          <GateFlowLogo size={56} onDark />
          <h1 className="font-display mt-3 text-xl font-semibold tracking-tight">Gate Flow</h1>
          <p className="mt-1 text-xs uppercase tracking-wide text-primary">Panel de administración</p>
          <p className="mt-1 text-sm text-white/50">Envíos que fluyen, conexiones que llegan.</p>
        </div>

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
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
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
            {loading ? "Ingresando..." : "Ingresar"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-white/30">
          El acceso de guardias en campo se realiza desde la app móvil offline-first.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { Button, GateFlowLogo, Input, Label, PasswordInput } from "@gateflow/ui";
import type { ResultadoAlta } from "@/lib/registro/alta";
import { MAX_VIVIENDAS_AUTOSERVICIO, MENSAJE_CONTACTO, PAISES_REGISTRO, type ErroresRegistro } from "@/lib/registro/validacion";
import { registrarCuentaPrueba } from "./actions";

type Pantalla = "formulario" | "revisa_correo" | "contacto";

const CLASE_CAMPO = "border-white/10 bg-ink-950 text-white placeholder:text-white/30";

export function RegistroForm({ tokenTiempo }: { tokenTiempo: string }) {
  const [pantalla, setPantalla] = useState<Pantalla>("formulario");
  const [enviando, setEnviando] = useState(false);
  const [errores, setErrores] = useState<ErroresRegistro>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [mensajeFinal, setMensajeFinal] = useState("");
  const [timezone, setTimezone] = useState("");
  const [viviendas, setViviendas] = useState("");

  // Zona horaria del navegador: se manda oculta y el servidor la valida.
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    } catch {
      setTimezone("");
    }
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrores({});
    setErrorGeneral(null);

    // Más de 150 viviendas: ni siquiera se envía. El servidor aplica
    // la misma regla por su cuenta.
    if (/^\d+$/.test(viviendas.trim()) && Number(viviendas) > MAX_VIVIENDAS_AUTOSERVICIO) {
      setMensajeFinal(MENSAJE_CONTACTO);
      setPantalla("contacto");
      return;
    }

    setEnviando(true);
    let resultado: ResultadoAlta;
    try {
      resultado = await registrarCuentaPrueba(new FormData(e.currentTarget));
    } catch {
      resultado = { tipo: "error", mensaje: "No pudimos procesar tu registro. Inténtalo de nuevo." };
    }
    setEnviando(false);

    switch (resultado.tipo) {
      case "revisa_correo":
      case "contacto":
        setMensajeFinal(resultado.mensaje);
        setPantalla(resultado.tipo);
        return;
      case "campos":
        setErrores(resultado.errores);
        return;
      case "error":
        setErrorGeneral(resultado.mensaje);
        return;
    }
  }

  if (pantalla === "revisa_correo") {
    return (
      <Marco>
        <div className="flex flex-col items-center gap-3 text-center">
          <MailCheck className="h-10 w-10 text-success" />
          <h1 className="font-display text-xl font-semibold text-white">Revisa tu correo</h1>
          <p className="text-sm text-white/70">{mensajeFinal}</p>
          <p className="text-xs text-white/50">Te enviamos un enlace para confirmar tu cuenta. Si no lo ves, revisa la carpeta de spam.</p>
          <Link href="/login" className="mt-2 text-sm text-primary underline">
            Ir a iniciar sesión
          </Link>
        </div>
      </Marco>
    );
  }

  if (pantalla === "contacto") {
    return (
      <Marco>
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="font-display text-xl font-semibold text-white">Hablemos</h1>
          <p className="text-sm text-white/70">{mensajeFinal}</p>
          <a href="mailto:hola@gateflow.mx" className="mt-2 text-sm text-primary underline">
            hola@gateflow.mx
          </a>
          <button type="button" onClick={() => setPantalla("formulario")} className="text-xs text-white/50 underline">
            Volver
          </button>
        </div>
      </Marco>
    );
  }

  return (
    <Marco>
      <div className="mb-6 text-center text-white">
        <h1 className="font-display text-xl font-semibold tracking-tight">Prueba Gate Flow gratis</h1>
        <p className="mt-1 text-sm text-white/60">30 días con todo incluido. Sin tarjeta.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4" autoComplete="on">
        <Campo id="nombreCompleto" etiqueta="Nombre y apellido" error={errores.nombreCompleto}>
          <Input id="nombreCompleto" name="nombreCompleto" autoComplete="name" required maxLength={80} placeholder="Ana Pérez" className={CLASE_CAMPO} />
        </Campo>

        <Campo id="email" etiqueta="Correo" error={errores.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="ana@residencial.com" className={CLASE_CAMPO} />
        </Campo>

        <Campo id="password" etiqueta="Contraseña" error={errores.password}>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            placeholder="Mínimo 8 caracteres"
            className={CLASE_CAMPO}
            iconClassName="text-white/50 hover:text-white"
          />
        </Campo>

        <Campo id="nombreResidencial" etiqueta="Nombre del residencial" error={errores.nombreResidencial}>
          <Input id="nombreResidencial" name="nombreResidencial" autoComplete="organization" required maxLength={80} placeholder="Residencial Las Palmas" className={CLASE_CAMPO} />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo id="pais" etiqueta="País" error={errores.pais}>
            <select id="pais" name="pais" required defaultValue="MX" className={`flex h-10 w-full rounded-md border px-3 text-sm ${CLASE_CAMPO}`}>
              {PAISES_REGISTRO.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="viviendas" etiqueta="Viviendas (aprox.)" error={errores.viviendas}>
            <Input
              id="viviendas"
              name="viviendas"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              value={viviendas}
              onChange={(e) => setViviendas(e.target.value)}
              placeholder="48"
              className={CLASE_CAMPO}
            />
          </Campo>
        </div>

        <div>
          <label className="flex items-start gap-2 text-sm text-white/80">
            <input type="checkbox" name="aceptaTerminos" value="on" required className="mt-0.5 h-4 w-4" />
            <span>
              Acepto los{" "}
              <a href="/terminos" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Términos y Condiciones
              </a>{" "}
              y el{" "}
              <a href="/privacidad" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Aviso de Privacidad
              </a>
              .
            </span>
          </label>
          {errores.aceptaTerminos && <p className="mt-1 text-xs text-destructive">{errores.aceptaTerminos}</p>}
        </div>

        {/* Campos invisibles: zona horaria, token de tiempo y honeypot. */}
        <input type="hidden" name="timezone" value={timezone} />
        <input type="hidden" name="t" value={tokenTiempo} />
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="sitio_web">Sitio web</label>
          <input id="sitio_web" name="sitio_web" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>

        {errorGeneral && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorGeneral}
          </p>
        )}

        <Button type="submit" disabled={enviando} className="w-full">
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {enviando ? "Creando tu cuenta…" : "Empezar prueba gratis"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-primary underline">
          Inicia sesión
        </Link>
      </p>
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <GateFlowLogo size={64} onDark />
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900 p-6 shadow-xl">{children}</div>
      </div>
    </div>
  );
}

function Campo({ id, etiqueta, error, children }: { id: string; etiqueta: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-white/80">
        {etiqueta}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Widget de Cloudflare Turnstile (render explícito, sin dependencias).
 * El token sale por onToken y el formulario lo manda como
 * cf-turnstile-response; el servidor lo verifica (lib/registro/antibot.ts).
 * Un token sirve una sola vez: tras cada envío fallido hay que llamar a
 * reset() para obtener otro.
 */

interface ApiTurnstile {
  render(contenedor: HTMLElement, opciones: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let cargaScript: Promise<ApiTurnstile> | null = null;

function cargarTurnstile(): Promise<ApiTurnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!cargaScript) {
    cargaScript = new Promise<ApiTurnstile>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile no disponible")));
      script.onerror = () => {
        cargaScript = null;
        reject(new Error("no se pudo cargar turnstile"));
      };
      document.head.appendChild(script);
    });
  }
  return cargaScript;
}

export interface TurnstileHandle {
  reset(): void;
}

interface Props {
  siteKey: string;
  onToken(token: string | null): void;
  onError(): void;
  /** Acción que Cloudflare asocia al token (por omisión, "registro"). */
  accion?: string;
  tema?: "dark" | "light";
}

export const TurnstileWidget = forwardRef<TurnstileHandle, Props>(function TurnstileWidget(
  { siteKey, onToken, onError, accion = "registro", tema = "dark" },
  ref,
) {
  const contenedor = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Los callbacks del widget se registran una vez: siempre llaman a la última versión.
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  useImperativeHandle(ref, () => ({
    reset() {
      callbacks.current.onToken(null);
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    let activo = true;
    cargarTurnstile()
      .then((api) => {
        if (!activo || !contenedor.current) return;
        widgetId.current = api.render(contenedor.current, {
          sitekey: siteKey,
          action: accion,
          theme: tema,
          language: "es",
          // El formulario manda el token en su propio campo oculto.
          "response-field": false,
          callback: (token: string) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(null),
          "timeout-callback": () => callbacks.current.onToken(null),
          "error-callback": () => {
            callbacks.current.onToken(null);
            callbacks.current.onError();
          },
        });
      })
      .catch(() => {
        if (activo) callbacks.current.onError();
      });
    return () => {
      activo = false;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, accion, tema]);

  return <div ref={contenedor} data-turnstile={accion} className="flex min-h-[65px] justify-center" />;
});

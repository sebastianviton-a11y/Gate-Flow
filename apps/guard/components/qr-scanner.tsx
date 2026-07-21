"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, AlertTriangle } from "lucide-react";

interface QrScannerProps {
  onDetectado: (texto: string) => void;
}

type EstadoCamara = "iniciando" | "activa" | "sin_permiso" | "error";

/**
 * @zxing/browser decodifica en JavaScript puro (no depende de la API
 * nativa "Barcode Detection", que Safari/iOS no soporta en absoluto —
 * verificado antes de elegir esta librería). Import dinámico: la
 * librería solo se necesita en esta pantalla, no tiene sentido incluirla
 * en el bundle de ninguna otra parte de la app.
 */
export function QrScanner({ onDetectado }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [estado, setEstado] = useState<EstadoCamara>("iniciando");
  const detectadoRef = useRef(false);

  useEffect(() => {
    let activo = true;

    async function iniciar() {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const lector = new BrowserQRCodeReader();

        if (!activo || !videoRef.current) return;

        // decodeFromConstraints (no decodeFromVideoDevice con deviceId
        // undefined) — hay un comportamiento inconsistente documentado
        // entre navegadores donde `undefined` abre la cámara FRONTAL en
        // algunos casos en vez de la trasera, sin ningún error visible.
        // Pedir explícitamente facingMode: environment evita depender
        // de esa elección automática del navegador.
        const controls = await lector.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (resultado, error) => {
            if (resultado && !detectadoRef.current) {
              detectadoRef.current = true;
              onDetectado(resultado.getText());
            }
            // Los "errores" de frame a frame sin código detectado son
            // normales (pasa en cada fotograma sin QR visible) — no se
            // tratan como fallo de cámara, solo se ignoran.
            void error;
          },
        );

        if (!activo) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setEstado("activa");
      } catch (err) {
        if (!activo) return;
        const esPermiso =
          err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
        setEstado(esPermiso ? "sin_permiso" : "error");
      }
    }

    iniciar();

    return () => {
      activo = false;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (estado === "sin_permiso") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-warn-foreground" />
        <p className="text-sm text-warn-foreground">
          GateFlow necesita permiso de cámara para escanear. Ve a la configuración de tu navegador y permite el
          acceso a la cámara para este sitio, luego recarga la página.
        </p>
        <p className="text-xs text-muted-foreground">Mientras tanto, puedes ingresar el folio manualmente abajo.</p>
      </div>
    );
  }

  if (estado === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">No se pudo abrir la cámara en este dispositivo.</p>
        <p className="text-xs text-muted-foreground">Usa la búsqueda manual por folio, nombre, calle o número abajo.</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black">
      <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
      {estado === "iniciando" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
          <Camera className="mr-2 h-4 w-4 animate-pulse" /> Iniciando cámara…
        </div>
      )}
      {estado === "activa" && <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, AlertTriangle, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@gateflow/ui";

interface QrScannerProps {
  onDetectado: (texto: string) => void;
}

/**
 * Estados del flujo de cámara.
 *
 * "inactiva"         — estado inicial, esperando el toque del usuario
 *                       (requisito: nunca pedimos la cámara sin un gesto
 *                       directo, sobre todo en Chrome/Safari iOS).
 * "iniciando"         — getUserMedia/zxing en curso.
 * "activa"            — video corriendo, decodificando frames.
 * "permiso_denegado"  — específicamente NotAllowedError/PermissionDeniedError.
 * "sin_camara"        — específicamente NotFoundError/DevicesNotFoundError.
 * "no_soportado"      — falló alguna verificación previa (HTTPS, API
 *                       ausente) — nunca se llegó a pedir permiso, así
 *                       que no tiene sentido mostrar el mensaje de permiso.
 * "temporal"          — todo lo demás (cámara ocupada, interrumpido,
 *                       configuración no soportada tras el fallback,
 *                       error de la librería) — recuperable con
 *                       "Reintentar cámara", sin recargar la página.
 */
type EstadoCamara = "inactiva" | "iniciando" | "activa" | "permiso_denegado" | "sin_camara" | "no_soportado" | "temporal";

type MotivoNoSoportado = "https" | "mediaDevices" | "getUserMedia";

/**
 * @zxing/browser decodifica en JavaScript puro (no depende de la API
 * nativa "Barcode Detection", que Safari/iOS no soporta en absoluto —
 * verificado antes de elegir esta librería). Import dinámico: la
 * librería solo se necesita en esta pantalla, no tiene sentido incluirla
 * en el bundle de ninguna otra parte de la app.
 *
 * A diferencia de la versión anterior, NO usamos decodeFromConstraints
 * (que pide la cámara internamente sin que podamos controlar el
 * fallback de facingMode ni distinguir bien los errores). En su lugar
 * pedimos el MediaStream nosotros mismos con getUserMedia — así
 * controlamos el reintento con facingMode:"environment" -> video:true, y
 * a zxing solo le pasamos el stream ya obtenido vía decodeFromStream.
 */
export function QrScanner({ onDetectado }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const activoRef = useRef(true); // false tras unmount, para no tocar refs/estado ya destruidos
  const detectadoRef = useRef(false);
  const estadoRef = useRef<EstadoCamara>("inactiva");

  const [estado, setEstadoState] = useState<EstadoCamara>("inactiva");
  const [motivoNoSoportado, setMotivoNoSoportado] = useState<MotivoNoSoportado | null>(null);

  const setEstado = useCallback((valor: EstadoCamara) => {
    estadoRef.current = valor;
    setEstadoState(valor);
  }, []);

  /** Detiene tracks del stream anterior y la instancia previa del lector
   * ZXing, para no dejar la cámara "ocupada" antes de volver a pedirla
   * (requisito explícito: stream?.getTracks().forEach(t => t.stop())). */
  const detenerTodo = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** Verificaciones previas a pedir la cámara. Si alguna falla, ni
   * siquiera llamamos a getUserMedia — por eso "no_soportado" es un
   * estado distinto de "permiso_denegado": nunca hubo un permiso que
   * negar. */
  function verificarEntorno(): { ok: true } | { ok: false; motivo: MotivoNoSoportado } {
    const esHttps = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (!esHttps) return { ok: false, motivo: "https" };
    if (!navigator.mediaDevices) return { ok: false, motivo: "mediaDevices" };
    if (!navigator.mediaDevices.getUserMedia) return { ok: false, motivo: "getUserMedia" };
    return { ok: true };
  }

  /** Primer intento con facingMode ideal "environment" (cámara trasera).
   * Si falla específicamente por esa restricción (OverconstrainedError),
   * segundo intento con video:true liso. Cualquier otro error (permiso
   * denegado, cámara ocupada, etc.) se propaga tal cual — un segundo
   * intento no lo resuelve y solo demora el mensaje correcto. */
  async function obtenerStream(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "OverconstrainedError") {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      throw err;
    }
  }

  /** Clasifica el error real (nunca asumimos "permiso denegado" por
   * defecto) y deja un log temporal para diagnosticar el caso
   * intermitente en Chrome/Safari iOS — quitar una vez confirmado
   * resuelto en producción. */
  function manejarError(err: unknown) {
    if (!activoRef.current) return;

    const nombre = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "desconocido";
    const mensaje = err instanceof Error ? err.message : String(err);

    // eslint-disable-next-line no-console -- diagnóstico temporal (requisito 8), quitar cuando el intermitente esté confirmado resuelto
    console.log("[QrScanner] fallo al iniciar cámara:", {
      nombre,
      mensaje,
      userAgent: navigator.userAgent,
    });

    switch (nombre) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        setEstado("permiso_denegado");
        break;
      case "NotFoundError":
      case "DevicesNotFoundError":
        setEstado("sin_camara");
        break;
      // NotReadableError (cámara ocupada), AbortError (interrumpido),
      // OverconstrainedError (si incluso el fallback video:true falla, lo
      // cual sería un caso raro de hardware), SecurityError, y cualquier
      // error propio de la librería zxing caen todos en "temporal": son
      // recuperables con el botón de Reintentar, sin recargar la página.
      case "NotReadableError":
      case "TrackStartError":
      case "AbortError":
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
      case "SecurityError":
      default:
        setEstado("temporal");
        break;
    }
  }

  /** Punto de entrada único, usado tanto por el botón inicial "Activar
   * cámara y escanear" como por "Reintentar cámara". Siempre detiene lo
   * anterior antes de pedir un stream nuevo. */
  const iniciar = useCallback(async () => {
    detenerTodo();
    detectadoRef.current = false;

    const verificacion = verificarEntorno();
    if (!verificacion.ok) {
      setMotivoNoSoportado(verificacion.motivo);
      setEstado("no_soportado");
      return;
    }

    setEstado("iniciando");

    let stream: MediaStream;
    try {
      stream = await obtenerStream();
    } catch (err) {
      manejarError(err);
      return;
    }

    if (!activoRef.current || !videoRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const lector = new BrowserQRCodeReader();

      const controls = await lector.decodeFromStream(stream, videoRef.current, (resultado, error) => {
        if (resultado && !detectadoRef.current) {
          detectadoRef.current = true;
          onDetectado(resultado.getText());
        }
        // Los "errores" de frame a frame sin código detectado son
        // normales (pasa en cada fotograma sin QR visible) — no se
        // tratan como fallo de cámara, solo se ignoran.
        void error;
      });

      if (!activoRef.current) {
        controls.stop();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      controlsRef.current = controls;
      setEstado("activa");
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      manejarError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detenerTodo, onDetectado, setEstado]);

  // Limpieza al desmontar el componente (navegación fuera de la pantalla).
  useEffect(() => {
    activoRef.current = true;
    return () => {
      activoRef.current = false;
      detenerTodo();
    };
  }, [detenerTodo]);

  // Requisito 9: al volver a primer plano, NO relanzar la cámara sola si
  // ya hay una activa. Si no hay stream activo (se liberó al pasar a
  // segundo plano, o falló antes de irse a background), solo habilitamos
  // el botón de reintento — nunca llamamos a iniciar() automáticamente.
  useEffect(() => {
    function alCambiarVisibilidad() {
      if (document.visibilityState === "hidden") {
        // Liberamos la cámara al pasar a segundo plano: evita quedar con
        // el sensor "tomado" cuando el usuario vuelve, algo especialmente
        // frecuente en Chrome/Safari iOS.
        detenerTodo();
        return;
      }
      if (document.visibilityState === "visible" && !streamRef.current && estadoRef.current !== "inactiva") {
        setEstado("temporal");
      }
    }
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  }, [detenerTodo, setEstado]);

  const mostrandoVideo = estado === "iniciando" || estado === "activa";

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        style={{ display: mostrandoVideo ? "block" : "none" }}
        muted
        playsInline
      />

      {estado === "inactiva" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Camera className="h-6 w-6 text-white/70" />
          <p className="text-sm text-white/70">Activa la cámara para escanear el código QR del paquete.</p>
          <Button onClick={iniciar} className="h-11">
            Activar cámara y escanear
          </Button>
        </div>
      )}

      {estado === "iniciando" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
          <Camera className="mr-2 h-4 w-4 animate-pulse" /> Iniciando cámara…
        </div>
      )}

      {estado === "activa" && (
        <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />
      )}

      {estado === "permiso_denegado" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-warn/10 p-6 text-center">
          <ShieldAlert className="h-6 w-6 text-warn-foreground" />
          <p className="text-sm text-warn-foreground">
            GateFlow necesita permiso de cámara. Ve a la configuración de tu navegador y permite el acceso a la
            cámara para este sitio.
          </p>
          <Button onClick={iniciar} variant="outline" className="h-10 gap-2">
            <RotateCcw className="h-4 w-4" /> Reintentar cámara
          </Button>
        </div>
      )}

      {estado === "sin_camara" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">No se detectó ninguna cámara en este dispositivo.</p>
          <p className="text-xs text-muted-foreground">Usa la búsqueda manual por folio, nombre, calle o número abajo.</p>
        </div>
      )}

      {estado === "no_soportado" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">
            {motivoNoSoportado === "https"
              ? "Esta página necesita abrirse con conexión segura (HTTPS) para usar la cámara."
              : "Este navegador no admite el acceso a la cámara."}
          </p>
          <p className="text-xs text-muted-foreground">Usa la búsqueda manual por folio, nombre, calle o número abajo.</p>
        </div>
      )}

      {estado === "temporal" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">
            No pudimos iniciar la cámara. Cierra cualquier aplicación que esté utilizándola y toca Reintentar.
          </p>
          <Button onClick={iniciar} variant="outline" className="h-10 gap-2">
            <RotateCcw className="h-4 w-4" /> Reintentar cámara
          </Button>
        </div>
      )}
    </div>
  );
}

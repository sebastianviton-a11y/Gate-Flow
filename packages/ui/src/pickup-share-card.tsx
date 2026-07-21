"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Share2, Download, Copy, MessageCircle, Check } from "lucide-react";

interface PickupShareCardProps {
  /** URL que se codifica en el QR — nunca el ID interno ni datos personales. */
  scanUrl: string;
  codigoGateflow: string;
  mensaje: string;
  /** null si el residente no tiene teléfono registrado — el botón de WhatsApp
   * se oculta y se muestra el aviso correspondiente, nunca se finge que existe. */
  whatsappUrl: string | null;
  size?: number;
}

/**
 * El mensaje de WhatsApp (botón principal) ya incluye un enlace a
 * /escanear/[token]/qr — una página pública que muestra solo la imagen
 * del QR, sin datos del paquete. Así, un solo toque abre directo la
 * conversación del residente (wa.me lo permite, sin preguntar a quién)
 * con TODO incluido en el mensaje, sin depender de que el sistema deje
 * elegir "compartir con WhatsApp" y sin la limitación de que wa.me nunca
 * puede adjuntar un archivo de imagen directamente.
 *
 * "Compartir QR" / "Descargar" / "Copiar" quedan como acciones
 * secundarias, útiles para el guardia (por ejemplo, mostrar el QR en su
 * propia pantalla si el residente está presente), no para el flujo
 * principal de aviso a distancia.
 */
export function PickupShareCard({ scanUrl, codigoGateflow, mensaje, whatsappUrl, size = 200 }: PickupShareCardProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [copiado, setCopiado] = useState(false);
  const [compartioNativo, setCompartioNativo] = useState<"ok" | "no_soportado" | null>(null);

  function obtenerCanvas(): HTMLCanvasElement | null {
    return canvasRef.current?.querySelector("canvas") ?? null;
  }

  function obtenerBlobPng(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const canvas = obtenerCanvas();
      if (!canvas) return resolve(null);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  async function handleCompartirNativo() {
    const blob = await obtenerBlobPng();
    if (!blob) return;
    const archivo = new File([blob], `qr-${codigoGateflow}.png`, { type: "image/png" });

    const soportaArchivos = typeof navigator.canShare === "function" && navigator.canShare({ files: [archivo] });
    if (navigator.share && soportaArchivos) {
      try {
        await navigator.share({ text: mensaje, files: [archivo] });
        setCompartioNativo("ok");
      } catch {
        // El usuario canceló el share nativo — no es un error real, no se muestra nada.
      }
    } else {
      setCompartioNativo("no_soportado");
    }
  }

  async function handleDescargar() {
    const blob = await obtenerBlobPng();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `qr-${codigoGateflow}.png`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopiarMensaje() {
    await navigator.clipboard.writeText(mensaje);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div ref={canvasRef} className="inline-flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-4">
        <QRCodeCanvas value={scanUrl} size={size} level="M" includeMargin={false} />
        <span className="gf-code">{codigoGateflow}</span>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground"
          >
            <MessageCircle className="h-4 w-4" />
            Enviar aviso por WhatsApp
          </a>
        ) : (
          <p className="rounded-md bg-warn/10 px-3 py-2 text-center text-xs text-warn-foreground">
            Este residente no tiene un número de WhatsApp registrado.
          </p>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          El mensaje ya incluye un enlace para que el residente vea su código QR — no necesitas compartir la imagen
          por separado. Las opciones de abajo son solo para ti, si quieres guardarla o mostrarla en tu pantalla.
        </p>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={handleCompartirNativo} className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-border text-xs">
            <Share2 className="h-4 w-4" />
            Compartir QR
          </button>
          <button onClick={handleDescargar} className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-border text-xs">
            <Download className="h-4 w-4" />
            Descargar
          </button>
          <button onClick={handleCopiarMensaje} className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-border text-xs">
            {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>

        {compartioNativo === "no_soportado" && (
          <p className="text-center text-xs text-muted-foreground">
            Este navegador no puede compartir la imagen directamente — usa "Descargar" y compártela desde tu galería.
          </p>
        )}
      </div>
    </div>
  );
}

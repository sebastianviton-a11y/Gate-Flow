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
 * "Compartir aviso y QR": los enlaces wa.me NO permiten adjuntar una
 * imagen automáticamente desde el navegador — es una limitación real de
 * wa.me, no algo que se pueda rodear. Web Share API SÍ puede compartir
 * texto + archivo de imagen juntos, pero solo en navegadores/contextos
 * que lo soportan (mayormente móvil, con HTTPS). Por eso:
 *   1º intento: Web Share API con el PNG del QR + el texto — si el
 *      dispositivo lo soporta, el usuario elige a dónde compartir
 *      (WhatsApp entre las opciones).
 *   2º respaldo, siempre visible: enviar solo el texto por wa.me,
 *      descargar el QR por separado, copiar el mensaje — nunca se
 *      afirma que WhatsApp adjunta la imagen si el navegador no lo
 *      permite.
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
        <QRCodeCanvas value={scanUrl} size={size} level="M" marginSize={2} />
        <span className="gf-code">{codigoGateflow}</span>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          onClick={handleCompartirNativo}
          className="flex h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground"
        >
          <Share2 className="h-4 w-4" />
          Compartir aviso y QR
        </button>

        {compartioNativo === "no_soportado" && (
          <p className="text-center text-xs text-muted-foreground">
            Este navegador no soporta compartir la imagen directamente — usa las opciones de abajo.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-border text-xs"
            >
              <MessageCircle className="h-4 w-4" />
              Texto
            </a>
          ) : (
            <span className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border text-center text-[10px] text-muted-foreground">
              Sin WhatsApp
            </span>
          )}
          <button onClick={handleDescargar} className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-border text-xs">
            <Download className="h-4 w-4" />
            Descargar
          </button>
          <button onClick={handleCopiarMensaje} className="flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border border-border text-xs">
            {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>
    </div>
  );
}

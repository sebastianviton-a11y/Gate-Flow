"use client";

import { useRef, useState } from "react";
import { Camera, X, Loader2 } from "lucide-react";

interface PhotoCaptureProps {
  onChange: (archivo: File | null) => void;
}

const DIMENSION_MAXIMA = 1600;
const CALIDAD_JPEG = 0.8;

/**
 * Redimensiona y recomprime la foto en el navegador antes de subirla —
 * una foto de cámara de iPhone puede pesar 3-8MB; esto la deja
 * típicamente en unos cientos de KB sin pérdida de calidad perceptible
 * (1600px en el lado mayor es de sobra para verla en el detalle del
 * paquete o en el panel de admin).
 *
 * Nunca bloquea la captura: si algo falla (formato no soportado por
 * canvas, etc.) o si el resultado comprimido termina pesando MÁS que
 * el original (pasa con imágenes ya chicas), se devuelve el archivo
 * original tal cual — la compresión es una optimización, nunca un
 * requisito para poder subir la foto.
 */
async function comprimirImagen(archivo: File): Promise<File> {
  if (!archivo.type.startsWith("image/")) return archivo;

  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, DIMENSION_MAXIMA / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", CALIDAD_JPEG));
    if (!blob || blob.size >= archivo.size) return archivo;

    const nombreComprimido = archivo.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nombreComprimido, { type: "image/jpeg" });
  } catch (e) {
    console.error("[GateFlow] No se pudo comprimir la imagen, se sube el original:", e);
    return archivo;
  }
}

/**
 * `capture="environment"` abre la cámara trasera directamente en
 * navegadores móviles (Safari iOS y Chrome Android lo soportan de forma
 * nativa) — no requiere ninguna librería de acceso a cámara, es un
 * atributo estándar de <input type="file">. En desktop, simplemente
 * abre el selector de archivos normal (comportamiento esperado, no un
 * bug: en desktop no hay cámara trasera que abrir).
 */
export function PhotoCapture({ onChange }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [comprimiendo, setComprimiendo] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setComprimiendo(true);
    try {
      const comprimida = await comprimirImagen(archivo);
      setPreview(URL.createObjectURL(comprimida));
      onChange(comprimida);
    } finally {
      setComprimiendo(false);
    }
  }

  function limpiar() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (preview) {
    return (
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Fotografía del paquete" className="h-32 w-32 rounded-xl border border-border object-cover" />
        <button
          type="button"
          onClick={limpiar}
          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white shadow"
          aria-label="Quitar fotografía"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={comprimiendo}
      className="flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-card text-muted-foreground disabled:opacity-60"
    >
      {comprimiendo ? (
        <>
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-xs">Procesando…</span>
        </>
      ) : (
        <>
          <Camera className="h-6 w-6" />
          <span className="text-xs">Tomar foto</span>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
    </button>
  );
}

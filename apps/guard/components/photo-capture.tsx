"use client";

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";

interface PhotoCaptureProps {
  onChange: (archivo: File | null) => void;
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

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setPreview(URL.createObjectURL(archivo));
    onChange(archivo);
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
      className="flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-card text-muted-foreground"
    >
      <Camera className="h-6 w-6" />
      <span className="text-xs">Tomar foto</span>
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

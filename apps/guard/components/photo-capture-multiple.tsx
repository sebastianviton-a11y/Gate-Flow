"use client";

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";

interface PhotoCaptureMultipleProps {
  onChange: (archivos: File[]) => void;
}

/** Hermano de PhotoCapture — mismo patrón de <input capture="environment">,
 * pero acumula un arreglo en vez de reemplazar un solo archivo. No
 * modifica PhotoCapture ni su uso existente en ningún otro lugar. */
export function PhotoCaptureMultiple({ onChange }: PhotoCaptureMultipleProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<{ archivo: File; preview: string }[]>([]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const siguiente = [...items, { archivo, preview: URL.createObjectURL(archivo) }];
    setItems(siguiente);
    onChange(siguiente.map((i) => i.archivo));
    if (inputRef.current) inputRef.current.value = "";
  }

  function quitar(index: number) {
    const item = items[index];
    if (item) URL.revokeObjectURL(item.preview);
    const siguiente = items.filter((_, i) => i !== index);
    setItems(siguiente);
    onChange(siguiente.map((i) => i.archivo));
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <div key={item.preview} className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.preview} alt="Evidencia de incidencia" className="h-24 w-24 rounded-xl border border-border object-cover" />
          <button
            type="button"
            onClick={() => quitar(index)}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white shadow"
            aria-label="Quitar fotografía"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card text-muted-foreground"
      >
        <Camera className="h-5 w-5" />
        <span className="text-xs">Agregar foto</span>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      </button>
    </div>
  );
}


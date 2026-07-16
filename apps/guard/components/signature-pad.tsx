"use client";

import { useRef, useState, useEffect } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@gateflow/ui";

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

/**
 * Canvas nativo, sin librería — capturar trazos de mouse/touch y
 * exportar a PNG (`toDataURL`) es una API estándar del navegador, no
 * justifica una dependencia nueva para algo tan acotado.
 */
export function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const [vacio, setVacio] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Ajusta la resolución del canvas al tamaño real en pantalla (evita
    // firmas borrosas en pantallas de alta densidad de píxeles).
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0D1B2A";
  }, []);

  function posicion(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    dibujando.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = posicion(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = posicion(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (vacio) setVacio(false);
  }

  function handlePointerUp() {
    if (!dibujando.current) return;
    dibujando.current = false;
    onChange(vacio ? null : canvasRef.current!.toDataURL("image/png"));
  }

  function limpiar() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setVacio(true);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border border-input bg-background">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="h-40 w-full touch-none rounded-xl"
        />
        {vacio && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Firma aquí
          </span>
        )}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={limpiar} disabled={vacio}>
        <Eraser className="h-3.5 w-3.5" />
        Borrar
      </Button>
    </div>
  );
}

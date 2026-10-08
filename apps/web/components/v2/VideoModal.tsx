"use client";

import { useEffect, useRef } from "react";

// Puerto 1:1 del modal de video de reference/index.html (`#pv-video` /
// `.pv-dialog`, renombrado `.gfv2-modal` / `.gfv2-dialog` en v2.css).
// Marcas de sincronizacion (04-interaccion-y-navegacion.md): mientras
// reproduce, el paso activo de "Cómo funciona" sigue al tiempo del video:
// >= 14.5s -> 01, >= 16s -> 02, >= 24s -> 03, >= 40s -> 04.
const MARKS = [14.5, 16, 24, 40];

export default function VideoModal({
  open,
  opener,
  onClose,
  onTimeSync,
}: {
  open: boolean;
  /** Botón que abrió el modal: recibe el foco al cerrar. */
  opener: HTMLElement | null;
  onClose: () => void;
  onTimeSync: (step: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  function close() {
    videoRef.current?.pause();
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Mientras está abierto, la página de fondo no se desplaza (rueda o gesto
  // sobre el fondo oscuro). Al cerrar, o si el modal se desmonta, se quita
  // el bloqueo, la página vuelve a donde estaba si algo la movió (Safari
  // < 16 ignora overflow en el gesto) y el foco vuelve al botón.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const previo = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
    const x = window.scrollX;
    const y = window.scrollY;
    html.style.overflow = "hidden";
    html.style.scrollbarGutter = "stable";
    return () => {
      html.style.overflow = previo.overflow;
      html.style.scrollbarGutter = previo.gutter;
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, opener]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    let k = 0;
    MARKS.forEach((mark, i) => {
      if (video.currentTime >= mark) k = i;
    });
    onTimeSync(k);
  }

  if (!open) return null;

  return (
    <div
      className="gfv2 gfv2-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Demo del producto, video vertical real de 0:48"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="gfv2-dialog">
        <video
          ref={videoRef}
          src="/v2/video/demo-vertical.mp4"
          poster="/v2/video/demo-vertical-poster.jpg"
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
        />
        <div className="gfv2-vbar">
          <span>DEMO DEL PRODUCTO · 0:48</span>
          <button type="button" ref={closeRef} className="gfv2-close" onClick={close}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

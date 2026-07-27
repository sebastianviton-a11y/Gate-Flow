"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Consola visible en pantalla — temporal, solo para depurar en
 * dispositivos donde no hay forma fácil de abrir las herramientas de
 * desarrollador (iPad sin Mac conectada). Intercepta console.log/
 * warn/error de TODA la página (no solo de este componente) y los
 * muestra en un panel con un botón de copiar, para poder pegar el
 * contenido directo en un mensaje sin necesitar describir de memoria
 * lo que apareció.
 *
 * Quitar una vez resuelto el problema que se esté depurando — no debe
 * quedar en producción de forma permanente.
 */
export function DebugConsole() {
  const [lineas, setLineas] = useState<string[]>([]);
  const [abierto, setAbierto] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const originales = { log: console.log, error: console.error, warn: console.warn };

    function formatear(args: unknown[]): string {
      return args
        .map((a) => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === "object" && a !== null) {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return String(a);
        })
        .join(" ");
    }

    function agregar(nivel: string, args: unknown[]) {
      const hora = new Date().toLocaleTimeString("es-MX", { hour12: false });
      setLineas((prev) => [...prev, `[${hora}] ${nivel}: ${formatear(args)}`].slice(-200));
    }

    console.log = (...args: unknown[]) => {
      agregar("LOG", args);
      originales.log(...args);
    };
    console.error = (...args: unknown[]) => {
      agregar("ERROR", args);
      originales.error(...args);
    };
    console.warn = (...args: unknown[]) => {
      agregar("WARN", args);
      originales.warn(...args);
    };

    return () => {
      console.log = originales.log;
      console.error = originales.error;
      console.warn = originales.warn;
    };
  }, []);

  useEffect(() => {
    contenedorRef.current?.scrollTo({ top: contenedorRef.current.scrollHeight });
  }, [lineas]);

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles, al menos el texto ya
      // está seleccionable manualmente en el panel.
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        style={{
          position: "fixed",
          bottom: 12,
          right: 12,
          zIndex: 99999,
          background: "#0D1B2A",
          color: "#fff",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 12,
          fontFamily: "monospace",
        }}
      >
        Consola ({lineas.length})
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 99999,
        maxHeight: "45vh",
        background: "#0D1B2A",
        color: "#E4E9EE",
        borderRadius: 10,
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "monospace",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
        <span style={{ fontWeight: 700 }}>Consola de depuración ({lineas.length})</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCopiar} style={{ background: "#00C49A", color: "#fff", borderRadius: 6, padding: "4px 8px", fontSize: 11 }}>
            {copiado ? "¡Copiado!" : "Copiar todo"}
          </button>
          <button onClick={() => setLineas([])} style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderRadius: 6, padding: "4px 8px", fontSize: 11 }}>
            Limpiar
          </button>
          <button onClick={() => setAbierto(false)} style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderRadius: 6, padding: "4px 8px", fontSize: 11 }}>
            Ocultar
          </button>
        </div>
      </div>
      <div ref={contenedorRef} style={{ overflowY: "auto", padding: "8px 10px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {lineas.length === 0 ? (
          <span style={{ opacity: 0.5 }}>Sin mensajes todavía — intenta iniciar sesión.</span>
        ) : (
          lineas.map((l, i) => <div key={i}>{l}</div>)
        )}
      </div>
    </div>
  );
}

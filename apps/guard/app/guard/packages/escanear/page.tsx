"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button, Input } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { QrScanner } from "@/components/qr-scanner";

/** El QR codifica una URL completa (.../guardia/escanear/[token]) para
 * que también funcione si alguien lo abre con la cámara nativa del
 * teléfono, no solo con este escáner. Aquí solo interesa el token — se
 * toma el último segmento de la ruta, y si el texto no tiene esa forma
 * (por ejemplo, alguien tecleó el token pelón), se usa tal cual. */
function extraerToken(textoDetectado: string): string {
  const marcador = "/escanear/";
  const indice = textoDetectado.lastIndexOf(marcador);
  if (indice === -1) return textoDetectado.trim();
  return textoDetectado.slice(indice + marcador.length).trim();
}

export default function EscanearQrPage() {
  const router = useRouter();
  const [folioManual, setFolioManual] = useState("");

  function irAToken(token: string) {
    if (!token) return;
    router.push(`/escanear/${encodeURIComponent(token)}`);
  }

  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Escanear QR" />
      <div className="flex-1 space-y-6 p-4">
        <QrScanner onDetectado={(texto) => irAToken(extraerToken(texto))} />

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            ¿Sin cámara disponible? Busca por folio, nombre, calle o número
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="GF-2026-0001234 o nombre / unidad"
                value={folioManual}
                onChange={(e) => setFolioManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(`/guard/packages/search?q=${encodeURIComponent(folioManual)}`);
                }}
                className="h-12 pl-9"
              />
            </div>
            <Button
              onClick={() => router.push(`/guard/packages/search?q=${encodeURIComponent(folioManual)}`)}
              disabled={!folioManual.trim()}
              className="h-12"
            >
              Buscar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Esto usa la búsqueda normal de paquetes — no requiere el código QR.
          </p>
        </div>
      </div>
    </div>
  );
}

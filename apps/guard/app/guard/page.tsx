import { PackagePlus, PackageCheck, Search, Clock, TriangleAlert, QrCode } from "lucide-react";
import { ActionTile } from "@/components/action-tile";

export default function GuardHomePage() {
  return (
    <div className="p-4">
      <div className="mb-4">
        <h1 className="font-display text-xl font-semibold tracking-tight">Portería</h1>
        <p className="text-sm text-muted-foreground">Elige una acción para continuar.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionTile
          href="/guard/packages/register"
          label="Registrar paquete"
          description="Recepción — menos de 20 segundos"
          icon={PackagePlus}
          tone="primary"
        />
        <ActionTile
          href="/guard/packages/escanear"
          label="Escanear QR"
          description="Localiza un paquete al instante"
          icon={QrCode}
          tone="primary"
        />
        <ActionTile
          href="/guard/packages/deliver"
          label="Entregar paquete"
          description="Con firma y evidencia"
          icon={PackageCheck}
        />
        <ActionTile
          href="/guard/packages/search"
          label="Buscar paquete"
          description="Por unidad, nombre o código"
          icon={Search}
        />
        <ActionTile
          href="/guard/packages/pending"
          label="Paquetes pendientes"
          description="Aún no entregados"
          icon={Clock}
        />
        <ActionTile
          href="/guard/incidents/new"
          label="Reportar incidencia"
          description="Dañado, extraviado, etc."
          icon={TriangleAlert}
        />
      </div>
    </div>
  );
}

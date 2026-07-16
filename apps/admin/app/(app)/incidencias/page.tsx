import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export default function IncidenciasPage() {
  return (
    <div className="flex h-full flex-col space-y-6">
      <PageHeader
        title="Incidencias"
        description="Seguimiento de paquetes dañados, extraviados o con algún problema reportado."
      />
      <EmptyState
        icon={TriangleAlert}
        title="Sin incidencias abiertas"
        description="Cuando el módulo de Paquetes esté conectado, cada incidencia (BR-21 a BR-25) aparecerá aquí con su propio ciclo de vida, independiente del paquete que la originó."
      />
    </div>
  );
}

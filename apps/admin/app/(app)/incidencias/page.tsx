import { TriangleAlert } from "lucide-react";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarIncidencias } from "@gateflow/paquetes";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { IncidenciasClient } from "./incidencias-client";

export default async function IncidenciasPage() {
  const session = await getSessionContext();
  if (!session) return null;

  const supabase = createServerSupabaseClient();
  const incidencias = await listarIncidencias(supabase, session.tenant.id);

  return (
    <div className="flex h-full flex-col space-y-6">
      <PageHeader title="Incidencias" description="Seguimiento de paquetes dañados, extraviados o con algún problema reportado." />
      {incidencias.length === 0 ? (
        <EmptyState
          icon={TriangleAlert}
          title="Sin incidencias abiertas"
          description="Cuando un guardia reporte un paquete dañado, extraviado o con algún problema, aparecerá aquí."
        />
      ) : (
        <IncidenciasClient incidenciasIniciales={incidencias} />
      )}
    </div>
  );
}

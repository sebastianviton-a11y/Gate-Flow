import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarUbicacionesAdmin } from "@gateflow/paquetes";
import { PageHeader } from "@/components/shared/page-header";
import { BodegaClient } from "./bodega-client";

export default async function BodegaPage() {
  const session = await getSessionContext();
  if (!session) return null;
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const ubicaciones = await listarUbicacionesAdmin(supabase, session.tenant.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bodega"
        description="Las áreas, estantes o espacios donde se almacenan los paquetes de este residencial."
      />
      <BodegaClient tenantId={session.tenant.id} userId={session.user.id} ubicacionesIniciales={ubicaciones} />
    </div>
  );
}

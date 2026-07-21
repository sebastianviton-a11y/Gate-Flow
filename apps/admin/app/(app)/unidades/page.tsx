import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarUnidades } from "@gateflow/paquetes";
import { PageHeader } from "@/components/shared/page-header";
import { UnidadesClient } from "./unidades-client";

export default async function UnidadesPage() {
  const session = await getSessionContext();
  if (!session) return null;
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const unidades = await listarUnidades(supabase, session.tenant.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Unidades" description="Casas y departamentos del residencial activo." />
      <UnidadesClient tenantId={session.tenant.id} unidades={unidades} />
    </div>
  );
}

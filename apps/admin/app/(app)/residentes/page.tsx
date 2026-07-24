import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarUnidades } from "@gateflow/paquetes";
import { PageHeader } from "@/components/shared/page-header";
import { ResidentesClient } from "./residentes-client";

/**
 * Residentes NO tiene su propia tabla ni su propia fuente de datos —
 * vive exactamente en `unidades` (misma tabla, mismas columnas de
 * contacto) que ya usa la pantalla de Unidades. Esta pantalla es una
 * vista distinta sobre los MISMOS datos, con marco de "residente"
 * (contacto primero) en vez de "vivienda" (dirección primero) — no
 * hay ninguna consulta ni tabla nueva, para no duplicar la fuente de
 * verdad tal como pidió la especificación.
 */
export default async function ResidentesPage() {
  const session = await getSessionContext();
  if (!session) return null;
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const unidades = await listarUnidades(supabase, session.tenant.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Residentes" description="Personas de contacto de cada unidad — mismos datos que Unidades, organizados para encontrar a alguien rápido." />
      <ResidentesClient tenantId={session.tenant.id} unidades={unidades} />
    </div>
  );
}

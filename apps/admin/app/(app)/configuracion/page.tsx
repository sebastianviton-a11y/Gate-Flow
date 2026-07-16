import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { PageHeader } from "@/components/shared/page-header";
import { FormularioGeneral } from "./formulario-general";
import type { ConfiguracionResidencial } from "./actions";

export default async function ConfiguracionPage() {
  const session = await getSessionContext();
  if (!session) return null;
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("tenants")
    .select("nombre, configuracion")
    .eq("id", session.tenant.id)
    .maybeSingle();

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Configuración" description="Datos generales de tu residencial." />
      <FormularioGeneral
        nombreInicial={data?.nombre ?? session.tenant.nombre}
        configuracionInicial={(data?.configuracion as ConfiguracionResidencial) ?? {}}
      />
    </div>
  );
}

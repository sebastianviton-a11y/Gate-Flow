import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarUsuariosTenant } from "@gateflow/paquetes";
import { PageHeader } from "@/components/shared/page-header";
import { UsuariosClient } from "./usuarios-client";

export default async function UsuariosPage() {
  const session = await getSessionContext();
  if (!session) return null;
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const usuarios = await listarUsuariosTenant(supabase, session.tenant.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" description="Guardias, administradores y sus roles dentro de este residencial." />
      <UsuariosClient usuarios={usuarios} />
    </div>
  );
}

import { UserCog } from "lucide-react";
import { getSessionContext, requireRole } from "@gateflow/auth";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export default async function UsuariosPage() {
  const session = await getSessionContext();
  // Defensivo: el layout (app) ya garantiza sesión activa; aquí se agrega
  // la restricción específica de rol para esta página (guardia/residente
  // no deben poder entrar aunque escriban la URL directamente).
  if (session) requireRole(session, ["admin_residencial", "super_admin"]);

  return (
    <div className="flex h-full flex-col space-y-6">
      <PageHeader
        title="Usuarios"
        description="Guardias, administradores y sus roles dentro de este residencial."
      />
      <EmptyState
        icon={UserCog}
        title="Sin usuarios adicionales todavía"
        description="La gestión de usuarios y roles por tenant (user_tenants) se conecta junto con la autenticación real en Sprint 02."
      />
    </div>
  );
}

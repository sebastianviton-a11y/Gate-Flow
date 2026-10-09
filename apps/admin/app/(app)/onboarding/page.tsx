import { redirect } from "next/navigation";
import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarUbicacionesAdmin, obtenerEnlaceResidentes } from "@gateflow/paquetes";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OnboardingPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("nombre, telefono, correo, direccion, configuracion, onboarding_completado")
    .eq("id", session.tenant.id)
    .maybeSingle();

  // Si ya se completó, no tiene sentido volver a mostrar el asistente
  // — se manda directo al dashboard real.
  if (tenantRow?.onboarding_completado) redirect("/dashboard");

  const [ubicaciones, enlaceResidentes] = await Promise.all([
    listarUbicacionesAdmin(supabase, session.tenant.id),
    obtenerEnlaceResidentes(supabase, session.tenant.id),
  ]);

  return (
    <OnboardingWizard
      tenantId={session.tenant.id}
      userId={session.user.id}
      nombreInicial={tenantRow?.nombre ?? session.tenant.nombre}
      telefonoInicial={tenantRow?.telefono ?? ""}
      correoInicial={tenantRow?.correo ?? ""}
      direccionInicial={tenantRow?.direccion ?? ""}
      logoUrlInicial={(tenantRow?.configuracion as { logoUrl?: string } | null)?.logoUrl ?? null}
      ubicacionesIniciales={ubicaciones}
      enlaceResidentes={enlaceResidentes}
    />
  );
}

import { redirect } from "next/navigation";
import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import {
  listarUbicacionesAdmin,
  obtenerConteosConfiguracion,
  obtenerEnlaceResidentes,
  pasoInicialAsistente,
  progresoConfiguracion,
} from "@gateflow/paquetes";
import { OnboardingWizard } from "./onboarding-wizard";

/**
 * Asistente de configuración. Se impone solo la primera vez (middleware,
 * mientras onboarding_completado = false); después se puede abrir cuando
 * se quiera desde «Primeros pasos». Se abre en el primer paso con algo
 * pendiente según los datos reales del residencial, y cada paso carga lo
 * que ya existe: retomarlo nunca borra ni rehace nada.
 */
export default async function OnboardingPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const [{ data: tenantRow }, ubicaciones, enlaceResidentes, conteos] = await Promise.all([
    supabase
      .from("tenants")
      .select("nombre, telefono, correo, direccion, configuracion, onboarding_completado")
      .eq("id", session.tenant.id)
      .maybeSingle(),
    listarUbicacionesAdmin(supabase, session.tenant.id),
    obtenerEnlaceResidentes(supabase, session.tenant.id),
    obtenerConteosConfiguracion(supabase, session.tenant.id),
  ]);

  const asistenteCerrado = Boolean(tenantRow?.onboarding_completado);
  const sinDatos = { unidades: 0, residentes: 0, ubicaciones: 0, guardias: 0, paquetes: 0 };

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
      pais={session.tenant.pais ?? null}
      progreso={conteos ? progresoConfiguracion(conteos) : null}
      pasoInicial={pasoInicialAsistente(conteos ?? sinDatos, asistenteCerrado)}
      asistenteCerrado={asistenteCerrado}
      guardias={conteos?.guardias ?? 0}
    />
  );
}

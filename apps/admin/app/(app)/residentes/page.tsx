import { getSessionContext, requireRole } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { esPaisResidencial, listarResidentesAdicionales, listarSolicitudesResidentes, listarUnidades, obtenerEnlaceResidentes } from "@gateflow/paquetes";
import { PageHeader } from "@/components/shared/page-header";
import { EnlaceResidentes } from "./enlace-residentes";
import { ResidentesClient } from "./residentes-client";
import { SolicitudesResidentes } from "./solicitudes-residentes";

/**
 * Residentes es una vista sobre las MISMAS viviendas de Unidades (contacto
 * de cada unidad) más las personas adicionales de cada vivienda
 * (residentes_unidades sin cuenta, aprobadas desde el enlace). Arriba:
 * el enlace para que cada residente cargue sus datos y las solicitudes
 * pendientes de revisión.
 */
export default async function ResidentesPage() {
  const session = await getSessionContext();
  if (!session) return null;
  requireRole(session, ["admin_residencial", "super_admin"]);

  const supabase = createServerSupabaseClient();
  const tenantId = session.tenant.id;
  const pais = esPaisResidencial(session.tenant.pais) ? session.tenant.pais : "MX";
  const [unidades, adicionales, enlace, solicitudes] = await Promise.all([
    listarUnidades(supabase, tenantId),
    listarResidentesAdicionales(supabase, tenantId),
    obtenerEnlaceResidentes(supabase, tenantId),
    listarSolicitudesResidentes(supabase, tenantId),
  ]);
  const viviendas = unidades
    .filter((u) => u.activo)
    .map((u) => ({ id: u.id, direccion: u.identificador, conContacto: Boolean(u.contactoNombre || u.contactoTelefono) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Residentes" description="Personas de contacto de cada vivienda — mismos datos que Unidades, organizados para encontrar a alguien rápido." />
      <EnlaceResidentes tenantId={tenantId} enlaceInicial={enlace} />
      <SolicitudesResidentes solicitudes={solicitudes} viviendas={viviendas} pais={pais} zonaHoraria={session.tenant.timezone ?? null} />
      <ResidentesClient tenantId={tenantId} unidades={unidades} adicionales={adicionales} pais={pais} />
    </div>
  );
}

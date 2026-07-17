import { getSessionContext } from "@gateflow/auth";
import { PageHeader } from "@/components/shared/page-header";
import { FormularioRegistroPaquete } from "./formulario-registro";

export default async function NuevoPaquetePage() {
  const session = await getSessionContext();
  if (!session) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Registrar paquete" description="Recepción manual desde administración." />
      <FormularioRegistroPaquete session={session} />
    </div>
  );
}

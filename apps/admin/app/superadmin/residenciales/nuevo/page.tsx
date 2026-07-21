import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarEmpresasParaSelector } from "@gateflow/paquetes";
import { FormularioResidencial } from "./formulario-residencial";

export default async function NuevoResidencialPage({ searchParams }: { searchParams: { empresaId?: string } }) {
  const supabase = createServerSupabaseClient();
  const empresas = await listarEmpresasParaSelector(supabase);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Nuevo residencial</h1>
        <p className="text-sm text-muted-foreground">
          Esto crea el registro del residencial. Invitar al administrador real (crear su cuenta de acceso) es un paso aparte, en Supabase — ver
          nota al final del formulario.
        </p>
      </div>
      <FormularioResidencial empresas={empresas} empresaIdInicial={searchParams.empresaId} />
    </div>
  );
}

import Link from "next/link";
import { Plus } from "lucide-react";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarEmpresas } from "@gateflow/paquetes";
import { EmpresasTable } from "./empresas-table";

export default async function EmpresasPage() {
  const supabase = createServerSupabaseClient();
  const empresas = await listarEmpresas(supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground">{empresas.length} empresa(s) — cada una puede administrar uno o varios residenciales.</p>
        </div>
        <Link href="/superadmin/empresas/nueva" className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          <Plus className="h-4 w-4" />
          Nueva empresa
        </Link>
      </div>

      <EmpresasTable empresas={empresas} />
    </div>
  );
}

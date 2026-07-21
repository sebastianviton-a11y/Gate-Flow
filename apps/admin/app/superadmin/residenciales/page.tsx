import Link from "next/link";
import { Plus } from "lucide-react";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarResidenciales } from "@gateflow/paquetes";
import { ResidencialesTable } from "./residenciales-table";

export default async function ResidencialesPage() {
  const supabase = createServerSupabaseClient();
  const residenciales = await listarResidenciales(supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Residenciales</h1>
          <p className="text-sm text-muted-foreground">{residenciales.length} residencial(es) en la plataforma.</p>
        </div>
        <Link href="/superadmin/residenciales/nuevo" className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          <Plus className="h-4 w-4" />
          Nuevo residencial
        </Link>
      </div>

      <ResidencialesTable residenciales={residenciales} />
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { obtenerEmpresaDetalle, listarResidenciales } from "@gateflow/paquetes";
import { ResidencialesTable } from "../../residenciales/residenciales-table";
import { EmpresaDetalleClient } from "./detalle-client";

export default async function EmpresaDetallePage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const empresa = await obtenerEmpresaDetalle(supabase, params.id);
  if (!empresa) notFound();

  const residenciales = await listarResidenciales(supabase, params.id);

  return (
    <div className="space-y-6">
      <EmpresaDetalleClient empresa={empresa} />

      <div className="flex items-center justify-between border-t border-border pt-6">
        <h2 className="font-display text-lg font-semibold">Residenciales de esta empresa</h2>
        <Link
          href={`/superadmin/residenciales/nuevo?empresaId=${empresa.id}`}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Agregar residencial
        </Link>
      </div>
      {/* Mismo componente que usa /superadmin/residenciales — reutilizado
          tal cual, no una copia — así que cualquier mejora futura a esa
          tabla aplica aquí automáticamente también. */}
      <ResidencialesTable residenciales={residenciales} mostrarEmpresa={false} />
    </div>
  );
}

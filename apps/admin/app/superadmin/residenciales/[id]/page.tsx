import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { obtenerResidencialDetalle } from "@gateflow/paquetes";
import { ResidencialDetalleClient } from "./detalle-client";

export default async function ResidencialDetallePage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const residencial = await obtenerResidencialDetalle(supabase, params.id);
  if (!residencial) notFound();

  return <ResidencialDetalleClient residencial={residencial} />;
}

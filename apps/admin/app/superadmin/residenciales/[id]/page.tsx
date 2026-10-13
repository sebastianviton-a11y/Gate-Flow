import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { obtenerResidencialDetalle, obtenerSuscripcionResidencial } from "@gateflow/paquetes";
import { ResidencialDetalleClient } from "./detalle-client";

export default async function ResidencialDetallePage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const residencial = await obtenerResidencialDetalle(supabase, params.id);
  if (!residencial) notFound();
  const suscripcion = await obtenerSuscripcionResidencial(supabase, params.id);

  return <ResidencialDetalleClient residencial={residencial} suscripcion={suscripcion} />;
}

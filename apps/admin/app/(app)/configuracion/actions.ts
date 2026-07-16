"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";

export interface ConfiguracionResidencial {
  logoUrl?: string;
  horarioRecepcion?: string;
  reglasBasicas?: string;
}

/**
 * `tenants.configuracion` es la columna JSONB que existe desde la
 * migración inicial (D012, DECISIONS.md) — no se agregó ninguna tabla
 * ni columna nueva para esta pantalla.
 */
export async function actualizarConfiguracionResidencial(input: {
  nombre: string;
  configuracion: ConfiguracionResidencial;
}) {
  const session = await getSessionContext();
  if (!session) throw new Error("Sesión no válida.");

  const supabase = createServerSupabaseClient();

  const { data: anterior } = await supabase
    .from("tenants")
    .select("nombre, configuracion")
    .eq("id", session.tenant.id)
    .maybeSingle();

  const { error } = await supabase
    .from("tenants")
    .update({ nombre: input.nombre, configuracion: input.configuracion })
    .eq("id", session.tenant.id);

  if (error) throw error;

  await supabase.rpc("registrar_auditoria", {
    p_tenant_id: session.tenant.id,
    p_accion: "tenant.configuracion_editada",
    p_entidad: "tenants",
    p_entidad_id: session.tenant.id,
    p_datos_anteriores: anterior ?? {},
    p_datos_nuevos: input,
  });

  revalidatePath("/configuracion");
}

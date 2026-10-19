import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Avance de la configuración de un residencial, calculado SIEMPRE a
 * partir de sus datos reales (no del navegador). Son recomendaciones para
 * empezar a operar, no requisitos: ningún paso pendiente bloquea el panel
 * ni el asistente. Lo usan la tarjeta «Primeros pasos» del Dashboard y el
 * asistente de configuración (para retomarlo donde quedó).
 */
export interface ConteosConfiguracion {
  /** Unidades activas. */
  unidades: number;
  /** Unidades activas con un contacto (nombre o teléfono) + residentes adicionales vigentes (enlace). */
  residentes: number;
  /** Ubicaciones de bodega activas. */
  ubicaciones: number;
  /** Guardias con membresía activa (invitados o que ya aceptaron). */
  guardias: number;
  /** Paquetes registrados (cualquier estado). */
  paquetes: number;
}

export type ClavePasoConfiguracion = "unidades" | "residentes" | "ubicaciones" | "guardias" | "paquetes";

export interface PasoConfiguracion {
  clave: ClavePasoConfiguracion;
  titulo: string;
  descripcion: string;
  href: string;
  listo: boolean;
}

export interface ProgresoConfiguracion {
  pasos: PasoConfiguracion[];
  completados: number;
  total: number;
  /** Todos los pasos listos: la tarjeta deja de mostrarse. */
  completo: boolean;
}

const DEFINICION: ReadonlyArray<Omit<PasoConfiguracion, "listo"> & { cuenta: keyof ConteosConfiguracion }> = [
  { clave: "unidades", cuenta: "unidades", titulo: "Carga tus unidades", descripcion: "Casas o departamentos del residencial.", href: "/unidades" },
  { clave: "residentes", cuenta: "residentes", titulo: "Agrega residentes", descripcion: "Con su WhatsApp, para avisarles de cada paquete.", href: "/residentes" },
  { clave: "ubicaciones", cuenta: "ubicaciones", titulo: "Configura la bodega", descripcion: "Los lugares donde se guardan los paquetes.", href: "/configuracion/bodega" },
  { clave: "guardias", cuenta: "guardias", titulo: "Invita a tus guardias", descripcion: "Cada guardia entra con su propio usuario.", href: "/usuarios" },
  { clave: "paquetes", cuenta: "paquetes", titulo: "Registra el primer paquete", descripcion: "Desde portería (app Guard) o desde el panel.", href: "/paquetes/nuevo" },
];

export function progresoConfiguracion(conteos: ConteosConfiguracion): ProgresoConfiguracion {
  const pasos = DEFINICION.map(({ cuenta, ...paso }) => ({ ...paso, listo: conteos[cuenta] > 0 }));
  const completados = pasos.filter((p) => p.listo).length;
  return { pasos, completados, total: pasos.length, completo: completados === pasos.length };
}

/**
 * Pasos del asistente (apps/admin/app/(app)/onboarding): 1 bienvenida,
 * 2 datos, 3 residentes, 4 usuarios, 5 bodega, 6 resumen. Al retomarlo
 * se abre en el primer paso con algo pendiente según los datos reales;
 * la bienvenida solo se muestra a quien todavía no configuró nada ni
 * cerró el asistente. Nada se borra ni se rehace: cada paso carga lo que
 * ya existe.
 */
export function pasoInicialAsistente(conteos: ConteosConfiguracion, asistenteCerrado: boolean): number {
  const algoConfigurado = conteos.unidades + conteos.residentes + conteos.ubicaciones + conteos.guardias + conteos.paquetes > 0;
  if (!asistenteCerrado && !algoConfigurado) return 1;
  if (conteos.residentes === 0 && conteos.unidades === 0) return 3;
  if (conteos.guardias === 0) return 4;
  if (conteos.ubicaciones === 0) return 5;
  return 6;
}

/**
 * Conteos del residencial. Cada consulta filtra por tenant_id y además
 * pasa por RLS (solo se ven filas de residenciales del usuario). Devuelve
 * null si alguna falla: quien llama no muestra el progreso (nunca bloquea
 * por no poder leerlo).
 */
export async function obtenerConteosConfiguracion(supabase: SupabaseClient, tenantId: string): Promise<ConteosConfiguracion | null> {
  const contar = { count: "exact" as const, head: true };
  const [unidades, conContacto, adicionales, ubicaciones, guardias, paquetes] = await Promise.all([
    supabase.from("unidades").select("id", contar).eq("tenant_id", tenantId).eq("activo", true),
    supabase.from("unidades").select("id", contar).eq("tenant_id", tenantId).eq("activo", true).or("contacto_nombre.not.is.null,contacto_telefono.not.is.null"),
    supabase.from("residentes_unidades").select("id", contar).eq("tenant_id", tenantId).is("fecha_fin", null),
    supabase.from("ubicaciones").select("id", contar).eq("tenant_id", tenantId).eq("activo", true),
    supabase.from("user_tenants").select("id, roles!inner(clave)", contar).eq("tenant_id", tenantId).eq("activo", true).eq("roles.clave", "guardia"),
    supabase.from("paquetes").select("id", contar).eq("tenant_id", tenantId),
  ]);
  const resultados = [unidades, conContacto, adicionales, ubicaciones, guardias, paquetes];
  if (resultados.some((r) => r.error || r.count === null)) return null;
  return {
    unidades: unidades.count ?? 0,
    residentes: (conContacto.count ?? 0) + (adicionales.count ?? 0),
    ubicaciones: ubicaciones.count ?? 0,
    guardias: guardias.count ?? 0,
    paquetes: paquetes.count ?? 0,
  };
}

/**
 * País de los documentos legales en /aceptar-invitacion: el del
 * residencial de la invitación, leído en el servidor
 * (app/aceptar-invitacion/actions.ts). La invitación no lleva el
 * residencial en el enlace: la membresía se otorga al invitar
 * (otorgar_membresia), así que el residencial es el de las membresías
 * activas de la sesión. Si son de países distintos, o no se pueden leer,
 * el país queda indeterminado: nunca se supone México.
 * Sin imports de Next ni de Supabase, para poder probarlo
 * (lib/__tests__/legal-invitacion.test.ts).
 */
import { PAISES, type Pais } from "./documentos";

export type MotivoPaisIndeterminado = "sin_sesion" | "error" | "sin_membresia" | "sin_pais" | "pais_no_admitido" | "varios_paises";

export type PaisInvitacion = { estado: "ok"; pais: Pais } | { estado: "indeterminado"; motivo: MotivoPaisIndeterminado };

type FilaMembresiaPais = { tenants: { pais: string | null } | { pais: string | null }[] | null };

/** Un solo país entre todas las membresías activas → ese país; cualquier otra cosa → indeterminado. */
export function paisDeMembresias(error: unknown, filas: unknown): PaisInvitacion {
  if (error || !Array.isArray(filas)) return { estado: "indeterminado", motivo: "error" };
  if (filas.length === 0) return { estado: "indeterminado", motivo: "sin_membresia" };
  const paises = new Set<string>();
  for (const fila of filas as FilaMembresiaPais[]) {
    const tenant = Array.isArray(fila?.tenants) ? fila.tenants[0] : fila?.tenants;
    const pais = typeof tenant?.pais === "string" ? tenant.pais.trim() : "";
    if (!pais) return { estado: "indeterminado", motivo: "sin_pais" };
    if (!PAISES.some((p) => p.codigo === pais)) return { estado: "indeterminado", motivo: "pais_no_admitido" };
    paises.add(pais);
  }
  if (paises.size !== 1) return { estado: "indeterminado", motivo: "varios_paises" };
  return { estado: "ok", pais: [...paises][0] as Pais };
}

/** Indeterminado por algo pasajero (sesión o lectura): tiene sentido reintentar. */
export function reintentable(motivo: MotivoPaisIndeterminado): boolean {
  return motivo === "sin_sesion" || motivo === "error";
}

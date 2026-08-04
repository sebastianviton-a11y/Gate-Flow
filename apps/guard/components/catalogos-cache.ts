import type { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { obtenerCatalogos, type Catalogos } from "@gateflow/paquetes";

/**
 * `SupabaseClient` no se importa directo de `@supabase/supabase-js`
 * porque esa librería no es una dependencia directa de `apps/guard`
 * (viaja como transitiva a través de `@gateflow/supabase`) — pnpm no
 * permite importar paquetes que no están declarados como dependencia
 * directa. Ningún archivo de guard hace esa importación; todos dejan
 * que TypeScript infiera el tipo desde `createBrowserSupabaseClient()`,
 * y este archivo sigue la misma convención con `ReturnType<...>`.
 */
type SupabaseClient = ReturnType<typeof createBrowserSupabaseClient>;

/**
 * Caché en memoria de los catálogos del residencial (empresas de
 * paquetería, tamaños, prioridades, ubicaciones) — datos que un
 * administrador cambia de vez en cuando, no varias veces por turno de
 * guardia. Sin esto, cada vez que el guardia entra a "Registrar
 * paquete" se repiten 4 consultas idénticas a Supabase.
 *
 * Deliberadamente NO se cachea dentro de obtenerCatalogos() en
 * @gateflow/paquetes — esa función la usa también admin
 * (formulario-registro.tsx), y ahí conviene que los datos siempre
 * estén frescos (un admin editando el catálogo quiere ver el cambio
 * de inmediato). Este caché vive solo en apps/guard.
 *
 * TTL de 5 minutos: alcanza para que un guardia entre y salga de
 * "Registrar paquete" varias veces en su turno sin repetir la
 * consulta, pero no deja datos desactualizados por mucho tiempo si
 * algo cambia en admin durante el turno. Vive en memoria del navegador
 * — se reinicia solo al recargar la página, sin necesidad de invalidar
 * nada manualmente.
 */
const TTL_MS = 5 * 60 * 1000;

let cache: { tenantId: string; datos: Catalogos; expiraEn: number } | null = null;
let consultaEnCurso: Promise<Catalogos> | null = null;

export async function obtenerCatalogosCacheados(supabase: SupabaseClient, tenantId: string): Promise<Catalogos> {
  const ahora = Date.now();
  if (cache && cache.tenantId === tenantId && cache.expiraEn > ahora) {
    return cache.datos;
  }

  // Si ya hay una consulta en curso para este montaje (por ejemplo, el
  // guardia entra y sale rápido de la pantalla), se reutiliza la misma
  // promesa en vez de disparar una segunda consulta idéntica en
  // paralelo.
  if (!consultaEnCurso) {
    consultaEnCurso = obtenerCatalogos(supabase, tenantId).finally(() => {
      consultaEnCurso = null;
    });
  }

  const datos = await consultaEnCurso;
  cache = { tenantId, datos, expiraEn: ahora + TTL_MS };
  return datos;
}

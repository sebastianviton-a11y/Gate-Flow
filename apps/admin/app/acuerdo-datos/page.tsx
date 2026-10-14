import type { Metadata } from "next";
import { PaginaDocumentoLegal, type ParametrosLegales } from "@/components/legal/pagina-documento-legal";

// Lo vigente lo decide la base en cada petición (now() del servidor): ni la
// página ni sus lecturas se cachean. force-dynamic solo no basta: el
// cliente anónimo no usa cookies y Next guardaría las RPC en su caché de
// datos sin vencimiento.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = { title: "Acuerdo de Tratamiento de Datos · Gate Flow" };

/**
 * /acuerdo-datos — Acuerdo de Tratamiento de Datos. Ruta pública (lib/rutas-publicas.ts).
 * Muestra la versión publicada vigente para el país (?pais=MX|AR, México
 * por defecto), una versión del historial (?version=<id>) o, si no hay
 * nada publicado, el estado "pendiente" (components/legal).
 */
export default function AcuerdoDatosPage({ searchParams }: { searchParams: ParametrosLegales }) {
  return <PaginaDocumentoLegal clave="acuerdo_tratamiento" searchParams={searchParams} />;
}

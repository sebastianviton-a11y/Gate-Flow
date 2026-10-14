import type { Metadata } from "next";
import { PaginaDocumentoLegal, type ParametrosLegales } from "@/components/legal/pagina-documento-legal";

// Lo vigente lo decide la base en cada petición (now() del servidor): ni la
// página ni sus lecturas se cachean. force-dynamic solo no basta: el
// cliente anónimo no usa cookies y Next guardaría las RPC en su caché de
// datos sin vencimiento.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = { title: "Aviso de Privacidad · Gate Flow" };

/**
 * /privacidad — Aviso de Privacidad. Ruta pública (lib/rutas-publicas.ts),
 * enlazada desde /registro, /alta-residente, /suscripcion y la landing.
 * Muestra la versión publicada vigente para el país (?pais=MX|AR, México
 * por defecto), una versión del historial (?version=<id>) o, si no hay
 * nada publicado, el estado "pendiente" (components/legal).
 */
export default function PrivacidadPage({ searchParams }: { searchParams: ParametrosLegales }) {
  return <PaginaDocumentoLegal clave="privacidad" searchParams={searchParams} />;
}

import Link from "next/link";
import { Plus } from "lucide-react";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { listarPaquetes, buscarPaquetes } from "@gateflow/paquetes";
import { EstadoBadge, Button } from "@gateflow/ui";
import type { EstadoPaquete } from "@gateflow/types";
import { PageHeader } from "@/components/shared/page-header";
import { FiltrosPaquetes } from "@/components/paquetes/filtros-paquetes";
import { Paginacion } from "@/components/paquetes/paginacion";

const POR_PAGINA = 25;

export default async function PaquetesPage({
  searchParams,
}: {
  searchParams: { estado?: string; q?: string; pagina?: string };
}) {
  const session = await getSessionContext();
  if (!session) return null; // el layout ya protege la ruta; defensivo.

  const supabase = createServerSupabaseClient();
  const pagina = Math.max(1, parseInt(searchParams.pagina ?? "1", 10) || 1);
  const texto = searchParams.q?.trim();

  // La búsqueda de texto y el listado filtrado son dos consultas
  // distintas en la capa de datos (una usa el vector de búsqueda
  // completo, la otra filtros exactos) — con texto, prevalece la
  // búsqueda; sin texto, se usa el listado paginado normal.
  const resultado = texto
    ? { items: await buscarPaquetes(supabase, session.tenant.id, texto), total: undefined }
    : await listarPaquetes(supabase, {
        tenantId: session.tenant.id,
        estado: searchParams.estado ? [searchParams.estado as EstadoPaquete] : undefined,
        pagina,
        porPagina: POR_PAGINA,
      });

  function buildHref(p: number) {
    const params = new URLSearchParams();
    if (searchParams.estado) params.set("estado", searchParams.estado);
    if (searchParams.q) params.set("q", searchParams.q);
    params.set("pagina", String(p));
    return `/paquetes?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Paquetes" description="Todos los paquetes del residencial activo." />
        <Button asChild size="sm" className="shrink-0">
          <Link href="/paquetes/nuevo">
            <Plus className="h-4 w-4" />
            Registrar paquete
          </Link>
        </Button>
      </div>

      <FiltrosPaquetes estadoActual={searchParams.estado} textoActual={searchParams.q} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Código</th>
              <th className="px-4 py-2.5">Unidad</th>
              <th className="px-4 py-2.5">Residente</th>
              <th className="px-4 py-2.5">Remitente / Guía</th>
              <th className="px-4 py-2.5">Ubicación</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5">Recepción</th>
              <th className="px-4 py-2.5">Entrega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {resultado.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {texto ? (
                    `Sin resultados para "${texto}".`
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <span>Sin paquetes registrados todavía.</span>
                      <Button asChild size="sm">
                        <Link href="/paquetes/nuevo">
                          <Plus className="h-4 w-4" />
                          Registrar paquete
                        </Link>
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            )}
            {resultado.items.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <Link href={`/paquetes/${p.id}`} className="gf-code text-primary hover:underline">
                    {p.codigoGateflow}
                  </Link>
                </td>
                <td className="px-4 py-2.5 font-medium">{p.unidadIdentificador}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.residenteNombre ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {p.remitente ?? p.empresaPaqueteria ?? "—"}
                  {p.numeroGuia ? ` · ${p.numeroGuia}` : ""}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.ubicacionDescripcion ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <EstadoBadge estado={p.estado} />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{new Date(p.fechaRecepcion).toLocaleDateString("es-MX")}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {p.fechaEntrega ? new Date(p.fechaEntrega).toLocaleDateString("es-MX") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!texto && resultado.total !== undefined && (
        <Paginacion pagina={pagina} porPagina={POR_PAGINA} total={resultado.total} buildHref={buildHref} />
      )}
    </div>
  );
}

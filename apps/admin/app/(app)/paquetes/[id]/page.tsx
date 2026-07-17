import { notFound } from "next/navigation";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { obtenerPaquetePorId, obtenerHistorial, obtenerFirmaEntrega, obtenerFotografiasPaquete } from "@gateflow/paquetes";
import { EstadoBadge, PackageQRCode } from "@gateflow/ui";
import { PageHeader } from "@/components/shared/page-header";
import { EditarNotas } from "./editar-notas";

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente de recepción",
  recibido: "Recibido en portería",
  notificado: "Residente notificado",
  entregado: "Entregado al residente",
  rechazado: "Rechazado por residente",
  devuelto: "Devuelto a paquetería",
};

export default async function PaqueteDetallePage({ params }: { params: { id: string } }) {
  const session = await getSessionContext();
  if (!session) return null;

  const supabase = createServerSupabaseClient();
  const paquete = await obtenerPaquetePorId(supabase, params.id);
  if (!paquete) notFound();

  const historial = await obtenerHistorial(supabase, params.id);
  const firma = await obtenerFirmaEntrega(supabase, params.id);
  const fotografias = await obtenerFotografiasPaquete(supabase, params.id);

  return (
    <div className="space-y-6">
      <PageHeader title={paquete.unidadIdentificador} description={paquete.codigoGateflow} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <EstadoBadge estado={paquete.estado} />
              <span className="gf-code text-muted-foreground">{paquete.codigoGateflow}</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Unidad</dt>
              <dd className="font-medium">{paquete.unidadIdentificador}</dd>

              <dt className="text-muted-foreground">Residente</dt>
              <dd className="font-medium">{paquete.residenteNombre ?? "—"}</dd>

              <dt className="text-muted-foreground">Remitente</dt>
              <dd className="font-medium">{paquete.remitente ?? "—"}</dd>

              <dt className="text-muted-foreground">Empresa</dt>
              <dd className="font-medium">{paquete.empresaPaqueteria ?? "—"}</dd>

              <dt className="text-muted-foreground">Guía</dt>
              <dd className="font-medium">{paquete.numeroGuia ?? "—"}</dd>

              <dt className="text-muted-foreground">Tamaño</dt>
              <dd className="font-medium">{paquete.tamano ?? "—"}</dd>

              <dt className="text-muted-foreground">Prioridad</dt>
              <dd className="font-medium">{paquete.prioridad ?? "—"}</dd>

              <dt className="text-muted-foreground">Ubicación</dt>
              <dd className="font-medium">{paquete.ubicacionDescripcion ?? "—"}</dd>

              <dt className="text-muted-foreground">Recibido por</dt>
              <dd className="font-medium">{paquete.recibidoPorNombre ?? "—"}</dd>

              <dt className="text-muted-foreground">Fecha de recepción</dt>
              <dd className="font-medium">{new Date(paquete.fechaRecepcion).toLocaleString("es-MX")}</dd>

              {paquete.fechaEntrega && (
                <>
                  <dt className="text-muted-foreground">Entregado por</dt>
                  <dd className="font-medium">{paquete.entregadoPorNombre ?? "—"}</dd>
                  <dt className="text-muted-foreground">Fecha de entrega</dt>
                  <dd className="font-medium">{new Date(paquete.fechaEntrega).toLocaleString("es-MX")}</dd>
                  <dt className="text-muted-foreground">Recibió (persona)</dt>
                  <dd className="font-medium">{paquete.entregadoANombre ?? "—"}</dd>
                </>
              )}
            </dl>

            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium text-muted-foreground">Notas</p>
              <EditarNotas paqueteId={paquete.id} notasIniciales={paquete.notas ?? ""} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 font-display text-sm font-medium text-muted-foreground">Historial</h2>
            {historial.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin eventos todavía.</p>
            ) : (
              <div className="space-y-3 border-l-2 border-border pl-4">
                {historial.map((h) => (
                  <div key={h.id}>
                    <p className="text-sm font-medium">{ESTADO_LABEL[h.estadoNuevoId] ?? h.estadoNuevoId}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.usuarioNombre} · {new Date(h.creadoEn).toLocaleString("es-MX")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-start gap-4 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col items-center">
            <PackageQRCode codigoGateflow={paquete.codigoGateflow} size={200} />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Escanéalo desde la app de guardia para buscar este paquete directamente.
            </p>
          </div>

          {firma && (
            <div className="w-full border-t border-border pt-4">
              <p className="mb-2 text-center text-sm font-medium text-muted-foreground">Firma de entrega</p>
              <div className="rounded-lg border border-border bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={firma.firmaData} alt={`Firma de ${firma.firmanteNombre}`} className="mx-auto h-20" />
              </div>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                {firma.firmanteNombre} · {new Date(firma.creadoEn).toLocaleString("es-MX")}
              </p>
            </div>
          )}

          {fotografias.length > 0 && (
            <div className="w-full border-t border-border pt-4">
              <p className="mb-2 text-center text-sm font-medium text-muted-foreground">Fotografías</p>
              <div className="grid grid-cols-2 gap-2">
                {fotografias.map((foto) => (
                  <a key={foto.id} href={foto.url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={foto.url} alt={`Evidencia (${foto.tipo})`} className="aspect-square w-full rounded-lg border border-border object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

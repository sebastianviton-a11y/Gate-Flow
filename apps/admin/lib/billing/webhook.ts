import type { BillingProvider, EventoNormalizado } from "./tipos";

/**
 * Núcleo del webhook, sin Next ni Supabase. Orden:
 *   firma (cuerpo crudo) → si falla: 401 y NINGUNA escritura
 *   → volver a consultar el recurso al proveedor y normalizar
 *   → billing_aplicar_evento (una transacción: idempotencia, asociación
 *     por NUESTRO checkout, FOR UPDATE, versión, monto, transición)
 *   → efectos fuera de la base (cancelar una suscripción duplicada).
 * Un error de red o de base responde 500 para que el proveedor
 * reintente; el evento no quedó registrado (la RPC es atómica).
 */

export interface ResultadoAplicar {
  resultado: string;
  resultado_original?: string | null;
  tenant_id?: string | null;
}

export interface DepsWebhook {
  proveedor: BillingProvider;
  aplicarEvento(evento: EventoNormalizado): Promise<ResultadoAplicar>;
  log?: (mensaje: string, datos: Record<string, unknown>) => void;
}

export interface RespuestaWebhook {
  status: number;
  body: string;
}

const json = (status: number, cuerpo: Record<string, unknown>): RespuestaWebhook => ({ status, body: JSON.stringify(cuerpo) });

export async function procesarWebhook(deps: DepsWebhook, cuerpoCrudo: string, cabeceras: Headers): Promise<RespuestaWebhook> {
  const log = deps.log ?? (() => {});
  const evento = deps.proveedor.verificarWebhook(cuerpoCrudo, cabeceras);
  if (!evento) {
    log("billing.webhook_firma_invalida", { proveedor: deps.proveedor.id });
    return json(401, { error: "firma" });
  }

  let normalizado: EventoNormalizado;
  try {
    normalizado = await deps.proveedor.normalizarEvento(evento);
  } catch {
    log("billing.webhook_consulta_fallo", { proveedor: deps.proveedor.id, evento: evento.id, tipo: evento.tipo });
    return json(500, { error: "consulta" });
  }

  let aplicado: ResultadoAplicar;
  try {
    aplicado = await deps.aplicarEvento(normalizado);
  } catch {
    log("billing.webhook_base_fallo", { proveedor: deps.proveedor.id, evento: evento.id, tipo: evento.tipo });
    return json(500, { error: "base" });
  }

  const duplicada =
    aplicado.resultado === "suscripcion_duplicada" ||
    (aplicado.resultado === "duplicado" && aplicado.resultado_original === "suscripcion_duplicada");
  if (duplicada && normalizado.subscriptionId) {
    try {
      await deps.proveedor.cancelarSuscripcion(normalizado.subscriptionId);
      log("billing.suscripcion_duplicada_cancelada", { evento: evento.id, tenant_id: aplicado.tenant_id ?? null });
    } catch {
      // El evento ya quedó registrado: el reintento llega como
      // "duplicado" con resultado_original y vuelve a intentarlo.
      log("billing.cancelar_duplicada_fallo", { evento: evento.id, tenant_id: aplicado.tenant_id ?? null });
      return json(500, { error: "cancelar_duplicada" });
    }
  }

  log("billing.webhook", {
    proveedor: deps.proveedor.id,
    evento: evento.id,
    tipo: evento.tipo,
    estado: normalizado.estado,
    resultado: aplicado.resultado,
    tenant_id: aplicado.tenant_id ?? null,
  });
  return json(200, { recibido: true });
}

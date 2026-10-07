import { procesarWebhookStripe } from "@/lib/billing/servidor";

/**
 * POST /api/billing/webhook/stripe — fuera del middleware de sesión
 * (middleware.ts lo excluye del matcher). La firma se verifica sobre el
 * cuerpo CRUDO; sin firma válida: 401 y ninguna escritura. El resto del
 * flujo vive en lib/billing (webhook.ts + proveedores/stripe.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const cuerpo = await request.text();
  const { status, body } = await procesarWebhookStripe(cuerpo, request.headers);
  return new Response(body, { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

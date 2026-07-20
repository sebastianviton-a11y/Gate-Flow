import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { buscarPaquetePorPickupToken, listarPendientesPorUnidad } from "@gateflow/paquetes";
import { GateFlowLogo } from "@gateflow/ui";
import { EscaneoResultado } from "./escaneo-resultado";

/**
 * Esta ruta es pública en el middleware (apps/guard/middleware.ts) — se
 * abre sin sesión si alguien escanea el QR con la cámara nativa de su
 * teléfono en vez del escáner de GateFlow, o si comparte el enlace por
 * error. Por eso el chequeo de sesión ocurre AQUÍ, explícitamente, antes
 * de tocar cualquier dato — nunca se consulta la base de datos si no hay
 * sesión activa, ni siquiera para confirmar si el token existe.
 */
export default async function EscanearTokenPage({ params }: { params: { token: string } }) {
  const session = await getSessionContext();

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center">
        <GateFlowLogo size={48} onDark />
        <p className="max-w-xs text-sm text-white/70">Presenta este código al personal de seguridad.</p>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  const paquete = await buscarPaquetePorPickupToken(supabase, params.token);

  if (!paquete) {
    return <EstadoNeutral titulo="No se encontró un paquete relacionado con este código." />;
  }

  if (paquete.estado === "rechazado" || paquete.estado === "devuelto") {
    return <EstadoNeutral titulo="Este paquete fue cancelado y no está disponible para entrega." />;
  }

  if (paquete.estado === "entregado") {
    const fecha = paquete.fechaEntrega ? new Date(paquete.fechaEntrega).toLocaleString("es-MX") : "";
    return <EstadoNeutral titulo={`Este paquete ya fue entregado${fecha ? ` el ${fecha}` : ""}.`} tono="success" />;
  }

  const otrosPendientes = await listarPendientesPorUnidad(supabase, paquete.unidadId, paquete.id);

  // Auditoría del escaneo — quién, cuándo, sobre qué paquete. No bloquea
  // la respuesta al guardia si por algún motivo falla (BR-32: la
  // operación real no debe depender de que la auditoría tenga éxito).
  supabase
    .rpc("registrar_auditoria", {
      p_tenant_id: session.tenant.id,
      p_accion: "paquete.qr_escaneado",
      p_entidad: "paquetes",
      p_entidad_id: paquete.id,
      p_datos_anteriores: {},
      p_datos_nuevos: { escaneado_por: session.user.id },
    })
    .then(() => {});

  return <EscaneoResultado paquete={paquete} otrosPendientes={otrosPendientes} session={session} />;
}

function EstadoNeutral({ titulo, tono = "warn" }: { titulo: string; tono?: "warn" | "success" }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full ${
          tono === "success" ? "bg-success/10" : "bg-warn/10"
        }`}
      >
        <GateFlowLogo size={28} />
      </span>
      <p className="max-w-xs text-sm text-muted-foreground">{titulo}</p>
    </div>
  );
}

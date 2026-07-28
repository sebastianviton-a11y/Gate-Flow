import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { buscarPaquetePorPickupToken, listarPendientesPorUnidad, obtenerGrupoPorTokenConPaquetes } from "@gateflow/paquetes";
import { GateFlowLogo } from "@gateflow/ui";
import { EscaneoResultado } from "./escaneo-resultado";
import { EscaneoGrupoResultado } from "./escaneo-grupo-resultado";

/**
 * Esta ruta es pública en el middleware (apps/guard/middleware.ts) — se
 * abre sin sesión si alguien escanea el QR con la cámara nativa de su
 * teléfono en vez del escáner de GateFlow, o si comparte el enlace por
 * error. Por eso el chequeo de sesión ocurre AQUÍ, explícitamente, antes
 * de tocar cualquier dato — nunca se consulta la base de datos si no hay
 * sesión activa, ni siquiera para confirmar si el token existe.
 *
 * Desde el sistema de agrupación de paquetes: un mismo token de la URL
 * ahora puede ser el de un PAQUETE individual (como siempre) o el de un
 * GRUPO de entrega (nuevo). Se intenta primero como paquete individual
 * — el caso más común y el que ya funcionaba — y solo si no se
 * encuentra ahí, se intenta como grupo. Ningún paquete individual deja
 * de funcionar por este cambio.
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

  if (paquete) {
    if (paquete.estado === "rechazado" || paquete.estado === "devuelto") {
      return <EstadoNeutral titulo="Este paquete fue cancelado y no está disponible para entrega." />;
    }

    if (paquete.estado === "entregado") {
      const fecha = paquete.fechaEntrega ? new Date(paquete.fechaEntrega).toLocaleString("es-MX") : "";
      return <EstadoNeutral titulo={`Este paquete ya fue entregado${fecha ? ` el ${fecha}` : ""}.`} tono="success" />;
    }

    const otrosPendientes = await listarPendientesPorUnidad(supabase, paquete.unidadId, paquete.id);

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

  // No se encontró como paquete individual — intentar como token de
  // GRUPO de entrega antes de rendirse.
  let grupoConPaquetes;
  try {
    grupoConPaquetes = await obtenerGrupoPorTokenConPaquetes(supabase, params.token);
  } catch (e) {
    console.error("[GateFlow] obtenerGrupoPorTokenConPaquetes falló:", e instanceof Error ? e.message : e);
    return (
      <EstadoNeutral
        titulo={`No se pudo cargar este código. ${e instanceof Error ? e.message : "Intenta de nuevo en unos segundos."}`}
      />
    );
  }

  if (!grupoConPaquetes) {
    return <EstadoNeutral titulo="No se encontró un paquete relacionado con este código." />;
  }

  if (grupoConPaquetes.grupo.estado === "cancelado") {
    return <EstadoNeutral titulo="Este retiro fue cancelado y no está disponible para entrega." />;
  }

  if (grupoConPaquetes.grupo.estado === "completado") {
    const fecha = grupoConPaquetes.grupo.fechaEntrega
      ? new Date(grupoConPaquetes.grupo.fechaEntrega).toLocaleString("es-MX")
      : "";
    return <EstadoNeutral titulo={`Este retiro ya fue completado${fecha ? ` el ${fecha}` : ""}.`} tono="success" />;
  }

  supabase
    .rpc("registrar_auditoria", {
      p_tenant_id: session.tenant.id,
      p_accion: "grupo_entrega.qr_escaneado",
      p_entidad: "paquete_grupos_entrega",
      p_entidad_id: grupoConPaquetes.grupo.id,
      p_datos_anteriores: {},
      p_datos_nuevos: { escaneado_por: session.user.id },
    })
    .then(() => {});

  return <EscaneoGrupoResultado datos={grupoConPaquetes} session={session} />;
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
      {/* Enlace simple, no un <Button> con useRouter — EstadoNeutral es
          un Server Component sin "use client", y esto evita tener que
          convertirlo solo para una navegación básica. Antes no había
          ninguna salida desde esta pantalla más que cerrar y volver a
          abrir la app. */}
      <a
        href="/guard"
        className="min-h-touch flex w-full max-w-xs items-center justify-center rounded-lg bg-primary text-base font-medium text-primary-foreground"
      >
        Volver al inicio
      </a>
    </div>
  );
}

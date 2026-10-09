import { validarDatosResidente, type CampoResidente, type PaisResidencial } from "@gateflow/paquetes";
import { hashIp, verificarTokenTiempo } from "../registro/hash";

/**
 * Envío del formulario público de residentes (/alta-residente). El
 * navegador manda los cuatro campos y el token del enlace; el país, el
 * residencial y el estado del enlace los decide el servidor. Nada de
 * esto registra datos personales ni el token: los logs llevan solo un
 * evento y un motivo.
 *
 * Orden: trampa y token de tiempo → desafío (Turnstile) → enlace →
 * validación con el país del residencial → base (límites, reenvíos
 * idénticos y alta pendiente). Lo barato va primero: un envío
 * demasiado rápido no gasta el desafío.
 *
 * El desafío es el de /registro: en staging sin claves no se pasa
 * (queda la trampa, el tiempo mínimo, los límites de la base y la
 * revisión obligatoria del administrador); en el entorno de clientes es
 * obligatorio (ver app/alta-residente/actions.ts).
 *
 * Éxito SOLO si la base devolvió el id de una solicitud guardada. Ni la
 * trampa ni el tiempo responden "enviado": la trampa da un error
 * genérico y el tiempo pide esperar y volver a enviar, con los datos
 * intactos.
 */

export const MENSAJES_RESIDENTE = {
  enviado: "Tus datos fueron enviados a la administración del residencial para su revisión.",
  revocado: "Este enlace ya no está activo. Pide a la administración de tu residencial el enlace actualizado.",
  noOperativo: "El registro de residentes no está disponible por ahora en este residencial. Consulta con la administración.",
  noDisponible: "El registro de residentes no está disponible por ahora. Inténtalo más tarde.",
  limiteConexion: "Recibimos muchos envíos desde esta conexión. Espera un rato y vuelve a intentarlo, o envíalo con tus datos móviles.",
  limiteEnlace: "El registro recibió muchos envíos por ahora. Vuelve a intentarlo más tarde o consulta con la administración del residencial.",
  desafio: "No pudimos comprobar que no eres un robot. Vuelve a intentarlo.",
  rapido: "Lo enviaste muy rápido. Espera unos segundos y vuelve a tocar «Confirmar y enviar». Tus datos siguen aquí.",
  renovado: "El formulario estuvo abierto mucho tiempo. Espera unos segundos y vuelve a tocar «Confirmar y enviar». Tus datos siguen aquí.",
  generico: "No pudimos enviar tus datos. Inténtalo de nuevo en unos minutos.",
} as const;

export const RE_TOKEN_ENLACE = /^[0-9a-f]{64}$/;

export type EstadoEnlace =
  | { estado: "activo"; residencial: string; pais: PaisResidencial }
  | { estado: "revocado" }
  | { estado: "no_operativo" };

export type ResultadoCrearSolicitud =
  | { resultado: "recibida"; solicitudId: string }
  | { resultado: "revocado" | "no_operativo" | "limite_conexion" | "limite_enlace" | "invalido" };

export type ResultadoEnvioResidente =
  | { tipo: "enviado"; mensaje: string }
  | { tipo: "campos"; errores: Partial<Record<CampoResidente, string>> }
  | { tipo: "no_disponible"; motivo: "revocado" | "no_operativo"; mensaje: string }
  /** Nada guardado: esperar y volver a enviar. `renovar`: pedir antes un token de tiempo nuevo. */
  | { tipo: "esperar"; mensaje: string; renovar: boolean }
  | { tipo: "error"; mensaje: string };

export interface DepsEnvioResidente {
  consultarEnlace(token: string): Promise<EstadoEnlace>;
  crearSolicitud(args: {
    token: string;
    nombre: string;
    apellido: string;
    direccion: string;
    telefono: string;
    ipHash: string | null;
  }): Promise<ResultadoCrearSolicitud>;
  /** Turnstile en el entorno de clientes; sin él (pruebas locales), no se pasa. */
  verificarDesafio?: () => Promise<{ ok: boolean; motivo?: string }>;
  /** Solo evento y motivo: nunca nombres, teléfonos, direcciones, IP ni token. */
  log(evento: string, datos?: Record<string, string>): void;
}

export interface CamposEnvioResidente {
  token: string;
  nombre: string;
  apellido: string;
  direccion: string;
  whatsapp: string;
  t: string;
  sitio_web: string;
}

export function leerCamposResidente(formData: FormData): CamposEnvioResidente {
  const texto = (k: string, max: number) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.slice(0, max) : "";
  };
  return {
    token: texto("token", 128),
    nombre: texto("nombre", 200),
    apellido: texto("apellido", 200),
    direccion: texto("direccion", 400),
    whatsapp: texto("whatsapp", 60),
    t: texto("t", 200),
    sitio_web: texto("sitio_web", 200),
  };
}

const REVOCADO: ResultadoEnvioResidente = { tipo: "no_disponible", motivo: "revocado", mensaje: MENSAJES_RESIDENTE.revocado };
const NO_OPERATIVO: ResultadoEnvioResidente = { tipo: "no_disponible", motivo: "no_operativo", mensaje: MENSAJES_RESIDENTE.noOperativo };

export async function procesarEnvioResidente(
  deps: DepsEnvioResidente,
  campos: CamposEnvioResidente,
  ctx: { pepper: string; ip: string | null; ahoraMs?: number },
): Promise<ResultadoEnvioResidente> {
  if (!RE_TOKEN_ENLACE.test(campos.token)) return REVOCADO;

  // Trampa llena (una persona no ve el campo): no se guarda y no se
  // dice "enviado"; el error es genérico para no señalar la trampa.
  if (campos.sitio_web.trim() !== "") {
    deps.log("residentes_envio_descartado", { motivo: "trampa" });
    return { tipo: "error", mensaje: MENSAJES_RESIDENTE.generico };
  }
  // Tiempo mínimo desde que se abrió el formulario (igual que /registro):
  // no se guarda; se pide esperar y volver a enviar. Si el token venció
  // o no es válido, el navegador pide uno nuevo antes de reenviar.
  const tiempo = verificarTokenTiempo(ctx.pepper, campos.t, ctx.ahoraMs);
  if (!tiempo.ok) {
    deps.log("residentes_envio_esperar", { motivo: `tiempo_${tiempo.motivo}` });
    return tiempo.motivo === "rapido"
      ? { tipo: "esperar", mensaje: MENSAJES_RESIDENTE.rapido, renovar: false }
      : { tipo: "esperar", mensaje: MENSAJES_RESIDENTE.renovado, renovar: true };
  }
  if (deps.verificarDesafio) {
    const desafio = await deps.verificarDesafio();
    if (!desafio.ok) {
      deps.log("residentes_envio_desafio", { motivo: desafio.motivo ?? "rechazado" });
      return { tipo: "error", mensaje: MENSAJES_RESIDENTE.desafio };
    }
  }

  let enlace: EstadoEnlace;
  try {
    enlace = await deps.consultarEnlace(campos.token);
  } catch (e) {
    deps.log("residentes_envio_error", { paso: "enlace", detalle: e instanceof Error ? e.message.slice(0, 120) : "?" });
    return { tipo: "error", mensaje: MENSAJES_RESIDENTE.generico };
  }
  if (enlace.estado === "revocado") return REVOCADO;
  if (enlace.estado === "no_operativo") return NO_OPERATIVO;

  const validacion = validarDatosResidente(
    { nombre: campos.nombre, apellido: campos.apellido, direccion: campos.direccion, whatsapp: campos.whatsapp },
    enlace.pais,
  );
  if (!validacion.ok) return { tipo: "campos", errores: validacion.errores };

  let resultado: ResultadoCrearSolicitud;
  try {
    resultado = await deps.crearSolicitud({ token: campos.token, ...validacion.datos, ipHash: hashIp(ctx.pepper, ctx.ip) });
  } catch (e) {
    deps.log("residentes_envio_error", { paso: "solicitud", detalle: e instanceof Error ? e.message.slice(0, 120) : "?" });
    return { tipo: "error", mensaje: MENSAJES_RESIDENTE.generico };
  }
  deps.log("residentes_envio", { resultado: resultado.resultado });
  switch (resultado.resultado) {
    case "recibida":
      // interpretarCrearSolicitud solo da "recibida" con el id guardado.
      return { tipo: "enviado", mensaje: MENSAJES_RESIDENTE.enviado };
    case "revocado":
      return REVOCADO;
    case "no_operativo":
      return NO_OPERATIVO;
    case "limite_conexion":
      return { tipo: "error", mensaje: MENSAJES_RESIDENTE.limiteConexion };
    case "limite_enlace":
      return { tipo: "error", mensaje: MENSAJES_RESIDENTE.limiteEnlace };
    case "invalido":
      // La base rechazó algo que el validador aceptó, o respondió sin el
      // id de la solicitud: no se muestra éxito.
      return { tipo: "error", mensaje: MENSAJES_RESIDENTE.generico };
  }
}

/** Interpreta la respuesta de residentes_enlace_publico. */
export function interpretarEnlacePublico(data: unknown): EstadoEnlace {
  const r = (data ?? {}) as { estado?: string; residencial?: string; pais?: string };
  if (r.estado === "activo" && typeof r.residencial === "string" && (r.pais === "AR" || r.pais === "MX")) {
    return { estado: "activo", residencial: r.residencial, pais: r.pais };
  }
  return r.estado === "no_operativo" ? { estado: "no_operativo" } : { estado: "revocado" };
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "recibida" solo con el id de la solicitud guardada; si falta, "invalido". */
export function interpretarCrearSolicitud(data: unknown): ResultadoCrearSolicitud {
  const r = (data ?? {}) as { resultado?: string; solicitud_id?: unknown };
  if (r.resultado === "recibida") {
    return typeof r.solicitud_id === "string" && RE_UUID.test(r.solicitud_id)
      ? { resultado: "recibida", solicitudId: r.solicitud_id }
      : { resultado: "invalido" };
  }
  return r.resultado === "revocado" || r.resultado === "no_operativo" || r.resultado === "limite_conexion" || r.resultado === "limite_enlace"
    ? { resultado: r.resultado }
    : { resultado: "invalido" };
}

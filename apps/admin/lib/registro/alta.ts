import { MENSAJES_ACEPTACION, errorDeAceptacion, mismasVersiones, type DocumentoAceptable } from "../legal/aceptacion";
import { hashEmail, hashIp, verificarTokenTiempo } from "./hash";
import {
  MENSAJE_CONTACTO,
  MENSAJE_REVISA_CORREO,
  validarRegistro,
  type CamposCrudos,
  type ErroresRegistro,
  type PaisRegistro,
} from "./validacion";

/**
 * Orquestación del alta de /registro, sin Next ni Supabase: todo lo
 * externo entra por `DepsAlta`, así se prueba con dobles.
 *
 * Orden fijo:
 *   1. rate limit (registro_intento_permitido)
 *   2. honeypot + token de tiempo
 *   2b. documentos legales: lo mostrado debe ser lo vigente (si cambió,
 *       no se crea nada y se muestran de nuevo para aceptarlos)
 *   3. auth.admin.createUser (email sin confirmar)
 *   4. RPC crear_cuenta_prueba (empresa + tenant + admin + trial + evidencia
 *      de aceptación, todo en una transacción)
 *   5. correo de confirmación
 *   6. cierre del intento
 *
 * Compensación: si falla 4 se borra el usuario de Auth; si falla 5 se
 * llama revertir_cuenta_prueba y después se borra el usuario. Si la
 * reversión se niega, el usuario NO se borra (quedaría un residencial
 * sin dueño) y se deja constancia en el log.
 */

export interface DatosNuevoUsuario {
  email: string;
  password: string;
  nombreCompleto: string;
}

export interface DatosNuevaCuenta {
  userId: string;
  nombreResidencial: string;
  pais: PaisRegistro;
  viviendas: number;
  timezone: string | null;
  aceptaTerminos: true;
  /** Versiones mostradas: la RPC registra la evidencia o rechaza el alta. */
  versionIds: string[];
  declaraFacultades: boolean;
}

export interface DepsAlta {
  intentoPermitido(emailHash: string, ipHash: string | null): Promise<{ intentoId: string | null; permitido: boolean; motivo: string | null }>;
  intentoResultado(intentoId: string, estado: "exito" | "fallo", motivo: string | null): Promise<void>;
  crearUsuario(datos: DatosNuevoUsuario): Promise<{ ok: true; userId: string } | { ok: false; duplicado: boolean; detalle: string }>;
  borrarUsuario(userId: string): Promise<void>;
  crearCuenta(datos: DatosNuevaCuenta): Promise<{ ok: true; tenantId: string } | { ok: false; detalle: string }>;
  revertirCuenta(userId: string): Promise<{ revertido: boolean; motivo: string | null }>;
  enviarConfirmacion(email: string): Promise<{ ok: true } | { ok: false; detalle: string }>;
  /** Documentos legales vigentes del país que se muestran en /registro. */
  documentosVigentes(pais: PaisRegistro): Promise<{ ok: true; documentos: DocumentoAceptable[] } | { ok: false; detalle: string }>;
  /** Nunca recibe correo, IP ni contraseña: solo nombres de evento y códigos. */
  log(evento: string, datos?: Record<string, unknown>): void;
}

export interface ContextoAlta {
  pepper: string;
  ip: string | null;
  ahoraMs?: number;
  /** Países con registro abierto (REGISTRO_PAISES); sin valor, solo México. */
  paises?: readonly PaisRegistro[];
}

export type ResultadoAlta =
  | { tipo: "revisa_correo"; mensaje: string }
  | { tipo: "contacto"; mensaje: string }
  | { tipo: "campos"; errores: ErroresRegistro }
  | { tipo: "error"; mensaje: string }
  /** Los documentos cambiaron mientras se llenaba el formulario: hay que aceptarlos de nuevo. */
  | { tipo: "documentos"; mensaje: string; documentos: DocumentoAceptable[] };

export const MENSAJES_ALTA = {
  bloqueado: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
  desafio: "No pudimos comprobar que no eres un robot. Vuelve a intentarlo.",
  expirado: "El formulario expiró. Recarga la página e inténtalo de nuevo.",
  generico: "No pudimos crear tu cuenta. Inténtalo de nuevo en unos minutos.",
  correo: "No pudimos enviar el correo de confirmación. Inténtalo de nuevo en unos minutos.",
  noDisponible: "El registro no está disponible por ahora.",
} as const;

const REVISA_CORREO: ResultadoAlta = { tipo: "revisa_correo", mensaje: MENSAJE_REVISA_CORREO };

function detalle(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function ejecutarAlta(deps: DepsAlta, campos: CamposCrudos, ctx: ContextoAlta): Promise<ResultadoAlta> {
  const validacion = validarRegistro(campos, ctx.paises);
  if (!validacion.ok) {
    return validacion.tipo === "contacto"
      ? { tipo: "contacto", mensaje: MENSAJE_CONTACTO }
      : { tipo: "campos", errores: validacion.errores };
  }
  const datos = validacion.datos;

  // 1. Rate limit (siempre registra el intento, permitido o no).
  let intentoId: string | null = null;
  try {
    const intento = await deps.intentoPermitido(hashEmail(ctx.pepper, datos.email), hashIp(ctx.pepper, ctx.ip));
    intentoId = intento.intentoId;
    if (!intento.permitido) {
      deps.log("registro.bloqueado", { motivo: intento.motivo });
      return { tipo: "error", mensaje: MENSAJES_ALTA.bloqueado };
    }
  } catch (e) {
    deps.log("registro.intento_permitido_error", { detalle: detalle(e) });
    return { tipo: "error", mensaje: MENSAJES_ALTA.generico };
  }

  const cerrar = async (estado: "exito" | "fallo", motivo: string | null) => {
    if (!intentoId) return;
    try {
      await deps.intentoResultado(intentoId, estado, motivo);
    } catch (e) {
      deps.log("registro.intento_resultado_error", { detalle: detalle(e) });
    }
  };

  // 2. Honeypot y tiempo de llenado. A un bot se le responde igual que
  //    a un alta correcta: no se le da ninguna pista.
  if (campos.sitio_web.trim() !== "") {
    await cerrar("fallo", "honeypot");
    return REVISA_CORREO;
  }
  const token = verificarTokenTiempo(ctx.pepper, campos.t, ctx.ahoraMs);
  if (!token.ok) {
    await cerrar("fallo", `token_${token.motivo}`);
    return token.motivo === "expirado" ? { tipo: "error", mensaje: MENSAJES_ALTA.expirado } : REVISA_CORREO;
  }

  // 2b. Documentos legales. Lo que se mostró debe ser exactamente lo
  //     vigente; si no, no se crea nada. La RPC lo vuelve a comprobar
  //     dentro de la transacción (por si cambia justo entre medio).
  const leerDocumentos = async (): Promise<DocumentoAceptable[] | null> => {
    try {
      const r = await deps.documentosVigentes(datos.pais);
      if (r.ok) return r.documentos;
      deps.log("registro.documentos_error", { detalle: r.detalle });
    } catch (e) {
      deps.log("registro.documentos_excepcion", { detalle: detalle(e) });
    }
    return null;
  };
  const vigentes = await leerDocumentos();
  if (!vigentes) {
    await cerrar("fallo", "documentos_lectura");
    return { tipo: "error", mensaje: MENSAJES_ALTA.generico };
  }
  if (!mismasVersiones(datos.versionIds, vigentes.map((d) => d.versionId))) {
    await cerrar("fallo", "documentos_cambiados");
    return { tipo: "documentos", mensaje: MENSAJES_ACEPTACION.actualizados, documentos: vigentes };
  }
  if (vigentes.some((d) => d.clave === "acuerdo_tratamiento") && !datos.declaraFacultades) {
    await cerrar("fallo", "sin_declaracion");
    return { tipo: "campos", errores: { declaraFacultades: MENSAJES_ACEPTACION.declaracion } };
  }

  // 3. Usuario de Auth (sin confirmar). Un correo que ya existe recibe
  //    la misma respuesta pública que un alta: no se revela nada.
  let userId: string;
  try {
    const usuario = await deps.crearUsuario({ email: datos.email, password: datos.password, nombreCompleto: datos.nombreCompleto });
    if (!usuario.ok) {
      if (usuario.duplicado) {
        await cerrar("fallo", "email_duplicado");
        return REVISA_CORREO;
      }
      deps.log("registro.auth_crear_error", { detalle: usuario.detalle });
      await cerrar("fallo", "auth_crear");
      return { tipo: "error", mensaje: MENSAJES_ALTA.generico };
    }
    userId = usuario.userId;
  } catch (e) {
    deps.log("registro.auth_crear_excepcion", { detalle: detalle(e) });
    await cerrar("fallo", "auth_crear");
    return { tipo: "error", mensaje: MENSAJES_ALTA.generico };
  }

  const borrarUsuario = async (motivo: string) => {
    try {
      await deps.borrarUsuario(userId);
    } catch (e) {
      deps.log("registro.auth_borrar_error", { motivo, detalle: detalle(e) });
    }
  };

  // 4. Empresa + residencial + admin + trial, en una transacción.
  let tenantId: string;
  try {
    const cuenta = await deps.crearCuenta({
      userId,
      nombreResidencial: datos.nombreResidencial,
      pais: datos.pais,
      viviendas: datos.viviendas,
      timezone: datos.timezone,
      aceptaTerminos: true,
      versionIds: datos.versionIds,
      declaraFacultades: datos.declaraFacultades,
    });
    if (!cuenta.ok) {
      // La transacción se revirtió entera (tampoco hay evidencia): solo
      // queda borrar el usuario de Auth.
      const motivo = errorDeAceptacion(cuenta.detalle);
      deps.log("registro.rpc_error", { detalle: cuenta.detalle });
      await borrarUsuario("rpc");
      await cerrar("fallo", motivo ? `aceptacion_${motivo}` : "rpc");
      if (motivo === "actualizados") {
        return { tipo: "documentos", mensaje: MENSAJES_ACEPTACION.actualizados, documentos: (await leerDocumentos()) ?? [] };
      }
      if (motivo === "declaracion") return { tipo: "campos", errores: { declaraFacultades: MENSAJES_ACEPTACION.declaracion } };
      if (motivo === "no_disponible") return { tipo: "error", mensaje: MENSAJES_ALTA.noDisponible };
      return { tipo: "error", mensaje: MENSAJES_ALTA.generico };
    }
    tenantId = cuenta.tenantId;
  } catch (e) {
    deps.log("registro.rpc_excepcion", { detalle: detalle(e) });
    await borrarUsuario("rpc");
    await cerrar("fallo", "rpc");
    return { tipo: "error", mensaje: MENSAJES_ALTA.generico };
  }

  // 5. Correo de confirmación. Si no sale, se deshace el alta.
  let envio: { ok: true } | { ok: false; detalle: string };
  try {
    envio = await deps.enviarConfirmacion(datos.email);
  } catch (e) {
    envio = { ok: false, detalle: detalle(e) };
  }
  if (!envio.ok) {
    deps.log("registro.email_error", { detalle: envio.detalle });
    let reversion: { revertido: boolean; motivo: string | null };
    try {
      reversion = await deps.revertirCuenta(userId);
    } catch (e) {
      reversion = { revertido: false, motivo: `excepcion:${detalle(e)}` };
    }
    if (reversion.revertido) {
      await borrarUsuario("email");
      await cerrar("fallo", "email");
    } else {
      // No se borra el usuario: el residencial quedaría sin dueño.
      deps.log("registro.compensacion_incompleta", { motivo: reversion.motivo, tenantId });
      await cerrar("fallo", "email_sin_compensar");
    }
    return { tipo: "error", mensaje: MENSAJES_ALTA.correo };
  }

  await cerrar("exito", null);
  deps.log("registro.ok", { tenantId });
  return REVISA_CORREO;
}

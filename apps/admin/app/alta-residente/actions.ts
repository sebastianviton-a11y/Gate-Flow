"use server";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@gateflow/supabase";
import { configuracionAntibot, verificarDesafio } from "@/lib/registro/antibot";
import { emitirTokenTiempo, ipDesdeHeaders } from "@/lib/registro/hash";
import {
  interpretarCrearSolicitud,
  interpretarEnlacePublico,
  leerCamposResidente,
  MENSAJES_RESIDENTE,
  procesarEnvioResidente,
  RE_TOKEN_ENLACE,
  type DepsEnvioResidente,
  type EstadoEnlace,
  type ResultadoEnvioResidente,
} from "@/lib/residentes/alta-publica";

/**
 * Formulario público de residentes. El token llega en el cuerpo de la
 * petición (en la URL viaja después del #, que el navegador no envía al
 * servidor): no queda en registros de acceso ni en cabeceras Referer.
 * Las funciones de la base solo las puede llamar service_role.
 *
 * Turnstile con la misma configuración que /registro
 * (lib/registro/antibot.ts): en staging, localhost y previews sin claves
 * se omite (trampa, tiempo mínimo, límites de la base y revisión del
 * administrador); en el entorno de clientes es obligatorio con claves
 * reales y, sin ellas, el formulario queda cerrado.
 */

function pepperValido(): string | null {
  const pepper = process.env.REGISTRO_HASH_PEPPER;
  return pepper && pepper.length >= 16 ? pepper : null;
}

function log(evento: string, datos?: Record<string, string>) {
  console.warn(`[GateFlow] ${evento}`, datos ? JSON.stringify(datos) : "");
}

async function consultar(servicio: ReturnType<typeof createServiceRoleClient>, token: string): Promise<EstadoEnlace> {
  const { data, error } = await servicio.rpc("residentes_enlace_publico", { p_token: token });
  if (error) throw new Error(error.code ?? "rpc");
  return interpretarEnlacePublico(data);
}

export type EstadoFormularioResidente =
  | { estado: "activo"; residencial: string; pais: "AR" | "MX"; t: string }
  | { estado: "revocado" | "no_operativo" | "no_disponible"; mensaje: string };

export async function consultarEnlaceResidente(token: string): Promise<EstadoFormularioResidente> {
  const pepper = pepperValido();
  const antibot = configuracionAntibot(process.env);
  if (!pepper || antibot.modo === "deshabilitado") {
    log("residentes_enlace_deshabilitado", { motivo: pepper ? `antibot_${antibot.modo === "deshabilitado" ? antibot.motivo : ""}` : "sin_pepper" });
    return { estado: "no_disponible", mensaje: MENSAJES_RESIDENTE.noDisponible };
  }
  if (typeof token !== "string" || !RE_TOKEN_ENLACE.test(token)) {
    return { estado: "revocado", mensaje: MENSAJES_RESIDENTE.revocado };
  }
  try {
    const enlace = await consultar(createServiceRoleClient(), token);
    if (enlace.estado === "activo") return { ...enlace, t: emitirTokenTiempo(pepper) };
    return enlace.estado === "revocado"
      ? { estado: "revocado", mensaje: MENSAJES_RESIDENTE.revocado }
      : { estado: "no_operativo", mensaje: MENSAJES_RESIDENTE.noOperativo };
  } catch (e) {
    log("residentes_enlace_error", { codigo: e instanceof Error ? e.message : "?" });
    return { estado: "no_disponible", mensaje: MENSAJES_RESIDENTE.noDisponible };
  }
}

export async function enviarDatosResidente(formData: FormData): Promise<ResultadoEnvioResidente> {
  const pepper = pepperValido();
  const antibot = configuracionAntibot(process.env);
  if (!pepper || antibot.modo === "deshabilitado") {
    log("residentes_envio_deshabilitado", { motivo: pepper ? `antibot_${antibot.modo === "deshabilitado" ? antibot.motivo : ""}` : "sin_pepper" });
    return { tipo: "error", mensaje: MENSAJES_RESIDENTE.noDisponible };
  }

  const cabeceras = headers();
  const ip = ipDesdeHeaders((nombre) => cabeceras.get(nombre));
  // Turnstile se verifica dentro de procesarEnvioResidente, después de la
  // trampa y del tiempo mínimo (un envío demasiado rápido no gasta el token).
  let verificar: DepsEnvioResidente["verificarDesafio"];
  if (antibot.modo === "turnstile") {
    const desafio = formData.get("cf-turnstile-response");
    verificar = () => verificarDesafio(typeof desafio === "string" ? desafio : null, { secreto: antibot.secreto, ip });
  } else {
    log("residentes_envio_sin_desafio", { motivo: "entorno_de_pruebas" });
  }

  let servicio: ReturnType<typeof createServiceRoleClient>;
  try {
    servicio = createServiceRoleClient();
  } catch {
    log("residentes_envio_deshabilitado", { motivo: "sin_clave_servicio" });
    return { tipo: "error", mensaje: MENSAJES_RESIDENTE.noDisponible };
  }

  const deps: DepsEnvioResidente = {
    consultarEnlace: (token) => consultar(servicio, token),
    async crearSolicitud({ token, nombre, apellido, direccion, telefono, ipHash }) {
      const { data, error } = await servicio.rpc("residentes_solicitud_crear", {
        p_token: token,
        p_nombre: nombre,
        p_apellido: apellido,
        p_direccion: direccion,
        p_telefono: telefono,
        p_ip_hash: ipHash,
      });
      if (error) throw new Error(error.code ?? "rpc");
      return interpretarCrearSolicitud(data);
    },
    verificarDesafio: verificar,
    log,
  };
  return procesarEnvioResidente(deps, leerCamposResidente(formData), { pepper, ip });
}

"use server";

import { headers } from "next/headers";
import { createServiceRoleClient } from "@gateflow/supabase";
import { ejecutarAlta, MENSAJES_ALTA, type DepsAlta, type ResultadoAlta } from "@/lib/registro/alta";
import { configuracionAntibot, verificarDesafio } from "@/lib/registro/antibot";
import { urlPublicaAdmin } from "@/lib/entorno";
import { enviarCorreoConfirmacion } from "@/lib/registro/confirmacion";
import { ipDesdeHeaders } from "@/lib/registro/hash";
import { leerCampos } from "@/lib/registro/validacion";

/**
 * Alta pública de cuenta + residencial con trial de 30 días. El
 * navegador solo manda los campos del formulario; tenant, empresa,
 * rol, fechas y estado los decide el servidor (lib/registro/alta.ts y
 * la RPC crear_cuenta_prueba). Nunca se usa supabase.auth.signUp:
 * "Allow new users to sign up" sigue OFF y el usuario se crea con la
 * clave secreta.
 */
export async function registrarCuentaPrueba(formData: FormData): Promise<ResultadoAlta> {
  const pepper = process.env.REGISTRO_HASH_PEPPER;
  if (!pepper || pepper.length < 16) {
    console.error("[GateFlow] /registro: falta REGISTRO_HASH_PEPPER (mínimo 16 caracteres); el registro queda deshabilitado.");
    return { tipo: "error", mensaje: MENSAJES_ALTA.noDisponible };
  }

  const urlAdmin = urlPublicaAdmin();
  if (!urlAdmin) {
    console.error("[GateFlow] /registro: falta NEXT_PUBLIC_ADMIN_APP_URL; el registro queda deshabilitado.");
    return { tipo: "error", mensaje: MENSAJES_ALTA.noDisponible };
  }

  // Turnstile: en el entorno de clientes es obligatorio y con claves
  // reales; si no, el registro queda cerrado (lib/registro/antibot.ts).
  const configAntibot = configuracionAntibot(process.env);
  if (configAntibot.modo === "deshabilitado") {
    console.error(`[GateFlow] /registro: Turnstile no configurado para este entorno (${configAntibot.motivo}); el registro queda deshabilitado.`);
    return { tipo: "error", mensaje: MENSAJES_ALTA.noDisponible };
  }

  const cabeceras = headers();
  const ip = ipDesdeHeaders((nombre) => cabeceras.get(nombre));

  if (configAntibot.modo === "omitido") {
    console.warn("[GateFlow] /registro: Turnstile omitido (entorno de pruebas sin claves).");
  } else {
    const desafio = formData.get("cf-turnstile-response");
    const antibot = await verificarDesafio(typeof desafio === "string" ? desafio : null, { secreto: configAntibot.secreto, ip });
    if (!antibot.ok) {
      console.warn("[GateFlow] /registro: desafío anti-bot rechazado:", antibot.motivo);
      return { tipo: "error", mensaje: MENSAJES_ALTA.desafio };
    }
  }

  let servicio: ReturnType<typeof createServiceRoleClient>;
  try {
    servicio = createServiceRoleClient();
  } catch (e) {
    console.error("[GateFlow] /registro:", e instanceof Error ? e.message : e);
    return { tipo: "error", mensaje: MENSAJES_ALTA.noDisponible };
  }

  const redirectTo = `${urlAdmin}/confirmar-cuenta`;

  const deps: DepsAlta = {
    async intentoPermitido(emailHash, ipHash) {
      const { data, error } = await servicio.rpc("registro_intento_permitido", { p_email_hash: emailHash, p_ip_hash: ipHash });
      if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
      const r = (data ?? {}) as { intento_id?: string; permitido?: boolean; motivo?: string | null };
      return { intentoId: r.intento_id ?? null, permitido: r.permitido === true, motivo: r.motivo ?? null };
    },
    async intentoResultado(intentoId, estado, motivo) {
      const { error } = await servicio.rpc("registro_intento_resultado", { p_intento_id: intentoId, p_estado: estado, p_motivo: motivo });
      if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
    },
    async crearUsuario({ email, password, nombreCompleto }) {
      const { data, error } = await servicio.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { nombre_completo: nombreCompleto },
      });
      if (error || !data.user) {
        const codigo = (error as { code?: string } | null)?.code ?? "";
        const duplicado = codigo === "email_exists" || (error?.status === 422 && /already|exists|registered/i.test(error.message));
        return { ok: false, duplicado, detalle: `${error?.status ?? ""} ${codigo} ${error?.message ?? "sin usuario"}`.trim() };
      }
      return { ok: true, userId: data.user.id };
    },
    async borrarUsuario(userId) {
      const { error } = await servicio.auth.admin.deleteUser(userId);
      if (error) throw new Error(`${error.status ?? ""} ${error.message}`.trim());
    },
    async crearCuenta({ userId, nombreResidencial, pais, viviendas, timezone, aceptaTerminos }) {
      const { data, error } = await servicio.rpc("crear_cuenta_prueba", {
        p_user_id: userId,
        p_nombre_residencial: nombreResidencial,
        p_pais: pais,
        p_viviendas: viviendas,
        p_timezone: timezone,
        p_acepta_terminos: aceptaTerminos,
      });
      if (error) return { ok: false, detalle: `${error.code ?? ""} ${error.message}`.trim() };
      const r = (data ?? {}) as { tenant_id?: string };
      return r.tenant_id ? { ok: true, tenantId: r.tenant_id } : { ok: false, detalle: "la RPC no devolvió tenant_id" };
    },
    async revertirCuenta(userId) {
      const { data, error } = await servicio.rpc("revertir_cuenta_prueba", { p_user_id: userId });
      if (error) return { revertido: false, motivo: `${error.code ?? ""} ${error.message}`.trim() };
      const r = (data ?? {}) as { revertido?: boolean; motivo?: string | null };
      return { revertido: r.revertido === true, motivo: r.motivo ?? null };
    },
    enviarConfirmacion(email) {
      return enviarCorreoConfirmacion(email, redirectTo);
    },
    log(evento, datos) {
      // Solo eventos y códigos: nunca correo, IP ni contraseña.
      console.warn(`[GateFlow] ${evento}`, datos ? JSON.stringify(datos) : "");
    },
  };

  return ejecutarAlta(deps, leerCampos(formData), { pepper, ip });
}

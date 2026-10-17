#!/usr/bin/env node
/**
 * eliminar-residencial.mjs — eliminación manual asistida de los datos de
 * un residencial (opción A, migración 20261018000000). Runbook:
 * docs/operations/ELIMINACION_DATOS.md.
 *
 *   node scripts/eliminacion/eliminar-residencial.mjs pendientes
 *   node scripts/eliminacion/eliminar-residencial.mjs simular  --residencial <uuid> --operador <alias-o-ticket>
 *   node scripts/eliminacion/eliminar-residencial.mjs ejecutar --eliminacion <uuid> --codigo <código>
 *   node scripts/eliminacion/eliminar-residencial.mjs reanudar --eliminacion <uuid>
 *
 * Variables (nunca se imprimen):
 *   GF_ELIMINACION_SUPABASE_URL        https://<ref>.supabase.co del proyecto
 *   GF_ELIMINACION_SERVICE_ROLE_KEY    clave service_role de ESE proyecto
 *
 * 0. pendientes no borra nada: lista los residenciales sin servicio con la
 *    fecha desde la que se pueden eliminar y las eliminaciones a medias.
 * 1. simular no borra nada: dice si el residencial es elegible, qué se
 *    borraría y qué se conserva, y entrega un código válido 30 minutos.
 * 2. ejecutar pide escribir el nombre exacto del residencial. La base
 *    vuelve a revisar todo: si el cliente contrató o algo cambió, cancela
 *    sin borrar. Después borra los archivos de Storage y las cuentas de
 *    Auth por la API de Supabase (borrar storage.objects por SQL deja los
 *    archivos huérfanos) y solo informa «COMPLETADA» cuando la base
 *    confirma que no queda nada.
 * 3. reanudar continúa una eliminación que quedó a medias (Storage o Auth).
 *
 * Sin dependencias (Node 18+, fetch). No imprime datos personales: solo
 * conteos, identificadores y el nombre del residencial para verificarlo.
 */
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_OPERADOR = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
const TANDA_STORAGE = 100;
const MAX_RONDAS = 50;

export const SALIDA = { ok: 0, uso: 1, rechazada: 2, cancelada: 3, fallida: 4, incompleta: 5 };

export function leerArgs(argv) {
  const [comando, ...resto] = argv;
  const opciones = {};
  for (let i = 0; i < resto.length; i++) {
    const m = /^--([a-z]+)$/.exec(resto[i]);
    if (!m || resto[i + 1] === undefined) return { comando, error: `argumento inválido: ${resto[i]}` };
    opciones[m[1]] = resto[++i];
  }
  return { comando, opciones };
}

/** URL del proyecto: https, o localhost solo con GF_ELIMINACION_LOCAL=1 (pruebas). */
export function leerConfiguracion(env) {
  const url = (env.GF_ELIMINACION_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const clave = (env.GF_ELIMINACION_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !clave) return { error: "faltan GF_ELIMINACION_SUPABASE_URL y/o GF_ELIMINACION_SERVICE_ROLE_KEY" };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { error: "GF_ELIMINACION_SUPABASE_URL no es una URL" };
  }
  const local = ["127.0.0.1", "localhost"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && env.GF_ELIMINACION_LOCAL === "1")) {
    return { error: "GF_ELIMINACION_SUPABASE_URL debe ser https://<ref>.supabase.co" };
  }
  return { url, clave, proyecto: u.host };
}

/** Cliente mínimo de la API de Supabase con la clave service_role. */
export function crearApi({ url, clave }, fetchImpl) {
  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}`, "Content-Type": "application/json" };
  async function pedir(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await fetchImpl(`${url}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    } catch (e) {
      return { ok: false, status: 0, error: `sin conexión (${e?.code ?? e?.name ?? "error"})` };
    }
    const texto = await r.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = null;
    }
    if (!r.ok) {
      // Solo el código y un mensaje corto: nunca cabeceras ni la clave.
      const detalle = datos && typeof datos === "object" ? [datos.code, datos.message ?? datos.error ?? datos.msg].filter(Boolean).join(" ") : "";
      return { ok: false, status: r.status, error: `HTTP ${r.status}${detalle ? ` ${String(detalle).slice(0, 200)}` : ""}` };
    }
    return { ok: true, status: r.status, datos };
  }
  return {
    rpc: (funcion, args) => pedir("POST", `/rest/v1/rpc/${funcion}`, args),
    borrarArchivos: (bucket, nombres) => pedir("DELETE", `/storage/v1/object/${encodeURIComponent(bucket)}`, { prefixes: nombres }),
    borrarCuenta: (id) => pedir("DELETE", `/auth/v1/admin/users/${encodeURIComponent(id)}`),
  };
}

function formatearConteo(obj) {
  const pares = Object.entries(obj ?? {});
  return pares.length ? pares.map(([k, v]) => `${k}=${v}`).join(", ") : "ninguno";
}

const dia = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "?");

async function pendientes(api, io, proyecto) {
  const r = await api.rpc("eliminacion_residencial_pendientes", {});
  if (!r.ok) return io.error(`No se pudieron leer los plazos: ${r.error}`), SALIDA.rechazada;
  const residenciales = Array.isArray(r.datos?.residenciales) ? r.datos.residenciales : [];
  const aMedias = Array.isArray(r.datos?.a_medias) ? r.datos.a_medias : [];
  const elegibles = residenciales.filter((x) => x.elegible);
  const proximos = residenciales.filter((x) => !x.elegible);
  io.escribir(`PLAZOS DE ELIMINACIÓN (no se borró nada) · proyecto ${proyecto} · ${r.datos?.generado_en ?? ""}`);
  io.escribir(`  Elegibles hoy: ${elegibles.length}`);
  for (const x of elegibles) io.escribir(`    ${x.nombre} (${x.tenant_id}) · ${x.pais} · terminó ${dia(x.fin_servicio)} · eliminable desde ${dia(x.eliminar_desde)}`);
  io.escribir(`  Sin servicio o por terminar (todavía no): ${proximos.length}`);
  for (const x of proximos) io.escribir(`    ${x.nombre} (${x.tenant_id}) · ${x.pais} · ${x.motivo} · fin ${dia(x.fin_servicio)} · eliminable desde ${dia(x.eliminar_desde)}`);
  io.escribir(`  Eliminaciones a medias: ${aMedias.length}`);
  for (const x of aMedias) io.escribir(`    ${x.eliminacion_id} (residencial ${x.tenant_id}) → reanudar --eliminacion ${x.eliminacion_id}`);
  if (elegibles.length) io.escribir("Para cada elegible: simular --residencial <id> --operador <ticket> (y seguir el runbook).");
  return SALIDA.ok;
}

async function simular(api, opciones, io, proyecto) {
  if (!RE_UUID.test(opciones.residencial ?? "")) return io.error("--residencial debe ser el uuid del residencial"), SALIDA.uso;
  if (!RE_OPERADOR.test(opciones.operador ?? "")) return io.error("--operador: alias o número de ticket, sin espacios ni @"), SALIDA.uso;
  const r = await api.rpc("eliminacion_residencial_simular", { p_tenant_id: opciones.residencial, p_operador: opciones.operador });
  if (!r.ok) return io.error(`No se pudo simular: ${r.error}`), SALIDA.rechazada;
  const s = r.datos;
  io.escribir(`SIMULACIÓN (no se borró nada) · proyecto ${proyecto}`);
  io.escribir(`  Residencial: ${s.residencial?.nombre} (${s.residencial?.id}) · país ${s.pais ?? "?"} · servicio ${s.estado_servicio ?? "?"}`);
  io.escribir(`  Suscripción: ${s.suscripcion?.estado ?? "sin suscripción"} · fin del servicio ${s.suscripcion?.fin_servicio ?? "desconocido"}`);
  io.escribir(`  Se borraría: ${formatearConteo(s.datos)}`);
  io.escribir(`  Archivos en Storage: ${formatearConteo(s.archivos)}`);
  io.escribir(`  Cuentas: ${s.cuentas?.exclusivas ?? 0} exclusivas (se borran) · ${s.cuentas?.compartidas ?? 0} compartidas con otro residencial (solo pierden el acceso a este)`);
  io.escribir(`  Se conservan: ${formatearConteo(s.se_conservan)}${s.empresa_compartida ? " · la empresa (tiene otros residenciales)" : ""}`);
  io.escribir(`  Registro de la operación: ${s.eliminacion_id}`);
  if (!s.elegible) {
    io.escribir(`NO ELEGIBLE: ${s.motivo}. No se puede eliminar.`);
    return SALIDA.rechazada;
  }
  io.escribir(`ELEGIBLE. Código: ${s.codigo} (vence ${s.expira_en}).`);
  io.escribir(`Para eliminar: node scripts/eliminacion/eliminar-residencial.mjs ejecutar --eliminacion ${s.eliminacion_id} --codigo ${s.codigo}`);
  return SALIDA.ok;
}

/** Borra lo pendiente (Storage y Auth) hasta que la base confirme que no queda nada. */
async function terminar(api, id, io) {
  let anterior = null;
  for (let ronda = 1; ronda <= MAX_RONDAS; ronda++) {
    const c = await api.rpc("eliminacion_residencial_completar", { p_eliminacion_id: id });
    if (!c.ok) return io.error(`La eliminación NO terminó: no se pudo verificar el estado (${c.error}). Repite con «reanudar --eliminacion ${id}».`), SALIDA.incompleta;
    const d = c.datos;
    if (d.ok && d.estado === "completada") {
      io.escribir(`COMPLETADA: no quedan datos, archivos ni cuentas del residencial (${d.completada_en}).`);
      return SALIDA.ok;
    }
    if (d.estado !== "en_curso") {
      io.error(`La eliminación está «${d.estado}»${d.motivo ? ` (${d.motivo})` : ""}: no hay nada que continuar.`);
      return d.estado === "cancelada" ? SALIDA.cancelada : SALIDA.fallida;
    }
    const cuentas = Array.isArray(d.cuentas_pendientes) ? d.cuentas_pendientes : [];
    const pendientes = `${d.archivos_pendientes} archivos y ${cuentas.length} cuentas`;
    if (anterior === pendientes) {
      return io.error(`La eliminación NO terminó: siguen pendientes ${pendientes} y no hubo avance. Repite con «reanudar --eliminacion ${id}».`), SALIDA.incompleta;
    }
    anterior = pendientes;
    io.escribir(`  Pendiente: ${pendientes}…`);
    const errores = [];
    for (const [bucket, nombres] of Object.entries(d.archivos ?? {})) {
      for (let i = 0; i < nombres.length; i += TANDA_STORAGE) {
        const r = await api.borrarArchivos(bucket, nombres.slice(i, i + TANDA_STORAGE));
        if (!r.ok) errores.push(`Storage ${bucket}: ${r.error}`);
      }
    }
    // Las cuentas, solo con los archivos ya borrados: un paso a la vez.
    if (!errores.length) {
      for (const cuenta of cuentas) {
        const r = await api.borrarCuenta(cuenta);
        if (!r.ok && r.status !== 404) errores.push(`Auth ${cuenta}: ${r.error}`);
      }
    }
    if (errores.length) {
      for (const e of errores.slice(0, 10)) io.error(`  ${e}`);
      return io.error(`La eliminación NO terminó (${errores.length} errores). Los datos de la base ya se borraron; repite con «reanudar --eliminacion ${id}».`), SALIDA.incompleta;
    }
  }
  return io.error(`La eliminación NO terminó tras ${MAX_RONDAS} rondas. Repite con «reanudar --eliminacion ${id}».`), SALIDA.incompleta;
}

async function ejecutar(api, opciones, io, proyecto) {
  if (!RE_UUID.test(opciones.eliminacion ?? "")) return io.error("--eliminacion debe ser el uuid que dio la simulación"), SALIDA.uso;
  if (!/^[0-9A-Fa-f]{10}$/.test(opciones.codigo ?? "")) return io.error("--codigo debe ser el código de 10 caracteres de la simulación"), SALIDA.uso;
  io.escribir(`Vas a ELIMINAR los datos del residencial de la simulación ${opciones.eliminacion} en el proyecto ${proyecto}.`);
  io.escribir("Esto no se puede deshacer. Escribe el nombre exacto del residencial para confirmar (vacío cancela):");
  const nombre = ((await io.leerLinea()) ?? "").trim();
  if (!nombre) return io.escribir("Cancelado: no se borró nada."), SALIDA.cancelada;
  const r = await api.rpc("eliminacion_residencial_ejecutar", { p_eliminacion_id: opciones.eliminacion, p_codigo: opciones.codigo, p_nombre_confirmado: nombre });
  if (!r.ok) return io.error(`No se eliminó nada: ${r.error}`), SALIDA.rechazada;
  const d = r.datos;
  if (d.estado === "cancelada") return io.error(`CANCELADA (${d.motivo}): no se borró nada. Si corresponde, simula de nuevo.`), SALIDA.cancelada;
  if (d.estado === "fallida") return io.error(`FALLÓ (código ${d.sqlstate}): la base deshizo todo, no se borró nada. Revisa el registro ${opciones.eliminacion}.`), SALIDA.fallida;
  if (!d.ok || d.estado !== "en_curso") return io.error(`Respuesta inesperada (${d.estado ?? "?"}): revisa el registro ${opciones.eliminacion}.`), SALIDA.incompleta;
  io.escribir(`Datos de la base eliminados. Archivos: ${formatearConteo(d.archivos)} · cuentas de Auth: ${d.cuentas_pendientes}.`);
  return terminar(api, opciones.eliminacion, io);
}

async function reanudar(api, opciones, io) {
  if (!RE_UUID.test(opciones.eliminacion ?? "")) return io.error("--eliminacion debe ser el uuid del registro"), SALIDA.uso;
  return terminar(api, opciones.eliminacion, io);
}

export async function principal(argv, { env = process.env, fetchImpl = globalThis.fetch, io } = {}) {
  const { comando, opciones, error } = leerArgs(argv);
  if (error || !["pendientes", "simular", "ejecutar", "reanudar"].includes(comando)) {
    io.error(error ?? "uso: eliminar-residencial.mjs pendientes|simular|ejecutar|reanudar … (ver docs/operations/ELIMINACION_DATOS.md)");
    return SALIDA.uso;
  }
  const config = leerConfiguracion(env);
  if (config.error) return io.error(config.error), SALIDA.uso;
  const api = crearApi(config, fetchImpl);
  if (comando === "pendientes") return pendientes(api, io, config.proyecto);
  if (comando === "simular") return simular(api, opciones, io, config.proyecto);
  if (comando === "ejecutar") return ejecutar(api, opciones, io, config.proyecto);
  return reanudar(api, opciones, io);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rl = createInterface({ input: process.stdin });
  const lineas = rl[Symbol.asyncIterator]();
  const io = {
    escribir: (t) => console.log(t),
    error: (t) => console.error(t),
    leerLinea: async () => (await lineas.next()).value,
  };
  principal(process.argv.slice(2), { io }).then((codigo) => {
    rl.close();
    process.exit(codigo);
  });
}

/**
 * Registro de residentes por enlace: validación compartida (navegador,
 * servidor y revisión del administrador). Sin red ni base.
 *   npx tsx apps/admin/lib/__tests__/residentes-enlace.test.ts
 * Las reglas de la base (fn_residente_*) y el flujo completo están en
 * supabase/tests/security/94_residentes_enlace.sql y en el recorrido.
 */
import {
  construirEnlaceWhatsAppGrupo,
  destinatariosDeVivienda,
  errorCampoResidente,
  formatearWhatsApp,
  idPersonaDestinataria,
  limpiarEspacios,
  normalizarTelefonoWhatsApp,
  validarDatosResidente,
  validarWhatsApp,
  urlCompartirEnlaceWhatsApp,
  urlEnlaceResidentes,
  type PaisResidencial,
} from "@gateflow/paquetes";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configuracionAntibot } from "../registro/antibot";
import { emitirTokenTiempo } from "../registro/hash";
import {
  interpretarCrearSolicitud,
  interpretarEnlacePublico,
  MENSAJES_RESIDENTE,
  procesarEnvioResidente,
  type CamposEnvioResidente,
  type DepsEnvioResidente,
  type EstadoEnlace,
  type ResultadoCrearSolicitud,
} from "../residentes/alta-publica";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}
const ok = (t: string, p: PaisResidencial) => {
  const r = validarWhatsApp(t, p);
  return r.ok ? r.normalizado : null;
};
const error = (t: string, p: PaisResidencial) => {
  const r = validarWhatsApp(t, p);
  return r.ok ? null : r.error;
};

console.log("\nWhatsApp México (+52, 10 dígitos)");
assert(ok("998 123 4567", "MX") === "529981234567", "10 dígitos con espacios");
assert(ok("998-123-4567", "MX") === "529981234567" && ok("(998) 123.4567", "MX") === "529981234567", "guiones, paréntesis y puntos");
assert(ok("+52 998 123 4567", "MX") === "529981234567" && ok("52 998 123 4567", "MX") === "529981234567", "con el +52 una vez: se acepta");
assert(ok("+52 1 998 123 4567", "MX") === "529981234567" && ok("0052 998 123 4567", "MX") === "529981234567", "prefijo móvil anterior (521) y 00 internacional");
assert(/Sobran dígitos: escribiste 11/.test(error("998 123 45678", "MX") ?? ""), "un dígito de más → sobran (11 de 10)");
assert(/Faltan dígitos: escribiste 9/.test(error("998 123 456", "MX") ?? ""), "incompleto → faltan (9 de 10)");
assert(/repetido/.test(error("+52 52 998 123 4567", "MX") ?? "") && /repetido/.test(error("52 52 998 123 4567", "MX") ?? ""), "prefijo duplicado → +52 repetido");
assert(/Usa solo números/.test(error("998 123 45a7", "MX") ?? "") && /Usa solo números/.test(error("998+1234567", "MX") ?? ""), "letras o un + en medio → solo números");
assert(/no empiezan con 0 ni con 1/.test(error("012 345 6789", "MX") ?? ""), "empieza con 0 → revisar el primer dígito");
assert(/de México/.test(error("+54 9 11 2345 6789", "MX") ?? ""), "un número de otro país en un residencial MX → rechazado");
assert(error("", "MX") === "Escribe tu número de WhatsApp." && error("   ", "MX") === "Escribe tu número de WhatsApp.", "vacío → obligatorio");

console.log("\nWhatsApp Argentina (+54 9, área + número = 10 dígitos)");
assert(ok("11 2345-6789", "AR") === "5491123456789", "área 11 + número");
assert(ok("011 15 2345-6789", "AR") === "5491123456789", "con 0 y 15 (formato local) → sin el 0 ni el 15");
assert(ok("0351 15 123-4567", "AR") === "5493511234567", "área de 3 dígitos con 15");
assert(ok("+54 11 2345 6789", "AR") === "5491123456789" && ok("+54 9 11 2345 6789", "AR") === "5491123456789", "con +54 o +54 9 una vez");
assert(ok("9 11 2345 6789", "AR") === "5491123456789", "con el 9 de celular escrito a mano");
assert(ok("2994 12-3456", "AR") === "5492994123456", "área de 4 dígitos");
assert(/Sobran dígitos: escribiste 11/.test(error("11 2345 67890", "AR") ?? ""), "un dígito de más → sobran");
assert(/Faltan dígitos: escribiste 9/.test(error("11 2345 678", "AR") ?? ""), "incompleto → faltan");
assert(/repetido/.test(error("+54 9 54 9 11 2345 6789", "AR") ?? "") && /repetido/.test(error("549 549 11 2345 6789", "AR") ?? ""), "prefijo duplicado → +54 9 repetido");
assert(/Falta el código de área/.test(error("15 2345 6789", "AR") ?? ""), "celular sin código de área (15 …) → falta el área");
assert(/código de área/.test(error("6123 4567 89", "AR") ?? ""), "área imposible (empieza con 6) → revisar el área");
assert(/de Argentina/.test(error("+52 998 123 4567", "AR") ?? ""), "un número de México en un residencial AR → rechazado");
assert(/Usa solo números/.test(error("11-2345-678O", "AR") ?? ""), "una letra O en lugar de un cero → solo números");

console.log("\nLo aceptado coincide con la regla existente (enlace de WhatsApp de la guardia)");
const validos: Array<[string, PaisResidencial]> = [
  ["998 123 4567", "MX"], ["+52 1 998 123 4567", "MX"], ["11 2345-6789", "AR"], ["011 15 2345-6789", "AR"],
  ["0351 15 123-4567", "AR"], ["+54 9 11 2345 6789", "AR"], ["9 11 2345 6789", "AR"],
];
for (const [t, p] of validos) {
  const n = ok(t, p);
  assert(n !== null && normalizarTelefonoWhatsApp(n, p) === n, `${p} "${t}" → punto fijo de normalizarTelefonoWhatsApp (con el país del residencial)`);
}
assert(/^549\d{10}$/.test(ok("11 2345-6789", "AR") ?? "") && /^52\d{10}$/.test(ok("998 123 4567", "MX") ?? ""), "mismo formato que exige la base (549… / 52…)");
assert(formatearWhatsApp("529981234567", "MX") === "+52 998 123 4567" && formatearWhatsApp("5491123456789", "AR") === "+54 9 11 2345 6789", "formato para el resumen");

console.log("\nNombre, apellido y dirección");
const datos = (n: string, a: string, d = "Casa 12", w = "998 123 4567") => validarDatosResidente({ nombre: n, apellido: a, direccion: d, whatsapp: w }, "MX");
const nombresValidos: Array<[string, string]> = [["María José", "Núñez Güemes"], ["Ana-Lía", "O'Connor"], ["Zoë", "D’Angelo"], ["Iñaki", "de la Peña"]];
for (const [n, a] of nombresValidos) {
  assert(datos(n, a).ok, `acepta "${n} ${a}" (acentos, ñ, ü, espacios, apóstrofos y guiones)`);
}
const r1 = datos("Juan2", "Pérez");
assert(!r1.ok && /números/.test(r1.errores.nombre ?? ""), "dígitos en el nombre → error en el nombre");
const r2 = datos("Ana", "López@");
assert(!r2.ok && /Usa solo letras/.test(r2.errores.apellido ?? "") && !r2.errores.nombre, "símbolo en el apellido → error solo en el apellido");
const r3 = datos("-Ana", "Paz--Ruiz");
assert(!r3.ok && !!r3.errores.nombre && !!r3.errores.apellido, "separador al principio o doble → error");
const r4 = datos("", "", "", "");
assert(!r4.ok && Object.keys(r4.errores).sort().join(",") === "apellido,direccion,nombre,whatsapp", "todo vacío → los cuatro campos marcados");
const r5 = datos("a".repeat(61), "López", "x".repeat(121));
assert(!r5.ok && /Máximo 60/.test(r5.errores.nombre ?? "") && /Máximo 120/.test(r5.errores.direccion ?? ""), "límites de longitud (60 y 120)");
const r6 = datos("Ana", "López", "#$%");
assert(!r6.ok && /calle y el número/.test(r6.errores.direccion ?? ""), "dirección sin letras ni números → error concreto");
const r7 = datos("  Ana   María ", " López ", "  Torre B,   Depto 4°  ", " +52 998 123 4567 ");
assert(r7.ok && r7.datos.nombre === "Ana María" && r7.datos.apellido === "López" && r7.datos.direccion === "Torre B, Depto 4°" && r7.datos.telefono === "529981234567",
  "limpia espacios sobrantes sin alterar la dirección (comas, °)");
const r8 = datos("Ana", "López", "Casa 12", "998 123 456");
assert(!r8.ok && r8.limpios.nombre === "Ana" && r8.limpios.whatsapp === "998 123 456", "con un error se conserva lo escrito para corregirlo");
assert(limpiarEspacios(" Casa  5 ") === "Casa 5", "espacios no separables también");
assert(errorCampoResidente("whatsapp", "998 123 45678", "MX") !== null && errorCampoResidente("nombre", "Ana", "MX") === null, "validación por campo (al salir del campo)");

console.log("\nGuard: destinatarios de una vivienda y enlace de WhatsApp");
{
  const vivienda = {
    contactoNombre: "Rosa Propietaria",
    contactoTelefono: "998 333 4444",
    adicionales: [
      { id: "11111111-1111-4111-8111-111111111111", nombre: "Iván Inquilino", telefono: "529981110020" },
      { id: "22222222-2222-4222-8222-222222222222", nombre: "Lucía Paz", telefono: "5491123456789" },
    ],
  };
  const d = destinatariosDeVivienda(vivienda);
  assert(d.map((x) => x.clave).join(",") === "contacto,11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222",
    "la guardia puede elegir al contacto o a cualquier persona aprobada de la vivienda");
  assert(idPersonaDestinataria(d[0]!) === null && idPersonaDestinataria(d[1]!) === "11111111-1111-4111-8111-111111111111" && idPersonaDestinataria(null) === null,
    "G: la persona aprobada elegida queda en el paquete (destinatario_residente_id); el contacto no lleva id");
  assert(destinatariosDeVivienda({ contactoNombre: null, contactoTelefono: null, adicionales: [] }).length === 0 && destinatariosDeVivienda(null).length === 0,
    "vivienda sin contacto ni personas aprobadas → nadie a quien avisar");
  const solo = destinatariosDeVivienda({ contactoNombre: null, contactoTelefono: null, adicionales: [vivienda.adicionales[0]!] });
  assert(solo.length === 1 && solo[0]!.nombre === "Iván Inquilino", "vivienda sin contacto: la persona aprobada es el destinatario");
  // El enlace usa el constructor de staging con el país del residencial
  // (session.tenant.pais): un número aprobado (52… / 549…) llega intacto.
  const mx = construirEnlaceWhatsAppGrupo(d[1]!.telefono, "Hola", "MX");
  const ar = construirEnlaceWhatsAppGrupo(d[2]!.telefono, "Hola", "AR");
  assert(mx?.url === "https://wa.me/529981110020?text=Hola" && ar?.url === "https://wa.me/5491123456789?text=Hola",
    "WhatsApp: el enlace sale al número aprobado sin cambios (MX y AR)");
  assert(normalizarTelefonoWhatsApp("529981110020", "MX") === "529981110020" && normalizarTelefonoWhatsApp("5491123456789", "AR") === "5491123456789",
    "WhatsApp: la regla de staging deja intactos los números ya normalizados");
  assert(normalizarTelefonoWhatsApp("998 333 4444", "MX") === "529983334444" && construirEnlaceWhatsAppGrupo("11 2345-6789", "Hola", "AR")?.url === "https://wa.me/5491123456789?text=Hola",
    "WhatsApp: el contacto cargado a mano sigue la regla de su país (MX 52…, AR 549…)");
}

async function servidor() {
  console.log("\nServidor del formulario público (dependencias falsas)");
  const PEPPER = "pepper-de-prueba-0123456789";
  const TOKEN = "a".repeat(64);
  const ahora = 1_800_000_000_000;
  const t = emitirTokenTiempo(PEPPER, ahora - 10_000);
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const GUARDADA: ResultadoCrearSolicitud = { resultado: "recibida", solicitudId: ID };
  const crear = (enlace: EstadoEnlace, resultado: ResultadoCrearSolicitud = GUARDADA, desafio?: { ok: boolean; motivo?: string }) => {
    const llamadas: Array<Parameters<DepsEnvioResidente["crearSolicitud"]>[0]> = [];
    const logs: string[] = [];
    let consultas = 0;
    let desafios = 0;
    const deps: DepsEnvioResidente = {
      async consultarEnlace() {
        consultas++;
        return enlace;
      },
      async crearSolicitud(a) {
        llamadas.push(a);
        return resultado;
      },
      ...(desafio
        ? {
            async verificarDesafio() {
              desafios++;
              return desafio;
            },
          }
        : {}),
      log(evento, datos) {
        logs.push(`${evento} ${JSON.stringify(datos ?? {})}`);
      },
    };
    return { deps, llamadas, logs, consultas: () => consultas, desafios: () => desafios };
  };
  const campos = (extra: Partial<CamposEnvioResidente> = {}): CamposEnvioResidente => ({
    token: TOKEN, nombre: "  María José ", apellido: "Núñez", direccion: " Torre B,  Depto 4 ", whatsapp: "011 15 2345-6789", t, sitio_web: "", ...extra,
  });
  const ctx = { pepper: PEPPER, ip: "203.0.113.7", ahoraMs: ahora };
  const AR: EstadoEnlace = { estado: "activo", residencial: "ZZ Las Lomas", pais: "AR" };

  let f = crear(AR);
  let r = await procesarEnvioResidente(f.deps, campos(), ctx);
  const a = f.llamadas[0];
  assert(r.tipo === "enviado" && r.mensaje === "Tus datos fueron enviados a la administración del residencial para su revisión.", "válido → mensaje de envío pedido");
  assert(a?.telefono === "5491123456789" && a.nombre === "María José" && a.direccion === "Torre B, Depto 4", "normaliza con el país del RESIDENCIAL (AR) y limpia espacios");
  assert(/^[0-9a-f]{64}$/.test(a?.ipHash ?? "") && a?.ipHash !== "203.0.113.7", "la IP llega solo como hash");
  const textoLogs = f.logs.join(" ");
  assert(!/María|Núñez|Torre|2345|203\.0\.113|aaaaaaaa/.test(textoLogs), "los logs no llevan nombre, dirección, teléfono, IP ni token");

  f = crear({ estado: "activo", residencial: "ZZ Polanco", pais: "MX" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "campos" && !!r.errores.whatsapp && f.llamadas.length === 0, "el país no lo elige el formulario: un número AR en un residencial MX se rechaza");

  f = crear(AR);
  r = await procesarEnvioResidente(f.deps, campos({ token: "corto" }), ctx);
  assert(r.tipo === "no_disponible" && r.motivo === "revocado" && f.consultas() === 0, "token mal formado → enlace no activo, sin consultar la base");

  f = crear(AR);
  r = await procesarEnvioResidente(f.deps, campos({ sitio_web: "http://spam" }), ctx);
  assert(r.tipo === "error" && r.mensaje === MENSAJES_RESIDENTE.generico && f.llamadas.length === 0 && f.consultas() === 0,
    "trampa llena → error genérico (nunca \"enviado\"), nada guardado");

  // Demasiado rápido: nada guardado, pide esperar.
  const rapido = emitirTokenTiempo(PEPPER, ahora - 1_000);
  f = crear(AR);
  r = await procesarEnvioResidente(f.deps, campos({ t: rapido }), ctx);
  assert(r.tipo === "esperar" && !r.renovar && r.mensaje === MENSAJES_RESIDENTE.rapido && f.llamadas.length === 0 && f.consultas() === 0,
    "enviado en menos de 4 s → esperar y volver a enviar (sin guardar ni consultar la base)");
  r = await procesarEnvioResidente(f.deps, campos({ t: rapido }), { ...ctx, ahoraMs: ahora + 5_000 });
  assert(r.tipo === "enviado" && f.llamadas.length === 1, "el mismo envío, 5 s después → se guarda y recién ahí \"enviado\"");
  f = crear(AR);
  r = await procesarEnvioResidente(f.deps, campos({ t: emitirTokenTiempo(PEPPER, ahora - 2 * 3600_000) }), ctx);
  assert(r.tipo === "esperar" && r.renovar && f.llamadas.length === 0, "formulario abierto más de una hora → token nuevo y reenviar, sin recargar");
  r = await procesarEnvioResidente(f.deps, campos({ t: "123.firma-falsa" }), ctx);
  assert(r.tipo === "esperar" && r.renovar && f.llamadas.length === 0, "token de tiempo inválido → token nuevo, nada guardado");

  // C. Sin Turnstile (staging sin claves: modo "omitido", el servidor no
  // pasa verificarDesafio): el flujo completo funciona solo con la
  // trampa, el tiempo mínimo y los límites de la base.
  f = crear(AR);
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "enviado" && f.llamadas.length === 1 && f.consultas() === 1 && !("verificarDesafio" in f.deps),
    "sin Turnstile: envío válido → consulta el enlace, guarda una vez y responde \"enviado\"");
  f = crear(AR, { resultado: "limite_conexion" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "error" && f.llamadas.length === 1, "sin Turnstile: los límites de la base siguen frenando los envíos");

  // Con Turnstile (entorno de clientes, o staging con claves): se verifica
  // después de la trampa y del tiempo mínimo; rechazado → nada guardado.
  f = crear(AR, GUARDADA, { ok: false, motivo: "invalid-input-response" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "error" && r.mensaje === MENSAJES_RESIDENTE.desafio && f.llamadas.length === 0 && f.consultas() === 0 && f.desafios() === 1,
    "desafío rechazado → error, sin consultar el enlace ni guardar");
  assert(!f.logs.join(" ").includes("aaaaaaaa"), "el log del desafío lleva solo el motivo");
  f = crear(AR, GUARDADA, { ok: true });
  r = await procesarEnvioResidente(f.deps, campos({ t: emitirTokenTiempo(PEPPER, ahora - 1_000) }), ctx);
  assert(r.tipo === "esperar" && f.desafios() === 0 && f.llamadas.length === 0, "enviado demasiado rápido → esperar, sin gastar el desafío");
  r = await procesarEnvioResidente(f.deps, campos({ sitio_web: "http://spam" }), ctx);
  assert(r.tipo === "error" && f.desafios() === 0 && f.llamadas.length === 0, "trampa llena → error, sin gastar el desafío");
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "enviado" && f.desafios() === 1 && f.llamadas.length === 1, "desafío aprobado → se guarda");

  f = crear({ estado: "revocado" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "no_disponible" && r.motivo === "revocado" && f.llamadas.length === 0, "enlace revocado → no se envía");
  f = crear({ estado: "no_operativo" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "no_disponible" && r.motivo === "no_operativo" && f.llamadas.length === 0, "residencial no operativo → no se envía");

  f = crear(AR);
  r = await procesarEnvioResidente(f.deps, campos({ nombre: "Ana2", whatsapp: "11 2345 67890" }), ctx);
  assert(r.tipo === "campos" && !!r.errores.nombre && !!r.errores.whatsapp && !r.errores.direccion && f.llamadas.length === 0, "errores por campo, sin llamar a la base");

  f = crear(AR, { resultado: "limite_conexion" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "error" && r.mensaje === MENSAJES_RESIDENTE.limiteConexion, "límite de la conexión → esperar o usar datos móviles");
  f = crear(AR, { resultado: "limite_enlace" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "error" && r.mensaje === MENSAJES_RESIDENTE.limiteEnlace, "límite del enlace → más tarde o consultar a la administración");
  f = crear(AR, { resultado: "revocado" });
  r = await procesarEnvioResidente(f.deps, campos(), ctx);
  assert(r.tipo === "no_disponible" && r.motivo === "revocado", "revocado entre la carga y el envío → enlace no activo");

  const falla: DepsEnvioResidente = {
    consultarEnlace: async () => AR,
    crearSolicitud: async () => {
      throw new Error("PGRST301");
    },
    log: () => {},
  };
  r = await procesarEnvioResidente(falla, campos(), ctx);
  assert(r.tipo === "error" && r.mensaje === MENSAJES_RESIDENTE.generico, "falla de la base → mensaje genérico");

  assert(interpretarEnlacePublico({ estado: "activo", residencial: "X", pais: "AR" }).estado === "activo", "enlace activo con país válido");
  assert(interpretarEnlacePublico({ estado: "activo", residencial: "X", pais: "CL" }).estado === "revocado", "país no soportado → no se muestra el formulario");
  assert(interpretarEnlacePublico(null).estado === "revocado" && interpretarEnlacePublico({ estado: "no_operativo" }).estado === "no_operativo", "respuestas de la base");
  const i1 = interpretarCrearSolicitud({ resultado: "recibida", solicitud_id: ID });
  assert(i1.resultado === "recibida" && i1.solicitudId === ID, "recibida con el id de la solicitud guardada");
  assert(
    interpretarCrearSolicitud({ resultado: "recibida" }).resultado === "invalido"
      && interpretarCrearSolicitud({ resultado: "recibida", solicitud_id: "no-es-uuid" }).resultado === "invalido"
      && interpretarCrearSolicitud({ resultado: "limite" }).resultado === "invalido"
      && interpretarCrearSolicitud({}).resultado === "invalido",
    "recibida sin id válido, o un resultado desconocido → invalido (nunca éxito)",
  );

  // "enviado" si y solo si la base devolvió una solicitud guardada.
  const respuestas: unknown[] = [
    { resultado: "recibida", solicitud_id: ID },
    { resultado: "recibida" },
    { resultado: "recibida", solicitud_id: null },
    { resultado: "limite_conexion" },
    { resultado: "limite_enlace" },
    { resultado: "revocado" },
    { resultado: "no_operativo" },
    { resultado: "invalido" },
    null,
  ];
  const malas: string[] = [];
  for (const data of respuestas) {
    const g = crear(AR, interpretarCrearSolicitud(data));
    const res = await procesarEnvioResidente(g.deps, campos(), ctx);
    const guardada = (data as { solicitud_id?: unknown } | null)?.solicitud_id === ID;
    if ((res.tipo === "enviado") !== guardada) malas.push(JSON.stringify(data));
  }
  assert(malas.length === 0, `el mensaje de éxito aparece solo con una solicitud guardada (${respuestas.length} respuestas de la base)${malas.length ? `: ${malas.join(" ")}` : ""}`);
}

function configuracion() {
  console.log("\nTurnstile del formulario: la misma configuración que /registro");
  const raiz = join(__dirname, "..", "..");
  const acciones = readFileSync(join(raiz, "app/alta-residente/actions.ts"), "utf8");
  const pagina = readFileSync(join(raiz, "app/alta-residente/page.tsx"), "utf8");
  const formulario = readFileSync(join(raiz, "app/alta-residente/alta-residente.tsx"), "utf8");
  const usos = acciones.match(/configuracionAntibot\(process\.env\)/g) ?? [];
  assert(usos.length === 2 && /antibot\.modo === "deshabilitado"/.test(acciones.slice(acciones.indexOf("consultarEnlaceResidente")))
    && /if \(!pepper \|\| antibot\.modo === "deshabilitado"\)/.test(acciones.slice(acciones.indexOf("enviarDatosResidente"))),
    "consulta y envío: entorno de clientes sin claves reales → formulario cerrado (nunca abierto sin desafío)");
  assert(/antibot\.modo === "turnstile"/.test(acciones) && /verificarDesafio\(typeof desafio === "string" \? desafio : null, \{ secreto: antibot\.secreto, ip \}\)/.test(acciones),
    "con claves: el servidor verifica el token del formulario");
  assert(/antibot\.modo === "turnstile" \? antibot\.siteKey : null/.test(pagina) && /fd\.set\("cf-turnstile-response", tokenDesafio \?\? ""\)/.test(formulario) && /TurnstileWidget/.test(formulario),
    "la página pasa solo la clave pública; el formulario muestra el widget cuando hay claves");
  assert(!/secreto|TURNSTILE_SECRET_KEY/.test(pagina) && !/TURNSTILE_SECRET_KEY/.test(formulario), "la clave secreta nunca llega al navegador");
  const omitido = configuracionAntibot({ NEXT_PUBLIC_ADMIN_APP_URL: "https://gateflow-admin-staging.netlify.app" }, undefined);
  const clientes = configuracionAntibot({ NEXT_PUBLIC_ADMIN_APP_URL: "https://gateflow.mx" }, undefined);
  assert(omitido.modo === "omitido" && clientes.modo === "deshabilitado", "staging sin claves → omitido; entorno de clientes sin claves → cerrado");
  assert(/residente-que-sigue/.test(formulario) && formulario.includes("Cuando la administración apruebe tus datos, la guardia podrá avisarte por WhatsApp cuando llegue un paquete. No necesitas crear una cuenta."),
    "después del envío: el texto de qué sigue");
}

function compartir() {
  console.log("\nAdmin: copiar y compartir el enlace");
  const token = "0123456789abcdef".repeat(4);
  const url = urlEnlaceResidentes("https://gateflow-admin-staging.netlify.app/", token);
  assert(url === `https://gateflow-admin-staging.netlify.app/alta-residente#${token}`, "el enlace lleva el token después del # (no viaja al servidor)");
  const wa = new URL(urlCompartirEnlaceWhatsApp(url));
  assert(wa.origin === "https://wa.me" && wa.pathname === "/" && (wa.searchParams.get("text") ?? "").endsWith(url),
    "Compartir por WhatsApp: sin número (la persona elige el grupo) y con el enlace completo");
  const componente = readFileSync(join(__dirname, "..", "..", "app/(app)/residentes/enlace-residentes.tsx"), "utf8");
  const cuerpo = componente.slice(componente.indexOf("async function compartir()"), componente.indexOf("async function ejecutar("));
  assert(/onClick=\{copiar\}/.test(componente) && /onClick=\{compartir\}/.test(componente) && !/compartir\(\)/.test(componente.replace("async function compartir()", ""))
      && (componente.match(/navigator\.share\(/g) ?? []).length === 1 && (componente.match(/window\.open\(/g) ?? []).length === 1
      && cuerpo.includes("navigator.share(") && cuerpo.includes("window.open("),
    "copiar y compartir solo se ejecutan al tocar el botón (nada se envía solo)");
  assert(/data-testid="enlace-residentes-compartir"/.test(componente) && /Copiar enlace/.test(componente), "botones visibles: Copiar enlace y Compartir");
}

configuracion();
compartir();
servidor().then(() => {
  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
});

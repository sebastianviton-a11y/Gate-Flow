/**
 * Script de eliminación asistida (scripts/eliminacion/eliminar-residencial.mjs)
 * con una API de Supabase FALSA: qué llama, en qué orden, qué informa y
 * que nunca dice «COMPLETADA» si algo quedó pendiente.
 *   node tests/eliminacion/script.test.mjs
 */
import { SALIDA, leerConfiguracion, principal } from "../../scripts/eliminacion/eliminar-residencial.mjs";

let pasadas = 0;
let fallidas = 0;
function ok(condicion, mensaje, detalle = "") {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const CLAVE = "clave-service-role-de-prueba-NO-IMPRIMIR";
const ENV = { GF_ELIMINACION_SUPABASE_URL: "https://zzprueba.supabase.co", GF_ELIMINACION_SERVICE_ROLE_KEY: CLAVE };
const T = "11111111-2222-4333-8444-555555555555";
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";

/** API falsa: `rpc` decide la respuesta de cada función; Storage y Auth configurables. */
function falsa({ rpc = {}, storage = () => [200, []], auth = () => [200, {}] } = {}) {
  const llamadas = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const cuerpo = init.body ? JSON.parse(init.body) : null;
    llamadas.push({ metodo: init.method, ruta: u.pathname, cuerpo, cabeceras: init.headers });
    let estado = 404;
    let datos = { message: "no existe" };
    const m = /^\/rest\/v1\/rpc\/(.+)$/.exec(u.pathname);
    if (m && rpc[m[1]]) [estado, datos] = rpc[m[1]](cuerpo, llamadas);
    else if (u.pathname.startsWith("/storage/v1/object/")) [estado, datos] = storage(decodeURIComponent(u.pathname.split("/").pop()), cuerpo);
    else if (u.pathname.startsWith("/auth/v1/admin/users/")) [estado, datos] = auth(u.pathname.split("/").pop());
    return new Response(JSON.stringify(datos), { status: estado, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, llamadas };
}

function consola(lineas = []) {
  const salida = [];
  return {
    salida,
    io: {
      escribir: (t) => salida.push(String(t)),
      error: (t) => salida.push(String(t)),
      leerLinea: async () => lineas.shift(),
    },
  };
}

const SIM_ELEGIBLE = {
  eliminacion_id: ID, elegible: true, motivo: null, codigo: "A1B2C3D4E5", expira_en: "2026-10-16T12:30:00Z",
  residencial: { id: T, nombre: "ZZ Residencial" }, pais: "MX", estado_servicio: "activo",
  suscripcion: { estado: "expired", fin_servicio: "2026-09-01T00:00:00Z" },
  datos: { tenants: 1, paquetes: 3 }, archivos: { evidencia: 2 }, cuentas: { exclusivas: 2, compartidas: 1 },
  se_conservan: { aceptaciones_legales: 1, billing_eventos: 0 }, empresa_compartida: false,
};

console.log("\nConfiguración");
ok(leerConfiguracion({}).error?.includes("faltan"), "sin variables → error");
ok(leerConfiguracion({ ...ENV, GF_ELIMINACION_SUPABASE_URL: "http://zz.supabase.co" }).error?.includes("https"), "http a un host remoto → rechazado");
ok(leerConfiguracion({ ...ENV, GF_ELIMINACION_SUPABASE_URL: "http://127.0.0.1:5000" }).error?.includes("https"), "localhost sin GF_ELIMINACION_LOCAL=1 → rechazado");
ok(leerConfiguracion({ ...ENV, GF_ELIMINACION_SUPABASE_URL: "http://127.0.0.1:5000", GF_ELIMINACION_LOCAL: "1" }).proyecto === "127.0.0.1:5000", "localhost con GF_ELIMINACION_LOCAL=1 (pruebas)");
ok(leerConfiguracion(ENV).proyecto === "zzprueba.supabase.co", "el proyecto se muestra por su host");

console.log("\nSimulación");
{
  const { fetchImpl, llamadas } = falsa({ rpc: { eliminacion_residencial_simular: () => [200, SIM_ELEGIBLE] } });
  const { io, salida } = consola();
  const codigo = await principal(["simular", "--residencial", T, "--operador", "ticket-42"], { env: ENV, fetchImpl, io });
  const texto = salida.join("\n");
  ok(codigo === SALIDA.ok, "elegible → código de salida 0");
  ok(llamadas.length === 1 && llamadas[0].cuerpo.p_tenant_id === T && llamadas[0].cuerpo.p_operador === "ticket-42", "solo llama a simular, con el residencial y el operador");
  ok(llamadas[0].cabeceras.apikey === CLAVE && llamadas[0].cabeceras.Authorization === `Bearer ${CLAVE}`, "usa la clave service_role en las cabeceras");
  ok(/SIMULACIÓN \(no se borró nada\) · proyecto zzprueba\.supabase\.co/.test(texto) && texto.includes("ZZ Residencial"), "muestra el proyecto y el nombre del residencial para verificarlos");
  ok(texto.includes("paquetes=3") && texto.includes("evidencia=2") && texto.includes("2 exclusivas") && texto.includes("aceptaciones_legales=1"), "muestra qué se borraría y qué se conserva");
  ok(texto.includes(`ejecutar --eliminacion ${ID} --codigo A1B2C3D4E5`), "indica el comando para ejecutar con el código");
  ok(!texto.includes(CLAVE), "nunca imprime la clave");
}
{
  const { fetchImpl } = falsa({ rpc: { eliminacion_residencial_simular: () => [200, { ...SIM_ELEGIBLE, elegible: false, motivo: "suscripcion_activa", codigo: null }] } });
  const { io, salida } = consola();
  const codigo = await principal(["simular", "--residencial", T, "--operador", "ticket-42"], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.rechazada && salida.join("\n").includes("NO ELEGIBLE: suscripcion_activa") && !salida.join("\n").includes("--codigo"), "no elegible → salida 2, sin código ni comando para ejecutar");
}
{
  const { fetchImpl, llamadas } = falsa();
  const { io } = consola();
  ok((await principal(["simular", "--residencial", "no-uuid", "--operador", "ticket-42"], { env: ENV, fetchImpl, io })) === SALIDA.uso && llamadas.length === 0, "residencial que no es uuid → uso, sin llamadas");
  ok((await principal(["simular", "--residencial", T, "--operador", "ana@empresa.com"], { env: ENV, fetchImpl, io })) === SALIDA.uso && llamadas.length === 0, "operador con @ → uso, sin llamadas");
  ok((await principal(["borrar-todo"], { env: ENV, fetchImpl, io })) === SALIDA.uso, "comando desconocido → uso");
}

console.log("\nConfirmación");
{
  const { fetchImpl, llamadas } = falsa();
  const { io, salida } = consola([""]);
  const codigo = await principal(["ejecutar", "--eliminacion", ID, "--codigo", "A1B2C3D4E5"], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.cancelada && llamadas.length === 0 && salida.join("\n").includes("no se borró nada"), "nombre vacío → cancelado sin llamar a la base");
}
{
  const { fetchImpl, llamadas } = falsa({ rpc: { eliminacion_residencial_ejecutar: () => [400, { code: "22023", message: "eliminacion_residencial: nombre_no_coincide" }] } });
  const { io, salida } = consola(["Otro Residencial"]);
  const codigo = await principal(["ejecutar", "--eliminacion", ID, "--codigo", "A1B2C3D4E5"], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.rechazada && salida.join("\n").includes("No se eliminó nada: HTTP 400 22023 eliminacion_residencial: nombre_no_coincide"), "la base rechaza el nombre → «No se eliminó nada»");
  ok(llamadas.length === 1 && llamadas[0].cuerpo.p_nombre_confirmado === "Otro Residencial" && llamadas[0].cuerpo.p_codigo === "A1B2C3D4E5", "envía el nombre escrito y el código");
}
{
  const { fetchImpl } = falsa();
  const { io } = consola(["ZZ Residencial"]);
  ok((await principal(["ejecutar", "--eliminacion", ID, "--codigo", "123"], { env: ENV, fetchImpl, io })) === SALIDA.uso, "código con formato inválido → uso");
}

console.log("\nCancelación y fallo");
{
  const { fetchImpl, llamadas } = falsa({ rpc: { eliminacion_residencial_ejecutar: () => [200, { ok: false, estado: "cancelada", motivo: "suscripcion_activa" }] } });
  const { io, salida } = consola(["ZZ Residencial"]);
  const codigo = await principal(["ejecutar", "--eliminacion", ID, "--codigo", "A1B2C3D4E5"], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.cancelada && salida.join("\n").includes("CANCELADA (suscripcion_activa): no se borró nada") && llamadas.length === 1, "el cliente contrató → CANCELADA, sin tocar Storage ni Auth");
}
{
  const { fetchImpl, llamadas } = falsa({ rpc: { eliminacion_residencial_ejecutar: () => [200, { ok: false, estado: "fallida", sqlstate: "P0001" }] } });
  const { io, salida } = consola(["ZZ Residencial"]);
  const codigo = await principal(["ejecutar", "--eliminacion", ID, "--codigo", "A1B2C3D4E5"], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.fallida && salida.join("\n").includes("FALLÓ (código P0001)") && !salida.join("\n").includes("COMPLETADA") && llamadas.length === 1, "error en la base → FALLÓ, sin Storage ni Auth ni «COMPLETADA»");
}

console.log("\nEjecución completa");
{
  const nombres = Array.from({ length: 250 }, (_, i) => `${T}/p/${String(i).padStart(3, "0")}.jpg`);
  let completar = 0;
  let borradas = 0;
  const { fetchImpl, llamadas } = falsa({
    rpc: {
      eliminacion_residencial_ejecutar: () => [200, { ok: true, estado: "en_curso", archivos: { evidencia: 250, logos: 1 }, cuentas_pendientes: 2 }],
      eliminacion_residencial_completar: () => {
        completar++;
        if (completar === 1) return [200, { ok: false, estado: "en_curso", archivos_pendientes: 251, archivos: { evidencia: nombres, logos: [`${T}/logo.png`] }, cuentas_pendientes: [U1, U2] }];
        return [200, { ok: true, estado: "completada", completada_en: "2026-10-16T12:00:00Z" }];
      },
    },
    storage: (_bucket, cuerpo) => [200, cuerpo.prefixes.map((name) => ({ name }))],
    auth: (id) => (id === U2 ? [404, { msg: "User not found" }] : (borradas++, [200, {}])),
  });
  const { io, salida } = consola(["ZZ Residencial"]);
  const codigo = await principal(["ejecutar", "--eliminacion", ID, "--codigo", "A1B2C3D4E5"], { env: ENV, fetchImpl, io });
  const texto = salida.join("\n");
  const storage = llamadas.filter((l) => l.ruta.startsWith("/storage/"));
  const auth = llamadas.filter((l) => l.ruta.startsWith("/auth/"));
  ok(codigo === SALIDA.ok && texto.includes("COMPLETADA"), "todo borrado y confirmado por la base → COMPLETADA, salida 0");
  ok(storage.length === 4 && storage.filter((l) => l.ruta === "/storage/v1/object/evidencia").map((l) => l.cuerpo.prefixes.length).join(",") === "100,100,50" && storage.every((l) => l.metodo === "DELETE"), "Storage: borra por la API en tandas de 100, por bucket");
  ok(auth.map((l) => l.ruta).join(",") === `/auth/v1/admin/users/${U1},/auth/v1/admin/users/${U2}` && auth.every((l) => l.metodo === "DELETE") && borradas === 1, "Auth: borra cada cuenta pendiente por la API (404 = ya no existe)");
  const orden = llamadas.map((l) => (l.ruta.startsWith("/rest/") ? l.ruta.split("/").pop() : l.ruta.split("/")[1]));
  ok(orden[0] === "eliminacion_residencial_ejecutar" && orden.at(-1) === "eliminacion_residencial_completar" && orden.indexOf("storage") < orden.indexOf("auth"), "orden: base → Storage → Auth → verificación final de la base", orden.join(" "));
  ok(!texto.includes(CLAVE) && !texto.includes("@"), "la salida no trae la clave ni correos");
}

console.log("\nNunca informa falsamente que terminó");
{
  const { fetchImpl } = falsa({
    rpc: {
      eliminacion_residencial_ejecutar: () => [200, { ok: true, estado: "en_curso", archivos: { evidencia: 1 }, cuentas_pendientes: 0 }],
      eliminacion_residencial_completar: () => [200, { ok: false, estado: "en_curso", archivos_pendientes: 1, archivos: { evidencia: [`${T}/p/a.jpg`] }, cuentas_pendientes: [] }],
    },
    storage: () => [500, { error: "internal", message: "storage caído" }],
  });
  const { io, salida } = consola(["ZZ Residencial"]);
  const codigo = await principal(["ejecutar", "--eliminacion", ID, "--codigo", "A1B2C3D4E5"], { env: ENV, fetchImpl, io });
  const texto = salida.join("\n");
  ok(codigo === SALIDA.incompleta && texto.includes("La eliminación NO terminó") && texto.includes(`reanudar --eliminacion ${ID}`) && !texto.includes("COMPLETADA"), "Storage falla → NO terminó, indica cómo reanudar, sin «COMPLETADA»");
}
{
  const { fetchImpl, llamadas } = falsa({
    rpc: { eliminacion_residencial_completar: () => [200, { ok: false, estado: "en_curso", archivos_pendientes: 1, archivos: { evidencia: [`${T}/p/a.jpg`] }, cuentas_pendientes: [U1] }] },
    storage: () => [500, { message: "storage caído" }],
  });
  const { io } = consola();
  const codigo = await principal(["reanudar", "--eliminacion", ID], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.incompleta && !llamadas.some((l) => l.ruta.startsWith("/auth/")), "si Storage falla, no se tocan las cuentas de Auth en esa ronda");
}
{
  const { fetchImpl } = falsa({
    rpc: { eliminacion_residencial_completar: () => [200, { ok: false, estado: "en_curso", archivos_pendientes: 0, archivos: {}, cuentas_pendientes: [U1] }] },
    auth: () => [500, { msg: "Database error deleting user" }],
  });
  const { io, salida } = consola();
  const codigo = await principal(["reanudar", "--eliminacion", ID], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.incompleta && salida.join("\n").includes(`Auth ${U1}: HTTP 500`) && !salida.join("\n").includes("COMPLETADA"), "Auth falla → NO terminó (con el id de la cuenta, sin correo)");
}
{
  // Storage dice que borró pero la base sigue viendo el archivo: se detiene, no da vueltas.
  const { fetchImpl, llamadas } = falsa({
    rpc: { eliminacion_residencial_completar: () => [200, { ok: false, estado: "en_curso", archivos_pendientes: 1, archivos: { evidencia: [`${T}/p/a.jpg`] }, cuentas_pendientes: [] }] },
  });
  const { io, salida } = consola();
  const codigo = await principal(["reanudar", "--eliminacion", ID], { env: ENV, fetchImpl, io });
  ok(codigo === SALIDA.incompleta && salida.join("\n").includes("no hubo avance") && llamadas.filter((l) => l.ruta.endsWith("_completar")).length === 2, "sin avance entre rondas → se detiene como NO terminada");
}
{
  const { fetchImpl } = falsa({ rpc: { eliminacion_residencial_completar: () => [503, { message: "sin servicio" }] } });
  const { io, salida } = consola();
  ok((await principal(["reanudar", "--eliminacion", ID], { env: ENV, fetchImpl, io })) === SALIDA.incompleta && salida.join("\n").includes("NO terminó"), "la verificación final falla → NO terminó");
}
{
  const { fetchImpl } = falsa({ rpc: { eliminacion_residencial_completar: () => [200, { ok: false, estado: "fallida", motivo: null }] } });
  const { io, salida } = consola();
  ok((await principal(["reanudar", "--eliminacion", ID], { env: ENV, fetchImpl, io })) === SALIDA.fallida && !salida.join("\n").includes("COMPLETADA"), "reanudar una fallida → salida 4, nada que continuar");
}
{
  const fetchImpl = async () => {
    throw Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" });
  };
  const { io, salida } = consola();
  ok((await principal(["reanudar", "--eliminacion", ID], { env: ENV, fetchImpl, io })) === SALIDA.incompleta && salida.join("\n").includes("sin conexión (ECONNREFUSED)") && !salida.join("\n").includes(CLAVE), "sin conexión → NO terminó, sin imprimir la clave");
}

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);

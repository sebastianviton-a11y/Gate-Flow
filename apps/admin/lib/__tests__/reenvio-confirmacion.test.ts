/**
 * Reenvío del correo de confirmación desde /login (sin red externa ni
 * base): lógica con dobles + el envío real (enviarCorreoConfirmacion →
 * supabase-js) contra un Auth falso local que registra cada solicitud.
 *   A. pendiente de confirmación → puede reenviar
 *   B. sin "pendiente de confirmación" → sin botón (y sin enumeración)
 *   C/D/E. no crea usuario, residencial ni suscripción
 *   F. redirect /confirmar-cuenta de este Admin, fijado por el servidor
 *   G. límites (app y Supabase)   H. error de Supabase → mensaje neutro
 *   I. logs sin correo ni tokens   J. doble clic → una sola solicitud
 *   K. móvil: clases del botón (el render real está en tests/recorrido)
 *   npx tsx apps/admin/lib/__tests__/reenvio-confirmacion.test.ts
 */
import "../../../../tests/billing/e2e/server-only-shim.cjs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { urlPublicaAdmin } from "../entorno";
import { MENSAJES_REENVIO, crearControlReenvio, ofreceReenvioConfirmacion, resultadoReenvio, type ResultadoReenvio } from "../registro/reenvio";
import { LimitadorReenvio, ejecutarReenvio, type DepsReenvio } from "../registro/reenvio-servidor";

let pasadas = 0;
let fallidas = 0;
function assert(condicion: boolean, mensaje: string) {
  if (condicion) pasadas++;
  else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}
const RAIZ = join(__dirname, "../../../..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

const URL_ADMIN = "https://admin.staging.gateflow.invalid";
const EMAIL = "Ana.Perez+prueba@Residencial.Example";
const EMAIL_NORMALIZADO = "ana.perez+prueba@residencial.example";

interface DobleDeps extends DepsReenvio {
  envios: Array<{ email: string; redirectTo: string }>;
  logs: string[];
}
function deps(opciones: { respuesta?: Awaited<ReturnType<DepsReenvio["enviar"]>> | Error; permitido?: boolean; urlAdmin?: string | null } = {}): DobleDeps {
  const envios: DobleDeps["envios"] = [];
  const logs: string[] = [];
  return {
    envios,
    logs,
    urlAdmin: opciones.urlAdmin === undefined ? URL_ADMIN : opciones.urlAdmin,
    async enviar(email, redirectTo) {
      envios.push({ email, redirectTo });
      const r = opciones.respuesta ?? { ok: true as const };
      if (r instanceof Error) throw r;
      return r;
    },
    permitido: () => opciones.permitido ?? true,
    log(evento, datos) {
      logs.push(`${evento} ${datos ? JSON.stringify(datos) : ""}`);
    },
  };
}

/** Auth de Supabase falso: registra cada solicitud y responde lo que diga `responder`. */
async function authFalso(responder: (req: { metodo: string; ruta: string; cuerpo: string }) => { estado: number; cuerpo: unknown }) {
  const solicitudes: Array<{ metodo: string; ruta: string; query: URLSearchParams; cuerpo: string; apikey: string | undefined; autorizacion: string | undefined }> = [];
  const leer = (req: IncomingMessage) =>
    new Promise<string>((ok) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => ok(b));
    });
  const servidor = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const cuerpo = await leer(req);
    solicitudes.push({
      metodo: req.method ?? "",
      ruta: u.pathname,
      query: u.searchParams,
      cuerpo,
      apikey: req.headers.apikey as string | undefined,
      autorizacion: req.headers.authorization,
    });
    const r = responder({ metodo: req.method ?? "", ruta: u.pathname, cuerpo });
    res.writeHead(r.estado, { "content-type": "application/json" });
    res.end(JSON.stringify(r.cuerpo));
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return { url, solicitudes, cerrar: () => new Promise<void>((ok) => servidor.close(() => ok())) };
}

async function principal() {
  const { enviarCorreoConfirmacion } = await import("../registro/confirmacion");
  const ANON = "anon-key-de-prueba-no-es-secreta";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log("\nA. Cuenta pendiente de confirmación: puede reenviar");
  {
    const d = deps();
    const r = await ejecutarReenvio(d, EMAIL);
    assert(r.estado === "enviado" && r.mensaje === "Te enviamos un nuevo correo de confirmación.", `enviado con el mensaje pedido (${r.mensaje})`);
    assert(d.envios.length === 1 && d.envios[0]?.email === EMAIL_NORMALIZADO, "una sola solicitud, con el correo normalizado");
  }
  {
    const auth = await authFalso(() => ({ estado: 200, cuerpo: {} }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = auth.url;
    const consola: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    for (const k of ["log", "warn", "error"] as const) console[k] = (...a: unknown[]) => consola.push(a.map(String).join(" "));
    const logs: string[] = [];
    let r: ResultadoReenvio;
    try {
      r = await ejecutarReenvio(
        {
          urlAdmin: URL_ADMIN,
          enviar: enviarCorreoConfirmacion,
          permitido: () => true,
          log: (e, datos) => logs.push(`${e} ${datos ? JSON.stringify(datos) : ""}`),
        },
        EMAIL,
      );
    } finally {
      Object.assign(console, original);
    }
    await auth.cerrar();
    const s = auth.solicitudes[0];
    const cuerpo = JSON.parse(s?.cuerpo || "{}") as { email?: string; type?: string };
    assert(r.estado === "enviado", "con supabase-js real: enviado");
    assert(auth.solicitudes.length === 1 && s?.metodo === "POST" && s.ruta === "/auth/v1/resend", `una sola llamada: POST /auth/v1/resend (${auth.solicitudes.map((x) => `${x.metodo} ${x.ruta}`).join(", ")})`);
    assert(cuerpo.type === "signup" && cuerpo.email === EMAIL_NORMALIZADO, "resend type signup del correo normalizado");

    console.log("C/D/E. No crea usuario, residencial ni suscripción");
    assert(!auth.solicitudes.some((x) => /\/admin\/|\/signup|\/rest\/v1|\/invite/.test(x.ruta)), "ninguna llamada a admin/users, signup, invite ni a la base (rpc, tenants, suscripciones)");
    assert(s?.apikey === ANON && (s?.autorizacion ?? "") === `Bearer ${ANON}`, "usa la clave anónima, no la de servicio");

    console.log("F. Redirect");
    assert(s?.query.get("redirect_to") === `${URL_ADMIN}/confirmar-cuenta`, `redirect_to = ${URL_ADMIN}/confirmar-cuenta (${s?.query.get("redirect_to")})`);

    console.log("I. Logs sin correo ni tokens");
    const todo = [...logs, ...consola].join("\n");
    assert(!todo.includes("@") && !todo.toLowerCase().includes("ana.perez") && !todo.includes(ANON) && !/token|eyJ[A-Za-z0-9_-]{8,}/i.test(todo), `logs sin correo, clave ni tokens (${todo})`);
    assert(logs.length === 1 && logs[0]?.startsWith("reenvio_confirmacion.solicitado") === true, "un evento, sin datos personales");
    assert(!JSON.stringify(r).includes("token") && Object.keys(r).sort().join(",") === "estado,mensaje", "la respuesta al navegador solo trae estado y mensaje");
  }

  console.log("B. Sin «pendiente de confirmación» no hay botón; sin enumeración");
  assert(ofreceReenvioConfirmacion("email_not_confirmed"), "email_not_confirmed → se ofrece");
  for (const c of ["invalid_credentials", "over_request_rate_limit", "user_banned", "", undefined, null]) {
    assert(!ofreceReenvioConfirmacion(c), `${JSON.stringify(c)} → no se ofrece`);
  }
  const login = fuente("apps/admin/components/shared/login-form.tsx");
  assert((login.match(/setCorreoPendiente\(/g) ?? []).length === 2 && /if \(ofreceReenvioConfirmacion\(codigo\)\) setCorreoPendiente\(emailNormalizado\)/.test(login), "el botón solo se habilita desde el error de login pendiente de confirmación (y se limpia en cada intento)");
  assert(/\{correoPendiente && \(/.test(login), "sin correo pendiente no se muestra el botón (una cuenta confirmada inicia sesión y nunca lo ve)");
  {
    // Supabase responde 200 {} a un correo que no existe y a uno ya
    // confirmado (no manda nada): la acción contesta lo mismo que a uno pendiente.
    const auth = await authFalso(() => ({ estado: 200, cuerpo: {} }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = auth.url;
    const rs: ResultadoReenvio[] = [];
    for (const correo of ["no-existe@ejemplo.invalid", "confirmada@ejemplo.invalid", "pendiente@ejemplo.invalid"]) {
      rs.push(await ejecutarReenvio({ urlAdmin: URL_ADMIN, enviar: enviarCorreoConfirmacion, permitido: () => true, log: () => {} }, correo));
    }
    await auth.cerrar();
    assert(rs.every((x) => JSON.stringify(x) === JSON.stringify(rs[0])), "misma respuesta exista o no la cuenta, confirmada o no");
  }

  console.log("F. El navegador no elige el destino");
  {
    const d = deps();
    const r = await ejecutarReenvio(d, { email: EMAIL, redirectTo: "https://atacante.invalid" });
    assert(r.estado === "error" && d.envios.length === 0, "solo se acepta un correo (string): otro payload no envía nada");
    const d2 = deps();
    await ejecutarReenvio(d2, EMAIL);
    assert(d2.envios[0]?.redirectTo === `${URL_ADMIN}/confirmar-cuenta`, "destino = URL pública del Admin + /confirmar-cuenta");
    const d3 = deps({ urlAdmin: null });
    const r3 = await ejecutarReenvio(d3, EMAIL);
    assert(r3.estado === "error" && d3.envios.length === 0, "sin URL pública del Admin no se envía (Supabase usaría la Site URL de otro entorno)");
    assert(urlPublicaAdmin({ NEXT_PUBLIC_ADMIN_APP_URL: "javascript:alert(1)" }, undefined) === null && urlPublicaAdmin({ NEXT_PUBLIC_ADMIN_APP_URL: "https://admin.x/ruta" }, undefined) === null, "la URL del Admin se valida (solo http(s)://host)");
    for (const malo of ["", "   ", "sin-arroba", "a@b", "x".repeat(250) + "@ejemplo.com"]) {
      const dm = deps();
      const rm = await ejecutarReenvio(dm, malo);
      assert(rm.estado === "error" && dm.envios.length === 0, `correo inválido ${JSON.stringify(malo.slice(0, 20))} → no se envía`);
    }
  }

  console.log("G. Límites");
  {
    const d = deps({ permitido: false });
    const r = await ejecutarReenvio(d, EMAIL);
    assert(r.estado === "espera" && r.mensaje === "Espera un momento antes de volver a intentarlo." && d.envios.length === 0, "límite de la app → «Espera un momento…», sin llamar a Supabase");
    let t = 1_000_000;
    const lim = new LimitadorReenvio(() => t);
    assert(lim.permitir(EMAIL_NORMALIZADO, "203.0.113.7"), "primer reenvío permitido");
    assert(!lim.permitir(EMAIL_NORMALIZADO, "198.51.100.1"), "mismo correo antes de 60 s → no (aunque cambie la IP)");
    t += 59_999;
    assert(!lim.permitir(EMAIL_NORMALIZADO, "203.0.113.7"), "a los 59,999 s todavía no");
    t += 1;
    assert(lim.permitir(EMAIL_NORMALIZADO, "203.0.113.7"), "a los 60 s, sí");
    assert(lim.permitir("otra@ejemplo.invalid", "203.0.113.7"), "otro correo no espera al primero");
    const limIp = new LimitadorReenvio(() => t);
    let permitidos = 0;
    for (let i = 0; i < 15; i++) if (limIp.permitir(`c${i}@ejemplo.invalid`, "192.0.2.9")) permitidos++;
    assert(permitidos === 10, `como mucho 10 por IP en 10 min (${permitidos})`);
    assert(limIp.permitir("otro@ejemplo.invalid", "192.0.2.10"), "otra IP no se ve afectada");
    const sinIp = new LimitadorReenvio(() => t);
    assert(sinIp.permitir("a@ejemplo.invalid", null) && !sinIp.permitir("a@ejemplo.invalid", null), "sin IP aplica igual el límite por correo");
    const fuenteLim = fuente("apps/admin/lib/registro/reenvio-servidor.ts");
    assert(/createHash\("sha256"\)/.test(fuenteLim) && /huella\(`correo:\$\{email\}`\)/.test(fuenteLim), "el límite guarda huellas, no correos ni IPs");

    for (const [estado, codigo] of [
      [429, "over_email_send_rate_limit"],
      [429, "over_request_rate_limit"],
    ] as const) {
      const auth = await authFalso(() => ({ estado, cuerpo: { code: estado, error_code: codigo, msg: "For security purposes, you can only request this after 42 seconds." } }));
      process.env.NEXT_PUBLIC_SUPABASE_URL = auth.url;
      const logs: string[] = [];
      const r2 = await ejecutarReenvio({ urlAdmin: URL_ADMIN, enviar: enviarCorreoConfirmacion, permitido: () => true, log: (e, x) => logs.push(`${e} ${JSON.stringify(x)}`) }, EMAIL);
      await auth.cerrar();
      assert(r2.estado === "espera" && r2.mensaje === MENSAJES_REENVIO.espera, `Supabase ${estado} ${codigo} → «Espera un momento…»`);
      assert(!r2.mensaje.includes("42") && !r2.mensaje.includes("security"), "sin detalles internos en el mensaje");
      assert(logs.length === 1 && logs[0]!.includes(codigo) && !logs[0]!.includes("@"), "el log guarda el código, no el correo");
    }
  }

  console.log("H. Error de Supabase → mensaje neutro");
  {
    const auth = await authFalso(() => ({ estado: 500, cuerpo: { code: 500, error_code: "unexpected_failure", msg: "Error sending confirmation email: smtp 554 relay denied for ana.perez@residencial.example" } }));
    process.env.NEXT_PUBLIC_SUPABASE_URL = auth.url;
    const logs: string[] = [];
    const r = await ejecutarReenvio({ urlAdmin: URL_ADMIN, enviar: enviarCorreoConfirmacion, permitido: () => true, log: (e, x) => logs.push(`${e} ${JSON.stringify(x)}`) }, EMAIL);
    await auth.cerrar();
    assert(r.estado === "error" && r.mensaje === "No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.", "500 → error neutro");
    assert(!/smtp|554|relay|unexpected|ana\.perez/i.test(r.mensaje), "el mensaje no revela detalles internos");
    assert(logs.length === 1 && !logs[0]!.includes("@") && !logs[0]!.includes("relay"), `el log no copia el mensaje de Supabase (que puede traer el correo): ${logs[0]}`);
    const d = deps({ respuesta: new Error("ECONNREFUSED") });
    const r2 = await ejecutarReenvio(d, EMAIL);
    assert(r2.estado === "error" && !r2.mensaje.includes("ECONN"), "sin conexión → error neutro");
  }

  console.log("J. Doble clic → una sola solicitud");
  {
    let llamadas = 0;
    let soltar: (r: ResultadoReenvio) => void = () => {};
    let t = 0;
    const control = crearControlReenvio(
      () => {
        llamadas++;
        return new Promise<ResultadoReenvio>((ok) => (soltar = ok));
      },
      () => t,
    );
    const p1 = control.intentar(EMAIL);
    const p2 = control.intentar(EMAIL);
    assert(!control.puedeIntentar(), "con una solicitud en curso el botón no puede volver a enviar");
    soltar(resultadoReenvio("enviado"));
    const [r1, r2] = await Promise.all([p1, p2]);
    assert(llamadas === 1 && r1?.estado === "enviado" && r2 === null, `dos clics seguidos → una llamada (${llamadas})`);
    assert((await control.intentar(EMAIL)) === null && llamadas === 1, "tras un envío, en pausa: no llama");
    t += 60_000;
    assert(control.puedeIntentar(), "pasados 60 s se puede pedir otro");
    let llamadasError = 0;
    const conError = crearControlReenvio(async () => {
      llamadasError++;
      return resultadoReenvio("error");
    });
    await conError.intentar(EMAIL);
    assert(conError.puedeIntentar(), "tras un error se puede reintentar");
    const conExcepcion = crearControlReenvio(async () => {
      throw new Error("red");
    });
    const rx = await conExcepcion.intentar(EMAIL);
    assert(rx?.estado === "error" && conExcepcion.puedeIntentar(), "una excepción de red → error neutro y se puede reintentar");
    assert(/controlReenvio\.current\.puedeIntentar\(\)/.test(login) && /disabled=\{reenviando \|\| reenvioEnPausa\}/.test(login), "el botón usa el control y se deshabilita mientras envía y durante la pausa");
  }

  console.log("K. Móvil y estados del botón");
  assert(/w-full whitespace-normal/.test(login) && /h-auto min-h-10/.test(login), "el botón ocupa el ancho y el texto puede partirse en pantallas angostas");
  assert(/Enviando\.\.\./.test(login) && /aria-busy=\{reenviando\}/.test(login) && /role="status"/.test(login) && /aria-live="polite"/.test(login), "estados: cargando (aria-busy), resultado anunciado (role=status)");

  console.log("Seguridad del código");
  const archivos = ["apps/admin/app/login/actions.ts", "apps/admin/lib/registro/reenvio-servidor.ts", "apps/admin/lib/registro/reenvio.ts", "apps/admin/lib/registro/confirmacion.ts"];
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of archivos) {
    const s = sinComentarios(fuente(f));
    assert(!/createServiceRoleClient|SERVICE_ROLE|service_role|admin\.createUser|generateLink|crear_cuenta_prueba|\.rpc\(|\.from\(/.test(s), `${f}: sin clave de servicio, sin crear usuarios ni tocar la base`);
  }
  const accion = fuente("apps/admin/app/login/actions.ts");
  assert(/export async function reenviarCorreoConfirmacion\(email: string\)/.test(accion) && (accion.match(/export /g) ?? []).length === 1, "la acción expone solo reenviarCorreoConfirmacion(email)");
  assert(/enviar: enviarCorreoConfirmacion/.test(accion) && /urlAdmin: urlPublicaAdmin\(\)/.test(accion), "reutiliza enviarCorreoConfirmacion y la URL pública del Admin (sin segunda implementación)");
  assert(!/console\.\w+\([^)]*email/.test(accion + fuente("apps/admin/lib/registro/reenvio-servidor.ts")), "ningún console.* con el correo");

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});

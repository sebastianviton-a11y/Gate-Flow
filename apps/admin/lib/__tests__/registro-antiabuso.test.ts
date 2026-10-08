/**
 * Hashes, token de tiempo, IP y desafío anti-bot de /registro.
 *   npx tsx apps/admin/lib/__tests__/registro-antiabuso.test.ts
 */
import { configuracionAntibot, esClaveDePruebaTurnstile, motivoRegistroCerrado, verificarDesafio } from "../registro/antibot";
import { esEntornoDePruebas } from "../entorno";
import { emitirTokenTiempo, hashEmail, hashIp, ipDesdeHeaders, TIEMPO_MAXIMO_MS, TIEMPO_MINIMO_MS, verificarTokenTiempo } from "../registro/hash";

let pasadas = 0;
let fallidas = 0;

function assert(condicion: boolean, mensaje: string) {
  if (condicion) {
    pasadas++;
  } else {
    fallidas++;
    console.error(`✗ FALLÓ: ${mensaje}`);
  }
}

function seccion(nombre: string, fn: () => void | Promise<void>) {
  console.log(`\n${nombre}`);
  return fn();
}

const PEPPER = "pepper-de-prueba-con-mas-de-16";

async function main() {
  seccion("Hashes: determinísticos, hex de 64, sin el valor en claro", () => {
    const h = hashEmail(PEPPER, "ana@x.com");
    assert(/^[0-9a-f]{64}$/.test(h), "email_hash es hex de 64");
    assert(h === hashEmail(PEPPER, "ana@x.com"), "mismo correo → mismo hash");
    assert(h !== hashEmail("otro-pepper-distinto-123", "ana@x.com"), "otro pepper → otro hash");
    assert(h !== hashEmail(PEPPER, "ANA@x.com"), "el hash no normaliza: el correo llega ya normalizado");
    assert(!h.includes("ana"), "el hash no contiene el correo");
    const ip = hashIp(PEPPER, "203.0.113.9");
    assert(!!ip && /^[0-9a-f]{64}$/.test(ip) && ip !== h, "ip_hash es hex de 64 y usa un dominio distinto al del correo");
    assert(hashIp(PEPPER, null) === null, "sin IP → null");
  });

  seccion("Token de tiempo: mínimo 4 s, máximo 1 h, firma íntegra", () => {
    const t0 = 1_800_000_000_000;
    const token = emitirTokenTiempo(PEPPER, t0);
    assert(/^\d+\.[0-9a-f]{64}$/.test(token), "formato <ms>.<firma>");
    const rapido = verificarTokenTiempo(PEPPER, token, t0 + TIEMPO_MINIMO_MS - 1);
    assert(!rapido.ok && rapido.motivo === "rapido", "menos de 4 s → rapido");
    const ok = verificarTokenTiempo(PEPPER, token, t0 + TIEMPO_MINIMO_MS);
    assert(ok.ok && ok.edadMs === TIEMPO_MINIMO_MS, "a los 4 s → ok");
    const limite = verificarTokenTiempo(PEPPER, token, t0 + TIEMPO_MAXIMO_MS);
    assert(limite.ok, "a la hora exacta → ok");
    const expirado = verificarTokenTiempo(PEPPER, token, t0 + TIEMPO_MAXIMO_MS + 1);
    assert(!expirado.ok && expirado.motivo === "expirado", "más de 1 h → expirado");
    const [ts, firma] = token.split(".");
    const manipulado = verificarTokenTiempo(PEPPER, `${Number(ts) - 100_000}.${firma}`, t0 + 10_000);
    assert(!manipulado.ok && manipulado.motivo === "invalido", "cambiar el timestamp invalida la firma");
    const otroPepper = verificarTokenTiempo("otro-pepper-distinto-123", token, t0 + 10_000);
    assert(!otroPepper.ok && otroPepper.motivo === "invalido", "firmado con otro pepper → invalido");
    for (const basura of ["", "abc", "123.", ".abc", "123.zz", "1.2.3"]) {
      const r = verificarTokenTiempo(PEPPER, basura, t0);
      assert(!r.ok && r.motivo === "invalido", `token ${JSON.stringify(basura)} → invalido`);
    }
  });

  seccion("IP: Netlify primero, luego x-forwarded-for, si no null", () => {
    const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    assert(ipDesdeHeaders(h({ "x-nf-client-connection-ip": " 203.0.113.9 ", "x-forwarded-for": "10.0.0.1" })) === "203.0.113.9", "prefiere x-nf-client-connection-ip");
    assert(ipDesdeHeaders(h({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" })) === "198.51.100.7", "x-forwarded-for: la primera");
    assert(ipDesdeHeaders(h({})) === null, "sin cabeceras → null");
    assert((ipDesdeHeaders(h({ "x-forwarded-for": "x".repeat(200) })) ?? "").length === 64, "se recorta a 64");
  });

  await seccion("Anti-bot: sin clave se omite; con clave se exige y verifica", async () => {
    const sin = await verificarDesafio(null, {});
    assert(sin.ok && sin.proveedor === "ninguno", "sin TURNSTILE_SECRET_KEY → pasa (proveedor ninguno)");
    const sinToken = await verificarDesafio(null, { secreto: "clave" });
    assert(!sinToken.ok && sinToken.motivo === "sin_token", "con clave y sin token → rechazado");
    const fetchOk = (async () => new Response(JSON.stringify({ success: true }))) as unknown as typeof fetch;
    const okT = await verificarDesafio("token", { secreto: "clave", fetchFn: fetchOk });
    assert(okT.ok && okT.proveedor === "turnstile", "token válido → pasa");
    const fetchNo = (async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }))) as unknown as typeof fetch;
    const noT = await verificarDesafio("token", { secreto: "clave", fetchFn: fetchNo });
    assert(!noT.ok && noT.motivo === "invalid-input-response", "token rechazado → no pasa");
    const fetchCae = (async () => {
      throw new Error("red");
    }) as unknown as typeof fetch;
    const caido = await verificarDesafio("token", { secreto: "clave", fetchFn: fetchCae });
    assert(!caido.ok && caido.motivo === "verificador_no_disponible", "verificador caído → falla cerrado");
  });

  seccion("Turnstile por entorno: claves de prueba solo en pruebas; clientes, siempre con desafío real", () => {
    const SITE_PRUEBA = "1x00000000000000000000AA";
    const SECRETO_PRUEBA = "1x0000000000000000000000000000000AA";
    for (const k of [SITE_PRUEBA, "2x00000000000000000000AB", "1x00000000000000000000BB", "3x00000000000000000000FF", SECRETO_PRUEBA, "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
      assert(esClaveDePruebaTurnstile(k), `clave de prueba de Cloudflare reconocida: ${k.slice(0, 4)}…`);
    }
    assert(!esClaveDePruebaTurnstile("0x4AAAAAAAzZzZzZzZzZzZzZ") && !esClaveDePruebaTurnstile("0x4AAAAAAAzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZ"), "una clave real (0x4AAA…) no es de prueba");

    assert(esEntornoDePruebas("http://localhost:3963") && esEntornoDePruebas("https://gateflow-admin-staging.netlify.app") && esEntornoDePruebas("https://deploy-preview-2--gateflow-admin-staging.netlify.app") && esEntornoDePruebas("https://staging--gateflow-admin-staging.netlify.app"), "localhost, staging y previews son entornos de pruebas");
    assert(!esEntornoDePruebas("https://gateflow.mx") && !esEntornoDePruebas("https://app.gateflow.mx") && !esEntornoDePruebas(undefined) && !esEntornoDePruebas("") && !esEntornoDePruebas("no-es-url"), "gateflow.mx, sin URL o URL inválida → entorno de clientes");

    const PROD = { NEXT_PUBLIC_ADMIN_APP_URL: "https://gateflow.mx" };
    const STG = { NEXT_PUBLIC_ADMIN_APP_URL: "https://gateflow-admin-staging.netlify.app" };
    const REAL = { TURNSTILE_SITE_KEY: "0x4AAAAAAAsitekeyReal", TURNSTILE_SECRET_KEY: "0x4AAAAAAAsecretoReal" };
    const PRUEBA = { TURNSTILE_SITE_KEY: SITE_PRUEBA, TURNSTILE_SECRET_KEY: SECRETO_PRUEBA };

    const c1 = configuracionAntibot({ ...PROD });
    assert(c1.modo === "deshabilitado" && c1.motivo === "sin_claves", "clientes sin claves → registro DESHABILITADO (nunca abierto sin desafío)");
    const c2 = configuracionAntibot({ ...PROD, ...PRUEBA });
    assert(c2.modo === "deshabilitado" && c2.motivo === "claves_de_prueba_fuera_de_pruebas", "clientes con claves de prueba → registro DESHABILITADO");
    const c3 = configuracionAntibot({ ...PROD, TURNSTILE_SITE_KEY: REAL.TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY: SECRETO_PRUEBA });
    assert(c3.modo === "deshabilitado", "clientes con un secreto de prueba (aunque el sitekey sea real) → DESHABILITADO");
    const c4 = configuracionAntibot({ ...PROD, TURNSTILE_SITE_KEY: REAL.TURNSTILE_SITE_KEY });
    assert(c4.modo === "deshabilitado" && c4.motivo === "claves_incompletas", "una sola clave → DESHABILITADO");
    const c5 = configuracionAntibot({ ...PROD, ...REAL });
    assert(c5.modo === "turnstile" && c5.siteKey === REAL.TURNSTILE_SITE_KEY && !c5.dePrueba, "clientes con claves reales → Turnstile obligatorio");
    const c6 = configuracionAntibot({ ...REAL });
    assert(c6.modo === "turnstile", "sin NEXT_PUBLIC_ADMIN_APP_URL se trata como clientes: con claves reales, Turnstile");
    const c7 = configuracionAntibot({ ...PRUEBA });
    assert(c7.modo === "deshabilitado", "sin NEXT_PUBLIC_ADMIN_APP_URL y con claves de prueba → DESHABILITADO");

    assert(configuracionAntibot({ ...STG }).modo === "omitido", "staging sin claves → omitido (como hoy), con aviso en el log");
    const c8 = configuracionAntibot({ ...STG, ...PRUEBA });
    assert(c8.modo === "turnstile" && c8.dePrueba, "staging con claves de prueba → Turnstile (de prueba) exigido");
    assert(configuracionAntibot({ NEXT_PUBLIC_ADMIN_APP_URL: "http://localhost:3963", ...PRUEBA }).modo === "turnstile", "local con claves de prueba → Turnstile exigido");
    assert(configuracionAntibot({ ...STG, TURNSTILE_SECRET_KEY: SECRETO_PRUEBA }).modo === "deshabilitado", "staging con una sola clave → DESHABILITADO");

    // Deploy Preview de Netlify con NEXT_PUBLIC_ADMIN_APP_URL solo en el
    // alcance "Builds": en ejecución no está, pero quedó fijada en el build.
    const PREVIEW = "https://deploy-preview-2--gateflow-admin-staging.netlify.app";
    assert(configuracionAntibot({}, PREVIEW).modo === "omitido", "sin la URL en ejecución, usa la del build: una preview sin claves sigue siendo pruebas (antes cerraba /registro)");
    assert(configuracionAntibot({ NEXT_PUBLIC_ADMIN_APP_URL: "" }, STG.NEXT_PUBLIC_ADMIN_APP_URL).modo === "omitido", "URL vacía en ejecución → la del build");
    const c9 = configuracionAntibot({ ...PROD }, STG.NEXT_PUBLIC_ADMIN_APP_URL);
    assert(c9.modo === "deshabilitado" && c9.motivo === "sin_claves", "la URL de ejecución manda: gateflow.mx en ejecución es clientes aunque el build diga staging");
    const c10 = configuracionAntibot({ ...PRUEBA }, PREVIEW);
    assert(c10.modo === "turnstile" && c10.dePrueba, "preview con claves de prueba y la URL solo del build → Turnstile de prueba exigido");
    const c11 = configuracionAntibot({}, undefined);
    assert(c11.modo === "deshabilitado" && c11.motivo === "sin_claves", "sin URL en ejecución ni en el build → clientes: cerrado (falla cerrado)");
    const c12 = configuracionAntibot({ ...PRUEBA }, "https://gateflow.mx");
    assert(c12.modo === "deshabilitado", "build de clientes sin URL en ejecución y con claves de prueba → DESHABILITADO");

    // Motivo para el log: solo un código, nunca valores.
    const omitido = configuracionAntibot({ ...STG });
    assert(motivoRegistroCerrado(undefined, omitido) === "sin_REGISTRO_HASH_PEPPER" && motivoRegistroCerrado("corta", omitido) === "REGISTRO_HASH_PEPPER_corta",
      "motivo: falta el pepper o es corto");
    assert(motivoRegistroCerrado("p".repeat(16), configuracionAntibot({ ...STG, TURNSTILE_SECRET_KEY: SECRETO_PRUEBA })) === "turnstile_claves_incompletas"
      && motivoRegistroCerrado("p".repeat(16), c1) === "turnstile_sin_claves" && motivoRegistroCerrado("p".repeat(16), omitido) === null,
      "motivo: Turnstile incompleto o ausente en clientes; abierto → null");
    const secretoLargo = "s".repeat(40);
    assert(!String(motivoRegistroCerrado(secretoLargo, configuracionAntibot({ ...PROD, TURNSTILE_SITE_KEY: REAL.TURNSTILE_SITE_KEY }))).includes(secretoLargo.slice(0, 8))
      && !String(motivoRegistroCerrado(secretoLargo, c4)).includes("0x4AAA"), "el motivo nunca incluye el pepper ni claves");
  });

  await seccion("Servidor y formulario conectados al desafío", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raiz = join(__dirname, "../..");
    const accion = readFileSync(join(raiz, "app/registro/actions.ts"), "utf8");
    const pagina = readFileSync(join(raiz, "app/registro/page.tsx"), "utf8");
    const formulario = readFileSync(join(raiz, "app/registro/registro-form.tsx"), "utf8");
    assert(/configuracionAntibot\(process\.env\)/.test(accion) && /modo === "deshabilitado"[\s\S]*MENSAJES_ALTA\.noDisponible/.test(accion), "la acción del servidor rechaza si el entorno no tiene desafío válido");
    assert(accion.indexOf("configuracionAntibot(process.env)") < accion.indexOf("createServiceRoleClient()"), "el desafío se decide antes de tocar la base o Auth");
    assert(/verificarDesafio\([^)]*secreto: configAntibot\.secreto/.test(accion) && /MENSAJES_ALTA\.desafio/.test(accion), "con Turnstile, el token se verifica en el servidor con el secreto configurado");
    assert(/configuracionAntibot\(process\.env\)/.test(pagina) && /const motivo = motivoRegistroCerrado\(pepper, antibot\)/.test(pagina) && /if \(!pepper \|\| motivo\)/.test(pagina),
      "/registro no muestra el formulario si falta el pepper o el entorno no tiene desafío válido");
    assert(/console\.error\(`\[GateFlow\] \/registro cerrado: \$\{motivo\}`\)/.test(pagina) && !/console\.[a-z]+\([^)]*pepper\b/.test(pagina),
      "/registro cerrado deja en el log el motivo (código), nunca el pepper");
    assert(/turnstileSiteKey=\{antibot\.modo === "turnstile" \? antibot\.siteKey : null\}/.test(pagina), "solo la clave pública llega al navegador");
    assert(!/TURNSTILE_SECRET_KEY/.test(formulario) && !/TURNSTILE_SECRET_KEY/.test(pagina.replace(/configuracionAntibot\(process\.env\)/, "")), "el secreto nunca llega al formulario");
    assert(/name="cf-turnstile-response"/.test(formulario) && /disabled=\{enviando \|\| faltaDesafio\}/.test(formulario) && /desafio\.current\?\.reset\(\)/.test(formulario), "formulario: manda el token, no deja enviar sin él y pide uno nuevo tras un rechazo");
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

main();

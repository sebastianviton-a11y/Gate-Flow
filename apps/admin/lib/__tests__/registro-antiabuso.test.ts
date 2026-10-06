/**
 * Hashes, token de tiempo, IP y desafío anti-bot de /registro.
 *   npx tsx apps/admin/lib/__tests__/registro-antiabuso.test.ts
 */
import { verificarDesafio } from "../registro/antibot";
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

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

main();

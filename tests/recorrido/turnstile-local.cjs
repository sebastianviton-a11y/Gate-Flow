// Precarga (NODE_OPTIONS=--require …) del Admin del recorrido local:
// emula el siteverify de Cloudflare Turnstile para sus CLAVES DE PRUEBA
// documentadas, sin salir a internet:
//   secreto 1x…AA → success (siempre aprueba)
//   secreto 2x…AA → invalid-input-response (siempre rechaza)
//   secreto 3x…AA → timeout-or-duplicate (token ya usado)
//   sin token     → missing-input-response
// Cualquier otro secreto (una clave real) no se puede verificar aquí: la
// llamada falla como si no hubiera red. Cada llamada se anota (prefijo
// del secreto y token, nunca un secreto real) en GF_TURNSTILE_LLAMADAS.
"use strict";
const fs = require("node:fs");

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const registro = process.env.GF_TURNSTILE_LLAMADAS;
const original = globalThis.fetch;

globalThis.fetch = async function (entrada, init) {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada?.url;
  if (url !== SITEVERIFY) return original.apply(this, arguments);
  const cuerpo = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : String(init?.body ?? ""));
  const secreto = cuerpo.get("secret") ?? "";
  const token = cuerpo.get("response") ?? "";
  const prueba = /^[123]x0{15,}[A-Z]{2}$/.test(secreto);
  if (registro) fs.appendFileSync(registro, JSON.stringify({ secreto: prueba ? secreto.slice(0, 2) : "real", token }) + "\n");
  if (!prueba) throw Object.assign(new Error("GF_AUTOTEST: siteverify real no disponible en la prueba local"), { code: "ECONNREFUSED" });
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (!token) return json({ success: false, "error-codes": ["missing-input-response"] });
  if (secreto.startsWith("1x")) return json({ success: true, "error-codes": [], hostname: "localhost", action: "registro" });
  if (secreto.startsWith("2x")) return json({ success: false, "error-codes": ["invalid-input-response"] });
  return json({ success: false, "error-codes": ["timeout-or-duplicate"] });
};

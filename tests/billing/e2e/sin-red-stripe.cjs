// Precarga (NODE_OPTIONS=--require …) de los servidores Next de la capa C
// local: ninguna petición sale hacia Stripe. Cada intento se rechaza con
// un error de red y se anota en GF_STRIPE_BLOQUEOS (un archivo) para que
// la prueba pueda comprobar que el flujo llegó hasta el proveedor.
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const BLOQUEADOS = /(^|\.)stripe\.com$/i;
const registro = process.env.GF_STRIPE_BLOQUEOS;

function host(args) {
  const a = args[0];
  if (typeof a === "string" || a instanceof URL) return new URL(String(a)).hostname;
  return (a && (a.hostname || a.host)) || "";
}

for (const mod of [http, https]) {
  for (const nombre of ["request", "get"]) {
    const original = mod[nombre];
    mod[nombre] = function (...args) {
      const h = String(host(args)).replace(/:\d+$/, "");
      if (BLOQUEADOS.test(h)) {
        if (registro) fs.appendFileSync(registro, `${h}\n`);
        throw Object.assign(new Error(`GF_AUTOTEST: salida a ${h} bloqueada en la prueba local`), { code: "ECONNREFUSED" });
      }
      return original.apply(this, args);
    };
  }
}

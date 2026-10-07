// Precarga del pipeline (capa B2): fuera de Next, "server-only" lanza al
// importarse. En el servidor de Next se resuelve a un módulo vacío
// (condición react-server); aquí se hace lo mismo SOLO para ese paquete,
// sin activar react-server para el resto (React lo rechazaría).
"use strict";
const Module = require("node:module");
const path = require("node:path");
const vacio = path.join(__dirname, "server-only-vacio.cjs");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...resto) {
  if (request === "server-only") return vacio;
  return original.call(this, request, ...resto);
};

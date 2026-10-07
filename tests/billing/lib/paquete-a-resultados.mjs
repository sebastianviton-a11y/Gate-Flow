#!/usr/bin/env node
// Lee la salida de escenarios.sql (stdin) y la convierte en líneas
// RESULT|<capa>|<escenario>|PASS/FAIL|<caso> + FIXTURES|… para run.mjs.
// El paquete SQL siempre termina con la excepción
// "GF_AUTOTEST_RESULTADOS:{json}" (garantiza el rollback). Si no está,
// la corrida falló antes de terminar: se reporta como FAIL.
//   node paquete-a-resultados.mjs <capa> < salida_psql.txt
import { readFileSync } from "node:fs";

const capa = process.argv[2] ?? "B";
const entrada = readFileSync(0, "utf8");
const m = /GF_AUTOTEST_RESULTADOS:(\{.*\})\s*$/m.exec(entrada);
if (!m) {
  const error = (/ERROR:\s+(.*)/.exec(entrada)?.[1] ?? "sin resultados").slice(0, 300);
  console.log(`RESULT|${capa}|00|FAIL|el paquete SQL no terminó: ${error}`);
  process.exit(1);
}
let datos;
try {
  datos = JSON.parse(m[1]);
} catch (e) {
  console.log(`RESULT|${capa}|00|FAIL|JSON de resultados ilegible`);
  process.exit(1);
}
const limpio = (t) => String(t ?? "").replace(/[|\n\r]/g, " ").slice(0, 240);
let fallas = 0;
for (const r of datos.resultados) {
  const ok = r.ok === true;
  if (!ok) fallas++;
  console.log(`RESULT|${capa}|${r.e}|${ok ? "PASS" : "FAIL"}|${limpio(r.c)}${ok ? "" : ` — ${limpio(r.d)}`}`);
}
// El resumen calculado en la base debe coincidir con los resultados recibidos.
const resumen = datos.resumen ?? {};
const pasadas = datos.resultados.length - fallas;
if (resumen.total !== datos.resultados.length || resumen.pass !== pasadas || resumen.fail !== fallas) {
  console.log(`RESULT|${capa}|00|FAIL|resumen de la base (${resumen.pass}/${resumen.total}) no coincide con los resultados (${pasadas}/${datos.resultados.length})`);
  fallas++;
}
const suma = (o) => Object.values(o ?? {}).reduce((a, b) => a + Number(b), 0);
const f = datos.fixtures ?? {};
// eliminados = filas que existían ligadas al registro (incluye cascadas) y ya no están.
const creados = suma(f.creados);
const residuos = suma(f.residuos);
console.log(`FIXTURES|${capa}|run=${datos.run}|creados=${creados}|eliminados=${creados - residuos}|residuos=${residuos}`);
console.log(`DETALLE|${capa}|creados ${JSON.stringify(f.creados)} DELETE directos ${JSON.stringify(f.eliminados)} residuos ${JSON.stringify(f.residuos)}`);
console.log(`HASH|${capa}|reales_antes=${String(datos.hash_reales?.antes).slice(0, 12)}|reales_despues=${String(datos.hash_reales?.despues).slice(0, 12)}`);
process.exit(fallas ? 1 : 0);

/**
 * Orquestación del alta de /registro con dobles: orden de llamadas,
 * compensación y lo que nunca llega desde el cliente.
 *   npx tsx apps/admin/lib/__tests__/registro-alta.test.ts
 */
import { ejecutarAlta, MENSAJES_ALTA, type DatosNuevaCuenta, type DepsAlta } from "../registro/alta";
import { emitirTokenTiempo } from "../registro/hash";
import { MENSAJE_CONTACTO, MENSAJE_REVISA_CORREO, type CamposCrudos } from "../registro/validacion";

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

async function seccion(nombre: string, fn: () => Promise<void>) {
  console.log(`\n${nombre}`);
  await fn();
}

const PEPPER = "pepper-de-prueba-con-mas-de-16";
const T0 = 1_800_000_000_000;
const AHORA = T0 + 10_000;

interface Fallos {
  bloqueado?: boolean;
  duplicado?: boolean;
  authFalla?: boolean;
  rpcFalla?: boolean;
  emailFalla?: boolean;
  revertirNiega?: boolean;
}

function fakes(fallos: Fallos = {}) {
  const llamadas: string[] = [];
  const eventos: string[] = [];
  let cuenta: DatosNuevaCuenta | null = null;
  let usuario: { email: string; password: string; nombreCompleto: string } | null = null;
  const deps: DepsAlta = {
    async intentoPermitido(emailHash, ipHash) {
      llamadas.push(`intentoPermitido(${emailHash.slice(0, 6)},${ipHash?.slice(0, 6) ?? "null"})`);
      return fallos.bloqueado
        ? { intentoId: "int-1", permitido: false, motivo: "limite_email_hora" }
        : { intentoId: "int-1", permitido: true, motivo: null };
    },
    async intentoResultado(id, estado, motivo) {
      llamadas.push(`intentoResultado(${id},${estado},${motivo})`);
    },
    async crearUsuario(d) {
      usuario = d;
      llamadas.push("crearUsuario");
      if (fallos.duplicado) return { ok: false, duplicado: true, detalle: "422 email_exists" };
      if (fallos.authFalla) return { ok: false, duplicado: false, detalle: "500" };
      return { ok: true, userId: "user-1" };
    },
    async borrarUsuario(id) {
      llamadas.push(`borrarUsuario(${id})`);
    },
    async crearCuenta(d) {
      cuenta = d;
      llamadas.push("crearCuenta");
      return fallos.rpcFalla ? { ok: false, detalle: "22023" } : { ok: true, tenantId: "tenant-1" };
    },
    async revertirCuenta(id) {
      llamadas.push(`revertirCuenta(${id})`);
      return fallos.revertirNiega ? { revertido: false, motivo: "actividad:ubicaciones" } : { revertido: true, motivo: null };
    },
    async enviarConfirmacion(email) {
      llamadas.push(`enviarConfirmacion(${email})`);
      return fallos.emailFalla ? { ok: false, detalle: "smtp" } : { ok: true };
    },
    log(evento, datos) {
      eventos.push(evento);
      const texto = JSON.stringify(datos ?? {});
      if (/ana@x\.com|contraseña|203\.0\.113/.test(texto)) {
        fallidas++;
        console.error(`✗ FALLÓ: el log de ${evento} contiene PII: ${texto}`);
      }
    },
  };
  return { deps, llamadas, eventos, getCuenta: () => cuenta, getUsuario: () => usuario };
}

function campos(extra: Partial<CamposCrudos> & Record<string, string> = {}): CamposCrudos {
  return {
    nombreCompleto: "Ana Pérez",
    email: "ana@x.com",
    password: "contraseña-segura-1",
    nombreResidencial: "Residencial X",
    pais: "MX",
    viviendas: "48",
    aceptaTerminos: "on",
    timezone: "America/Cancun",
    sitio_web: "",
    t: emitirTokenTiempo(PEPPER, T0),
    ...extra,
  };
}

const ctx = { pepper: PEPPER, ip: "203.0.113.9", ahoraMs: AHORA };

async function main() {
  await seccion("Alta correcta: orden Auth → RPC → correo → intento exito", async () => {
    const f = fakes();
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "revisa_correo" && r.mensaje === MENSAJE_REVISA_CORREO, "respuesta revisa_correo con el mensaje público");
    assert(
      f.llamadas.join(" > ") ===
        "intentoPermitido(" + f.llamadas[0]?.slice(17, 23) + "," + f.llamadas[0]?.slice(24, 30) + ") > crearUsuario > crearCuenta > enviarConfirmacion(ana@x.com) > intentoResultado(int-1,exito,null)",
      `orden de llamadas: ${f.llamadas.join(" > ")}`,
    );
    const u = f.getUsuario();
    assert(!!u && u.email === "ana@x.com" && u.nombreCompleto === "Ana Pérez", "createUser recibe email normalizado y nombre");
  });

  await seccion("9-10. La cuenta la define el servidor: sin rol, tenant, fechas ni estado", async () => {
    const f = fakes();
    await ejecutarAlta(f.deps, campos({ rol: "super_admin", tenant_id: "t-ajeno", trial_ends_at: "2099-01-01", estado: "active" }), ctx);
    const c = f.getCuenta();
    assert(!!c, "la RPC se llamó");
    if (c) {
      assert(Object.keys(c).sort().join(",") === "aceptaTerminos,nombreResidencial,pais,timezone,userId,viviendas", `solo estos campos llegan a la RPC (${Object.keys(c).sort().join(",")})`);
      assert(c.userId === "user-1" && c.viviendas === 48 && c.pais === "MX" && c.timezone === "America/Cancun" && c.aceptaTerminos === true, "valores correctos");
    }
  });

  await seccion("23. Más de 150 viviendas: no se llama a nada", async () => {
    const f = fakes();
    const r = await ejecutarAlta(f.deps, campos({ viviendas: "151" }), ctx);
    assert(r.tipo === "contacto" && r.mensaje === MENSAJE_CONTACTO, "mensaje de contacto");
    assert(f.llamadas.length === 0, "cero llamadas externas");
  });

  await seccion("24. Términos no aceptados: rechazo antes de Auth", async () => {
    const f = fakes();
    const r = await ejecutarAlta(f.deps, campos({ aceptaTerminos: "" }), ctx);
    assert(r.tipo === "campos" && !!r.errores.aceptaTerminos, "error de campo");
    assert(f.llamadas.length === 0, "cero llamadas externas");
  });

  await seccion("18. Rate limit: bloqueado antes de crear nada", async () => {
    const f = fakes({ bloqueado: true });
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "error" && r.mensaje === MENSAJES_ALTA.bloqueado, "mensaje de bloqueo");
    assert(f.llamadas.length === 1 && f.llamadas[0]?.startsWith("intentoPermitido") === true, "solo se consultó el límite");
  });

  await seccion("19. Honeypot: respuesta genérica, intento fallo, sin Auth", async () => {
    const f = fakes();
    const r = await ejecutarAlta(f.deps, campos({ sitio_web: "http://spam.example" }), ctx);
    assert(r.tipo === "revisa_correo", "al bot se le responde como a un alta");
    assert(f.llamadas.length === 2 && f.llamadas[1] === "intentoResultado(int-1,fallo,honeypot)", `intento cerrado como honeypot (${f.llamadas.join(" > ")})`);
  });

  await seccion("Token de tiempo: rápido → genérico; expirado → pedir recarga", async () => {
    const f1 = fakes();
    const r1 = await ejecutarAlta(f1.deps, campos(), { ...ctx, ahoraMs: T0 + 1_000 });
    assert(r1.tipo === "revisa_correo" && f1.llamadas[1] === "intentoResultado(int-1,fallo,token_rapido)", "menos de 4 s → genérico, sin Auth");
    const f2 = fakes();
    const r2 = await ejecutarAlta(f2.deps, campos(), { ...ctx, ahoraMs: T0 + 2 * 60 * 60 * 1000 });
    assert(r2.tipo === "error" && r2.mensaje === MENSAJES_ALTA.expirado && f2.llamadas[1] === "intentoResultado(int-1,fallo,token_expirado)", "más de 1 h → expirado");
    const f3 = fakes();
    const r3 = await ejecutarAlta(f3.deps, campos({ t: "123.abc" }), ctx);
    assert(r3.tipo === "revisa_correo" && f3.llamadas.length === 2, "token inválido → genérico, sin Auth");
  });

  await seccion("3. Email duplicado: misma respuesta pública, sin RPC ni correo", async () => {
    const f = fakes({ duplicado: true });
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "revisa_correo" && r.mensaje === MENSAJE_REVISA_CORREO, "no se revela que existe");
    assert(f.llamadas.join(" > ").endsWith("crearUsuario > intentoResultado(int-1,fallo,email_duplicado)"), `sin crearCuenta ni enviarConfirmacion (${f.llamadas.join(" > ")})`);
  });

  await seccion("13-14. Falla la RPC: se borra el usuario de Auth y no se manda correo", async () => {
    const f = fakes({ rpcFalla: true });
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "error" && r.mensaje === MENSAJES_ALTA.generico, "error genérico");
    assert(f.llamadas.slice(1).join(" > ") === "crearUsuario > crearCuenta > borrarUsuario(user-1) > intentoResultado(int-1,fallo,rpc)", `compensación (${f.llamadas.join(" > ")})`);
  });

  await seccion("27. Falla el correo: revertir_cuenta_prueba y luego borrar el usuario", async () => {
    const f = fakes({ emailFalla: true });
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "error" && r.mensaje === MENSAJES_ALTA.correo, "error de correo");
    assert(
      f.llamadas.slice(1).join(" > ") === "crearUsuario > crearCuenta > enviarConfirmacion(ana@x.com) > revertirCuenta(user-1) > borrarUsuario(user-1) > intentoResultado(int-1,fallo,email)",
      `orden de compensación (${f.llamadas.join(" > ")})`,
    );
  });

  await seccion("Si la reversión se niega, el usuario NO se borra y queda constancia", async () => {
    const f = fakes({ emailFalla: true, revertirNiega: true });
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "error", "error de correo");
    assert(!f.llamadas.some((l) => l.startsWith("borrarUsuario")), "no se borra el usuario de Auth");
    assert(f.eventos.includes("registro.compensacion_incompleta"), "evento compensacion_incompleta en el log");
    assert(f.llamadas.at(-1) === "intentoResultado(int-1,fallo,email_sin_compensar)", "intento cerrado como email_sin_compensar");
  });

  await seccion("Auth falla por otra causa: error genérico, sin RPC", async () => {
    const f = fakes({ authFalla: true });
    const r = await ejecutarAlta(f.deps, campos(), ctx);
    assert(r.tipo === "error" && r.mensaje === MENSAJES_ALTA.generico, "error genérico");
    assert(!f.llamadas.includes("crearCuenta"), "sin crearCuenta");
  });

  await seccion("Sin IP: el límite por correo sigue aplicando (ip_hash null)", async () => {
    const f = fakes();
    await ejecutarAlta(f.deps, campos(), { ...ctx, ip: null });
    assert(f.llamadas[0]?.endsWith(",null)") === true, "intentoPermitido recibe ip_hash null");
  });

  console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
  if (fallidas > 0) process.exit(1);
}

main();

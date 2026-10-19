/**
 * Validación de /registro. Sin framework:
 *   npx tsx apps/admin/lib/__tests__/registro-validacion.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leerCampos, paisesHabilitados, timezoneValida, validarRegistro, type CamposCrudos } from "../registro/validacion";

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

function seccion(nombre: string, fn: () => void) {
  console.log(`\n${nombre}`);
  fn();
}

function campos(extra: Partial<CamposCrudos> = {}): CamposCrudos {
  return {
    nombreCompleto: " Ana   Pérez ",
    email: " Ana.Perez@Residencial.COM ",
    password: "contraseña-segura-1",
    nombreResidencial: "  Residencial  Las Palmas ",
    pais: "MX",
    viviendas: "48",
    aceptaTerminos: "on",
    timezone: "America/Cancun",
    sitio_web: "",
    t: "irrelevante-aqui",
    ...extra,
  };
}

seccion("1-2. Registro válido MX y AR", () => {
  const mx = validarRegistro(campos());
  assert(mx.ok, "MX válido");
  if (mx.ok) {
    assert(mx.datos.nombreCompleto === "Ana Pérez", "nombre normalizado (espacios)");
    assert(mx.datos.email === "ana.perez@residencial.com", "email en minúsculas y sin espacios");
    assert(mx.datos.nombreResidencial === "Residencial Las Palmas", "residencial normalizado");
    assert(mx.datos.pais === "MX" && mx.datos.viviendas === 48, "país y viviendas");
    assert(mx.datos.aceptaTerminos === true, "términos aceptados");
  }
  // Argentina solo con su registro abierto (REGISTRO_PAISES=MX,AR; segunda etapa).
  const ar = validarRegistro(campos({ pais: "AR", viviendas: "150", timezone: "America/Argentina/Cordoba" }), ["MX", "AR"]);
  assert(ar.ok && ar.datos.pais === "AR" && ar.datos.viviendas === 150, "AR válido con 150 viviendas (límite incluido)");
  assert(ar.ok && ar.datos.timezone === "America/Argentina/Cordoba", "timezone IANA válida se conserva");
});

seccion("4. Residencial vacío", () => {
  const r = validarRegistro(campos({ nombreResidencial: "   " }));
  assert(!r.ok && r.tipo === "campos" && !!r.errores.nombreResidencial, "residencial vacío → error de campo");
  const r2 = validarRegistro(campos({ nombreResidencial: "ab" }));
  assert(!r2.ok && r2.tipo === "campos" && !!r2.errores.nombreResidencial, "residencial de 2 caracteres → error");
});

seccion("5. Viviendas inválidas", () => {
  for (const v of ["0", "-3", "abc", "", "12.5", "1e3"]) {
    const r = validarRegistro(campos({ viviendas: v }));
    assert(!r.ok && r.tipo === "campos" && !!r.errores.viviendas, `viviendas ${JSON.stringify(v)} → error de campo`);
  }
});

seccion("23. Más de 150 viviendas → contacto, antes que cualquier otra validación", () => {
  const r = validarRegistro(campos({ viviendas: "151" }));
  assert(!r.ok && r.tipo === "contacto", "151 → contacto");
  const r2 = validarRegistro(campos({ viviendas: "5000", email: "no-es-correo", aceptaTerminos: "" }));
  assert(!r2.ok && r2.tipo === "contacto", "5000 con otros campos inválidos → sigue siendo contacto");
});

seccion("6. País no permitido", () => {
  for (const p of ["US", "mx", "", "ES", "MXX"]) {
    const r = validarRegistro(campos({ pais: p }));
    assert(!r.ok && r.tipo === "campos" && !!r.errores.pais, `país ${JSON.stringify(p)} → error`);
  }
  // Sin preselección: elegir el país es obligatorio y el mensaje lo dice.
  const sinPais = validarRegistro(campos({ pais: "  " }));
  assert(!sinPais.ok && sinPais.tipo === "campos" && sinPais.errores.pais === "Elige el país del residencial.", "sin país → \"Elige el país del residencial.\"");
});

seccion("24. Términos no aceptados", () => {
  for (const t of ["", "off", "no", "false"]) {
    const r = validarRegistro(campos({ aceptaTerminos: t }));
    assert(!r.ok && r.tipo === "campos" && !!r.errores.aceptaTerminos, `aceptaTerminos=${JSON.stringify(t)} → error`);
  }
});

seccion("Email y contraseña", () => {
  for (const e of ["sin-arroba", "a@b", "a@b.c", "con espacio@x.com", ""]) {
    const r = validarRegistro(campos({ email: e }));
    assert(!r.ok && r.tipo === "campos" && !!r.errores.email, `email ${JSON.stringify(e)} → error`);
  }
  const corta = validarRegistro(campos({ password: "1234567" }));
  assert(!corta.ok && corta.tipo === "campos" && !!corta.errores.password, "contraseña de 7 → error");
  const igual = validarRegistro(campos({ password: "ana.perez@residencial.com" }));
  assert(!igual.ok && igual.tipo === "campos" && !!igual.errores.password, "contraseña igual al correo → error");
  const nombre = validarRegistro(campos({ nombreCompleto: "Al" }));
  assert(!nombre.ok && nombre.tipo === "campos" && !!nombre.errores.nombreCompleto, "nombre de 2 → error");
});

seccion("25-26. Timezone", () => {
  assert(timezoneValida("America/Mexico_City") && timezoneValida("Etc/UTC"), "nombres IANA válidos");
  assert(!timezoneValida("Marte/Olympus") && !timezoneValida("") && !timezoneValida("x".repeat(65)), "nombres inválidos");
  assert(!timezoneValida("America/Cancun; drop"), "caracteres fuera del alfabeto IANA → inválida");
  const r = validarRegistro(campos({ timezone: "Marte/Olympus" }));
  assert(r.ok && r.datos.timezone === "America/Mexico_City", "timezone inválida → la del país");
  const r2 = validarRegistro(campos({ timezone: "" }));
  assert(r2.ok && r2.datos.timezone === "America/Mexico_City", "sin timezone → la del país");
});

seccion("7-8. Campos manipulados desde el cliente se ignoran", () => {
  const form = new FormData();
  form.set("nombreCompleto", "Ana Pérez");
  form.set("email", "ana@x.com");
  form.set("password", "contraseña-segura-1");
  form.set("nombreResidencial", "Residencial X");
  form.set("pais", "MX");
  form.set("viviendas", "10");
  form.set("aceptaTerminos", "on");
  form.set("rol", "super_admin");
  form.set("rol_clave", "super_admin");
  form.set("tenant_id", "5a000000-0000-4000-8000-000000000000");
  form.set("empresa_id", "e5000000-0000-4000-8000-000000000001");
  form.set("trial_ends_at", "2099-01-01");
  form.set("estado", "active");
  form.set("plan", "enterprise");
  const c = leerCampos(form);
  const claves = Object.keys(c).sort().join(",");
  assert(
    claves === "aceptaTerminos,declaraFacultades,email,nombreCompleto,nombreResidencial,pais,password,sitio_web,t,timezone,version_ids,viviendas",
    `solo se leen los campos conocidos (${claves})`,
  );
  assert(!("rol" in c) && !("tenant_id" in c) && !("trial_ends_at" in c) && !("plan" in c), "rol, tenant_id, trial_ends_at y plan no existen en los campos");
  const r = validarRegistro(c);
  assert(r.ok && !("rol" in r.datos) && !("tenantId" in r.datos) && !("trialEndsAt" in r.datos), "los datos validados tampoco los llevan");
});

{
  // Lanzamiento solo en México: sin REGISTRO_PAISES (o con valores inválidos), solo MX.
  assert(JSON.stringify(paisesHabilitados(undefined)) === '["MX"]' && JSON.stringify(paisesHabilitados("")) === '["MX"]', "sin variable: solo México");
  assert(JSON.stringify(paisesHabilitados("xx, ar ,MX")) === '["MX","AR"]', "MX,AR (con espacios y minúsculas) en el orden del catálogo");
  assert(JSON.stringify(paisesHabilitados("BR,US")) === '["MX"]', "solo códigos del catálogo; si ninguno vale, México");
  const arCerrado = validarRegistro(campos({ pais: "AR", timezone: "America/Argentina/Cordoba" }));
  assert(!arCerrado.ok && arCerrado.tipo === "campos" && arCerrado.errores.pais === "Por ahora Gate Flow está disponible solo en México.", "Argentina con el registro cerrado: rechazada en el servidor con un mensaje claro");
  const mxSolo = validarRegistro(campos({ pais: "MX" }), ["MX"]);
  assert(mxSolo.ok && mxSolo.datos.pais === "MX", "México con el registro de México abierto");
  const RAIZ_ADMIN = join(__dirname, "..", "..");
  const pagina = readFileSync(join(RAIZ_ADMIN, "app", "registro", "page.tsx"), "utf8");
  const accion = readFileSync(join(RAIZ_ADMIN, "app", "registro", "actions.ts"), "utf8");
  const formulario = readFileSync(join(RAIZ_ADMIN, "app", "registro", "registro-form.tsx"), "utf8");
  assert(pagina.includes("const paises = paisesHabilitados(process.env.REGISTRO_PAISES);") && pagina.includes("paises={paises}") && pagina.includes("documentosPorPais(paises)") && accion.includes("paises: paisesHabilitados(process.env.REGISTRO_PAISES)"), "la página y la acción usan la misma lista (REGISTRO_PAISES)");
  assert(formulario.includes("opcionesPais.map(") && !formulario.includes("PAISES_REGISTRO.map("), "el formulario solo ofrece los países abiertos");
}

console.log(`\n${pasadas} pasadas, ${fallidas} fallidas`);
if (fallidas > 0) process.exit(1);

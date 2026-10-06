/**
 * Validación server-side de /registro. Funciones puras: sin Next, sin
 * Supabase, sin Node. Todo lo que el navegador manda pasa por aquí
 * antes de tocar Auth o la base; la RPC crear_cuenta_prueba vuelve a
 * validar lo suyo (defensa en profundidad).
 */

export const PAISES_REGISTRO = [
  { codigo: "MX", nombre: "México" },
  { codigo: "AR", nombre: "Argentina" },
] as const;
export type PaisRegistro = (typeof PAISES_REGISTRO)[number]["codigo"];

/** Autoservicio: hasta 150 viviendas. Más de eso se atiende a mano. */
export const MAX_VIVIENDAS_AUTOSERVICIO = 150;

export const MENSAJE_CONTACTO = "Para residenciales de más de 150 viviendas, contáctanos.";
/** Única respuesta pública de éxito. También se usa cuando el correo
 * ya tiene cuenta: no se revela si existe. */
export const MENSAJE_REVISA_CORREO = "Revisa tu correo. Si ya tienes una cuenta, puedes iniciar sesión.";

/** Los únicos campos que la acción lee del FormData. Cualquier otro
 * (rol, tenant_id, trial_ends_at…) se ignora por construcción. */
export const CAMPOS_REGISTRO = [
  "nombreCompleto",
  "email",
  "password",
  "nombreResidencial",
  "pais",
  "viviendas",
  "aceptaTerminos",
  "timezone",
  "sitio_web", // honeypot: debe llegar vacío
  "t", // token de tiempo firmado por el servidor
] as const;
export type CampoRegistro = (typeof CAMPOS_REGISTRO)[number];
export type CamposCrudos = Record<CampoRegistro, string>;

export type CampoVisible = Exclude<CampoRegistro, "timezone" | "sitio_web" | "t">;
export type ErroresRegistro = Partial<Record<CampoVisible, string>>;

export interface DatosRegistro {
  nombreCompleto: string;
  email: string;
  password: string;
  nombreResidencial: string;
  pais: PaisRegistro;
  viviendas: number;
  /** Zona IANA válida del navegador, o null para que la RPC use la del país. */
  timezone: string | null;
  aceptaTerminos: true;
}

export type ResultadoValidacion =
  | { ok: true; datos: DatosRegistro }
  | { ok: false; tipo: "contacto" }
  | { ok: false; tipo: "campos"; errores: ErroresRegistro };

export function leerCampos(form: FormData): CamposCrudos {
  const campos = {} as CamposCrudos;
  for (const nombre of CAMPOS_REGISTRO) {
    const valor = form.get(nombre);
    campos[nombre] = typeof valor === "string" ? valor : "";
  }
  return campos;
}

export function normalizarEmail(valor: string): string {
  return valor.trim().toLowerCase();
}

export function normalizarTexto(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Nombre IANA que el motor de Intl reconoce (p. ej. "America/Cancun"). */
export function timezoneValida(tz: string): boolean {
  if (!/^[A-Za-z0-9_+/-]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function timezonePorPais(pais: PaisRegistro): string {
  return pais === "MX" ? "America/Mexico_City" : "America/Argentina/Buenos_Aires";
}

function esPais(valor: string): valor is PaisRegistro {
  return PAISES_REGISTRO.some((p) => p.codigo === valor);
}

export function validarRegistro(campos: CamposCrudos): ResultadoValidacion {
  // Más de 150 viviendas: no se crea nada, se invita a contactar. Se
  // decide antes que cualquier otra cosa para que el mensaje sea ese.
  const viviendasTexto = campos.viviendas.trim();
  const viviendasEsEntero = /^\d{1,7}$/.test(viviendasTexto);
  const viviendas = viviendasEsEntero ? Number(viviendasTexto) : NaN;
  if (viviendasEsEntero && viviendas > MAX_VIVIENDAS_AUTOSERVICIO) {
    return { ok: false, tipo: "contacto" };
  }

  const errores: ErroresRegistro = {};

  const nombreCompleto = normalizarTexto(campos.nombreCompleto);
  if (nombreCompleto.length < 3 || nombreCompleto.length > 80) {
    errores.nombreCompleto = "Escribe tu nombre y apellido.";
  }

  const email = normalizarEmail(campos.email);
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    errores.email = "Escribe un correo válido.";
  }

  const password = campos.password;
  if (password.length < 8 || password.length > 72) {
    errores.password = "La contraseña debe tener entre 8 y 72 caracteres.";
  } else if (password.toLowerCase() === email) {
    errores.password = "La contraseña no puede ser tu correo.";
  }

  const nombreResidencial = normalizarTexto(campos.nombreResidencial);
  if (nombreResidencial.length < 3 || nombreResidencial.length > 80) {
    errores.nombreResidencial = "Escribe el nombre del residencial (3 a 80 caracteres).";
  }

  const pais = campos.pais.trim();
  if (!esPais(pais)) {
    errores.pais = "Por ahora solo México y Argentina.";
  }

  if (!viviendasEsEntero || viviendas < 1) {
    errores.viviendas = `Indica un número de viviendas entre 1 y ${MAX_VIVIENDAS_AUTOSERVICIO}.`;
  }

  const aceptaTerminos = ["on", "true", "1"].includes(campos.aceptaTerminos.trim());
  if (!aceptaTerminos) {
    errores.aceptaTerminos = "Debes aceptar los Términos y Condiciones y el Aviso de Privacidad.";
  }

  if (Object.keys(errores).length > 0 || !esPais(pais)) {
    return { ok: false, tipo: "campos", errores };
  }

  const tz = campos.timezone.trim();
  return {
    ok: true,
    datos: {
      nombreCompleto,
      email,
      password,
      nombreResidencial,
      pais,
      viviendas,
      timezone: tz !== "" && timezoneValida(tz) ? tz : null,
      aceptaTerminos: true,
    },
  };
}

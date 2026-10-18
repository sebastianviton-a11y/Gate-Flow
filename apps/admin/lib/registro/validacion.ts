/**
 * Validación server-side de /registro. Funciones puras: sin Next, sin
 * Supabase, sin Node. Todo lo que el navegador manda pasa por aquí
 * antes de tocar Auth o la base; la RPC crear_cuenta_prueba vuelve a
 * validar lo suyo (defensa en profundidad).
 */
import { MENSAJES_ACEPTACION, leerVersionIds } from "../legal/aceptacion";

export const PAISES_REGISTRO = [
  { codigo: "MX", nombre: "México" },
  { codigo: "AR", nombre: "Argentina" },
] as const;
export type PaisRegistro = (typeof PAISES_REGISTRO)[number]["codigo"];

/**
 * Países con registro abierto: REGISTRO_PAISES del servidor ("MX" o
 * "MX,AR"), solo códigos del catálogo de arriba. Sin valor válido: solo
 * México (lanzamiento). Argentina queda en el catálogo para una segunda
 * etapa: se abre agregándola a la variable, sin cambiar código.
 */
export const PAISES_POR_DEFECTO: readonly PaisRegistro[] = ["MX"];

export function paisesHabilitados(valor: string | undefined): PaisRegistro[] {
  const pedidos = (valor ?? "").split(",").map((p) => p.trim().toUpperCase());
  const habilitados = PAISES_REGISTRO.map((p) => p.codigo).filter((c) => pedidos.includes(c));
  return habilitados.length > 0 ? habilitados : [...PAISES_POR_DEFECTO];
}

export function nombrePais(codigo: PaisRegistro): string {
  return PAISES_REGISTRO.find((p) => p.codigo === codigo)?.nombre ?? codigo;
}

/** Autoservicio: hasta 150 viviendas. Más de eso se atiende a mano. */
export const MAX_VIVIENDAS_AUTOSERVICIO = 150;

export const MENSAJE_CONTACTO = "Para residenciales de más de 150 viviendas, escríbenos por WhatsApp.";
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
/** Además de los campos de texto: las versiones de los documentos legales
 * que el formulario MOSTRÓ (version_ids, uno por documento) y la
 * declaración de facultades del Acuerdo de Tratamiento. */
export type CamposCrudos = Record<CampoRegistro, string> & { version_ids?: string[]; declaraFacultades?: string };

export type CampoVisible = Exclude<CampoRegistro, "timezone" | "sitio_web" | "t"> | "declaraFacultades";
export type ErroresRegistro = Partial<Record<CampoVisible, string>>;

export interface DatosRegistro {
  nombreCompleto: string;
  email: string;
  password: string;
  nombreResidencial: string;
  pais: PaisRegistro;
  viviendas: number;
  /** Zona del residencial: la del navegador si es de su país; si no, la del país. */
  timezone: string;
  aceptaTerminos: true;
  /** Versiones de los documentos legales mostrados (lo vigente lo comprueba el servidor). */
  versionIds: string[];
  /** Declaró facultades para aceptar el Acuerdo de Tratamiento en nombre del residencial. */
  declaraFacultades: boolean;
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
  campos.version_ids = form.getAll("version_ids").map((v) => (typeof v === "string" ? v : ""));
  const declara = form.get("declaraFacultades");
  campos.declaraFacultades = typeof declara === "string" ? declara : "";
  return campos;
}

export function normalizarEmail(valor: string): string {
  return valor.trim().toLowerCase();
}

export function normalizarTexto(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Correo ya normalizado con forma válida (mismo criterio que /registro). */
export function correoValido(emailNormalizado: string): boolean {
  return emailNormalizado.length <= 254 && EMAIL_RE.test(emailNormalizado);
}

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

/** Zonas IANA de México, actuales y alias antiguos que aún reportan algunos navegadores. */
const ZONAS_MX = new Set([
  "America/Mexico_City",
  "America/Cancun",
  "America/Merida",
  "America/Monterrey",
  "America/Matamoros",
  "America/Chihuahua",
  "America/Ciudad_Juarez",
  "America/Ojinaga",
  "America/Mazatlan",
  "America/Bahia_Banderas",
  "America/Hermosillo",
  "America/Tijuana",
  "America/Ensenada",
  "America/Santa_Isabel",
  "Mexico/General",
  "Mexico/BajaNorte",
  "Mexico/BajaSur",
]);

/** Alias antiguos de Argentina (las actuales son "America/Argentina/…"). */
const ZONAS_AR_ALIAS = new Set([
  "America/Buenos_Aires",
  "America/Catamarca",
  "America/Cordoba",
  "America/Jujuy",
  "America/Mendoza",
  "America/Rosario",
]);

/** La zona pertenece al país elegido para el residencial. */
export function zonaCompatibleConPais(tz: string, pais: PaisRegistro): boolean {
  if (pais === "MX") return ZONAS_MX.has(tz);
  return tz.startsWith("America/Argentina/") || ZONAS_AR_ALIAS.has(tz);
}

/**
 * Zona con la que nace el residencial (tenants.timezone). La del
 * navegador solo se usa si es del país elegido: quien registra un
 * residencial de Argentina desde un navegador en Cancún (viaje, VPN,
 * equipo mal configurado) no debe dejarlo con la hora de Cancún.
 * Si no es compatible, es inválida o falta → la zona del país.
 */
export function zonaHorariaParaRegistro(tz: string, pais: PaisRegistro): string {
  return tz !== "" && timezoneValida(tz) && zonaCompatibleConPais(tz, pais) ? tz : timezonePorPais(pais);
}

function esPais(valor: string): valor is PaisRegistro {
  return PAISES_REGISTRO.some((p) => p.codigo === valor);
}

export function validarRegistro(campos: CamposCrudos, habilitados: readonly PaisRegistro[] = PAISES_POR_DEFECTO): ResultadoValidacion {
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

  // Sin valor por defecto: el país define cómo se cobra la suscripción y
  // el formato de los teléfonos, así que se elige explícitamente.
  const pais = campos.pais.trim();
  if (!pais) {
    errores.pais = "Elige el país del residencial.";
  } else if (!esPais(pais) || !habilitados.includes(pais)) {
    errores.pais = `Por ahora Gate Flow está disponible solo en ${habilitados.map(nombrePais).join(" y ")}.`;
  }

  if (!viviendasEsEntero || viviendas < 1) {
    errores.viviendas = `Indica un número de viviendas entre 1 y ${MAX_VIVIENDAS_AUTOSERVICIO}.`;
  }

  const aceptaTerminos = ["on", "true", "1"].includes(campos.aceptaTerminos.trim());
  if (!aceptaTerminos) {
    errores.aceptaTerminos = "Debes aceptar los Términos y Condiciones y el Aviso de Privacidad.";
  }
  const versionIds = leerVersionIds(campos.version_ids ?? []);
  if (versionIds === null && !errores.aceptaTerminos) {
    errores.aceptaTerminos = MENSAJES_ACEPTACION.invalidos;
  }

  if (Object.keys(errores).length > 0 || !esPais(pais) || !habilitados.includes(pais)) {
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
      timezone: zonaHorariaParaRegistro(tz, pais),
      aceptaTerminos: true,
      versionIds: versionIds ?? [],
      declaraFacultades: ["on", "true", "1"].includes((campos.declaraFacultades ?? "").trim()),
    },
  };
}

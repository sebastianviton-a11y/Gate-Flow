import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@gateflow/supabase";
import { destinoPanelAdmin } from "@/lib/acceso-panel";

// "Solo para invitados": si ya hay sesión, no tiene sentido seguir
// viéndolas — se redirige al dashboard.
const RUTAS_SOLO_INVITADOS = ["/login"];

// "Siempre accesibles", con o sin sesión: /aceptar-invitacion porque
// establece una sesión ANTES de que la contraseña esté creada (aplicar
// la regla de "solo invitados" ahí sacaría a la persona a mitad del
// proceso), y /terminos porque es contenido informativo que cualquiera
// — con sesión o sin ella — debe poder leer sin ser redirigido.
// /sin-acceso también: es a donde se envía a quien tiene sesión pero no
// un residencial activo (o cuando no se pudo validar), y no consulta la
// sesión, así que no puede entrar en bucle.
const RUTAS_SIEMPRE_PUBLICAS = [
  "/aceptar-invitacion",
  "/terminos",
  "/residencial-suspendido",
  "/recuperar-password",
  "/restablecer-password",
  "/sin-acceso",
];

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const esSoloInvitados = RUTAS_SOLO_INVITADOS.some((path) => pathname.startsWith(path));
  const esSiemprePublica = RUTAS_SIEMPRE_PUBLICAS.some((path) => pathname.startsWith(path));
  const esPublica = esSoloInvitados || esSiemprePublica;
  const esRutaOnboarding = pathname.startsWith("/onboarding");
  const esRutaSuperadmin = pathname.startsWith("/superadmin");

  // Sin sesión + ruta protegida → login, conservando a dónde iba (BR-01/BR-02:
  // ninguna ruta protegida se sirve sin que el usuario esté autenticado en un tenant).
  if (!user && !esPublica) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Con sesión activa, las rutas "solo invitados" (login) redirigen al
  // dashboard — las "siempre públicas" nunca redirigen, sin importar
  // si hay sesión o no.
  if (user && esSoloInvitados) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Onboarding obligatorio y bloqueo de tenant suspendido: una sola
  // consulta liviana trae ambos datos y el rol — solo cuando aplica,
  // nunca en rutas públicas ni dentro del propio /onboarding.
  // Falla cerrado: si la consulta falla o la membresía no se puede leer
  // completa, no se deja pasar a la ruta protegida.
  if (user && !esPublica && !esRutaOnboarding && !esRutaSuperadmin) {
    const { data: membership, error } = await supabase
      .from("user_tenants")
      .select("roles(clave), tenants(onboarding_completado, estado_servicio)")
      .eq("user_id", user.id)
      .eq("activo", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[GateFlow] middleware: no se pudo leer user_tenants:", { code: error.code, message: error.message });
    }

    // Solo super_admin y admin_residencial usan este panel; cualquier
    // otro caso va a /sin-acceso (ver lib/acceso-panel.ts).
    const destino = destinoPanelAdmin(error, membership);
    if (destino) {
      return NextResponse.redirect(new URL(destino, request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Aplica a todas las rutas excepto assets estáticos y archivos internos
     * de Next.js, para no interceptar el propio bundle de la app.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

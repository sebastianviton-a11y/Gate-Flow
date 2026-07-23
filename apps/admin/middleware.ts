import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@gateflow/supabase";

// "Solo para invitados": si ya hay sesión, no tiene sentido seguir
// viéndolas — se redirige al dashboard.
const RUTAS_SOLO_INVITADOS = ["/login"];

// "Siempre accesibles", con o sin sesión: /aceptar-invitacion porque
// establece una sesión ANTES de que la contraseña esté creada (aplicar
// la regla de "solo invitados" ahí sacaría a la persona a mitad del
// proceso), y /terminos porque es contenido informativo que cualquiera
// — con sesión o sin ella — debe poder leer sin ser redirigido.
const RUTAS_SIEMPRE_PUBLICAS = ["/aceptar-invitacion", "/terminos", "/residencial-suspendido"];

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
  // consulta liviana trae ambos datos — solo cuando aplica, nunca en
  // rutas públicas ni dentro del propio /onboarding.
  if (user && !esPublica && !esRutaOnboarding && !esRutaSuperadmin) {
    const { data: membership } = await supabase
      .from("user_tenants")
      .select("tenants(onboarding_completado, estado_servicio)")
      .eq("user_id", user.id)
      .eq("activo", true)
      .limit(1)
      .maybeSingle();

    const tenantData = membership?.tenants as unknown as { onboarding_completado: boolean; estado_servicio: string } | null;

    // RIESGO 3 (PERMISSIONS.md): antes, "suspendido" era solo
    // informativo — un residencial suspendido seguía operando con
    // normalidad. Ahora se bloquea de verdad, salvo para super_admin
    // (que necesita poder entrar como soporte a un tenant suspendido
    // para resolver el motivo de la suspensión).
    if (tenantData?.estado_servicio === "suspendido") {
      const { data: rolReal } = await supabase
        .from("user_tenants")
        .select("roles(clave)")
        .eq("user_id", user.id)
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      const claveRol = (rolReal?.roles as unknown as { clave: string } | null)?.clave;

      if (claveRol !== "super_admin") {
        return NextResponse.redirect(new URL("/residencial-suspendido", request.url));
      }
    }

    if (tenantData && tenantData.onboarding_completado === false) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
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

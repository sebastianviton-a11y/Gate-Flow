import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@gateflow/supabase";
import { SELECT_MEMBRESIA_PANEL, destinoPanelAdmin } from "@/lib/acceso-panel";
import { RUTAS_SIEMPRE_PUBLICAS, RUTAS_SOLO_INVITADOS } from "@/lib/rutas-publicas";

// Qué rutas no exigen sesión y por qué: lib/rutas-publicas.ts.

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
      .select(SELECT_MEMBRESIA_PANEL)
      .eq("user_id", user.id)
      .eq("activo", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[GateFlow] middleware: no se pudo leer user_tenants:", { code: error.code, message: error.message });
    }

    // Solo super_admin y admin_residencial usan este panel. Un guardia
    // activo va a la app Guard (URL absoluta); cualquier otro caso va a
    // /sin-acceso (ver lib/acceso-panel.ts).
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

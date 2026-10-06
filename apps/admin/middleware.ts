import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@gateflow/supabase";
import { COOKIE_TENANT } from "@gateflow/auth/client";
import { SELECT_MEMBRESIA_PANEL, destinoDeDecision, resultadoPanel } from "@/lib/acceso-panel";
import { RUTAS_CUENTA, RUTAS_SIEMPRE_PUBLICAS, RUTAS_SOLO_INVITADOS } from "@/lib/rutas-publicas";

// Qué rutas no exigen sesión y por qué: lib/rutas-publicas.ts.

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const esSoloInvitados = RUTAS_SOLO_INVITADOS.some((path) => pathname.startsWith(path));
  const esSiemprePublica = RUTAS_SIEMPRE_PUBLICAS.some((path) => pathname.startsWith(path));
  const esPublica = esSoloInvitados || esSiemprePublica;
  const esRutaOnboarding = pathname.startsWith("/onboarding");
  const esRutaSuperadmin = pathname.startsWith("/superadmin");
  const esRutaCuenta = RUTAS_CUENTA.some((path) => pathname.startsWith(path));

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

  // Una sola consulta liviana trae rol, tenant y suscripción; el orden
  // de decisión (suspensión → suscripción → rol → onboarding) vive en
  // @gateflow/auth (acceso.ts). También cubre /onboarding: con el trial
  // vencido el asistente no se puede usar. No aplica en rutas públicas,
  // /superadmin (su layout exige super_admin), /suscripcion ni
  // /seleccionar-residencial (las páginas deciden con la misma lógica:
  // sin bucles). El residencial es el de la cookie gf_tenant, validada
  // contra las membresías activas; nunca una fila arbitraria.
  // Falla cerrado: si la consulta falla o la membresía no se puede leer
  // completa, no se deja pasar a la ruta protegida.
  if (user && !esPublica && !esRutaSuperadmin && !esRutaCuenta) {
    const { data: filas, error } = await supabase
      .from("user_tenants")
      .select(SELECT_MEMBRESIA_PANEL)
      .eq("user_id", user.id)
      .eq("activo", true);

    if (error) {
      console.error("[GateFlow] middleware: no se pudo leer user_tenants:", { code: error.code, message: error.message });
    }

    // Solo super_admin y admin_residencial usan este panel. Un guardia
    // activo va a la app Guard (URL absoluta); cualquier otro caso va a
    // /sin-acceso (ver lib/acceso-panel.ts).
    const { decision } = resultadoPanel(error, filas, request.cookies.get(COOKIE_TENANT)?.value);
    const destino = destinoDeDecision(decision);
    if (destino && !(destino === "/onboarding" && esRutaOnboarding)) {
      const redireccion = NextResponse.redirect(new URL(destino, request.url));
      // gf_tenant sin membresía activa: falla cerrado y se borra.
      if (decision.tipo === "seleccionar_residencial" && decision.limpiarCookie) {
        redireccion.cookies.delete(COOKIE_TENANT);
      }
      return redireccion;
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

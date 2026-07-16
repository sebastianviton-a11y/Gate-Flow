import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@gateflow/supabase";

const PUBLIC_PATHS = ["/login"];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Sin sesión + ruta protegida → login, conservando a dónde iba (BR-01/BR-02:
  // ninguna ruta protegida se sirve sin que el usuario esté autenticado en un tenant).
  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Con sesión activa, /login redirige directo al dashboard.
  if (user && isPublicPath) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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

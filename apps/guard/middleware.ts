import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@gateflow/supabase";

const PUBLIC_PATHS = ["/login"];

/**
 * Mismo patrón que apps/admin/middleware.ts — la lógica de refresco de
 * sesión vive en @gateflow/supabase (compartida), lo único que difiere
 * por app es a dónde redirige y qué considera "público". La verificación
 * de ROL (guardia/admin/super_admin vs. residente) no ocurre aquí, sino
 * en app/guard/layout.tsx — mantiene el middleware liviano (corre en el
 * edge en cada request) y deja la consulta a `user_tenants` en el server
 * component del layout, que ya la necesita para renderizar la sesión.
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isPublicPath) {
    return NextResponse.redirect(new URL("/guard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

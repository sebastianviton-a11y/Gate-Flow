import "server-only";
import { redirect } from "next/navigation";
import type { RoleKey, SessionContext } from "@gateflow/types";

/**
 * Hallazgo de la revisión de ingeniería: antes, restringir un ítem de
 * navegación por rol (nav-items.ts) solo ocultaba el link — no impedía
 * que alguien accediera directamente a la URL. La UI nunca es un
 * mecanismo de autorización real (CLAUDE.md §11: "ninguna verificación de
 * tenant/rol se re-implementa en código de aplicación como sustituto de
 * RLS"). Para rutas de página completas (no filas de datos, que ya están
 * cubiertas por RLS), se necesita este guard explícito del lado del
 * servidor.
 *
 * Nota: esto NO sustituye RLS para los datos — sustituye la ausencia total
 * de verificación que había para el *acceso a la página* en sí.
 */
export function requireRole(session: SessionContext, allowed: RoleKey[]) {
  if (!allowed.includes(session.role)) {
    redirect("/dashboard");
  }
}

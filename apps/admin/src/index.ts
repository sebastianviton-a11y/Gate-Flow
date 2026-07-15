/**
 * apps/admin — Panel administrativo (Next.js, cloud-first).
 *
 * Esqueleto de S0-03: proyecto vacío, sin páginas ni componentes de
 * negocio. Este archivo solo confirma que la app puede consumir
 * casos de uso de `application`, consistente con la regla
 * "UI solo consume casos de uso".
 *
 * El scaffolding real de Next.js (App Router, layout, páginas) no
 * forma parte de S0-03.
 */

import { applicationLayer } from "../../../packages/application/src/index";

export const appName = "admin" as const;
export const dependsOn = [applicationLayer] as const;

/**
 * apps/guard — PWA local-first para guardias de seguridad.
 *
 * Esqueleto de S0-03: proyecto vacío, sin pantallas, sin lógica
 * offline todavía (eso llega con `packages/sync` en S0-18) y sin
 * manifest/service worker todavía (eso corresponde a S0-17). Este
 * archivo solo confirma que la app puede consumir casos de uso de
 * `application`, consistente con la regla "UI solo consume casos de
 * uso".
 */

import { applicationLayer } from "../../../packages/application/src/index";

export const appName = "guard" as const;
export const dependsOn = [applicationLayer] as const;

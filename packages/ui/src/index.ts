/**
 * packages/ui — Componentes de interfaz reutilizables (S0-03, esqueleto).
 *
 * Consumido por apps/admin y apps/guard. Regla explícita de S0-03:
 * "UI solo consume casos de uso" — por lo tanto este paquete puede
 * importar de `application`, pero NO de `infrastructure` ni
 * directamente de `domain`.
 *
 * Este archivo es solo el punto de entrada del esqueleto; no contiene
 * componentes reales todavía.
 */

import { applicationLayer } from "../../application/src/index";

export const uiLayer = "ui" as const;

/**
 * Prueba de humo (S0-03): confirma que `ui` sí puede importar de
 * `application`.
 */
export const dependsOn = [applicationLayer] as const;

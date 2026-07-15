/**
 * packages/application — Capa de Aplicación (S0-03, esqueleto).
 *
 * Casos de uso que orquestan el dominio (ej. "registrar recepción de
 * paquete"). Puede importar de `domain`. No debe importar de
 * `infrastructure`, `ui` ni de ninguna app (CLAUDE.md §6).
 *
 * Este archivo es solo el punto de entrada del esqueleto; no contiene
 * casos de uso reales todavía.
 */

import { domainLayer } from "../../domain/src/index";

export const applicationLayer = "application" as const;

/**
 * Prueba de humo (S0-03): confirma que `application` sí puede
 * importar de `domain`, tal como exige la dirección de dependencias
 * aprobada (Domain → Application → Infrastructure → UI).
 */
export const dependsOn = [domainLayer] as const;

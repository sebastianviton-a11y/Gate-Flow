/**
 * packages/config — Configuración compartida (S0-03, esqueleto).
 *
 * Contiene la configuración base de TypeScript
 * (`tsconfig.base.json`, S0-02). La configuración de ESLint y
 * Prettier se añade en S0-04.
 *
 * Es infraestructura de build, no código de producción: no debe ser
 * importado por domain, application, infrastructure ni ui.
 */

export const configLayer = "config" as const;

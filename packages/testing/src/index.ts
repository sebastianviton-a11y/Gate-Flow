/**
 * packages/testing — Utilidades y fixtures compartidas para pruebas
 * (S0-03, esqueleto).
 *
 * Ej. builder de un tenant de prueba, para no duplicar setup de
 * pruebas entre paquetes. Se usa solo desde código de pruebas, nunca
 * desde código de producción.
 *
 * Este archivo es solo el punto de entrada del esqueleto; no contiene
 * utilidades todavía (se completa junto con S0-09).
 */

export const testingLayer = "testing" as const;

/**
 * packages/infrastructure — Capa de Infraestructura (S0-03, esqueleto).
 *
 * Adaptadores concretos: Postgres/Supabase, cliente de sincronización,
 * cliente de WhatsApp, almacenamiento de archivos, logging y manejo
 * de errores compartido. Puede importar de `application` y de
 * `domain`. No debe ser importada por `domain` ni por `application`
 * (CLAUDE.md §6).
 *
 * Este archivo es solo el punto de entrada del esqueleto; no contiene
 * adaptadores reales todavía (el cliente base de Supabase se añade en
 * S0-14/S0-15; no se instala ningún SDK en este sprint).
 */

import { domainLayer } from "../../domain/src/index";
import { applicationLayer } from "../../application/src/index";

export const infrastructureLayer = "infrastructure" as const;

/**
 * Prueba de humo (S0-03): confirma que `infrastructure` sí puede
 * importar de `application` y de `domain`.
 */
export const dependsOn = [domainLayer, applicationLayer] as const;

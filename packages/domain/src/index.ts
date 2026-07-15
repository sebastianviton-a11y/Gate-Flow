/**
 * packages/domain — Capa de Dominio (S0-03, esqueleto).
 *
 * Reglas de negocio puras (BR-XX). No conoce Supabase, PowerSync,
 * WhatsApp ni el framework de UI (CLAUDE.md §6).
 *
 * Regla de dependencias: domain NO importa de ningún otro paquete de
 * GateFlow (ni application, ni infrastructure, ni ui, ni las apps).
 * Es la base de la cadena Domain → Application → Infrastructure → UI.
 *
 * Este archivo es solo el punto de entrada del esqueleto; no contiene
 * lógica de negocio (eso comienza en Sprint 1).
 */

export const domainLayer = "domain" as const;

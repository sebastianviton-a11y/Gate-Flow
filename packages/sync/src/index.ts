/**
 * packages/sync — Contrato de sincronización offline (S0-03, esqueleto).
 *
 * Interfaz que `apps/guard` y `packages/infrastructure` usarán para
 * hablar de sincronización, sin depender de una implementación real
 * de PowerSync. Ver CLAUDE.md §12 y §4 (D-06: no se instala el SDK
 * de PowerSync en Sprint 0).
 *
 * Este archivo es solo el punto de entrada del esqueleto; el contrato
 * real (SyncQueueItem, SyncStatus, ConflictResolutionStrategy) se
 * define en la tarea S0-18.
 */

export const syncLayer = "sync" as const;

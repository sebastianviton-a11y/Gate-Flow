/**
 * Punto de entrada client-safe de @gateflow/auth.
 *
 * Corrige un error real de build en Netlify (Next.js 14): el barrel
 * principal (./index.ts) re-exporta get-session.ts y require-role.ts,
 * ambos marcados `import "server-only"`. Cuando un Client Component
 * importaba CUALQUIER cosa desde "@gateflow/auth" — incluso algo tan
 * inocente como ROLE_LABELS — Next.js rastreaba el grafo completo del
 * barrel, encontraba el código server-only, y abortaba la compilación
 * aunque el componente nunca usara esas funciones directamente.
 *
 * Este archivo expone únicamente lo que es seguro incluir en un bundle
 * de cliente: constantes y funciones puras de packages/auth/src/roles.ts,
 * sin ninguna dependencia de next/headers ni de Supabase server-side.
 * Ningún Client Component debe importar desde "@gateflow/auth" a secas
 * — siempre desde "@gateflow/auth/client".
 */
export { ROLE_LABELS, ROLES_PANEL_ADMIN, puedeUsarPanelAdmin, canAccessConfiguracion, canAccessUsuarios } from "./roles";
export {
  SELECT_MEMBRESIA_ACCESO,
  ROLES_APP_GUARD,
  estadoEfectivoSuscripcion,
  suscripcionOperativa,
  avisoTrial,
  avisoPago,
  finGraciaPago,
  DIAS_GRACIA_PAGO,
  resolverAcceso,
  puedeOperar,
  type EstadoEfectivoSuscripcion,
  type DatosSuscripcion,
  type AvisoTrial,
  type NivelAvisoTrial,
  type AvisoPago,
  type NivelAvisoPago,
  type MembresiaAcceso,
  type DecisionAcceso,
  type AppAcceso,
} from "./acceso";
export {
  COOKIE_TENANT,
  RUTA_SELECCIONAR_RESIDENCIAL,
  SELECT_MEMBRESIAS_ACCESO,
  opcionesCookieTenant,
  opcionesSeleccion,
  rolDeFila,
  nombreTenantDeFila,
  seleccionarMembresia,
  resolverAccesoUsuario,
  resultadoEleccionAdmin,
  resultadoEleccionGuard,
  type FilaMembresia,
  type SeleccionMembresia,
  type DecisionAccesoUsuario,
  type ResultadoAccesoUsuario,
} from "./membresias";

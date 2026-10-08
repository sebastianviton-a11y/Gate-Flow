/**
 * Contratación paga según el país del residencial (tenants.pais, que se
 * elige explícitamente en /registro y la API no puede cambiar).
 *
 *   MX  Stripe en MXN: el flujo actual, sin cambios.
 *   AR  prueba gratuita de 30 días sin tarjeta y SIN contratación paga
 *       hasta que se habilite su medio de cobro: ni checkout (servidor)
 *       ni planes ni botones de pago (interfaz).
 *
 * Solo se bloquea Argentina: cualquier otro valor conserva el
 * comportamiento actual (tenants.pais es NOT NULL default 'MX').
 */
export const PAISES_SIN_CONTRATACION: readonly string[] = ["AR"];

export function contratacionHabilitada(pais: string | null | undefined): boolean {
  return !PAISES_SIN_CONTRATACION.includes((pais ?? "").trim().toUpperCase());
}

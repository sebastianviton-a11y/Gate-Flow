/**
 * Preferencias de ayuda guardadas SOLO en este navegador (localStorage):
 * qué guías ya se cerraron y si se ocultó «Primeros pasos». No se guarda
 * ningún dato del residencial, solo una marca. Si el navegador no permite
 * guardar (modo privado, almacenamiento bloqueado), todo sigue
 * funcionando: la guía queda cerrada y se abre con «Cómo funciona».
 */
export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

const PREFIJO = "gf:ayuda";

/** Una guía cerrada se recuerda por usuario y versión (si su texto cambia, se sube la versión y vuelve a mostrarse una vez). */
export function claveGuiaVista(guia: string, version: number, usuarioId: string): string {
  return `${PREFIJO}:guia:${guia}:v${version}:${usuarioId}`;
}

/** «Primeros pasos» oculto: por usuario y por residencial (cada residencial tiene su propio avance). */
export function clavePrimerosPasosOculto(usuarioId: string, tenantId: string): string {
  return `${PREFIJO}:primeros-pasos-oculto:v1:${usuarioId}:${tenantId}`;
}

export function almacenDelNavegador(): Almacen | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function leerMarca(almacen: Almacen | null, clave: string): boolean {
  try {
    return almacen?.getItem(clave) === "1";
  } catch {
    return false;
  }
}

export function guardarMarca(almacen: Almacen | null, clave: string, activa: boolean): void {
  try {
    if (!almacen) return;
    if (activa) almacen.setItem(clave, "1");
    else almacen.removeItem(clave);
  } catch {
    // Sin almacenamiento disponible: la preferencia dura solo esta visita.
  }
}

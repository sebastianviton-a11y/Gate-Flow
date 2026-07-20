/**
 * @gateflow/types
 *
 * Tipos de dominio compartidos entre apps del monorepo GateFlow.
 * Fuente de verdad: 03-DATABASE.md y 01-BUSINESS_RULES.md.
 *
 * No se define aquí ninguna regla de negocio nueva — únicamente se tipa
 * lo ya aprobado en la documentación. Cualquier cambio a estos tipos que
 * implique una nueva regla debe reflejarse primero en 01-BUSINESS_RULES.md.
 */

// ─────────────────────────────────────────────────────────────────────────
// Núcleo de plataforma
// ─────────────────────────────────────────────────────────────────────────

export type RoleKey = "super_admin" | "admin_residencial" | "guardia" | "residente";

export interface Role {
  id: string;
  clave: RoleKey;
  nombre: string;
  descripcion?: string | null;
}

export interface Tenant {
  id: string;
  nombre: string;
  tipo: "residencial" | "condominio" | "urbanizacion";
  plan: "trial" | "basico" | "pro" | "enterprise";
  activo: boolean;
}

export interface UserProfile {
  id: string;
  nombreCompleto: string;
  telefono?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  activo: boolean;
}

/**
 * Sesión resuelta: usuario + tenant activo + rol en ese tenant.
 * Es el equivalente en la app a los claims (`tenant_id`, `role`) inyectados
 * en el JWT vía Auth Hook (02-ARCHITECTURE.md §12).
 */
export interface SessionContext {
  user: UserProfile;
  tenant: Tenant;
  role: RoleKey;
  /** Tenants adicionales a los que el usuario pertenece, para el selector de tenant. */
  availableTenants: Tenant[];
  /**
   * true si esta sesión es un fallback de demostración (Sprint 01), no una
   * resolución real contra `user_tenants`. Debe ser visible en la UI —
   * nunca ocultarse — hasta que se elimine en Sprint 02.
   */
  isDemo: boolean;
  /** Motivo del fallback, solo presente cuando isDemo === true. */
  demoReason?: "schema_not_migrated" | "no_membership_row" | "unexpected_error";
}

export type UnidadTipo = "casa" | "departamento";

export interface Unidad {
  id: string;
  tenantId: string;
  tipo: UnidadTipo;
  identificador: string;
  activo: boolean;
}

export type TipoRelacionResidente = "propietario" | "inquilino" | "familiar" | "autorizado";

export interface Residente {
  id: string;
  userId: string;
  nombreCompleto: string;
  telefono?: string | null;
  unidadId: string;
  unidadIdentificador: string;
  tipoRelacion: TipoRelacionResidente;
  vigente: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Módulo Paquetes
// ─────────────────────────────────────────────────────────────────────────

/** Estados válidos del ciclo de vida de un paquete (BR-16). */
export type EstadoPaquete =
  | "pendiente"
  | "recibido"
  | "notificado"
  | "entregado"
  | "rechazado"
  | "devuelto";

export type TamanoPaqueteClave = "pequeno" | "mediano" | "grande" | "extra_grande";

export type PrioridadPaqueteClave =
  | "normal"
  | "urgente"
  | "medicamento"
  | "documento"
  | "perecedero"
  | "confidencial";

export interface Paquete {
  id: string;
  codigoGateflow: string;
  tenantId: string;
  unidadId: string;
  unidadIdentificador: string;
  residenteId?: string | null;
  residenteNombre?: string | null;
  residenteTelefono?: string | null;
  contactoTelefono?: string | null;
  remitente?: string | null;
  empresaPaqueteria?: string | null;
  estado: EstadoPaquete;
  tamano?: TamanoPaqueteClave | null;
  prioridad?: PrioridadPaqueteClave | null;
  ubicacionId?: string | null;
  ubicacionDescripcion?: string | null;
  numeroGuia?: string | null;
  notas?: string | null;
  recibidoPor?: string | null;
  recibidoPorNombre?: string | null;
  entregadoPor?: string | null;
  entregadoPorNombre?: string | null;
  entregadoANombre?: string | null;
  fechaRecepcion: string;
  fechaEntrega?: string | null;
  pickupToken?: string | null;
}

/** Filtros aceptados por el listado de paquetes (apps/admin) y por las
 * búsquedas operativas (apps/guard). No todos los campos aplican en
 * ambos contextos — cada app usa el subconjunto que necesita. */
export interface PaqueteFiltros {
  tenantId: string;
  estado?: EstadoPaquete[];
  prioridad?: PrioridadPaqueteClave[];
  unidadId?: string;
  ubicacionId?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  texto?: string;
  pagina?: number;
  porPagina?: number;
  ordenarPor?: "fecha_recepcion" | "fecha_entrega";
  orden?: "asc" | "desc";
}

export interface PaqueteHistorialEvento {
  id: string;
  paqueteId: string;
  estadoAnteriorId: EstadoPaquete | null;
  estadoNuevoId: EstadoPaquete;
  usuarioNombre: string;
  notas?: string | null;
  creadoEn: string;
}

export interface RegistrarPaqueteInput {
  tenantId: string;
  unidadId: string;
  residenteId?: string | null;
  remitente?: string | null;
  empresaPaqueteriaId?: string | null;
  numeroGuia?: string | null;
  tamanoId?: string | null;
  prioridadId?: string | null;
  ubicacionId: string;
  notas?: string | null;
  recibidoPor: string;
  /** Usados para crear la notificación cuando no hay residente_id formal
   * (caso común: contacto importado sin cuenta de Auth todavía). */
  destinatarioNombre?: string | null;
  destinatarioTelefono?: string | null;
}

export interface EntregarPaqueteInput {
  paqueteId: string;
  entregadoPor: string;
  entregadoANombre: string;
}

/** Resultado de buscar una unidad (para el paso de selección en el
 * registro de paquete) — incluye a sus residentes vigentes (con cuenta
 * formal) y, cuando no hay ninguno, el contacto informal capturado en
 * la importación masiva (sin cuenta de Supabase Auth todavía). */
export interface UnidadConResidentes {
  id: string;
  identificador: string;
  residentes: { id: string; nombreCompleto: string }[];
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
}

export interface FotografiaPaquete {
  id: string;
  tipo: "recepcion" | "entrega" | "evidencia_dano";
  url: string;
  tomadaPorNombre?: string | null;
  creadoEn: string;
}

export type TipoIncidencia =
  | "danado"
  | "abierto"
  | "mojado"
  | "etiqueta_ilegible"
  | "destinatario_desconocido"
  | "rechazado"
  | "devuelto"
  | "extraviado";

export type EstadoIncidencia = "abierta" | "en_seguimiento" | "resuelta";

export interface Incidencia {
  id: string;
  tenantId: string;
  paqueteId: string;
  paqueteCodigoGateflow: string;
  tipo: TipoIncidencia;
  estado: EstadoIncidencia;
  descripcion?: string | null;
  creadaEn: string;
}

// ─────────────────────────────────────────────────────────────────────────
// UI / Navegación (no es dominio de negocio, pero se comparte entre capas)
// ─────────────────────────────────────────────────────────────────────────

export interface NavItem {
  href: string;
  label: string;
  /** Nombre del icono de lucide-react, resuelto en la capa de UI. */
  icon: string;
  /** Roles que pueden ver este ítem. Vacío = visible para todos los roles autenticados. */
  roles?: RoleKey[];
}

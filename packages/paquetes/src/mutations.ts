import type { SupabaseClient } from "@supabase/supabase-js";
import type { Paquete, RegistrarPaqueteInput, EntregarPaqueteInput } from "@gateflow/types";
import { obtenerPaquetePorId } from "./queries";

export interface FilaImportarUnidad {
  tipo: "casa" | "departamento";
  identificador: string;
  contactoNombre?: string;
  contactoTelefono?: string;
}

export interface ResultadoImportacion {
  creadas: number;
  omitidas: { identificador: string; motivo: string }[];
}

export interface ActualizarUnidadInput {
  tipo: "casa" | "departamento";
  identificador: string;
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  contactoTelefonoSecundario?: string | null;
  contactoEmail?: string | null;
  notas?: string | null;
  activo: boolean;
}

/**
 * Actualiza una unidad existente — nunca crea una nueva fila ni cambia
 * su id. Los campos opcionales se guardan como `null` cuando llegan
 * vacíos, nunca como texto "N/A" o similar (punto 3 de la
 * especificación) — `?.trim() || null` ya es la convención que usa
 * agregar-manual.tsx, se mantiene aquí exactamente igual.
 */
export async function actualizarUnidad(supabase: SupabaseClient, unidadId: string, input: ActualizarUnidadInput): Promise<void> {
  const { error } = await supabase
    .from("unidades")
    .update({
      tipo: input.tipo,
      identificador: input.identificador.trim(),
      contacto_nombre: input.contactoNombre?.trim() || null,
      contacto_telefono: input.contactoTelefono?.trim() || null,
      contacto_telefono_secundario: input.contactoTelefonoSecundario?.trim() || null,
      contacto_email: input.contactoEmail?.trim() || null,
      notas: input.notas?.trim() || null,
      activo: input.activo,
    })
    .eq("id", unidadId);
  if (error) throw error;
}

export interface UnidadDuplicada {
  id: string;
  identificador: string;
  campoCoincidente: "contacto_telefono" | "contacto_telefono_secundario" | "contacto_email";
}

/**
 * Advertencia, no bloqueo (punto 7 de la especificación): antes de
 * guardar, se avisa si otra unidad ya usa el mismo teléfono o correo —
 * pero nunca impide guardar, y siempre excluye la propia unidad que se
 * está editando (para no "detectarse a sí misma" como duplicado).
 */
export async function buscarUnidadesDuplicadas(
  supabase: SupabaseClient,
  tenantId: string,
  datos: { contactoTelefono?: string | null; contactoTelefonoSecundario?: string | null; contactoEmail?: string | null },
  excluirUnidadId: string,
): Promise<UnidadDuplicada[]> {
  const valores = [datos.contactoTelefono, datos.contactoTelefonoSecundario, datos.contactoEmail].filter(
    (v): v is string => !!v && v.trim().length > 0,
  );
  if (valores.length === 0) return [];

  const { data, error } = await supabase
    .from("unidades")
    .select("id, identificador, contacto_telefono, contacto_telefono_secundario, contacto_email")
    .eq("tenant_id", tenantId)
    .neq("id", excluirUnidadId)
    .or(
      [
        datos.contactoTelefono ? `contacto_telefono.eq.${datos.contactoTelefono}` : null,
        datos.contactoTelefonoSecundario ? `contacto_telefono_secundario.eq.${datos.contactoTelefonoSecundario}` : null,
        datos.contactoEmail ? `contacto_email.eq.${datos.contactoEmail}` : null,
      ]
        .filter(Boolean)
        .join(","),
    );
  if (error) throw error;

  const resultado: UnidadDuplicada[] = [];
  for (const fila of data ?? []) {
    if (datos.contactoTelefono && fila.contacto_telefono === datos.contactoTelefono) {
      resultado.push({ id: fila.id, identificador: fila.identificador, campoCoincidente: "contacto_telefono" });
    }
    if (datos.contactoTelefonoSecundario && fila.contacto_telefono_secundario === datos.contactoTelefonoSecundario) {
      resultado.push({ id: fila.id, identificador: fila.identificador, campoCoincidente: "contacto_telefono_secundario" });
    }
    if (datos.contactoEmail && fila.contacto_email === datos.contactoEmail) {
      resultado.push({ id: fila.id, identificador: fila.identificador, campoCoincidente: "contacto_email" });
    }
  }
  return resultado;
}

/**
 * Importa unidades en lote. No crea filas en `casas`/`departamentos`
 * (la ubicación por calle/manzana/edificio se administra por separado,
 * D0xx en DECISIONS.md) — solo `unidades`, que es lo único que el
 * módulo de Paquetes necesita para operar. `tenant_id` viene siempre
 * del parámetro de sesión del servidor, nunca de una columna del
 * archivo (SECURITY_ARCHITECTURE.md §8).
 */
export async function importarUnidadesMasivo(
  supabase: SupabaseClient,
  tenantId: string,
  filas: FilaImportarUnidad[],
): Promise<ResultadoImportacion> {
  const omitidas: ResultadoImportacion["omitidas"] = [];
  let creadas = 0;

  // Insert fila por fila (no en un solo batch) para poder reportar
  // exactamente cuál identificador falló y por qué — un batch insert
  // que falla completo por una sola fila duplicada sería una peor
  // experiencia para quien está importando 100 filas.
  for (const fila of filas) {
    const { error } = await supabase.from("unidades").insert({
      tenant_id: tenantId,
      tipo: fila.tipo,
      identificador: fila.identificador,
      contacto_nombre: fila.contactoNombre || null,
      contacto_telefono: fila.contactoTelefono || null,
    });

    if (error) {
      const motivo = error.code === "23505" ? "Ya existe una unidad con ese identificador." : error.message;
      omitidas.push({ identificador: fila.identificador, motivo });
    } else {
      creadas++;
    }
  }

  return { creadas, omitidas };
}

export interface ResultadoRegistro {
  paquete: Paquete;
  notificacion: { destinatario: string; canal: "whatsapp" } | null;
}

/**
 * Registra la recepción de un paquete. NO calcula ni envía el código
 * GateFlow — la columna `codigo_gateflow` tiene `DEFAULT
 * generar_codigo_gateflow()` (migración Sprint 02), así que un INSERT
 * simple ya obtiene un código único garantizado por la base de datos
 * (BR-11, BR-12: "no depender del frontend para garantizar unicidad").
 *
 * También crea la notificación (BR-30: registrar un paquete dispara
 * notificación automática). No hay proveedor de WhatsApp conectado
 * todavía (SECURITY_ARCHITECTURE.md, MVP_CHECKLIST.md) — la fila queda
 * en `estado_envio = 'pendiente'`, dato real, no una simulación de que
 * "ya se envió" cuando no es cierto.
 */
export async function registrarPaquete(supabase: SupabaseClient, input: RegistrarPaqueteInput): Promise<ResultadoRegistro> {
  const { data, error } = await supabase
    .from("paquetes")
    .insert({
      tenant_id: input.tenantId,
      unidad_id: input.unidadId,
      residente_id: input.residenteId ?? null,
      remitente: input.remitente ?? null,
      empresa_paqueteria_id: input.empresaPaqueteriaId ?? null,
      numero_guia: input.numeroGuia ?? null,
      tamano_id: input.tamanoId ?? null,
      prioridad_id: input.prioridadId ?? null,
      ubicacion_id: input.ubicacionId,
      notas: input.notas ?? null,
      recibido_por: input.recibidoPor,
      estado_id: "recibido",
    })
    .select("id")
    .single();

  if (error) throw error;

  const paquete = await obtenerPaquetePorId(supabase, data.id);
  if (!paquete) throw new Error("El paquete se creó pero no se pudo releer — revisar RLS de SELECT.");

  let notificacion: ResultadoRegistro["notificacion"] = null;
  const destinatarioNombre = paquete.residenteNombre ?? input.destinatarioNombre ?? null;

  if (destinatarioNombre) {
    const { error: errorNotif } = await supabase.from("notificaciones").insert({
      tenant_id: input.tenantId,
      paquete_id: paquete.id,
      destinatario_user_id: input.residenteId ?? null,
      destinatario_nombre: input.residenteId ? null : destinatarioNombre,
      destinatario_telefono: input.residenteId ? null : (input.destinatarioTelefono ?? null),
      canal: "whatsapp",
      plantilla: "paquete_recibido",
      contenido: `Hola ${destinatarioNombre}, tu paquete con código ${paquete.codigoGateflow} llegó a portería.`,
      estado_envio: "pendiente",
    });
    // Un fallo al crear la notificación no debe hacer fallar el registro
    // del paquete, que ya es un hecho consumado (BR-32).
    if (!errorNotif) notificacion = { destinatario: destinatarioNombre, canal: "whatsapp" };
  }

  return { paquete, notificacion };
}

export interface GuardarFirmaInput {
  tenantId: string;
  paqueteId: string;
  firmaData: string;
  firmanteNombre: string;
}

/**
 * Guarda la firma ANTES de llamar a entregar_paquete() — si esto falla,
 * nunca se intenta la transición de estado, así que no puede existir una
 * entrega sin evidencia (BR-27). Las firmas nunca se editan ni se
 * eliminan (BR-28) — esta función solo inserta.
 */
export async function guardarFirmaEntrega(supabase: SupabaseClient, input: GuardarFirmaInput): Promise<void> {
  const { error } = await supabase.from("paquete_firmas").insert({
    tenant_id: input.tenantId,
    paquete_id: input.paqueteId,
    tipo: "entrega_residente",
    firma_data: input.firmaData,
    firmante_nombre: input.firmanteNombre,
  });
  if (error) throw error;
}

export interface SubirFotografiaInput {
  tenantId: string;
  paqueteId: string;
  tipo: "recepcion" | "entrega" | "evidencia_dano";
  archivo: File;
  tomadaPor: string;
}

/**
 * Sube una fotografía al bucket privado `evidencia` (migración 12) y
 * registra la fila en paquete_fotografias. La ruta SIEMPRE empieza con
 * el tenant_id — es la convención de la que dependen las policies de
 * storage.objects (evidencia_select_propio_tenant /
 * evidencia_insert_propio_tenant), no una decisión cosmética.
 */
export async function subirFotografiaPaquete(supabase: SupabaseClient, input: SubirFotografiaInput): Promise<void> {
  const extension = input.archivo.name.split(".").pop() ?? "jpg";
  const nombreArchivo = `${crypto.randomUUID()}.${extension}`;
  const path = `${input.tenantId}/${input.paqueteId}/${nombreArchivo}`;

  const { error: errorSubida } = await supabase.storage.from("evidencia").upload(path, input.archivo, {
    contentType: input.archivo.type || "image/jpeg",
    upsert: false,
  });
  if (errorSubida) throw errorSubida;

  const { error: errorInsert } = await supabase.from("paquete_fotografias").insert({
    tenant_id: input.tenantId,
    paquete_id: input.paqueteId,
    tipo: input.tipo,
    storage_path: path,
    tomada_por: input.tomadaPor,
  });
  if (errorInsert) throw errorInsert;
}

/**
 * Entrega un paquete. Delega en la función `entregar_paquete()` de
 * Postgres (migración Sprint 02), que usa `SELECT ... FOR UPDATE` para
 * serializar intentos concurrentes y rechaza explícitamente un paquete
 * ya entregado (BR-14) — esta capa NO reimplementa esa verificación en
 * TypeScript, porque una verificación en el cliente antes del UPDATE es
 * exactamente la condición de carrera que se busca evitar.
 */
export async function entregarPaquete(supabase: SupabaseClient, input: EntregarPaqueteInput): Promise<Paquete> {
  const { data, error } = await supabase.rpc("entregar_paquete", {
    p_paquete_id: input.paqueteId,
    p_entregado_por: input.entregadoPor,
    p_entregado_a_nombre: input.entregadoANombre,
  });

  if (error) {
    // El mensaje de "ya fue entregado" viene tal cual de la función SQL
    // (RAISE EXCEPTION) — se propaga sin reinterpretar para no perder
    // la razón exacta del rechazo.
    throw error;
  }

  const paquete = await obtenerPaquetePorId(supabase, input.paqueteId);
  if (!paquete) throw new Error("No se pudo releer el paquete tras la entrega.");
  return paquete;
}

import { createAnonServerClient } from "@gateflow/supabase";
import { GateFlowLogo, WHATSAPP_SOPORTE_VISIBLE, enlaceWhatsAppSoporte } from "@gateflow/ui";
import { DOCUMENTOS_REGISTRO, documentosMostrados, type DocumentoAceptable, type FilaVigente } from "@/lib/legal/aceptacion";
import { esEntornoDePruebas, urlPublicaAdmin } from "@/lib/entorno";
import { configuracionAntibot, motivoRegistroCerrado } from "@/lib/registro/antibot";
import { emitirTokenTiempo } from "@/lib/registro/hash";
import { paisesHabilitados, type PaisRegistro } from "@/lib/registro/validacion";
import { RegistroForm } from "./registro-form";

// El token de tiempo se firma por petición: nunca se puede cachear. Los
// documentos vigentes tampoco: el cliente anónimo no usa cookies y, sin
// force-no-store, Next guardaría la RPC en su caché de datos.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * /registro — alta pública con trial de 30 días (Admin es la única app
 * con la clave secreta, por eso vive aquí y no en la landing).
 * Pública solo para quien no tiene sesión (middleware).
 */
/**
 * Versiones vigentes que el formulario muestra y envía (una lectura por
 * país habilitado). Si no se pueden leer, la lista queda vacía: la RPC
 * del alta rechaza el registro si algún documento es obligatorio.
 */
async function documentosPorPais(paises: readonly PaisRegistro[]): Promise<Partial<Record<PaisRegistro, DocumentoAceptable[]>>> {
  const cliente = createAnonServerClient();
  const pares = await Promise.all(
    paises.map(async (pais) => {
      const { data, error } = await cliente.rpc("documentos_legales_vigentes", { p_pais: pais });
      if (error) console.error(`[GateFlow] /registro: no se leyeron los documentos vigentes (${pais}): ${error.code ?? ""} ${error.message}`.trim());
      return [pais, error ? [] : documentosMostrados(data as FilaVigente[] | null, DOCUMENTOS_REGISTRO)] as const;
    }),
  );
  return Object.fromEntries(pares);
}

export default async function RegistroPage() {
  const pepper = process.env.REGISTRO_HASH_PEPPER;
  // Turnstile obligatorio con claves reales en el entorno de clientes.
  const antibot = configuracionAntibot(process.env);
  const urlAdmin = urlPublicaAdmin();
  const motivo = motivoRegistroCerrado(pepper, antibot, urlAdmin);
  if (!pepper || motivo) {
    // Sin el secreto o sin desafío anti-bot válido no hay antiabuso: el
    // formulario no se muestra. El log dice cuál falta (sin valores).
    console.error(`[GateFlow] /registro cerrado: ${motivo}`);
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
          <GateFlowLogo size={48} onDark />
          <p className="font-display text-lg font-semibold">El registro no está disponible por ahora</p>
          <p className="text-sm text-white/60">
            Inténtalo más tarde o escríbenos por WhatsApp al{" "}
            <a href={enlaceWhatsAppSoporte()} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {WHATSAPP_SOPORTE_VISIBLE}
            </a>
            .
          </p>
          {/* Solo en localhost, staging y previews: el código de lo que falta
              (nunca un valor) para que el equipo lo vea sin abrir los logs. */}
          {esEntornoDePruebas(urlAdmin) && (
            <p className="mt-2 rounded bg-white/10 px-2 py-1 font-mono text-xs text-white/70" data-testid="registro-cerrado-motivo">
              Entorno de pruebas · {motivo}
            </p>
          )}
        </div>
      </div>
    );
  }

  const paises = paisesHabilitados(process.env.REGISTRO_PAISES);
  return (
    <RegistroForm
      tokenTiempo={emitirTokenTiempo(pepper)}
      turnstileSiteKey={antibot.modo === "turnstile" ? antibot.siteKey : null}
      paises={paises}
      documentos={await documentosPorPais(paises)}
    />
  );
}

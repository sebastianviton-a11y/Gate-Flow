import { GateFlowLogo } from "@gateflow/ui";
import { configuracionAntibot } from "@/lib/registro/antibot";
import { emitirTokenTiempo } from "@/lib/registro/hash";
import { RegistroForm } from "./registro-form";

// El token de tiempo se firma por petición: nunca se puede cachear.
export const dynamic = "force-dynamic";

/**
 * /registro — alta pública con trial de 30 días (Admin es la única app
 * con la clave secreta, por eso vive aquí y no en la landing).
 * Pública solo para quien no tiene sesión (middleware).
 */
export default function RegistroPage() {
  const pepper = process.env.REGISTRO_HASH_PEPPER;
  // Turnstile obligatorio con claves reales en el entorno de clientes.
  const antibot = configuracionAntibot(process.env);
  if (!pepper || pepper.length < 16 || antibot.modo === "deshabilitado") {
    // Sin el secreto o sin desafío anti-bot válido no hay antiabuso: el formulario no se muestra.
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-white">
          <GateFlowLogo size={48} onDark />
          <p className="font-display text-lg font-semibold">El registro no está disponible por ahora</p>
          <p className="text-sm text-white/60">Inténtalo más tarde o escribe a soporte@gateflow.mx.</p>
        </div>
      </div>
    );
  }

  return <RegistroForm tokenTiempo={emitirTokenTiempo(pepper)} turnstileSiteKey={antibot.modo === "turnstile" ? antibot.siteKey : null} />;
}

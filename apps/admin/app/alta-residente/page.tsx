import type { Metadata } from "next";
import { configuracionAntibot } from "@/lib/registro/antibot";
import { AltaResidente } from "./alta-residente";

// Depende de la configuración del entorno (antibot): nunca se cachea.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registro de residentes",
  robots: { index: false, follow: false },
};

/**
 * /alta-residente#<token> — formulario público que el administrador
 * comparte en el grupo del residencial. Sin cuenta ni contraseña. El
 * token va después del # y lo lee el navegador; el servidor valida todo
 * (app/alta-residente/actions.ts).
 */
export default function AltaResidentePage() {
  const antibot = configuracionAntibot(process.env);
  return <AltaResidente turnstileSiteKey={antibot.modo === "turnstile" ? antibot.siteKey : null} />;
}

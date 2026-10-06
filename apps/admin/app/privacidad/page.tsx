import { AvisoStagingLegal } from "@/components/shared/aviso-staging-legal";

/**
 * /privacidad — Aviso de Privacidad. Ruta pública (lib/rutas-publicas.ts),
 * enlazada desde el checkbox de /registro junto a /terminos.
 *
 * PENDIENTE DE TEXTO LEGAL: el repositorio no contiene un Aviso de
 * Privacidad aprobado (SECURITY_ARCHITECTURE.md §7 y DECISIONS.md D008
 * lo dejan explícitamente para revisión legal). Igual que /terminos,
 * esta página es un marcador con la misma leyenda de referencia; no se
 * redactó texto legal nuevo.
 */
export default function PrivacidadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8 text-sm leading-relaxed">
      <AvisoStagingLegal />
      <h1 className="font-display text-xl font-semibold">Aviso de Privacidad de GateFlow</h1>
      <p className="text-muted-foreground">
        Texto de referencia — pendiente de reemplazar por el texto legal definitivo antes de comercializar. La aceptación de este documento
        queda registrada por usuario con fecha y hora en el momento de crear su cuenta.
      </p>
    </div>
  );
}

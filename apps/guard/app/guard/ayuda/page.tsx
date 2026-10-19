import { MessageCircle } from "lucide-react";
import { Button, WHATSAPP_SOPORTE_VISIBLE, enlaceWhatsAppSoporte } from "@gateflow/ui";
import { OperationalHeader } from "@/components/operational-header";
import { GUIAS_GUARD } from "@/lib/guias";

/** Ayuda de portería: las tres tareas del guardia y el contacto de soporte. */
export default function AyudaGuardPage() {
  return (
    <div className="flex h-full flex-col">
      <OperationalHeader title="Ayuda" />
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4">
        {Object.values(GUIAS_GUARD).map((guia) => (
          <section key={guia.clave} aria-label={guia.titulo} className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-base font-semibold">{guia.titulo}</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {guia.pasos.map((paso) => (
                <li key={paso}>{paso}</li>
              ))}
            </ol>
          </section>
        ))}
        <section aria-label="Contacto" className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-base font-semibold">¿Necesitas ayuda?</h2>
          <p className="text-sm text-muted-foreground">
            Escríbenos por WhatsApp: <span className="font-medium text-foreground">{WHATSAPP_SOPORTE_VISIBLE}</span>. Para cambios de usuarios o del
            residencial, habla con tu administrador.
          </p>
          <Button asChild className="min-h-touch w-full sm:w-auto">
            <a href={enlaceWhatsAppSoporte()} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Escribir por WhatsApp
            </a>
          </Button>
        </section>
      </div>
    </div>
  );
}

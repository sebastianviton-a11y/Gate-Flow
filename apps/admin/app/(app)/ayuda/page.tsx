import Link from "next/link";
import { CalendarClock, ChevronRight, ListChecks, MessageCircle } from "lucide-react";
import { getSessionContext } from "@gateflow/auth";
import { Button, MENSAJE_DEMO, WHATSAPP_SOPORTE_VISIBLE, enlaceWhatsAppSoporte } from "@gateflow/ui";
import { PageHeader } from "@/components/shared/page-header";
import { MostrarPrimerosPasos } from "@/components/ayuda/mostrar-primeros-pasos";
import { GUIAS_ADMIN, PROCESOS_AYUDA } from "@/lib/ayuda/guias";

const SECCIONES_GUIAS: ReadonlyArray<{ href: string; guia: keyof typeof GUIAS_ADMIN; nombre: string }> = [
  { href: "/unidades", guia: "unidades", nombre: "Unidades" },
  { href: "/residentes", guia: "residentes", nombre: "Residentes" },
  { href: "/usuarios", guia: "usuarios", nombre: "Usuarios" },
  { href: "/configuracion/bodega", guia: "bodega", nombre: "Bodega" },
  { href: "/paquetes", guia: "paquetes", nombre: "Paquetes" },
];

/**
 * Ayuda del panel: los procesos principales, las guías de cada sección
 * y el contacto. La demostración personal es opcional: todo se puede
 * configurar sin ella.
 */
export default async function AyudaPage() {
  const session = await getSessionContext();
  if (!session) return null;
  const configura = session.role === "admin_residencial" || session.role === "super_admin";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Ayuda" description="Guías breves para configurar y operar Gate Flow por tu cuenta." />

      {configura && (
        <section aria-labelledby="ayuda-empezar" className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 id="ayuda-empezar" className="flex items-center gap-2 font-display text-base font-semibold">
            <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" />
            Empieza aquí
          </h2>
          <p className="text-sm text-muted-foreground">
            El asistente te lleva paso a paso por residentes, guardias y bodega. Puedes salir cuando quieras y retomarlo: se abre donde quedaste y no
            borra nada de lo que ya configuraste.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/onboarding">Abrir la configuración guiada</Link>
            </Button>
            <MostrarPrimerosPasos usuarioId={session.user.id} tenantId={session.tenant.id} />
          </div>
        </section>
      )}

      <section aria-labelledby="ayuda-procesos" className="space-y-3">
        <h2 id="ayuda-procesos" className="font-display text-base font-semibold">
          Cómo funciona Gate Flow
        </h2>
        <ol className="space-y-3">
          {PROCESOS_AYUDA.map((proceso, i) => (
            <li key={proceso.titulo} className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">
                {i + 1}. {proceso.titulo}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{proceso.texto}</p>
              {proceso.href && proceso.enlace && (
                <Link href={proceso.href} className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {proceso.enlace}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="ayuda-guias" className="space-y-3">
        <h2 id="ayuda-guias" className="font-display text-base font-semibold">
          Guías de cada sección
        </h2>
        <p className="text-sm text-muted-foreground">
          Cada sección tiene una guía breve. Aparece sola la primera vez y siempre puedes volver a abrirla con «Cómo funciona», arriba de la pantalla.
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {SECCIONES_GUIAS.map(({ href, guia, nombre }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{nombre}</span>
                  <span className="block text-xs text-muted-foreground">{GUIAS_ADMIN[guia].titulo}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Los guardias tienen su propia ayuda en la app de portería (registrar, avisar por WhatsApp y entregar).
        </p>
      </section>

      <section aria-labelledby="ayuda-contacto" className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 id="ayuda-contacto" className="font-display text-base font-semibold">
          ¿Necesitas ayuda?
        </h2>
        <p className="text-sm text-muted-foreground">
          Soporte y ventas por WhatsApp: <span className="font-medium text-foreground">{WHATSAPP_SOPORTE_VISIBLE}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={enlaceWhatsAppSoporte()} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Escribir por WhatsApp
            </a>
          </Button>
        </div>
        <div className="border-t border-border pt-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
            Demostración personal (opcional)
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Si prefieres que te mostremos Gate Flow en una videollamada, agéndala por WhatsApp. No es necesaria: puedes configurar y usar todo por tu
            cuenta.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <a href={enlaceWhatsAppSoporte(MENSAJE_DEMO)} target="_blank" rel="noopener noreferrer">
              Pedir una demostración
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

import { Package, PackageCheck, Clock, TriangleAlert, Plus } from "lucide-react";
import Link from "next/link";
import { getSessionContext } from "@gateflow/auth";
import { createServerSupabaseClient } from "@gateflow/supabase";
import {
  obtenerResumenDashboard,
  obtenerVolumen30Dias,
  obtenerActividadReciente,
} from "@gateflow/paquetes";
import { Button } from "@gateflow/ui";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { PackagesChart } from "@/components/dashboard/packages-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";

export default async function DashboardPage() {
  const session = await getSessionContext();
  if (!session) return null;

  const supabase = createServerSupabaseClient();

  const [resumen, volumen, actividad] = await Promise.all([
    obtenerResumenDashboard(supabase, session.tenant.id),
    obtenerVolumen30Dias(supabase, session.tenant.id),
    obtenerActividadReciente(supabase, session.tenant.id),
  ]);

  const estadoOperativo =
    resumen.olvidados > 0
      ? { texto: `${resumen.olvidados} paquete${resumen.olvidados === 1 ? "" : "s"} requiere${resumen.olvidados === 1 ? "" : "n"} atención`, tono: "warn" as const }
      : resumen.pendientes > 10
        ? { texto: "Portería con carga alta hoy", tono: "warn" as const }
        : { texto: "Portería funcionando con normalidad", tono: "success" as const };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-1">
          <PageHeader title="Dashboard" description={session.tenant.nombre} />
          <div
            className={`flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              estadoOperativo.tono === "warn" ? "bg-warn/10 text-warn-foreground" : "bg-success/10 text-success"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${estadoOperativo.tono === "warn" ? "bg-warn" : "bg-success"}`} />
            {estadoOperativo.texto}
          </div>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href="/paquetes/nuevo">
            <Plus className="h-4 w-4" />
            Registrar paquete
          </Link>
        </Button>
      </div>

      {/* Alerta accionable, no una tarjeta más — solo aparece si hay algo
          que realmente requiere atención. Un dashboard "ejecutivo" no
          muestra "0 olvidados" con el mismo peso que "12 pendientes". */}
      {resumen.olvidados > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-foreground"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span>
            <strong>{resumen.olvidados}</strong> paquete{resumen.olvidados === 1 ? "" : "s"} lleva
            {resumen.olvidados === 1 ? "" : "n"} más de 5 días sin entregarse.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pendientes" value={resumen.pendientes} icon={Package} tone="warn" />
        <StatCard label="Recibidos hoy" value={resumen.recibidosHoy} icon={Package} />
        <StatCard label="Entregados hoy" value={resumen.entregadosHoy} icon={PackageCheck} tone="success" />
        <StatCard
          label="Tiempo promedio de entrega"
          value={resumen.horasPromedioEntrega30d !== null ? `${resumen.horasPromedioEntrega30d} h` : "—"}
          icon={Clock}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Actividad reciente primero — es lo que un administrador
            realmente revisa a diario. El gráfico de 30 días queda como
            contexto histórico, no como protagonista. */}
        <RecentActivity items={actividad} />
        <div className="lg:col-span-2">
          <PackagesChart data={volumen} />
        </div>
      </div>
    </div>
  );
}

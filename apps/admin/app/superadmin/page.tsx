import { TrendingUp, TrendingDown, Building, Building2, Users, Package, PackageCheck, ArrowRight } from "lucide-react";
import Link from "next/link";
import { createServerSupabaseClient } from "@gateflow/supabase";
import { obtenerMetricasGlobales } from "@gateflow/paquetes";

export default async function SuperAdminDashboardPage() {
  const supabase = createServerSupabaseClient();
  const m = await obtenerMetricasGlobales(supabase);

  const tarjetas = [
    { label: "Residenciales activos", valor: m.residencialesActivos, icon: Building2, tono: "success" },
    { label: "Residenciales piloto", valor: m.residencialesPiloto, icon: Building2, tono: "info" },
    { label: "Residenciales suspendidos", valor: m.residencialesSuspendidos, icon: Building2, tono: "destructive" },
    { label: "Total de residentes", valor: m.totalResidentes, icon: Users, tono: "default" },
    { label: "Total de usuarios", valor: m.totalUsuarios, icon: Users, tono: "default" },
    { label: "Total de paquetes registrados", valor: m.totalPaquetes, icon: Package, tono: "default" },
    { label: "Paquetes este mes", valor: m.paquetesEsteMes, icon: PackageCheck, tono: "default" },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Métricas globales de toda la plataforma GateFlow.</p>
        </div>
        <Link href="/superadmin/empresas" className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          <Building className="h-4 w-4" />
          Ver empresas
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tarjetas.map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t.label}</p>
              <t.icon
                className={`h-4 w-4 ${
                  t.tono === "success" ? "text-success" : t.tono === "destructive" ? "text-destructive" : t.tono === "info" ? "text-info" : "text-muted-foreground"
                }`}
              />
            </div>
            <p className="mt-1 font-display text-2xl font-semibold">{t.valor.toLocaleString("es-MX")}</p>
          </div>
        ))}

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Crecimiento mensual</p>
            {m.crecimientoMensual !== null &&
              (m.crecimientoMensual >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />)}
          </div>
          <p className="mt-1 font-display text-2xl font-semibold">
            {m.crecimientoMensual === null ? "—" : `${m.crecimientoMensual >= 0 ? "+" : ""}${m.crecimientoMensual.toFixed(1)}%`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m.crecimientoMensual === null ? "Sin datos del mes anterior para comparar." : "Paquetes registrados vs. el mes anterior."}
          </p>
        </div>
      </div>
    </div>
  );
}

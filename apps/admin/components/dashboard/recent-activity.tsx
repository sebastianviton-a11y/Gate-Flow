import { Card, CardContent, CardHeader, CardTitle, Separator } from "@gateflow/ui";
import type { ActividadRecienteItem } from "@gateflow/paquetes";

function hace(fechaISO: string): string {
  const minutos = Math.floor((Date.now() - new Date(fechaISO).getTime()) / 60_000);
  if (minutos < 1) return "justo ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

export function RecentActivity({ items }: { items: ActividadRecienteItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Actividad reciente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Sin actividad todavía.</p>}
        {items.map((item, index) => (
          <div key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm">{item.descripcion}</p>
                <span className="gf-code text-muted-foreground">{item.codigoGateflow}</span>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{hace(item.creadoEn)}</span>
            </div>
            {index < items.length - 1 && <Separator className="mt-3" />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { VolumenDiario } from "@gateflow/paquetes";
import { Card, CardContent, CardHeader, CardTitle } from "@gateflow/ui";

export function PackagesChart({ data }: { data: VolumenDiario[] }) {
  const puntos = data.map((d) => ({
    fecha: new Date(d.fecha).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
    recibidos: d.recibidosTotal,
    entregados: d.entregados,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Volumen de paquetes — últimos 30 días</CardTitle>
      </CardHeader>
      <CardContent className="h-72 pl-0">
        {puntos.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sin datos todavía — la vista de agregación se actualiza periódicamente (ver
            supabase/README.md).
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={puntos} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="recibidos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(178 70% 34%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(178 70% 34%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="entregados" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(222 47% 11%)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="hsl(222 47% 11%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 20% 91%)" vertical={false} />
              <XAxis dataKey="fecha" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(220 9% 46%)" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "hsl(220 9% 46%)" }} width={28} />
              <Tooltip contentStyle={{ borderRadius: 8, borderColor: "hsl(220 20% 91%)", fontSize: 12 }} />
              <Area type="monotone" dataKey="recibidos" name="Recibidos" stroke="hsl(178 70% 34%)" fill="url(#recibidos)" strokeWidth={2} />
              <Area type="monotone" dataKey="entregados" name="Entregados" stroke="hsl(222 47% 11%)" fill="url(#entregados)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

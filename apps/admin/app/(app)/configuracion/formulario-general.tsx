"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Input, Label } from "@gateflow/ui";
import { actualizarConfiguracionResidencial, type ConfiguracionResidencial } from "./actions";

interface Props {
  nombreInicial: string;
  configuracionInicial: ConfiguracionResidencial;
}

export function FormularioGeneral({ nombreInicial, configuracionInicial }: Props) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [logoUrl, setLogoUrl] = useState(configuracionInicial.logoUrl ?? "");
  const [horarioRecepcion, setHorarioRecepcion] = useState(configuracionInicial.horarioRecepcion ?? "");
  const [reglasBasicas, setReglasBasicas] = useState(configuracionInicial.reglasBasicas ?? "");

  const [pending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);

  function handleGuardar() {
    startTransition(async () => {
      await actualizarConfiguracionResidencial({
        nombre,
        configuracion: { logoUrl: logoUrl || undefined, horarioRecepcion: horarioRecepcion || undefined, reglasBasicas: reglasBasicas || undefined },
      });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    });
  }

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo del residencial" className="h-16 w-16 rounded-lg border border-border object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            Sin logo
          </div>
        )}
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="logoUrl">URL del logotipo</Label>
          <Input id="logoUrl" placeholder="https://…" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Por ahora se pega un enlace a una imagen ya alojada — la subida directa de archivo llega en una siguiente versión (ver MVP_CHECKLIST.md).
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre del residencial</Label>
        <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="horario">Horario de recepción de paquetes</Label>
        <Input
          id="horario"
          placeholder="Lunes a sábado, 8:00 a 20:00"
          value={horarioRecepcion}
          onChange={(e) => setHorarioRecepcion(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reglas">Reglas básicas para el equipo de portería</Label>
        <textarea
          id="reglas"
          rows={4}
          placeholder="Ej. Paquetes de valor declarado alto se resguardan en caja fuerte, no en el estante general."
          value={reglasBasicas}
          onChange={(e) => setReglasBasicas(e.target.value)}
          className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleGuardar} disabled={pending || !nombre.trim()}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        {guardado && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" /> Guardado
          </span>
        )}
      </div>
    </div>
  );
}

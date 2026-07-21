"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { actualizarEmpresa, cambiarEstadoEmpresa, ESTADO_SERVICIO_LABEL, type EmpresaDetalle, type EstadoServicio } from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

export function EmpresaDetalleClient({ empresa }: { empresa: EmpresaDetalle }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [nombre, setNombre] = useState(empresa.nombre);
  const [razonSocial, setRazonSocial] = useState(empresa.razonSocial ?? "");
  const [rfc, setRfc] = useState(empresa.rfc ?? "");
  const [correoPrincipal, setCorreoPrincipal] = useState(empresa.correoPrincipal ?? "");
  const [telefono, setTelefono] = useState(empresa.telefono ?? "");
  const [direccion, setDireccion] = useState(empresa.direccion ?? "");
  const [ciudad, setCiudad] = useState(empresa.ciudad ?? "");
  const [estadoGeografico, setEstadoGeografico] = useState(empresa.estadoGeografico ?? "");
  const [observaciones, setObservaciones] = useState(empresa.observaciones ?? "");

  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarEmpresa(supabase, empresa.id, {
        nombre,
        razonSocial,
        rfc,
        correoPrincipal,
        telefono,
        direccion,
        ciudad,
        estadoGeografico,
        observaciones,
      });
      setGuardado(true);
      router.refresh();
      setTimeout(() => setGuardado(false), 2000);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  async function handleCambiarEstado(estado: EstadoServicio) {
    setProcesando(true);
    try {
      await cambiarEstadoEmpresa(supabase, empresa.id, estado);
      router.refresh();
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {empresa.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={empresa.logoUrl} alt="" className="h-12 w-12 rounded-lg border border-border object-contain" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              {empresa.nombre.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{empresa.nombre}</h1>
            <p className="text-sm text-muted-foreground">
              {empresa.totalResidenciales} residencial(es) · {ESTADO_SERVICIO_LABEL[empresa.estadoServicio]}
            </p>
          </div>
        </div>
        {empresa.estadoServicio === "suspendido" ? (
          <Button size="sm" onClick={() => handleCambiarEstado("activo")} disabled={procesando}>
            <PlayCircle className="h-4 w-4" />
            Activar
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => handleCambiarEstado("suspendido")} disabled={procesando}>
            <PauseCircle className="h-4 w-4" />
            Suspender
          </Button>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ed-nombre">Nombre</Label>
            <Input id="ed-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-razon">Razón social</Label>
            <Input id="ed-razon" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-rfc">RFC</Label>
            <Input id="ed-rfc" value={rfc} onChange={(e) => setRfc(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-correo">Correo principal</Label>
            <Input id="ed-correo" value={correoPrincipal} onChange={(e) => setCorreoPrincipal(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-telefono">Teléfono</Label>
            <Input id="ed-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-direccion">Dirección</Label>
            <Input id="ed-direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-ciudad">Ciudad</Label>
            <Input id="ed-ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="ed-estado">Estado</Label>
            <Input id="ed-estado" value={estadoGeografico} onChange={(e) => setEstadoGeografico(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <div>
          <Label htmlFor="ed-obs">Observaciones</Label>
          <textarea
            id="ed-obs"
            rows={2}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-input bg-background p-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button onClick={handleGuardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
          {guardado && <span className="text-sm text-success">Guardado</span>}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { crearEmpresa } from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

export function FormularioEmpresa() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [nombre, setNombre] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [rfc, setRfc] = useState("");
  const [correoPrincipal, setCorreoPrincipal] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [estadoGeografico, setEstadoGeografico] = useState("");
  const [pais, setPais] = useState("MX");
  const [observaciones, setObservaciones] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCrear() {
    if (!nombre.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      const { id } = await crearEmpresa(supabase, {
        nombre,
        razonSocial,
        rfc,
        correoPrincipal,
        telefono,
        direccion,
        ciudad,
        estadoGeografico,
        pais,
        observaciones,
      });
      router.push(`/superadmin/empresas/${id}`);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo crear la empresa."));
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="e-nombre">
            Nombre <span className="text-destructive">*</span>
          </Label>
          <Input id="e-nombre" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-razon">Razón social</Label>
          <Input id="e-razon" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-rfc">RFC (opcional)</Label>
          <Input id="e-rfc" value={rfc} onChange={(e) => setRfc(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-correo">Correo principal</Label>
          <Input id="e-correo" type="email" value={correoPrincipal} onChange={(e) => setCorreoPrincipal(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-telefono">Teléfono</Label>
          <Input id="e-telefono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="mt-1.5" />
        </div>
        <div className="col-span-2">
          <Label htmlFor="e-direccion">Dirección</Label>
          <Input id="e-direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-ciudad">Ciudad</Label>
          <Input id="e-ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-estado">Estado</Label>
          <Input id="e-estado" placeholder="Ej. Quintana Roo" value={estadoGeografico} onChange={(e) => setEstadoGeografico(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="e-pais">País</Label>
          <Input id="e-pais" value={pais} onChange={(e) => setPais(e.target.value)} className="mt-1.5" />
        </div>
      </div>

      <div>
        <Label htmlFor="e-obs">Observaciones (opcional)</Label>
        <textarea
          id="e-obs"
          rows={2}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-input bg-background p-2 text-sm"
        />
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => router.push("/superadmin/empresas")}>
          Cancelar
        </Button>
        <Button onClick={handleCrear} disabled={!nombre.trim() || enviando}>
          {enviando ? "Creando…" : "Crear empresa"}
        </Button>
      </div>
    </div>
  );
}

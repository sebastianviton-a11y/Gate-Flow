"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { crearResidencial, PLAN_LABEL, type PlanClave } from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

const PLANES_NUEVOS: PlanClave[] = ["piloto", "starter", "business", "enterprise"];

interface Props {
  empresas: { id: string; nombre: string }[];
  empresaIdInicial?: string;
}

export function FormularioResidencial({ empresas, empresaIdInicial }: Props) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [empresaId, setEmpresaId] = useState(empresaIdInicial ?? "");
  const [nombre, setNombre] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [estadoGeografico, setEstadoGeografico] = useState("");
  const [pais, setPais] = useState("MX");
  const [plan, setPlan] = useState<PlanClave>("piloto");
  const [adminNombre, setAdminNombre] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminTelefono, setAdminTelefono] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCrear() {
    if (!nombre.trim() || !empresaId) return;
    setEnviando(true);
    setError(null);
    try {
      const { id } = await crearResidencial(supabase, {
        nombre,
        empresaId,
        ciudad,
        estadoGeografico,
        pais,
        plan,
        adminContactoNombre: adminNombre,
        adminContactoEmail: adminEmail,
        adminContactoTelefono: adminTelefono,
        observaciones,
      });
      router.push(`/superadmin/residenciales/${id}`);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo crear el residencial."));
      setEnviando(false);
    }
  }

  if (empresas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Todo residencial debe pertenecer a una empresa. Crea la primera empresa antes de poder crear un residencial.
        </p>
        <Link href="/superadmin/empresas/nueva" className="text-sm font-medium text-primary underline">
          Crear empresa
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div>
        <Label htmlFor="r-empresa">
          Empresa <span className="text-destructive">*</span>
        </Label>
        <select
          id="r-empresa"
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Selecciona…</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div className="col-span-2">
          <Label htmlFor="r-nombre">
            Nombre <span className="text-destructive">*</span>
          </Label>
          <Input id="r-nombre" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="r-ciudad">Ciudad</Label>
          <Input id="r-ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="r-estado">Estado</Label>
          <Input id="r-estado" placeholder="Ej. Quintana Roo" value={estadoGeografico} onChange={(e) => setEstadoGeografico(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="r-pais">País</Label>
          <Input id="r-pais" value={pais} onChange={(e) => setPais(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="r-plan">Plan</Label>
          <select
            id="r-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanClave)}
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {PLANES_NUEVOS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="mb-3 text-sm font-medium">Administrador principal (contacto)</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="r-admin-nombre">Nombre</Label>
            <Input id="r-admin-nombre" value={adminNombre} onChange={(e) => setAdminNombre(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="r-admin-email">Correo</Label>
            <Input id="r-admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="mt-1.5" />
          </div>
          <div className="col-span-2">
            <Label htmlFor="r-admin-tel">Teléfono</Label>
            <Input id="r-admin-tel" type="tel" value={adminTelefono} onChange={(e) => setAdminTelefono(e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-md bg-info/10 p-3 text-xs text-info">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Esto solo guarda el contacto — no crea la cuenta de acceso todavía. Crear la cuenta real del administrador (con la que inicia sesión)
            exige la clave de servicio de Supabase, que no puede manejarse desde el navegador. Se hace igual que los usuarios demo: desde
            Supabase → Authentication → Add user, y vinculándolo después en <code>user_tenants</code>.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="r-obs">Observaciones (opcional)</Label>
        <textarea
          id="r-obs"
          rows={2}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-input bg-background p-2 text-sm"
        />
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => router.push("/superadmin/residenciales")}>
          Cancelar
        </Button>
        <Button onClick={handleCrear} disabled={!nombre.trim() || !empresaId || enviando}>
          {enviando ? "Creando…" : "Crear residencial"}
        </Button>
      </div>
    </div>
  );
}

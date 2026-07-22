"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Send, CheckCircle2 } from "lucide-react";
import { PLAN_LABEL, type PlanClave } from "@gateflow/paquetes";
import { Button, Input, Label } from "@gateflow/ui";
import { invitarAdministrador } from "../../invitacion-actions";

const PLANES_NUEVOS: PlanClave[] = ["piloto", "starter", "business", "enterprise"];

interface Props {
  empresas: { id: string; nombre: string }[];
  empresaIdInicial?: string;
}

/**
 * A partir de este sprint, Super Admin ya NO configura el residencial
 * — solo crea el registro mínimo y envía la invitación. El
 * administrador hace el resto (asistente de configuración, en su
 * primer acceso). Por eso este formulario ya no pide nombre/teléfono
 * del administrador — solo su correo, que es lo único que la
 * invitación necesita.
 */
export function FormularioResidencial({ empresas, empresaIdInicial }: Props) {
  const router = useRouter();

  const [empresaId, setEmpresaId] = useState(empresaIdInicial ?? "");
  const [nombre, setNombre] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [estadoGeografico, setEstadoGeografico] = useState("");
  const [plan, setPlan] = useState<PlanClave>("piloto");
  const [correoAdmin, setCorreoAdmin] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  async function handleEnviarInvitacion() {
    if (!nombre.trim() || !empresaId || !correoAdmin.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      const resultado = await invitarAdministrador({
        empresaId,
        nombreResidencial: nombre,
        ciudad,
        estadoGeografico,
        plan,
        correoAdministrador: correoAdmin,
      });
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setExito(true);
      setTimeout(() => router.push(`/superadmin/residenciales/${resultado.tenantId}`), 1800);
    } finally {
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

  if (exito) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-10 text-center">
        <CheckCircle2 className="h-8 w-8 text-success" />
        <p className="font-medium">Invitación enviada a {correoAdmin}</p>
        <p className="text-sm text-muted-foreground">El administrador recibirá un correo para crear su contraseña y comenzar la configuración.</p>
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
            Nombre del residencial <span className="text-destructive">*</span>
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
        <div className="col-span-2">
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
        <Label htmlFor="r-correo-admin">
          Correo del administrador principal <span className="text-destructive">*</span>
        </Label>
        <Input
          id="r-correo-admin"
          type="email"
          placeholder="admin@residencial.com"
          value={correoAdmin}
          onChange={(e) => setCorreoAdmin(e.target.value)}
          className="mt-1.5"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Recibirá un correo para crear su contraseña. A partir de ahí, toda la configuración del residencial es responsabilidad suya —
          Super Admin no la realiza.
        </p>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => router.push("/superadmin/residenciales")}>
          Cancelar
        </Button>
        <Button onClick={handleEnviarInvitacion} disabled={!nombre.trim() || !empresaId || !correoAdmin.trim() || enviando}>
          <Send className="h-4 w-4" />
          {enviando ? "Enviando…" : "Enviar invitación"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { UserCog, Send, CheckCircle2 } from "lucide-react";
import type { UsuarioTenant } from "@gateflow/paquetes";
import { ROLES_INVITABLES } from "@gateflow/paquetes";
import type { RoleKey } from "@gateflow/types";
import { Button, Input } from "@gateflow/ui";
import { invitarUsuarioResidencial } from "../onboarding/invitar-usuario-action";

const ETIQUETA_ROL: Record<string, string> = {
  admin_residencial: "Administrador",
  guardia: "Guardia",
  recepcion: "Recepción",
  supervisor: "Supervisor",
  super_admin: "Super Admin",
};

export function UsuariosClient({ usuarios }: { usuarios: UsuarioTenant[] }) {
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<RoleKey>("guardia");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function handleInvitar() {
    if (!correo.trim()) return;
    setEnviando(true);
    setMensaje(null);
    const resultado = await invitarUsuarioResidencial({ correo, rolClave: rol });
    setMensaje({ tipo: resultado.ok ? "ok" : "error", texto: resultado.mensaje });
    if (resultado.ok) setCorreo("");
    setEnviando(false);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium">Invitar a alguien nuevo</p>
        <div className="flex flex-wrap gap-2">
          <Input
            type="email"
            placeholder="correo@residencial.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            className="flex-1 min-w-[220px]"
          />
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as RoleKey)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {ROLES_INVITABLES.map((r) => (
              <option key={r.clave} value={r.clave}>
                {r.etiqueta}
              </option>
            ))}
          </select>
          <Button onClick={handleInvitar} disabled={!correo.trim() || enviando}>
            <Send className="h-4 w-4" />
            {enviando ? "Enviando…" : "Invitar"}
          </Button>
        </div>
        {mensaje && (
          <p className={`flex items-center gap-1.5 text-sm ${mensaje.tipo === "ok" ? "text-success" : "text-destructive"}`}>
            {mensaje.tipo === "ok" && <CheckCircle2 className="h-4 w-4" />}
            {mensaje.texto}
          </p>
        )}
      </div>

      {usuarios.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
          <UserCog className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sin usuarios adicionales todavía — invita al primero arriba.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Correo</th>
                <th className="px-4 py-2 font-medium">Rol</th>
                <th className="px-4 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5 font-medium">{u.nombreCompleto}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ETIQUETA_ROL[u.rolClave] ?? u.rolNombre}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        u.activo ? "bg-success/10 text-success" : "bg-muted-foreground/10 text-muted-foreground"
                      }`}
                    >
                      {u.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

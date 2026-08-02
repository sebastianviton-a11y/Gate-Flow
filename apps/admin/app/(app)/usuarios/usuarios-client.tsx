"use client";

import { useState } from "react";
import { UserCog, Send, CheckCircle2, Pencil, Check, X, AlertCircle } from "lucide-react";
import type { UsuarioTenant } from "@gateflow/paquetes";
import { ROLES_INVITABLES } from "@gateflow/paquetes";
import type { RoleKey } from "@gateflow/types";
import { Button, Input } from "@gateflow/ui";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { invitarUsuarioResidencial } from "../onboarding/invitar-usuario-action";
import { actualizarNombreUsuario } from "./actualizar-nombre-usuario-action";

const ETIQUETA_ROL: Record<string, string> = {
  admin_residencial: "Administrador",
  guardia: "Guardia",
  recepcion: "Recepción",
  supervisor: "Supervisor",
  super_admin: "Super Admin",
};

export function UsuariosClient({ usuarios: usuariosIniciales }: { usuarios: UsuarioTenant[] }) {
  const supabase = createBrowserSupabaseClient();
  const [usuarios, setUsuarios] = useState(usuariosIniciales);

  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<RoleKey>("guardia");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState("");
  const [guardandoNombre, setGuardandoNombre] = useState(false);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);

  const [cambiandoEstadoId, setCambiandoEstadoId] = useState<string | null>(null);

  async function handleInvitar() {
    if (!correo.trim()) return;
    setEnviando(true);
    setMensaje(null);
    const resultado = await invitarUsuarioResidencial({ correo, rolClave: rol });
    setMensaje({ tipo: resultado.ok ? "ok" : "error", texto: resultado.mensaje });
    if (resultado.ok) setCorreo("");
    setEnviando(false);
  }

  function iniciarEdicion(u: UsuarioTenant) {
    setEditandoId(u.id);
    setNombreEdicion(u.perfilIncompleto ? "" : u.nombreCompleto);
    setErrorNombre(null);
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setNombreEdicion("");
    setErrorNombre(null);
  }

  async function guardarNombre(u: UsuarioTenant) {
    setGuardandoNombre(true);
    setErrorNombre(null);
    const resultado = await actualizarNombreUsuario({ userId: u.userId, nombreCompleto: nombreEdicion });
    if (!resultado.ok) {
      setErrorNombre(resultado.mensaje);
      setGuardandoNombre(false);
      return;
    }
    setUsuarios((prev) =>
      prev.map((item) =>
        item.id === u.id ? { ...item, nombreCompleto: nombreEdicion.trim(), perfilIncompleto: false } : item,
      ),
    );
    setGuardandoNombre(false);
    setEditandoId(null);
  }

  async function toggleActivo(u: UsuarioTenant) {
    setCambiandoEstadoId(u.id);
    const { error } = await supabase.from("user_tenants").update({ activo: !u.activo }).eq("id", u.id);
    if (!error) {
      setUsuarios((prev) => prev.map((item) => (item.id === u.id ? { ...item, activo: !item.activo } : item)));
    }
    setCambiandoEstadoId(null);
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
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2.5 font-medium">
                    {editandoId === u.id ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={nombreEdicion}
                            onChange={(e) => setNombreEdicion(e.target.value)}
                            placeholder="Nombre completo"
                            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
                          />
                          <button
                            onClick={() => guardarNombre(u)}
                            disabled={guardandoNombre || nombreEdicion.trim().length < 3}
                            className="text-success disabled:opacity-40"
                            aria-label="Guardar nombre"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button onClick={cancelarEdicion} className="text-muted-foreground" aria-label="Cancelar">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {errorNombre && <p className="text-xs text-destructive">{errorNombre}</p>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span>{u.perfilIncompleto ? (u.email ?? u.nombreCompleto) : u.nombreCompleto}</span>
                        <button onClick={() => iniciarEdicion(u)} className="text-muted-foreground hover:text-primary" aria-label="Editar nombre">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {u.perfilIncompleto && (
                          <span className="flex items-center gap-1 text-xs text-warn-foreground" title="Este usuario aún no registró su nombre completo">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Perfil incompleto
                          </span>
                        )}
                      </div>
                    )}
                  </td>
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
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => toggleActivo(u)}
                      disabled={cambiandoEstadoId === u.id}
                      className="text-xs font-medium text-primary underline disabled:opacity-50"
                    >
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, PauseCircle, PlayCircle, Trash2, LogIn } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import {
  actualizarResidencial,
  cambiarEstadoServicio,
  actualizarPlanResidencial,
  eliminarResidencial,
  ESTADO_SERVICIO_LABEL,
  PLAN_LABEL,
  type ResidencialDetalle,
  type EstadoServicio,
  type PlanClave,
} from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";
import { entrarComoSoporte } from "../../soporte-actions";

const TABS = ["Información general", "Administrador", "Usuarios", "Actividad", "Configuración", "Plan", "Consumo"] as const;
type Tab = (typeof TABS)[number];

const PLANES_NUEVOS: PlanClave[] = ["piloto", "starter", "business", "enterprise"];

export function ResidencialDetalleClient({ residencial }: { residencial: ResidencialDetalle }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [tab, setTab] = useState<Tab>("Información general");
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [textoConfirmacion, setTextoConfirmacion] = useState("");
  const [procesando, setProcesando] = useState(false);

  async function handleCambiarEstado(estado: EstadoServicio) {
    setProcesando(true);
    try {
      await cambiarEstadoServicio(supabase, residencial.id, estado);
      router.refresh();
    } finally {
      setProcesando(false);
    }
  }

  async function handleEliminar() {
    if (textoConfirmacion !== residencial.nombre) return;
    setProcesando(true);
    try {
      await eliminarResidencial(supabase, residencial.id);
      router.push("/superadmin/residenciales");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {residencial.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={residencial.logoUrl} alt="" className="h-12 w-12 rounded-lg border border-border object-contain" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              {residencial.nombre.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{residencial.nombre}</h1>
            <p className="text-sm text-muted-foreground">
              {residencial.ciudad ?? "Sin ciudad"}
              {residencial.estadoGeografico ? `, ${residencial.estadoGeografico}` : ""} · {ESTADO_SERVICIO_LABEL[residencial.estadoServicio]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <form action={entrarComoSoporte.bind(null, residencial.id)}>
            <Button type="submit" variant="outline" size="sm">
              <LogIn className="h-4 w-4" />
              Entrar como soporte
            </Button>
          </form>
          {residencial.estadoServicio === "suspendido" ? (
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
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Información general" && <TabInformacionGeneral residencial={residencial} onGuardado={() => router.refresh()} />}
      {tab === "Plan" && <TabPlan residencial={residencial} onGuardado={() => router.refresh()} />}
      {tab === "Administrador" && (
        <TabProximamente
          descripcion={
            residencial.administradorNombre
              ? `Contacto registrado: ${residencial.administradorNombre}. La gestión completa (invitar, remover, cambiar) llega en una siguiente versión.`
              : "Sin administrador asignado todavía. Invitar administradores desde aquí llega en una siguiente versión — por ahora se crea manualmente en Supabase."
          }
        />
      )}
      {tab === "Usuarios" && <TabProximamente descripcion={`${residencial.totalUsuarios} usuario(s) vinculado(s). El listado detallado llega en una siguiente versión.`} />}
      {tab === "Actividad" && <TabProximamente descripcion="El registro de actividad (auditoría por residencial) llega en una siguiente versión." />}
      {tab === "Configuración" && (
        <TabProximamente descripcion="Esta pestaña mostrará la Configuración propia del residencial (Configuración → Bodega, horarios, etc.) en una siguiente versión." />
      )}
      {tab === "Consumo" && <TabProximamente descripcion="Métricas de uso (paquetes por mes, usuarios activos) específicas de este residencial llegan en una siguiente versión." />}

      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <p className="mb-1 text-sm font-medium text-destructive">Eliminar residencial</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Borra permanentemente este residencial y TODOS sus datos (paquetes, unidades, usuarios vinculados, historial). No se puede deshacer.
        </p>
        {!confirmandoEliminar ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmandoEliminar(true)} className="border-destructive text-destructive">
            <Trash2 className="h-4 w-4" />
            Eliminar residencial
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Escribe <strong>{residencial.nombre}</strong> para confirmar.
            </p>
            <Input value={textoConfirmacion} onChange={(e) => setTextoConfirmacion(e.target.value)} className="max-w-xs" />
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmandoEliminar(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleEliminar}
                disabled={textoConfirmacion !== residencial.nombre || procesando}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {procesando ? "Eliminando…" : "Confirmar eliminación"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabProximamente({ descripcion }: { descripcion: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
      <ShieldCheck className="h-6 w-6 text-muted-foreground" />
      <p className="max-w-md text-sm text-muted-foreground">{descripcion}</p>
    </div>
  );
}

function TabInformacionGeneral({ residencial, onGuardado }: { residencial: ResidencialDetalle; onGuardado: () => void }) {
  const supabase = createBrowserSupabaseClient();
  const [nombre, setNombre] = useState(residencial.nombre);
  const [ciudad, setCiudad] = useState(residencial.ciudad ?? "");
  const [estadoGeografico, setEstadoGeografico] = useState(residencial.estadoGeografico ?? "");
  const [adminNombre, setAdminNombre] = useState(residencial.administradorNombre ?? "");
  const [adminEmail, setAdminEmail] = useState(residencial.adminContactoEmail ?? "");
  const [adminTelefono, setAdminTelefono] = useState(residencial.adminContactoTelefono ?? "");
  const [observaciones, setObservaciones] = useState(residencial.observaciones ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarResidencial(supabase, residencial.id, {
        nombre,
        empresaId: residencial.empresaId,
        ciudad,
        estadoGeografico,
        adminContactoNombre: adminNombre,
        adminContactoEmail: adminEmail,
        adminContactoTelefono: adminTelefono,
        observaciones,
      });
      setGuardado(true);
      onGuardado();
      setTimeout(() => setGuardado(false), 2000);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="d-nombre">Nombre</Label>
          <Input id="d-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="d-ciudad">Ciudad</Label>
          <Input id="d-ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="d-estado">Estado</Label>
          <Input id="d-estado" value={estadoGeografico} onChange={(e) => setEstadoGeografico(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label>País</Label>
          <Input value={residencial.pais} disabled className="mt-1.5 opacity-60" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <Label htmlFor="d-admin-nombre">Administrador — nombre</Label>
          <Input id="d-admin-nombre" value={adminNombre} onChange={(e) => setAdminNombre(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="d-admin-email">Administrador — correo</Label>
          <Input id="d-admin-email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="mt-1.5" />
        </div>
        <div className="col-span-2">
          <Label htmlFor="d-admin-tel">Administrador — teléfono</Label>
          <Input id="d-admin-tel" value={adminTelefono} onChange={(e) => setAdminTelefono(e.target.value)} className="mt-1.5" />
        </div>
      </div>
      <div>
        <Label htmlFor="d-obs">Observaciones</Label>
        <textarea
          id="d-obs"
          rows={3}
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
  );
}

function TabPlan({ residencial, onGuardado }: { residencial: ResidencialDetalle; onGuardado: () => void }) {
  const supabase = createBrowserSupabaseClient();
  const [plan, setPlan] = useState<PlanClave>(residencial.plan);
  const [precio, setPrecio] = useState(residencial.planPrecio?.toString() ?? "");
  const [fechaInicio, setFechaInicio] = useState(residencial.planFechaInicio ?? "");
  const [fechaRenovacion, setFechaRenovacion] = useState(residencial.planFechaRenovacion ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarPlanResidencial(supabase, residencial.id, {
        plan,
        precio: precio ? Number(precio) : null,
        fechaInicio: fechaInicio || null,
        fechaRenovacion: fechaRenovacion || null,
      });
      setGuardado(true);
      onGuardado();
      setTimeout(() => setGuardado(false), 2000);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo guardar el plan."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-md space-y-4 rounded-lg border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">Todavía no existe cobro automático — esto solo guarda los datos del plan para referencia.</p>
      <div>
        <Label htmlFor="p-plan">Plan</Label>
        <select
          id="p-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as PlanClave)}
          className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {PLANES_NUEVOS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABEL[p]}
            </option>
          ))}
          {!PLANES_NUEVOS.includes(residencial.plan) && <option value={residencial.plan}>{PLAN_LABEL[residencial.plan]}</option>}
        </select>
      </div>
      <div>
        <Label htmlFor="p-precio">Precio (MXN/mes)</Label>
        <Input id="p-precio" type="number" value={precio} onChange={(e) => setPrecio(e.target.value)} className="mt-1.5" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="p-inicio">Fecha de inicio</Label>
          <Input id="p-inicio" type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="p-renovacion">Próxima renovación</Label>
          <Input id="p-renovacion" type="date" value={fechaRenovacion} onChange={(e) => setFechaRenovacion(e.target.value)} className="mt-1.5" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={handleGuardar} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar plan"}
        </Button>
        {guardado && <span className="text-sm text-success">Guardado</span>}
      </div>
    </div>
  );
}

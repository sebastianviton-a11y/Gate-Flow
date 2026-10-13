"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, CreditCard, Info, ShieldAlert } from "lucide-react";
import { estadoEfectivoSuscripcion, suscripcionOperativa } from "@gateflow/auth/client";
import type { EstadoServicio, SuscripcionSuperAdmin } from "@gateflow/paquetes";
import { Button, Input, Label, formatearFechaHora } from "@gateflow/ui";
import {
  ACLARACION_SIN_COBRO,
  ESTADO_SUSCRIPCION_LABEL,
  ORIGEN_SUSCRIPCION_LABEL,
  PLANES_MANUALES,
  accionesSuscripcion,
  esActivacionManual,
  fechaCorta,
  finComoDiaIncluido,
  limitesFecha,
  nombreProveedor,
  textoConfirmacion,
  ultimoDiaConAcceso,
  type AccionSuscripcion,
  type ResultadoAccion,
} from "@/lib/superadmin/suscripcion-manual";
import { activarSuscripcionManualAction, extenderPruebaAction, extenderVigenciaAction } from "../../suscripcion-actions";

/**
 * Bloque "Suscripción" del detalle de un residencial (Super Admin). Solo
 * ofrece las acciones que la base acepta para el estado actual; la base
 * (RPC superadmin_*) vuelve a validar todo. Nada de esto cobra ni usa
 * Stripe o Mercado Pago.
 */
export function TabSuscripcion({
  tenantId,
  zona,
  estadoServicio,
  suscripcion,
}: {
  tenantId: string;
  /** tenants.timezone: las fechas "hasta" son días de esta zona. */
  zona: string;
  estadoServicio: EstadoServicio;
  suscripcion: SuscripcionSuperAdmin | null;
}) {
  const acciones = accionesSuscripcion(suscripcion);
  const efectivo = estadoEfectivoSuscripcion(
    suscripcion
      ? {
          estado: suscripcion.estado,
          trial_ends_at: suscripcion.trialEndsAt,
          current_period_end: suscripcion.currentPeriodEnd,
          cancel_at_period_end: suscripcion.cancelAtPeriodEnd,
          impago_desde: suscripcion.impagoDesde,
        }
      : null,
  );
  const operativa = suscripcionOperativa(efectivo);
  const fecha = (iso: string | null) => (iso ? formatearFechaHora(iso, zona, { dateStyle: "medium", timeStyle: "short" }) : "—");
  const manual = suscripcion ? esActivacionManual(suscripcion) : false;
  const ultimoDia = manual ? ultimoDiaConAcceso(suscripcion?.currentPeriodEnd, zona) : null;
  const finPrueba = finComoDiaIncluido(suscripcion?.trialEndsAt, zona);

  return (
    <section aria-labelledby="titulo-suscripcion" data-testid="suscripcion-superadmin" className="max-w-3xl space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="titulo-suscripcion" className="font-display text-lg font-semibold">
            Suscripción
          </h2>
          <p className="text-xs text-muted-foreground">Fechas en la zona horaria del residencial ({zona}).</p>
        </div>
        {suscripcion && (
          <span
            data-operativa={operativa}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              operativa ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            }`}
          >
            {operativa ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {operativa ? "Puede usar Gate Flow hoy" : "Bloqueado por la suscripción"}
          </span>
        )}
      </div>

      {suscripcion ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Dato titulo="Estado" valor={ESTADO_SUSCRIPCION_LABEL[suscripcion.estado] ?? suscripcion.estado} prueba="estado" />
          <Dato titulo="Origen" valor={ORIGEN_SUSCRIPCION_LABEL[suscripcion.origen] ?? suscripcion.origen} />
          <Dato titulo="Fin de la prueba" valor={finPrueba ? `${fechaCorta(finPrueba)} (incluido)` : fecha(suscripcion.trialEndsAt)} prueba="fin-prueba" />
          <Dato
            titulo={suscripcion.provider ? "Fin del periodo pagado" : "Vigente hasta"}
            valor={ultimoDia ? `${fechaCorta(ultimoDia)} (incluido)` : suscripcion.estado === "active" && !suscripcion.currentPeriodEnd ? "Sin vencimiento" : fecha(suscripcion.currentPeriodEnd)}
            prueba="vigencia"
          />
          <Dato titulo="Proveedor de cobro" valor={suscripcion.provider ? nombreProveedor(suscripcion.provider) : "Ninguno (manual)"} />
          <Dato titulo="Plan" valor={PLANES_MANUALES.find((p) => p.id === suscripcion.plan)?.nombre ?? "Sin plan de catálogo"} />
          <Dato titulo="Viviendas declaradas" valor={suscripcion.viviendasDeclaradas?.toString() ?? "—"} />
        </dl>
      ) : null}

      {estadoServicio === "suspendido" && (
        <Aviso>El residencial está suspendido: aunque extiendas o actives la suscripción, no podrá operar hasta que lo reactives (botón «Activar» de arriba).</Aviso>
      )}

      {acciones.gestion.tipo === "sin_suscripcion" && <Aviso>Este residencial no tiene suscripción. No se crea una desde aquí.</Aviso>}
      {acciones.gestion.tipo === "proveedor" && (
        <p data-testid="gestionada-proveedor" className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Esta suscripción está gestionada por {acciones.gestion.proveedor}. Las fechas y el estado los define el proveedor: no se extiende ni se activa manualmente
            desde aquí.
          </span>
        </p>
      )}
      {acciones.gestion.tipo === "sin_vencimiento" && (
        <Aviso>Activa sin fecha de vencimiento (alta manual anterior a la prueba gratuita). No requiere acción y no se modifica desde aquí.</Aviso>
      )}

      {suscripcion && acciones.extenderPrueba && (
        <FormularioAccion
          accion="extender_prueba"
          titulo="Extender prueba"
          descripcion="Sigue en prueba gratuita hasta el día que elijas (incluido)."
          boton="Extender prueba"
          limites={limitesFecha("extender_prueba", suscripcion, zona)}
          enviar={(hasta) => extenderPruebaAction(tenantId, hasta)}
        />
      )}
      {suscripcion && acciones.activar && (
        <FormularioAccion
          accion="activar"
          titulo="Activar manualmente"
          descripcion="Activación administrativa: el residencial puede usar Gate Flow hasta el día que elijas (incluido) y luego se bloquea solo. No cobra nada."
          boton="Activar manualmente"
          conPlan
          limites={limitesFecha("activar", suscripcion, zona)}
          enviar={(hasta, plan) => activarSuscripcionManualAction(tenantId, hasta, plan)}
        />
      )}
      {suscripcion && acciones.extenderVigencia && (
        <FormularioAccion
          accion="extender_vigencia"
          titulo="Extender vigencia"
          descripcion="Mueve hacia adelante la fecha hasta la que puede usar Gate Flow. No cobra nada."
          boton="Extender vigencia"
          limites={limitesFecha("extender_vigencia", suscripcion, zona)}
          enviar={(hasta) => extenderVigenciaAction(tenantId, hasta)}
        />
      )}
    </section>
  );
}

function Dato({ titulo, valor, prueba }: { titulo: string; valor: string; prueba?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className="break-words font-medium" data-dato={prueba}>
        {valor}
      </dd>
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function FormularioAccion({
  accion,
  titulo,
  descripcion,
  boton,
  limites,
  conPlan = false,
  enviar,
}: {
  accion: AccionSuscripcion;
  titulo: string;
  descripcion: string;
  boton: string;
  limites: { min: string; max: string; sugerida: string };
  conPlan?: boolean;
  enviar: (hasta: string, plan: string | null) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [fecha, setFecha] = useState(limites.sugerida);
  const [plan, setPlan] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const enCurso = useRef(false);
  const id = `sm-${accion}`;
  const fueraDeRango = !fecha || fecha < limites.min || fecha > limites.max;

  async function confirmar() {
    if (enCurso.current || fueraDeRango) return;
    enCurso.current = true;
    setEnviando(true);
    try {
      const r = await enviar(fecha, plan || null);
      setResultado(r);
      if (r.ok) {
        setConfirmando(false);
        router.refresh();
      }
    } catch {
      setResultado({ ok: false, codigo: "desconocido", mensaje: "No se pudo guardar. Inténtalo de nuevo." });
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-4" data-testid={`accion-${accion}`}>
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{titulo}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{descripcion}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-fecha`}>Hasta (incluido)</Label>
          <Input
            id={`${id}-fecha`}
            type="date"
            value={fecha}
            min={limites.min}
            max={limites.max}
            onChange={(e) => {
              setFecha(e.target.value);
              setConfirmando(false);
              setResultado(null);
            }}
            className="mt-1.5"
          />
        </div>
        {conPlan && (
          <div>
            <Label htmlFor={`${id}-plan`}>Plan</Label>
            <select
              id={`${id}-plan`}
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value);
                setConfirmando(false);
              }}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sin plan de catálogo (acuerdo a medida)</option>
              {PLANES_MANUALES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {fueraDeRango && (
        <p className="text-xs text-destructive">
          Elige un día entre el {fechaCorta(limites.min)} y el {fechaCorta(limites.max)}.
        </p>
      )}

      {!confirmando ? (
        <Button type="button" variant="outline" onClick={() => setConfirmando(true)} disabled={fueraDeRango} className="w-full sm:w-auto">
          {boton}
        </Button>
      ) : (
        <div role="alertdialog" aria-labelledby={`${id}-confirmacion`} className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p id={`${id}-confirmacion`} className="text-sm font-medium" data-testid="texto-confirmacion">
            {textoConfirmacion(accion, fecha)}
          </p>
          {accion !== "extender_prueba" && <p className="text-xs text-muted-foreground">{ACLARACION_SIN_COBRO}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={confirmar} disabled={enviando} aria-busy={enviando} className="w-full sm:w-auto">
              {enviando ? "Guardando…" : "Confirmar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmando(false)} disabled={enviando} className="w-full sm:w-auto">
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {resultado && (
        <p role="status" aria-live="polite" data-ok={resultado.ok} className={`text-sm ${resultado.ok ? "text-success" : "text-destructive"}`}>
          {resultado.mensaje}
        </p>
      )}
    </div>
  );
}

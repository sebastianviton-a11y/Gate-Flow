"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Circle, Loader2, MessageCircle, Send, Upload, Building2, Users, Package, Warehouse, PartyPopper } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { ROLES_INVITABLES, type EnlaceResidentes as Enlace, type ProgresoConfiguracion, type UbicacionAdmin } from "@gateflow/paquetes";
import type { RoleKey } from "@gateflow/types";
import {
  AyudaCampo,
  Button,
  Input,
  Label,
  GateFlowLogo,
  WHATSAPP_SOPORTE_VISIBLE,
  enlaceWhatsAppSoporte,
  obtenerMensajeError,
} from "@gateflow/ui";
import { ImportarUnidades } from "../unidades/importar-unidades";
import { EnlaceResidentes } from "../residentes/enlace-residentes";
import { BodegaClient } from "../configuracion/bodega/bodega-client";
import { invitarUsuarioResidencial } from "./invitar-usuario-action";

const TOTAL_PASOS = 6;
const NOMBRES_PASOS = ["Bienvenida", "Datos del residencial", "Residentes", "Usuarios", "Bodega", "Resumen"] as const;

type Supabase = ReturnType<typeof createBrowserSupabaseClient>;

/**
 * El asistente deja de imponerse al entrar al panel. Lo usan «Seguir más
 * tarde» y el resumen final: no borra ni cambia nada de lo configurado,
 * y se puede volver a abrir cuando se quiera (Dashboard → Primeros
 * pasos). Única escritura de onboarding_completado desde el panel.
 */
async function marcarAsistenteCerrado(supabase: Supabase, tenantId: string) {
  const { error } = await supabase.from("tenants").update({ onboarding_completado: true }).eq("id", tenantId);
  if (error) throw error;
}

/**
 * Navegación completa (no del router de cliente): mientras el asistente
 * se imponía, la precarga de los enlaces del menú guardó «/dashboard →
 * /onboarding», y router.replace() la reutilizaría y devolvería aquí.
 */
function irAlDashboard() {
  window.location.assign("/dashboard");
}
interface Props {
  tenantId: string;
  userId: string;
  nombreInicial: string;
  telefonoInicial: string;
  correoInicial: string;
  direccionInicial: string;
  logoUrlInicial: string | null;
  ubicacionesIniciales: UbicacionAdmin[];
  enlaceResidentes: Enlace | null;
  /** País del residencial: ejemplo de teléfono de la plantilla. */
  pais?: string | null;
  /** Avance real del residencial (null si no se pudo leer). */
  progreso: ProgresoConfiguracion | null;
  /** Paso en el que se abre: el primero con algo pendiente (pasoInicialAsistente). */
  pasoInicial: number;
  /** El asistente ya se cerró antes (terminado o «Seguir más tarde»). */
  asistenteCerrado: boolean;
  /** Guardias que ya tiene el residencial. */
  guardias: number;
}

export function OnboardingWizard(props: Props) {
  const router = useRouter();
  const [paso, setPasoActual] = useState(props.pasoInicial);
  const [usuariosCreados, setUsuariosCreados] = useState(0);

  // El resumen se arma con los datos reales: al llegar a él se vuelven a
  // leer en el servidor (sin perder el paso actual).
  function setPaso(n: number) {
    setPasoActual(n);
    if (n === TOTAL_PASOS) router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4 sm:py-6">
      <nav aria-label="Pasos de la configuración" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Puedes salir cuando quieras: lo que configures se guarda.</p>
          <SeguirMasTarde tenantId={props.tenantId} asistenteCerrado={props.asistenteCerrado} />
        </div>
        <ol className="flex items-center gap-1.5">
          {NOMBRES_PASOS.map((nombre, i) => (
            <li key={nombre} className="flex-1">
              <button
                type="button"
                onClick={() => setPaso(i + 1)}
                aria-label={`Paso ${i + 1} de ${TOTAL_PASOS}: ${nombre}`}
                aria-current={paso === i + 1 ? "step" : undefined}
                className="block w-full rounded py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={`block h-1.5 rounded-full ${i + 1 <= paso ? "bg-primary" : "bg-muted"}`} />
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {paso === 1 && <PasoBienvenida onContinuar={() => setPaso(2)} />}
      {paso === 2 && <PasoInformacion {...props} onContinuar={() => setPaso(3)} />}
      {paso === 3 && (
        <PasoImportarResidentes
          tenantId={props.tenantId}
          enlace={props.enlaceResidentes}
          pais={props.pais ?? null}
          onImportado={() => router.refresh()}
          onContinuar={() => setPaso(4)}
        />
      )}
      {paso === 4 && (
        <PasoCrearUsuarios
          onInvitado={() => setUsuariosCreados((n) => n + 1)}
          usuariosCreados={usuariosCreados}
          guardiasExistentes={props.guardias}
          onContinuar={() => setPaso(5)}
        />
      )}
      {paso === 5 && (
        <PasoBodega tenantId={props.tenantId} userId={props.userId} ubicacionesIniciales={props.ubicacionesIniciales} onContinuar={() => setPaso(6)} />
      )}
      {paso === 6 && <PasoFinalizar tenantId={props.tenantId} progreso={props.progreso} />}

      <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        ¿Dudas? Escríbenos por WhatsApp al
        <a href={enlaceWhatsAppSoporte()} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
          {WHATSAPP_SOPORTE_VISIBLE}
        </a>
      </p>
    </div>
  );
}

/** Sale del asistente sin bloquear nada; se retoma desde el Dashboard. */
function SeguirMasTarde({ tenantId, asistenteCerrado }: { tenantId: string; asistenteCerrado: boolean }) {
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSalir() {
    setSaliendo(true);
    setError(null);
    try {
      if (!asistenteCerrado) await marcarAsistenteCerrado(createBrowserSupabaseClient(), tenantId);
      irAlDashboard();
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo salir del asistente. Intenta de nuevo."));
      setSaliendo(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" size="sm" onClick={handleSalir} disabled={saliendo}>
        {saliendo ? "Saliendo…" : "Seguir más tarde"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
function TarjetaPaso({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 rounded-lg border border-border bg-card p-6">{children}</div>;
}

function PasoBienvenida({ onContinuar }: { onContinuar: () => void }) {
  return (
    <TarjetaPaso>
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <GateFlowLogo size={56} />
        <h1 className="font-display text-2xl font-semibold">¡Bienvenido a GateFlow!</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Vamos a configurar tu residencial. Toma solo unos minutos — puedes ajustar todo esto después desde Configuración.
        </p>
        <Button onClick={onContinuar} size="lg">
          Comenzar
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </TarjetaPaso>
  );
}

function PasoInformacion({
  tenantId,
  nombreInicial,
  telefonoInicial,
  correoInicial,
  direccionInicial,
  logoUrlInicial,
  onContinuar,
}: Props & { onContinuar: () => void }) {
  const supabase = createBrowserSupabaseClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [nombre, setNombre] = useState(nombreInicial);
  const [telefono, setTelefono] = useState(telefonoInicial);
  const [correo, setCorreo] = useState(correoInicial);
  const [direccion, setDireccion] = useState(direccionInicial);
  const [logoUrl, setLogoUrl] = useState(logoUrlInicial);
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubirLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendo(true);
    setError(null);
    try {
      const extension = archivo.name.split(".").pop() ?? "png";
      const path = `${tenantId}/logo.${extension}`;
      const { error: errorSubida } = await supabase.storage.from("logos").upload(path, archivo, { contentType: archivo.type, upsert: true });
      if (errorSubida) throw errorSubida;
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      setLogoUrl(`${data.publicUrl}?v=${Date.now()}`);
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo subir el logo. Prueba con una imagen PNG o JPG más liviana."));
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleContinuar() {
    setGuardando(true);
    setError(null);
    try {
      const { data: actual } = await supabase.from("tenants").select("configuracion").eq("id", tenantId).maybeSingle();
      const configuracionActual = (actual?.configuracion as Record<string, unknown>) ?? {};

      const { error: errorUpdate } = await supabase
        .from("tenants")
        .update({
          nombre,
          telefono,
          correo,
          direccion,
          configuracion: { ...configuracionActual, logoUrl },
        })
        .eq("id", tenantId);
      if (errorUpdate) throw errorUpdate;
      onContinuar();
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <TarjetaPaso>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Building2 className="h-4 w-4" />
        Paso 2 de 6 — Información del residencial
      </div>

      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded-lg border border-border object-contain" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            Sin logo
          </div>
        )}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={subiendo}>
            {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {subiendo ? "Subiendo…" : "Subir logo"}
          </Button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleSubirLogo} className="hidden" />
          <p className="mt-1 text-xs text-muted-foreground">Opcional. Aparece en el panel y en la app de portería.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-x-1">
            <Label htmlFor="ob-nombre">Nombre comercial</Label>
            <AyudaCampo id="ob-nombre" etiqueta="Nombre comercial">
              Es el nombre que ven tus guardias en la app de portería y el que aparece en los mensajes de WhatsApp a los residentes.
            </AyudaCampo>
          </div>
          <Input id="ob-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-x-1">
            <Label htmlFor="ob-telefono">Teléfono</Label>
            <AyudaCampo id="ob-telefono" etiqueta="Teléfono, correo y dirección">
              Teléfono, correo y dirección son datos de contacto del residencial para tu referencia: hoy no se envían a los residentes. Puedes dejarlos
              vacíos y completarlos después.
            </AyudaCampo>
          </div>
          <Input id="ob-telefono" type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="ob-correo">Correo</Label>
          <Input id="ob-correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className="mt-1.5" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ob-direccion">Dirección</Label>
          <Input id="ob-direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} className="mt-1.5" />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleContinuar} disabled={guardando} className="w-full">
        {guardando ? "Guardando…" : "Continuar"}
        <ChevronRight className="h-4 w-4" />
      </Button>
    </TarjetaPaso>
  );
}

function PasoImportarResidentes({
  tenantId,
  enlace,
  pais,
  onImportado,
  onContinuar,
}: {
  tenantId: string;
  enlace: Enlace | null;
  pais: string | null;
  onImportado: () => void;
  onContinuar: () => void;
}) {
  const [importoAlgo, setImportoAlgo] = useState(false);

  return (
    <TarjetaPaso>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4" />
        Paso 3 de 6 — Residentes
      </div>
      <EnlaceResidentes tenantId={tenantId} enlaceInicial={enlace} />
      <p className="text-sm text-muted-foreground">
        También puedes cargarlos tú: descarga la plantilla, complétala con tus residentes y súbela — verás cuántos registros se encontraron,
        duplicados y errores antes de confirmar nada.
      </p>
      <ImportarUnidades
        tenantId={tenantId}
        pais={pais}
        onImportado={() => {
          setImportoAlgo(true);
          onImportado();
        }}
      />
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={onContinuar} className="flex-1">
          Continuar
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!importoAlgo && (
          <button onClick={onContinuar} className="text-sm text-muted-foreground underline">
            Omitir por ahora
          </button>
        )}
      </div>
    </TarjetaPaso>
  );
}

function PasoCrearUsuarios({
  onInvitado,
  usuariosCreados,
  guardiasExistentes,
  onContinuar,
}: {
  onInvitado: () => void;
  usuariosCreados: number;
  guardiasExistentes: number;
  onContinuar: () => void;
}) {
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<RoleKey>("guardia");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitados, setInvitados] = useState<string[]>([]);

  async function handleInvitar() {
    if (!correo.trim()) return;
    setEnviando(true);
    setError(null);
    const resultado = await invitarUsuarioResidencial({ correo, rolClave: rol });
    if (!resultado.ok) {
      setError(resultado.mensaje);
    } else {
      setInvitados((prev) => [...prev, correo]);
      setCorreo("");
      onInvitado();
    }
    setEnviando(false);
  }

  return (
    <TarjetaPaso>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4" />
        Paso 4 de 6 — Crear usuarios
      </div>
      <p className="text-sm text-muted-foreground">Invita a tu equipo — cada uno recibe un correo para crear su propia contraseña.</p>
      {guardiasExistentes > 0 && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Tu residencial ya tiene {guardiasExistentes} guardia{guardiasExistentes === 1 ? "" : "s"}. Puedes invitar a más o continuar.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="ob-invitar-correo">Correo</Label>
          <Input
            id="ob-invitar-correo"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="correo@residencial.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div className="sm:w-40">
          <div className="flex flex-wrap items-center gap-x-1">
            <Label htmlFor="ob-invitar-rol">Rol</Label>
            <AyudaCampo id="ob-invitar-rol" etiqueta="Rol">
              El guardia trabaja desde la app de portería: registra paquetes, avisa por WhatsApp y entrega. Tú sigues como administrador.
            </AyudaCampo>
          </div>
          <select
            id="ob-invitar-rol"
            value={rol}
            onChange={(e) => setRol(e.target.value as RoleKey)}
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {ROLES_INVITABLES.map((r) => (
              <option key={r.clave} value={r.clave}>
                {r.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={handleInvitar} disabled={!correo.trim() || enviando} className="w-full sm:w-auto">
          <Send className="h-4 w-4" />
          {enviando ? "Enviando…" : "Invitar"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {invitados.length > 0 && (
        <div className="space-y-1.5 rounded-md bg-success/5 p-3">
          {invitados.map((email, i) => (
            <p key={i} className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {email}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button onClick={onContinuar} className="flex-1">
          Continuar {usuariosCreados > 0 && `(${usuariosCreados} invitado${usuariosCreados > 1 ? "s" : ""})`}
          <ChevronRight className="h-4 w-4" />
        </Button>
        {invitados.length === 0 && (
          <button onClick={onContinuar} className="text-sm text-muted-foreground underline">
            Omitir por ahora
          </button>
        )}
      </div>
    </TarjetaPaso>
  );
}

function PasoBodega({
  tenantId,
  userId,
  ubicacionesIniciales,
  onContinuar,
}: {
  tenantId: string;
  userId: string;
  ubicacionesIniciales: UbicacionAdmin[];
  onContinuar: () => void;
}) {
  return (
    <TarjetaPaso>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Warehouse className="h-4 w-4" />
        Paso 5 de 6 — Configurar bodega
      </div>
      <div className="flex flex-wrap items-center gap-x-1">
        <p className="text-sm text-muted-foreground">
          Solo lo básico para empezar a operar — puedes agregar más ubicaciones después desde Configuración → Bodega.
        </p>
        <AyudaCampo id="ob-ubicaciones" etiqueta="Ubicaciones de bodega">
          Una ubicación es el lugar donde se guarda un paquete (por ejemplo, «Bodega» y dentro «Estante A»). Al registrar cada paquete, el guardia
          elige una; así cualquiera del equipo sabe dónde buscarlo al entregarlo.
        </AyudaCampo>
      </div>
      <BodegaClient tenantId={tenantId} userId={userId} ubicacionesIniciales={ubicacionesIniciales} />
      <div className="border-t border-border pt-4">
        <Button onClick={onContinuar} className="w-full">
          Continuar
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </TarjetaPaso>
  );
}

function PasoFinalizar({ tenantId, progreso }: { tenantId: string; progreso: ProgresoConfiguracion | null }) {
  const [finalizando, setFinalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinalizar() {
    setFinalizando(true);
    setError(null);
    try {
      await marcarAsistenteCerrado(createBrowserSupabaseClient(), tenantId);
      irAlDashboard();
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo terminar el asistente. Intenta de nuevo."));
      setFinalizando(false);
    }
  }

  // Con los datos reales del residencial (los mismos de «Primeros pasos»).
  const items = progreso?.pasos ?? [];

  return (
    <TarjetaPaso>
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <PartyPopper className="h-10 w-10 text-primary" />
        <h2 className="font-display text-xl font-semibold">GateFlow está listo para comenzar a operar.</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Lo pendiente no bloquea nada: lo encuentras en «Primeros pasos», en el Dashboard, y puedes volver a este asistente cuando quieras.
        </p>
      </div>

      {items.length > 0 && (
        <ul className="space-y-2" data-resumen-asistente>
          {items.map((item) => (
            <li key={item.clave} data-paso={item.clave} data-listo={item.listo ? "1" : "0"} className="flex items-start gap-2 text-sm">
              {item.listo ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              )}
              <span className={item.listo ? "" : "text-muted-foreground"}>
                {item.titulo}
                {!item.listo && <span className="text-xs"> (pendiente: puedes hacerlo después)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button onClick={handleFinalizar} disabled={finalizando} size="lg" className="w-full">
        {finalizando ? "Entrando…" : "Ir al Dashboard"}
        <Package className="h-4 w-4" />
      </Button>
    </TarjetaPaso>
  );
}

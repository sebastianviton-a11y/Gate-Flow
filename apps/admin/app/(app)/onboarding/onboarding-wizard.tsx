"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Loader2, Send, Upload, Building2, Users, Package, Warehouse, PartyPopper } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import type { UbicacionAdmin } from "@gateflow/paquetes";
import type { RoleKey } from "@gateflow/types";
import { Button, Input, Label, GateFlowLogo, obtenerMensajeError } from "@gateflow/ui";
import { ImportarUnidades } from "../unidades/importar-unidades";
import { BodegaClient } from "../configuracion/bodega/bodega-client";
import { invitarUsuarioResidencial } from "./invitar-usuario-action";

const TOTAL_PASOS = 6;

interface Props {
  tenantId: string;
  userId: string;
  nombreInicial: string;
  telefonoInicial: string;
  correoInicial: string;
  direccionInicial: string;
  logoUrlInicial: string | null;
  ubicacionesIniciales: UbicacionAdmin[];
}

export function OnboardingWizard(props: Props) {
  const [paso, setPaso] = useState(1);
  const [residentesImportados, setResidentesImportados] = useState(false);
  const [usuariosCreados, setUsuariosCreados] = useState(0);

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="flex items-center gap-2">
        {Array.from({ length: TOTAL_PASOS }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= paso ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      {paso === 1 && <PasoBienvenida onContinuar={() => setPaso(2)} />}
      {paso === 2 && <PasoInformacion {...props} onContinuar={() => setPaso(3)} />}
      {paso === 3 && (
        <PasoImportarResidentes
          tenantId={props.tenantId}
          onImportado={() => setResidentesImportados(true)}
          onContinuar={() => setPaso(4)}
        />
      )}
      {paso === 4 && <PasoCrearUsuarios onInvitado={() => setUsuariosCreados((n) => n + 1)} usuariosCreados={usuariosCreados} onContinuar={() => setPaso(5)} />}
      {paso === 5 && (
        <PasoBodega tenantId={props.tenantId} userId={props.userId} ubicacionesIniciales={props.ubicacionesIniciales} onContinuar={() => setPaso(6)} />
      )}
      {paso === 6 && (
        <PasoFinalizar
          tenantId={props.tenantId}
          residentesImportados={residentesImportados}
          usuariosCreados={usuariosCreados}
          bodegaConfigurada={props.ubicacionesIniciales.length > 0}
        />
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
    try {
      const extension = archivo.name.split(".").pop() ?? "png";
      const path = `${tenantId}/logo.${extension}`;
      await supabase.storage.from("logos").upload(path, archivo, { contentType: archivo.type, upsert: true });
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      setLogoUrl(`${data.publicUrl}?v=${Date.now()}`);
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
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="ob-nombre">Nombre comercial</Label>
          <Input id="ob-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="ob-telefono">Teléfono</Label>
          <Input id="ob-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label htmlFor="ob-correo">Correo</Label>
          <Input id="ob-correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className="mt-1.5" />
        </div>
        <div className="col-span-2">
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

function PasoImportarResidentes({ tenantId, onImportado, onContinuar }: { tenantId: string; onImportado: () => void; onContinuar: () => void }) {
  const [importoAlgo, setImportoAlgo] = useState(false);

  return (
    <TarjetaPaso>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Users className="h-4 w-4" />
        Paso 3 de 6 — Importar residentes
      </div>
      <p className="text-sm text-muted-foreground">
        Descarga la plantilla, complétala con tus residentes y súbela — verás cuántos registros se encontraron, duplicados y errores antes de
        confirmar nada.
      </p>
      <ImportarUnidades
        tenantId={tenantId}
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

const ROLES_INVITABLES: { clave: RoleKey; etiqueta: string }[] = [
  { clave: "admin_residencial", etiqueta: "Administrador adicional" },
  { clave: "guardia", etiqueta: "Guardia" },
  { clave: "recepcion", etiqueta: "Recepción" },
  { clave: "supervisor", etiqueta: "Supervisor" },
];

function PasoCrearUsuarios({
  onInvitado,
  usuariosCreados,
  onContinuar,
}: {
  onInvitado: () => void;
  usuariosCreados: number;
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

      <div className="flex gap-2">
        <Input type="email" placeholder="correo@residencial.com" value={correo} onChange={(e) => setCorreo(e.target.value)} className="flex-1" />
        <select value={rol} onChange={(e) => setRol(e.target.value as RoleKey)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          {ROLES_INVITABLES.map((r) => (
            <option key={r.clave} value={r.clave}>
              {r.etiqueta}
            </option>
          ))}
        </select>
        <Button onClick={handleInvitar} disabled={!correo.trim() || enviando}>
          <Send className="h-4 w-4" />
          {enviando ? "…" : "Invitar"}
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
      <p className="text-sm text-muted-foreground">
        Solo lo básico para empezar a operar — puedes agregar más ubicaciones después desde Configuración → Bodega.
      </p>
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

function PasoFinalizar({
  tenantId,
  residentesImportados,
  usuariosCreados,
  bodegaConfigurada,
}: {
  tenantId: string;
  residentesImportados: boolean;
  usuariosCreados: number;
  bodegaConfigurada: boolean;
}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [finalizando, setFinalizando] = useState(false);

  async function handleFinalizar() {
    setFinalizando(true);
    await supabase.from("tenants").update({ onboarding_completado: true }).eq("id", tenantId);
    router.replace("/dashboard");
    router.refresh();
  }

  const items = [
    { label: "Residencial configurado", listo: true },
    { label: "Residentes importados", listo: residentesImportados },
    { label: "Usuarios creados", listo: usuariosCreados > 0 },
    { label: "Bodega configurada", listo: bodegaConfigurada },
  ];

  return (
    <TarjetaPaso>
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <PartyPopper className="h-10 w-10 text-primary" />
        <h2 className="font-display text-xl font-semibold">GateFlow está listo para comenzar a operar.</h2>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className={`h-4 w-4 ${item.listo ? "text-success" : "text-muted-foreground/40"}`} />
            <span className={item.listo ? "" : "text-muted-foreground"}>{item.label}</span>
            {!item.listo && <span className="text-xs text-muted-foreground">(pendiente — se puede hacer después)</span>}
          </div>
        ))}
      </div>

      <Button onClick={handleFinalizar} disabled={finalizando} size="lg" className="w-full">
        {finalizando ? "Entrando…" : "Ir al Dashboard"}
        <Package className="h-4 w-4" />
      </Button>
    </TarjetaPaso>
  );
}

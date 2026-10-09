"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Clock, Home, Link2Off, Loader2, MessageCircle, Pencil } from "lucide-react";
import { Button, Input, Label } from "@gateflow/ui";
import {
  AYUDA_WHATSAPP,
  EJEMPLO_WHATSAPP,
  errorCampoResidente,
  formatearWhatsApp,
  LIMITES_RESIDENTE,
  PREFIJO_WHATSAPP,
  validarDatosResidente,
  type CampoResidente,
  type DatosResidente,
  type PaisResidencial,
} from "@gateflow/paquetes";
import { TurnstileWidget, type TurnstileHandle } from "../registro/turnstile-widget";
import { consultarEnlaceResidente, enviarDatosResidente } from "./actions";

type Fase =
  | { tipo: "cargando" }
  | { tipo: "no_disponible"; mensaje: string; revocado: boolean }
  | { tipo: "formulario" }
  | { tipo: "resumen"; telefono: string }
  | { tipo: "enviado"; mensaje: string };

const ORDEN: CampoResidente[] = ["nombre", "apellido", "direccion", "whatsapp"];
const VACIO: DatosResidente = { nombre: "", apellido: "", direccion: "", whatsapp: "" };
// Tras "lo enviaste muy rápido": segundos antes de poder reenviar. Más
// que el mínimo del servidor (4 s desde que se abrió el formulario).
const ESPERA_REENVIO_S = 5;
// Qué pasa después del envío: el residente no recibe aviso de la
// aprobación, así que se le explica una sola vez, sin prometer plazos.
const QUE_SIGUE =
  "Cuando la administración apruebe tus datos, la guardia podrá avisarte por WhatsApp cuando llegue un paquete. No necesitas crear una cuenta.";
const AYUDA_DIRECCION =
  "Escribe la dirección que utilizas para recibir tus pedidos: calle, número, torre o departamento, según corresponda.";

export function AltaResidente({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [fase, setFase] = useState<Fase>({ tipo: "cargando" });
  const [token, setToken] = useState("");
  const [residencial, setResidencial] = useState("");
  const [pais, setPais] = useState<PaisResidencial>("MX");
  const [tiempo, setTiempo] = useState("");
  const [valores, setValores] = useState<DatosResidente>(VACIO);
  const [errores, setErrores] = useState<Partial<Record<CampoResidente, string>>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [espera, setEspera] = useState<{ mensaje: string; segundos: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tokenDesafio, setTokenDesafio] = useState<string | null>(null);
  const [errorDesafio, setErrorDesafio] = useState(false);
  const desafio = useRef<TurnstileHandle>(null);
  // Trampa para bots: se guarda en el estado (el campo no existe en el resumen).
  const [trampa, setTrampa] = useState("");
  const refs = {
    nombre: useRef<HTMLInputElement>(null),
    apellido: useRef<HTMLInputElement>(null),
    direccion: useRef<HTMLInputElement>(null),
    whatsapp: useRef<HTMLInputElement>(null),
  };
  const faltaDesafio = turnstileSiteKey !== null && !tokenDesafio;

  // El token del enlace va después del #: solo lo ve el navegador.
  useEffect(() => {
    const t = window.location.hash.replace(/^#/, "").trim();
    setToken(t);
    let activo = true;
    consultarEnlaceResidente(t)
      .then((r) => {
        if (!activo) return;
        if (r.estado === "activo") {
          setResidencial(r.residencial);
          setPais(r.pais);
          setTiempo(r.t);
          setFase({ tipo: "formulario" });
        } else {
          setFase({ tipo: "no_disponible", mensaje: r.mensaje, revocado: r.estado === "revocado" });
        }
      })
      .catch(() => {
        if (activo) setFase({ tipo: "no_disponible", mensaje: "No pudimos abrir el formulario. Revisa tu conexión y recarga la página.", revocado: false });
      });
    return () => {
      activo = false;
    };
  }, []);

  // Cuenta regresiva para volver a enviar (nada se guardó todavía).
  useEffect(() => {
    if (!espera || espera.segundos <= 0) return;
    const id = window.setTimeout(() => setEspera((e) => (e ? { ...e, segundos: e.segundos - 1 } : e)), 1000);
    return () => window.clearTimeout(id);
  }, [espera]);
  const esperando = (espera?.segundos ?? 0) > 0;

  function cambiar(campo: CampoResidente, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    // Si el campo tenía un error, se revalida mientras se corrige.
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: errorCampoResidente(campo, valor, pais) ?? undefined }));
  }

  function salir(campo: CampoResidente) {
    if (!valores[campo]) return; // vacío: se avisa al continuar
    setErrores((e) => ({ ...e, [campo]: errorCampoResidente(campo, valores[campo], pais) ?? undefined }));
  }

  function continuar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorGeneral(null);
    const r = validarDatosResidente(valores, pais);
    if (!r.ok) {
      setErrores(r.errores);
      const primero = ORDEN.find((c) => r.errores[c]);
      if (primero) refs[primero].current?.focus();
      return;
    }
    setErrores({});
    setValores({ nombre: r.datos.nombre, apellido: r.datos.apellido, direccion: r.datos.direccion, whatsapp: valores.whatsapp.trim() });
    setFase({ tipo: "resumen", telefono: r.datos.telefono });
    window.scrollTo({ top: 0 });
  }

  async function confirmar() {
    if (fase.tipo !== "resumen" || esperando) return;
    setEnviando(true);
    setErrorGeneral(null);
    setEspera(null);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("nombre", valores.nombre);
    fd.set("apellido", valores.apellido);
    fd.set("direccion", valores.direccion);
    fd.set("whatsapp", valores.whatsapp);
    fd.set("t", tiempo);
    fd.set("sitio_web", trampa);
    fd.set("cf-turnstile-response", tokenDesafio ?? "");
    let r: Awaited<ReturnType<typeof enviarDatosResidente>>;
    try {
      r = await enviarDatosResidente(fd);
    } catch {
      r = { tipo: "error", mensaje: "No pudimos enviar tus datos. Revisa tu conexión e inténtalo de nuevo." };
    }
    if (r.tipo !== "enviado") desafio.current?.reset();
    switch (r.tipo) {
      case "enviado":
        setEnviando(false);
        setFase({ tipo: "enviado", mensaje: r.mensaje });
        window.scrollTo({ top: 0 });
        return;
      case "campos":
        setEnviando(false);
        setErrores(r.errores);
        setFase({ tipo: "formulario" });
        return;
      case "no_disponible":
        setEnviando(false);
        setFase({ tipo: "no_disponible", mensaje: r.mensaje, revocado: r.motivo === "revocado" });
        return;
      case "esperar":
        // No se guardó nada. Si el token de tiempo venció, se pide otro
        // (sin recargar: los datos siguen en pantalla).
        if (r.renovar) {
          try {
            const nuevo = await consultarEnlaceResidente(token);
            if (nuevo.estado !== "activo") {
              setEnviando(false);
              setFase({ tipo: "no_disponible", mensaje: nuevo.mensaje, revocado: nuevo.estado === "revocado" });
              return;
            }
            setTiempo(nuevo.t);
          } catch {
            setEnviando(false);
            setErrorGeneral("No pudimos enviar tus datos. Revisa tu conexión e inténtalo de nuevo.");
            return;
          }
        }
        setEnviando(false);
        setEspera({ mensaje: r.mensaje, segundos: ESPERA_REENVIO_S });
        return;
      case "error":
        setEnviando(false);
        setErrorGeneral(r.mensaje);
        return;
    }
  }

  if (fase.tipo === "cargando") {
    return (
      <Marco>
        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Abriendo el formulario…</p>
        </div>
      </Marco>
    );
  }

  if (fase.tipo === "no_disponible") {
    return (
      <Marco>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Link2Off className="h-10 w-10 text-muted-foreground" />
          <h1 className="font-display text-lg font-semibold">{fase.revocado ? "Este enlace no está activo" : "Registro no disponible"}</h1>
          <p className="text-sm text-muted-foreground">{fase.mensaje}</p>
        </div>
      </Marco>
    );
  }

  if (fase.tipo === "enviado") {
    return (
      <Marco residencial={residencial}>
        <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="residente-enviado">
          <CheckCircle2 className="h-12 w-12 text-success" />
          <h1 className="font-display text-xl font-semibold">¡Listo!</h1>
          <p className="text-base">{fase.mensaje}</p>
          <p className="text-sm text-muted-foreground" data-testid="residente-que-sigue">{QUE_SIGUE}</p>
          <p className="text-sm text-muted-foreground">Ya puedes cerrar esta página.</p>
        </div>
      </Marco>
    );
  }

  if (fase.tipo === "resumen") {
    return (
      <Marco residencial={residencial}>
        <h1 className="font-display text-xl font-semibold">Revisa tus datos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Antes de enviar, confirma que la dirección y el número sean correctos. No podemos comprobarlos automáticamente: un error de
          tipeo haría que el aviso no te llegue.
        </p>
        <dl className="mt-5 space-y-3" data-testid="residente-resumen">
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Home className="h-3.5 w-3.5" /> Dirección
            </dt>
            <dd className="mt-1 break-words text-lg font-semibold">{valores.direccion}</dd>
          </div>
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{formatearWhatsApp(fase.telefono, pais)}</dd>
          </div>
          <div className="rounded-lg border border-border p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nombre y apellido</dt>
            <dd className="mt-1 break-words text-base font-medium">
              {valores.nombre} {valores.apellido}
            </dd>
          </div>
        </dl>

        {turnstileSiteKey && (
          <div className="mt-5 space-y-1.5">
            <TurnstileWidget
              ref={desafio}
              siteKey={turnstileSiteKey}
              accion="alta_residente"
              tema="light"
              onToken={(t) => {
                setTokenDesafio(t);
                if (t) setErrorDesafio(false);
              }}
              onError={() => setErrorDesafio(true)}
            />
            {errorDesafio ? (
              <p role="alert" className="text-center text-xs text-destructive">
                No pudimos cargar la verificación anti-robots. Recarga la página e inténtalo de nuevo.
              </p>
            ) : (
              faltaDesafio && <p className="text-center text-xs text-muted-foreground">Comprobando que no eres un robot…</p>
            )}
          </div>
        )}

        {errorGeneral && (
          <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorGeneral}
          </p>
        )}
        {espera && (
          <p role="status" className="mt-4 flex items-start gap-2 rounded-md bg-warn/15 px-3 py-2 text-sm text-warn-foreground" data-testid="residente-esperar">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{espera.mensaje}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
          <Button type="button" variant="outline" className="h-12 flex-1 text-base" onClick={() => setFase({ tipo: "formulario" })} disabled={enviando}>
            <Pencil className="h-4 w-4" />
            Corregir
          </Button>
          <Button type="button" className="h-12 flex-1 text-base" onClick={confirmar} disabled={enviando || faltaDesafio || esperando}>
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            {enviando ? "Enviando…" : esperando ? `Espera ${espera?.segundos} s` : "Confirmar y enviar"}
          </Button>
        </div>
      </Marco>
    );
  }

  const campo = (c: CampoResidente) => ({
    id: `residente-${c}`,
    name: c,
    value: valores[c],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => cambiar(c, e.target.value),
    onBlur: () => salir(c),
    "aria-invalid": errores[c] ? true : undefined,
    "aria-describedby": [errores[c] ? `residente-${c}-error` : null, c === "direccion" || c === "whatsapp" ? `residente-${c}-ayuda` : null]
      .filter(Boolean)
      .join(" ") || undefined,
    className: `h-12 text-base ${errores[c] ? "border-destructive focus-visible:ring-destructive" : ""}`,
  });

  return (
    <Marco residencial={residencial}>
      <h1 className="font-display text-xl font-semibold">Carga tus datos de residente</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Así la administración y la guardia podrán avisarte cuando llegue un paquete. No necesitas cuenta ni contraseña.
      </p>

      <form onSubmit={continuar} noValidate className="mt-5 space-y-4" data-testid="residente-formulario">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo c="nombre" etiqueta="Nombre" error={errores.nombre}>
            <Input ref={refs.nombre} {...campo("nombre")} autoComplete="given-name" maxLength={LIMITES_RESIDENTE.nombre + 20} />
          </Campo>
          <Campo c="apellido" etiqueta="Apellido" error={errores.apellido}>
            <Input ref={refs.apellido} {...campo("apellido")} autoComplete="family-name" maxLength={LIMITES_RESIDENTE.apellido + 20} />
          </Campo>
        </div>

        <Campo c="direccion" etiqueta="Dirección dentro del residencial" error={errores.direccion} ayuda={AYUDA_DIRECCION}>
          <Input ref={refs.direccion} {...campo("direccion")} autoComplete="off" maxLength={LIMITES_RESIDENTE.direccionMax + 20} />
        </Campo>

        <Campo c="whatsapp" etiqueta="Número de WhatsApp" error={errores.whatsapp} ayuda={AYUDA_WHATSAPP[pais]}>
          <div className="flex">
            <span
              className="inline-flex h-12 shrink-0 items-center whitespace-nowrap rounded-l-md border border-r-0 border-input bg-muted px-3 text-base text-muted-foreground"
              aria-label={`Código de país ${PREFIJO_WHATSAPP[pais]}`}
              data-testid="residente-prefijo"
            >
              {PREFIJO_WHATSAPP[pais]}
            </span>
            <Input
              ref={refs.whatsapp}
              {...campo("whatsapp")}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={EJEMPLO_WHATSAPP[pais]}
              maxLength={30}
              className={`${campo("whatsapp").className} rounded-l-none`}
            />
          </div>
        </Campo>

        {/* Trampa para bots: invisible para personas y lectores de pantalla. */}
        <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="sitio_web">Sitio web</label>
          <input id="sitio_web" name="sitio_web" type="text" tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} />
        </div>

        <p className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]" data-testid="residente-privacidad">
          <strong className="font-medium text-foreground">Privacidad.</strong> Tu nombre, apellido, dirección y WhatsApp los recibe la administración
          de {residencial} para identificarte como residente y avisarte cuando llegue un paquete. Se guardan en Gate Flow, el sistema que usa la
          administración; no se muestran a otros residentes. Más información en el{" "}
          <a href="/privacidad" target="_blank" rel="noopener noreferrer" className="text-primary underline">
            Aviso de Privacidad
          </a>
          .
        </p>

        <Button type="submit" className="h-12 w-full text-base">
          Continuar
        </Button>
      </form>
    </Marco>
  );
}

function Marco({ residencial, children }: { residencial?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        {residencial && (
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]" data-testid="residente-residencial">
            {residencial}
          </p>
        )}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">{children}</div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Registro de residentes · Gate Flow</p>
      </div>
    </div>
  );
}

function Campo({
  c,
  etiqueta,
  error,
  ayuda,
  children,
}: {
  c: CampoResidente;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`residente-${c}`} className="text-sm font-medium">
        {etiqueta}
      </Label>
      {ayuda && (
        <p id={`residente-${c}-ayuda`} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      )}
      {children}
      {error && (
        <p id={`residente-${c}-error`} role="alert" className="text-sm text-destructive" data-testid={`residente-${c}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

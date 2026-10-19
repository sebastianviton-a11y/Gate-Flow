import { unstable_noStore as noStore } from "next/cache";
import { AlertTriangle, Clock, FileText, History } from "lucide-react";
import { GateFlowLogo, formatearFecha } from "@gateflow/ui";
import { createAnonServerClient } from "@gateflow/supabase";
import { AvisoStagingLegal } from "@/components/shared/aviso-staging-legal";
import {
  DOCUMENTOS,
  ETIQUETA_SITUACION,
  PAISES,
  hrefDocumento,
  leerDocumentoLegal,
  nombrePais,
  normalizarPais,
  normalizarVersionId,
  zonaPais,
  type ClaveDocumento,
  type Pais,
  type ResultadoDocumento,
  type VersionHistorial,
} from "@/lib/legal/documentos";
import { ContenidoLegal } from "./contenido-legal";

export type ParametrosLegales = { pais?: string | string[]; version?: string | string[] };

const fecha = (iso: string, pais: Pais) => formatearFecha(iso, zonaPais(pais), { day: "numeric", month: "long", year: "numeric" });

/**
 * Página pública de un documento legal. Sin sesión: lee con el cliente
 * anónimo del servidor y SOLO por las funciones de documentos publicados
 * (migración 20261015000000). Sin esa migración, o si la lectura falla,
 * muestra el estado "pendiente": nunca un texto que no esté publicado.
 */
export async function PaginaDocumentoLegal({ clave, searchParams }: { clave: ClaveDocumento; searchParams: ParametrosLegales }) {
  // Nunca desde la caché de datos de Next (ver app/terminos/page.tsx).
  noStore();
  const pais = normalizarPais(searchParams.pais);
  const versionId = normalizarVersionId(searchParams.version);
  const resultado = await leerDocumentoLegal(createAnonServerClient(), clave, pais, versionId);
  const titulo = DOCUMENTOS[clave].titulo;

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <GateFlowLogo size={36} withWordmark />
          <SelectorPais clave={clave} actual={resultado.pais} />
        </header>

        <AvisoStagingLegal />

        <article className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8" data-testid="legal-documento" data-estado={resultado.tipo}>
          <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{titulo}</h1>
          <Cuerpo resultado={resultado} clave={clave} titulo={titulo} />
        </article>

        {"historial" in resultado && resultado.historial.length > 0 && (
          <Historial clave={clave} pais={resultado.pais} historial={resultado.historial} actual={resultado.tipo === "publicado" ? resultado.documento.versionId : null} />
        )}

        <nav aria-label="Documentos legales" className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-2 text-sm text-muted-foreground">
          {(Object.keys(DOCUMENTOS) as ClaveDocumento[]).map((c) => (
            <a key={c} href={hrefDocumento(c, resultado.pais)} aria-current={c === clave ? "page" : undefined} className={c === clave ? "font-semibold text-foreground" : "hover:text-foreground"}>
              {DOCUMENTOS[c].titulo}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

function SelectorPais({ clave, actual }: { clave: ClaveDocumento; actual: Pais }) {
  return (
    <nav aria-label="País" className="inline-flex rounded-lg border border-border bg-card p-1 text-sm" data-testid="legal-paises">
      {PAISES.map((p) => (
        <a
          key={p.codigo}
          href={hrefDocumento(clave, p.codigo)}
          aria-current={p.codigo === actual ? "true" : undefined}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${p.codigo === actual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {p.nombre}
        </a>
      ))}
    </nav>
  );
}

function Cuerpo({ resultado, clave, titulo }: { resultado: ResultadoDocumento; clave: ClaveDocumento; titulo: string }) {
  if (resultado.tipo === "publicado") {
    const d = resultado.documento;
    return (
      <>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid="legal-meta">
          <span>
            Versión <span className="font-semibold text-foreground">{d.version}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {d.situacion === "programada" ? "Entra en vigor el " : "Vigente desde el "}
            <span className="font-semibold text-foreground">{fecha(d.vigenteDesde, d.pais)}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>{nombrePais(d.pais)}</span>
        </p>
        {d.situacion !== "vigente" && <AvisoVersion situacion={d.situacion} clave={clave} pais={d.pais} retiradoEn={d.retiradoEn} vigenteDesde={d.vigenteDesde} />}
        <div className="mt-6 border-t border-border pt-6">
          <ContenidoLegal contenido={d.contenido} />
        </div>
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          Huella del texto (SHA-256): <span className="font-mono">{d.sha256}</span>
        </p>
      </>
    );
  }
  if (resultado.tipo === "version_no_encontrada") {
    return (
      <Aviso tono="neutro" icono={<FileText className="mt-0.5 h-4 w-4 shrink-0" />} testid="legal-version-no-encontrada">
        <p className="font-semibold">No encontramos esa versión de {titulo}.</p>
        <p className="mt-1">
          Puede que el enlace esté incompleto o que la versión no se haya publicado.{" "}
          <a className="text-primary underline" href={hrefDocumento(clave, resultado.pais)}>
            Ver la versión vigente
          </a>
          .
        </p>
      </Aviso>
    );
  }
  // pendiente / no_disponible: nunca se muestra texto como si fuera definitivo.
  const programada = resultado.tipo === "pendiente" ? resultado.historial.find((h) => h.situacion === "programada") : undefined;
  return (
    <Aviso tono="pendiente" icono={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />} testid="legal-pendiente">
      <p className="font-semibold">Documento pendiente de publicación · no definitivo</p>
      <p className="mt-1">
        {resultado.tipo === "no_disponible"
          ? "No pudimos cargar este documento en este momento. Inténtalo de nuevo más tarde."
          : `Todavía no hay una versión oficial publicada de este documento para ${nombrePais(resultado.pais)}.`}{" "}
        Este aviso no es el texto legal definitivo.
      </p>
      {programada && (
        <p className="mt-2">
          Hay una versión publicada que entrará en vigor el {fecha(programada.vigenteDesde, programada.pais)}:{" "}
          <a className="text-primary underline" href={hrefDocumento(clave, programada.pais, programada.versionId)}>
            consultarla
          </a>
          .
        </p>
      )}
    </Aviso>
  );
}

function AvisoVersion({ situacion, clave, pais, retiradoEn, vigenteDesde }: { situacion: "programada" | "anterior" | "retirada"; clave: ClaveDocumento; pais: Pais; retiradoEn: string | null; vigenteDesde: string }) {
  const textos = {
    programada: `Esta versión está publicada pero todavía no está vigente: entra en vigor el ${fecha(vigenteDesde, pais)}.`,
    anterior: "Estás viendo una versión anterior. Ya no es la vigente.",
    retirada: `Esta versión fue retirada${retiradoEn ? ` el ${fecha(retiradoEn, pais)}` : ""}. Se conserva como historial y no es la vigente.`,
  };
  return (
    <Aviso tono={situacion === "programada" ? "neutro" : "pendiente"} icono={situacion === "programada" ? <Clock className="mt-0.5 h-4 w-4 shrink-0" /> : <History className="mt-0.5 h-4 w-4 shrink-0" />} testid={`legal-aviso-${situacion}`}>
      <p>
        {textos[situacion]}{" "}
        <a className="text-primary underline" href={hrefDocumento(clave, pais)}>
          Ver la versión vigente
        </a>
        .
      </p>
    </Aviso>
  );
}

function Aviso({ tono, icono, testid, children }: { tono: "pendiente" | "neutro"; icono: React.ReactNode; testid: string; children: React.ReactNode }) {
  const clases = tono === "pendiente" ? "border-warn/40 bg-warn/10 text-warn-foreground" : "border-border bg-muted/60 text-foreground";
  return (
    <div role="status" className={`mt-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${clases}`} data-testid={testid}>
      {icono}
      <div>{children}</div>
    </div>
  );
}

function Historial({ clave, pais, historial, actual }: { clave: ClaveDocumento; pais: Pais; historial: VersionHistorial[]; actual: string | null }) {
  return (
    <section aria-labelledby="historial-titulo" className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" data-testid="legal-historial">
      <h2 id="historial-titulo" className="flex items-center gap-2 font-display text-base font-semibold">
        <History className="h-4 w-4" /> Versiones publicadas · {nombrePais(pais)}
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {historial.map((h) => (
          <li key={h.versionId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-situacion={h.situacion}>
            <div className="min-w-0">
              <a href={hrefDocumento(clave, pais, h.versionId)} aria-current={h.versionId === actual ? "true" : undefined} className="font-semibold text-primary underline">
                Versión {h.version}
              </a>
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{ETIQUETA_SITUACION[h.situacion]}</span>
              {h.resumenCambios && <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{h.resumenCambios}</p>}
            </div>
            <p className="shrink-0 text-sm text-muted-foreground">
              {h.situacion === "programada" ? "Desde el " : "Vigente desde el "}
              {fecha(h.vigenteDesde, pais)}
              {h.retiradoEn ? ` · retirada el ${fecha(h.retiradoEn, pais)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

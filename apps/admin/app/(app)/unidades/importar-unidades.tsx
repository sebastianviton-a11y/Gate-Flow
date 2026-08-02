"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload, AlertCircle, CheckCircle2, Loader2, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@gateflow/ui";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { importarUnidadesMasivo, type FilaImportarUnidad, type ResultadoImportacion } from "@gateflow/paquetes";
import { validarCSVUnidades, type FilaValidada } from "@/lib/csv";
import { cargarXLSXDesdeCDN, descargarPlantillaCSV, descargarPlantillaXLSX } from "@/lib/generar-plantilla";

type Paso = "inicio" | "revisando" | "importando" | "resumen";

const ACCEPT_ARCHIVOS =
  ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

interface ImportarUnidadesProps {
  tenantId: string;
  onImportado: () => void;
  archivoExterno?: File | null;
  onArchivoConsumido?: () => void;
  onSolicitarArchivo?: () => void;
}

/** Botones de plantilla — se muestran en TODOS los pasos (inicio,
 * revisando con o sin error, importando, resumen), nunca solo en el
 * primero. Es la corrección directa del punto 1: antes vivían dentro
 * del bloque `if (paso === "inicio")`, así que desaparecían en cuanto
 * el usuario avanzaba o encontraba un error. */
function BotonesPlantilla({ compacto = false }: { compacto?: boolean }) {
  const [descargandoXlsx, setDescargandoXlsx] = useState(false);
  const [errorXlsx, setErrorXlsx] = useState<string | null>(null);

  async function handleDescargarXlsx() {
    setErrorXlsx(null);
    setDescargandoXlsx(true);
    try {
      await descargarPlantillaXLSX();
    } catch {
      setErrorXlsx("No se pudo generar el Excel. Descarga el CSV mientras tanto.");
    } finally {
      setDescargandoXlsx(false);
    }
  }

  return (
    <div className={compacto ? "flex flex-wrap items-center gap-2" : "flex flex-wrap gap-2"}>
      <Button variant="outline" size="sm" onClick={handleDescargarXlsx} disabled={descargandoXlsx} type="button">
        {descargandoXlsx ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Descargar plantilla (Excel)
      </Button>
      <Button variant="outline" size="sm" onClick={descargarPlantillaCSV} type="button">
        <FileText className="h-4 w-4" />
        Descargar plantilla (CSV)
      </Button>
      {errorXlsx && <p className="w-full text-xs text-destructive">{errorXlsx}</p>}
    </div>
  );
}

export function ImportarUnidades({
  tenantId,
  onImportado,
  archivoExterno,
  onArchivoConsumido,
  onSolicitarArchivo,
}: ImportarUnidadesProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paso, setPaso] = useState<Paso>("inicio");
  const [filas, setFilas] = useState<FilaValidada[]>([]);
  const [columnasFaltantes, setColumnasFaltantes] = useState<string[]>([]);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  function reiniciarEstadoDeArchivo() {
    setFilas([]);
    setColumnasFaltantes([]);
    setErrorLectura(null);
    setResultado(null);
  }

  async function procesarArchivo(archivo: File) {
    reiniciarEstadoDeArchivo();
    const nombre = archivo.name.toLowerCase();
    const esExcel = nombre.endsWith(".xlsx") || nombre.endsWith(".xls");

    let contenido: string;
    try {
      if (esExcel) {
        const XLSX = await cargarXLSXDesdeCDN();
        const buffer = await archivo.arrayBuffer();
        const libro = XLSX.read(buffer, { type: "array" });
        const nombrePrimeraHoja = libro.SheetNames[0];
        if (!nombrePrimeraHoja) throw new Error("El archivo no tiene ninguna hoja.");
        const hoja = libro.Sheets[nombrePrimeraHoja];
        contenido = XLSX.utils.sheet_to_csv(hoja);
      } else {
        contenido = await archivo.text();
      }
    } catch (e) {
      console.error("[GateFlow] No se pudo leer el archivo de importación:", e);
      setErrorLectura("No fue posible leer el archivo. Verifica que no esté dañado o protegido con contraseña.");
      setPaso("revisando");
      return;
    }

    const { encabezadoValido, columnasFaltantes: faltantes, filas: filasValidadas } = validarCSVUnidades(contenido);

    if (!encabezadoValido) {
      setColumnasFaltantes(faltantes);
      setPaso("revisando");
      return;
    }

    setFilas(filasValidadas);
    setPaso("revisando");
  }

  async function handleArchivoInterno(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    if (!archivo) return;
    await procesarArchivo(archivo);
    if (inputRef.current) inputRef.current.value = "";
  }

  useEffect(() => {
    if (archivoExterno) {
      procesarArchivo(archivoExterno).then(() => onArchivoConsumido?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivoExterno]);

  function handleSeleccionarOtroArchivo() {
    reiniciarEstadoDeArchivo();
    setPaso("inicio");
    if (onSolicitarArchivo) onSolicitarArchivo();
    else inputRef.current?.click();
  }

  function handleIntentarNuevamente() {
    reiniciarEstadoDeArchivo();
    setPaso("inicio");
  }

  async function handleConfirmarImportacion() {
    setPaso("importando");
    const supabase = createBrowserSupabaseClient();
    const filasValidas: FilaImportarUnidad[] = filas
      .filter((f) => f.errores.length === 0)
      .map((f) => ({
        tipo: f.datos.tipo as "casa" | "departamento",
        identificador: f.datos.identificador,
        contactoNombre: f.datos.contactoNombre || undefined,
        contactoTelefono: f.datos.contactoTelefono || undefined,
      }));

    const res = await importarUnidadesMasivo(supabase, tenantId, filasValidas);
    setResultado(res);
    setPaso("resumen");
    onImportado();
  }

  const filasConError = filas.filter((f) => f.errores.length > 0);
  const filasValidas = filas.filter((f) => f.errores.length === 0);

  return (
    <div className="space-y-4">
      {/* Persistente en TODOS los pasos — nunca desaparece. */}
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-5">
        <p className="text-sm text-muted-foreground">
          Descarga la plantilla, complétala y súbela — acepta CSV, XLSX o XLS.
        </p>
        <BotonesPlantilla />
      </div>

      {paso === "inicio" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => (onSolicitarArchivo ? onSolicitarArchivo() : inputRef.current?.click())}>
            <Upload className="h-4 w-4" />
            Subir archivo
          </Button>
          {!onSolicitarArchivo && (
            <input ref={inputRef} type="file" accept={ACCEPT_ARCHIVOS} className="hidden" onChange={handleArchivoInterno} />
          )}
        </div>
      )}

      {paso === "revisando" && errorLectura && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-medium">No pudimos leer el archivo.</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{errorLectura}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleSeleccionarOtroArchivo}>
              Seleccionar otro archivo
            </Button>
            <Button variant="ghost" size="sm" onClick={handleIntentarNuevamente}>
              Intentar nuevamente
            </Button>
          </div>
        </div>
      )}

      {paso === "revisando" && !errorLectura && columnasFaltantes.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-medium">No pudimos importar el archivo.</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Faltan las siguientes columnas:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
            {columnasFaltantes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            Descarga nuevamente la plantilla y conserva los encabezados originales.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleSeleccionarOtroArchivo}>
              Seleccionar otro archivo
            </Button>
            <Button variant="ghost" size="sm" onClick={handleIntentarNuevamente}>
              Intentar nuevamente
            </Button>
          </div>
        </div>
      )}

      {paso === "revisando" && !errorLectura && columnasFaltantes.length === 0 && (
        <div className="space-y-4 rounded-lg border border-border p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {filasValidas.length} de {filas.length} filas listas para importar
              {filasConError.length > 0 && ` — ${filasConError.length} con errores`}
            </p>
          </div>

          {filasConError.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border border-warn/30 bg-warn/5 p-3 text-sm">
              {filasConError.map((f) => (
                <p key={f.fila} className="text-warn-foreground">
                  Fila {f.fila} ({f.datos.identificador || "sin identificador"}): {f.errores.join(" ")}
                </p>
              ))}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Identificador</th>
                  <th className="px-3 py-2">Residente</th>
                  <th className="px-3 py-2">Teléfono</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filasValidas.map((f) => (
                  <tr key={f.fila}>
                    <td className="px-3 py-1.5 capitalize">{f.datos.tipo}</td>
                    <td className="px-3 py-1.5 font-medium">{f.datos.identificador}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.datos.contactoNombre || "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{f.datos.contactoTelefono || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConfirmarImportacion} disabled={filasValidas.length === 0}>
              Importar {filasValidas.length} unidad{filasValidas.length === 1 ? "" : "es"}
            </Button>
            <Button variant="outline" onClick={handleSeleccionarOtroArchivo}>
              Seleccionar otro archivo
            </Button>
            <Button variant="ghost" onClick={handleIntentarNuevamente}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {paso === "importando" && (
        <div className="flex items-center gap-2 rounded-lg border border-border p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Importando…
        </div>
      )}

      {paso === "resumen" && resultado && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-5">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            <p className="font-medium">
              {resultado.creadas} unidad{resultado.creadas === 1 ? "" : "es"} importada{resultado.creadas === 1 ? "" : "s"}
            </p>
          </div>
          {resultado.omitidas.length > 0 && (
            <div className="mt-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{resultado.omitidas.length} omitida(s):</p>
              {resultado.omitidas.map((o) => (
                <p key={o.identificador}>
                  {o.identificador}: {o.motivo}
                </p>
              ))}
            </div>
          )}
          <Button variant="ghost" size="sm" className="mt-3" onClick={handleIntentarNuevamente}>
            Importar otro archivo
          </Button>
        </div>
      )}
    </div>
  );
}

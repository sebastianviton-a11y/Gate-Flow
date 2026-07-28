"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@gateflow/ui";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { importarUnidadesMasivo, type FilaImportarUnidad, type ResultadoImportacion } from "@gateflow/paquetes";
import { validarCSVUnidades, type FilaValidada } from "@/lib/csv";

type Paso = "inicio" | "revisando" | "importando" | "resumen";

const ACCEPT_ARCHIVOS =
  ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

interface ImportarUnidadesProps {
  tenantId: string;
  onImportado: () => void;
  /**
   * Modo de input compartido — lo usa Residentes, donde el botón
   * "Importar Excel/CSV" (fuera de este componente) y el botón interno
   * "Subir archivo" deben abrir EXACTAMENTE el mismo selector, no dos
   * independientes. Si no se pasan estas 3 props, el componente sigue
   * funcionando exactamente igual que antes, con su propio input
   * interno — así la pantalla de Unidades, que ya lo usa así, no se
   * rompe con este cambio.
   */
  archivoExterno?: File | null;
  onArchivoConsumido?: () => void;
  onSolicitarArchivo?: () => void;
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
  const [encabezadoInvalido, setEncabezadoInvalido] = useState(false);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  /**
   * Único punto de entrada para procesar CUALQUIER archivo (CSV o
   * Excel) — sin importar si vino del input interno o del externo.
   * Un XLSX/XLS se convierte a texto CSV con SheetJS y de ahí en
   * adelante corre exactamente por la misma validación que ya existía
   * (validarCSVUnidades) — cero lógica de validación duplicada.
   */
  async function procesarArchivo(archivo: File) {
    setErrorLectura(null);
    const nombre = archivo.name.toLowerCase();
    const esExcel = nombre.endsWith(".xlsx") || nombre.endsWith(".xls");

    let contenido: string;
    try {
      if (esExcel) {
        const XLSX = await import("xlsx");
        const buffer = await archivo.arrayBuffer();
        const libro = XLSX.read(buffer, { type: "array" });
        const nombrePrimeraHoja = libro.SheetNames[0];
        if (!nombrePrimeraHoja) throw new Error("El archivo no tiene ninguna hoja.");
        const hoja = libro.Sheets[nombrePrimeraHoja];
        // sheet_to_csv reproduce el mismo formato de texto que ya
        // consume validarCSVUnidades — es la razón por la que no hace
        // falta ninguna ruta de validación nueva para Excel.
        contenido = XLSX.utils.sheet_to_csv(hoja);
      } else {
        contenido = await archivo.text();
      }
    } catch (e) {
      console.error("[GateFlow] No se pudo leer el archivo de importación:", e);
      setErrorLectura("No fue posible leer el archivo.");
      setPaso("revisando");
      return;
    }

    const { encabezadoValido, filas: filasValidadas } = validarCSVUnidades(contenido);

    if (!encabezadoValido) {
      setEncabezadoInvalido(true);
      setPaso("revisando");
      return;
    }

    setEncabezadoInvalido(false);
    setFilas(filasValidadas);
    setPaso("revisando");
  }

  async function handleArchivoInterno(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    if (!archivo) return;
    await procesarArchivo(archivo);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Modo de input compartido: cuando el padre (Residentes) entrega un
  // archivo elegido desde SU propio input, se procesa aquí igual que
  // si hubiera venido del input interno.
  useEffect(() => {
    if (archivoExterno) {
      procesarArchivo(archivoExterno).then(() => onArchivoConsumido?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivoExterno]);

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

  if (paso === "inicio") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-5">
        <p className="text-sm text-muted-foreground">
          Importa tus unidades desde una plantilla — sin recapturar una por una. Acepta CSV, XLSX o XLS.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/plantilla-unidades.csv" download>
              <Download className="h-4 w-4" />
              Descargar plantilla
            </a>
          </Button>
          <Button size="sm" onClick={() => (onSolicitarArchivo ? onSolicitarArchivo() : inputRef.current?.click())}>
            <Upload className="h-4 w-4" />
            Subir archivo
          </Button>
          {/* Sin modo compartido (Unidades, uso original): este input
              propio sigue existiendo tal cual como antes. En modo
              compartido (Residentes), onSolicitarArchivo ya viene
              definido y este input interno nunca se usa — el que
              importa es el del padre. */}
          {!onSolicitarArchivo && (
            <input ref={inputRef} type="file" accept={ACCEPT_ARCHIVOS} className="hidden" onChange={handleArchivoInterno} />
          )}
        </div>
      </div>
    );
  }

  if (paso === "revisando") {
    if (errorLectura) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-medium">{errorLectura}</p>
          </div>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setPaso("inicio")}>
            Intentar de nuevo
          </Button>
        </div>
      );
    }

    if (encabezadoInvalido) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm font-medium">El archivo no tiene las columnas esperadas.</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Debe incluir exactamente: <code className="gf-code">tipo, identificador, residente_nombre, residente_telefono</code>.
            Descarga la plantilla de nuevo si editaste los encabezados por error.
          </p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setPaso("inicio")}>
            Intentar de nuevo
          </Button>
        </div>
      );
    }

    return (
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

        <div className="flex gap-2">
          <Button onClick={handleConfirmarImportacion} disabled={filasValidas.length === 0}>
            Importar {filasValidas.length} unidad{filasValidas.length === 1 ? "" : "es"}
          </Button>
          <Button variant="ghost" onClick={() => setPaso("inicio")}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  if (paso === "importando") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Importando…
      </div>
    );
  }

  if (paso === "resumen" && resultado) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-5">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <p className="font-medium">{resultado.creadas} unidad{resultado.creadas === 1 ? "" : "es"} importada{resultado.creadas === 1 ? "" : "s"}</p>
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
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setPaso("inicio")}>
          Importar otro archivo
        </Button>
      </div>
    );
  }

  return null;
}

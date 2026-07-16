"use client";

import { useRef, useState } from "react";
import { Download, Upload, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@gateflow/ui";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { importarUnidadesMasivo, type FilaImportarUnidad, type ResultadoImportacion } from "@gateflow/paquetes";
import { validarCSVUnidades, type FilaValidada } from "@/lib/csv";

type Paso = "inicio" | "revisando" | "importando" | "resumen";

export function ImportarUnidades({ tenantId, onImportado }: { tenantId: string; onImportado: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paso, setPaso] = useState<Paso>("inicio");
  const [filas, setFilas] = useState<FilaValidada[]>([]);
  const [encabezadoInvalido, setEncabezadoInvalido] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  async function handleArchivo(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    if (!archivo) return;

    const contenido = await archivo.text();
    const { encabezadoValido, filas: filasValidadas } = validarCSVUnidades(contenido);

    if (!encabezadoValido) {
      setEncabezadoInvalido(true);
      setPaso("revisando");
      return;
    }

    setEncabezadoInvalido(false);
    setFilas(filasValidadas);
    setPaso("revisando");
    if (inputRef.current) inputRef.current.value = "";
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

  if (paso === "inicio") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-5">
        <p className="text-sm text-muted-foreground">
          Importa tus unidades desde una plantilla — sin recapturar una por una.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/plantilla-unidades.csv" download>
              <Download className="h-4 w-4" />
              Descargar plantilla
            </a>
          </Button>
          <Button size="sm" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Subir archivo
          </Button>
          <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={handleArchivo} />
        </div>
      </div>
    );
  }

  if (paso === "revisando") {
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

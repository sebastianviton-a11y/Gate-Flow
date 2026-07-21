"use client";

import { useState } from "react";
import { X, TriangleAlert } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { actualizarUnidad, buscarUnidadesDuplicadas, type UnidadListItem, type UnidadDuplicada } from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

const ETIQUETA_CAMPO: Record<UnidadDuplicada["campoCoincidente"], string> = {
  contacto_telefono: "el teléfono",
  contacto_telefono_secundario: "el teléfono secundario",
  contacto_email: "el correo",
};

export function EditarUnidad({
  tenantId,
  unidad,
  onGuardado,
  onCerrar,
}: {
  tenantId: string;
  unidad: UnidadListItem;
  onGuardado: () => void;
  onCerrar: () => void;
}) {
  const supabase = createBrowserSupabaseClient();

  const [tipo, setTipo] = useState<"casa" | "departamento">(unidad.tipo as "casa" | "departamento");
  const [identificador, setIdentificador] = useState(unidad.identificador);
  const [contactoNombre, setContactoNombre] = useState(unidad.contactoNombre ?? "");
  const [contactoTelefono, setContactoTelefono] = useState(unidad.contactoTelefono ?? "");
  const [contactoTelefonoSecundario, setContactoTelefonoSecundario] = useState(unidad.contactoTelefonoSecundario ?? "");
  const [contactoEmail, setContactoEmail] = useState(unidad.contactoEmail ?? "");
  const [notas, setNotas] = useState(unidad.notas ?? "");
  const [activo, setActivo] = useState(unidad.activo);

  const [duplicados, setDuplicados] = useState<UnidadDuplicada[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  async function handleGuardar(forzar = false) {
    if (!identificador.trim()) return;
    setError(null);

    if (!forzar) {
      try {
        const encontrados = await buscarUnidadesDuplicadas(
          supabase,
          tenantId,
          { contactoTelefono, contactoTelefonoSecundario, contactoEmail },
          unidad.id,
        );
        if (encontrados.length > 0) {
          setDuplicados(encontrados);
          return;
        }
      } catch {
        // Si la verificación de duplicados falla, no se bloquea el
        // guardado por eso — es una advertencia, no una validación dura.
      }
    }

    setEnviando(true);
    try {
      await actualizarUnidad(supabase, unidad.id, {
        tipo,
        identificador,
        contactoNombre,
        contactoTelefono,
        contactoTelefonoSecundario,
        contactoEmail,
        notas,
        activo,
      });
      setExito(true);
      setTimeout(() => {
        onGuardado();
      }, 900);
    } catch (e) {
      setError(obtenerMensajeError(e, "No fue posible actualizar los datos. Intenta nuevamente."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-primary bg-primary/5 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Editar &quot;{unidad.identificador}&quot;</p>
        <button onClick={onCerrar} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {exito ? (
        <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">Los datos del residente se actualizaron correctamente.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="e-tipo">Tipo</Label>
              <select
                id="e-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "casa" | "departamento")}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="casa">Casa</option>
                <option value="departamento">Departamento</option>
              </select>
            </div>
            <div>
              <Label htmlFor="e-identificador">
                Identificador <span className="text-destructive">*</span>
              </Label>
              <Input id="e-identificador" value={identificador} onChange={(e) => setIdentificador(e.target.value)} className="mt-1.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="e-nombre">Nombre del residente</Label>
              <Input id="e-nombre" value={contactoNombre} onChange={(e) => setContactoNombre(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="e-telefono">Teléfono principal</Label>
              <Input id="e-telefono" type="tel" value={contactoTelefono} onChange={(e) => setContactoTelefono(e.target.value)} className="mt-1.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="e-telefono2">Teléfono secundario (opcional)</Label>
              <Input
                id="e-telefono2"
                type="tel"
                value={contactoTelefonoSecundario}
                onChange={(e) => setContactoTelefonoSecundario(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="e-email">Correo (opcional)</Label>
              <Input id="e-email" type="email" value={contactoEmail} onChange={(e) => setContactoEmail(e.target.value)} className="mt-1.5" />
            </div>
          </div>

          <div>
            <Label htmlFor="e-notas">Notas (opcional)</Label>
            <textarea
              id="e-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background p-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4" />
            Unidad activa
          </label>

          {duplicados.length > 0 && (
            <div className="space-y-2 rounded-md border border-warn/30 bg-warn/10 p-3">
              {duplicados.map((d, i) => (
                <p key={i} className="flex items-start gap-1.5 text-sm text-warn-foreground">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Ya existe otra unidad ({d.identificador}) con {ETIQUETA_CAMPO[d.campoCoincidente]} que estás guardando.
                </p>
              ))}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setDuplicados([])} className="text-xs text-muted-foreground">
                  Revisar de nuevo
                </button>
                <button
                  onClick={() => {
                    setDuplicados([]);
                    handleGuardar(true);
                  }}
                  className="text-xs font-medium text-warn-foreground"
                >
                  Guardar de todas formas
                </button>
              </div>
            </div>
          )}

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleGuardar} disabled={!identificador.trim() || enviando}>
              {enviando ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

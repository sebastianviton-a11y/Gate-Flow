"use client";

import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { importarUnidadesMasivo } from "@gateflow/paquetes";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";

/**
 * Reutiliza importarUnidadesMasivo() con un solo registro en vez de
 * crear una mutación nueva — es exactamente la misma validación
 * (dirección duplicada) que ya usa la carga por plantilla, así que las
 * dos vías nunca pueden divergir en sus reglas. Sin "Tipo": ya no se
 * captura (la vivienda queda sin tipo, nunca con uno supuesto).
 */
export function AgregarUnidadManual({
  tenantId,
  onAgregada,
  pais = null,
  abiertoInicial = false,
  onCerrar,
}: {
  tenantId: string;
  onAgregada: () => void;
  /** País del residencial: solo cambia el ejemplo del teléfono. */
  pais?: string | null;
  /** Desde Residentes ("Nuevo residente") el formulario abre directo. */
  abiertoInicial?: boolean;
  /** Si se pasa, "Cerrar" lo maneja quien abrió el formulario. */
  onCerrar?: () => void;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const [identificador, setIdentificador] = useState("");
  const [contactoNombre, setContactoNombre] = useState("");
  const [contactoTelefono, setContactoTelefono] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  function reiniciar() {
    setIdentificador("");
    setContactoNombre("");
    setContactoTelefono("");
    setError(null);
  }

  async function handleGuardar() {
    if (!identificador.trim()) return;
    setEnviando(true);
    setError(null);
    setExito(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const resultado = await importarUnidadesMasivo(supabase, tenantId, [
        {
          identificador: identificador.trim(),
          contactoNombre: contactoNombre.trim() || undefined,
          contactoTelefono: contactoTelefono.trim() || undefined,
        },
      ]);

      if (resultado.creadas === 1) {
        setExito(`"${identificador.trim()}" agregada correctamente.`);
        reiniciar();
        onAgregada();
        setTimeout(() => setExito(null), 3000);
      } else {
        setError(resultado.omitidas[0]?.motivo ?? "No se pudo agregar la vivienda.");
      }
    } catch (e) {
      setError(obtenerMensajeError(e, "No se pudo agregar la vivienda."));
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <UserPlus className="h-4 w-4" />
        Agregar manualmente
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Agregar vivienda y residente</p>
        <button onClick={() => (onCerrar ? onCerrar() : setAbierto(false))} className="text-xs text-muted-foreground hover:text-foreground">
          Cerrar
        </button>
      </div>

      <div>
        <Label htmlFor="identificador-manual">
          Dirección <span className="text-destructive">*</span>
        </Label>
        <Input
          id="identificador-manual"
          placeholder='Ej. "Calle 5 #12", "Casa 12" o "Torre B, Depto 302"'
          value={identificador}
          onChange={(e) => setIdentificador(e.target.value)}
          className="mt-1.5"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="nombre-manual">Nombre del residente (opcional)</Label>
          <Input
            id="nombre-manual"
            value={contactoNombre}
            onChange={(e) => setContactoNombre(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="telefono-manual">Teléfono / WhatsApp (opcional)</Label>
          <Input
            id="telefono-manual"
            type="tel"
            placeholder={pais === "AR" ? "11 2345-6789" : "998 123 4567"}
            value={contactoTelefono}
            onChange={(e) => setContactoTelefono(e.target.value)}
            className="mt-1.5"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Este residente queda como contacto informal (sin cuenta propia) — igual que al importar por plantilla. El día
        que necesite iniciar sesión, se le crea una cuenta y se vincula formalmente.
      </p>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleGuardar} disabled={!identificador.trim() || enviando} size="sm">
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        {exito && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" /> {exito}
          </span>
        )}
      </div>
    </div>
  );
}

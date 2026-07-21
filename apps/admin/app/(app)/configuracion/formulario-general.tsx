"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, Upload } from "lucide-react";
import { createBrowserSupabaseClient } from "@gateflow/supabase/client";
import { Button, Input, Label, obtenerMensajeError } from "@gateflow/ui";
import { actualizarConfiguracionResidencial, type ConfiguracionResidencial } from "./actions";

interface Props {
  tenantId: string;
  nombreInicial: string;
  configuracionInicial: ConfiguracionResidencial;
}

const TIPOS_PERMITIDOS = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const TAMANO_MAXIMO = 2 * 1024 * 1024; // 2 MB — igual al límite configurado en el bucket de Storage

/**
 * White-label: cada residencial que compre GateFlow debe poder subir su
 * propio logo, no solo pegar un enlace a una imagen ya alojada en otro
 * lado (limitación real de la versión anterior, nunca resuelta). Sube
 * directo al bucket "logos" de Supabase Storage desde el navegador —
 * nombre de archivo fijo por tenant (logo.<ext>) para que volver a
 * subir SIEMPRE reemplace la anterior, en vez de acumular archivos
 * huérfanos con cada cambio.
 */
export function FormularioGeneral({ tenantId, nombreInicial, configuracionInicial }: Props) {
  const supabase = createBrowserSupabaseClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [nombre, setNombre] = useState(nombreInicial);
  const [logoUrl, setLogoUrl] = useState(configuracionInicial.logoUrl ?? "");
  const [horarioRecepcion, setHorarioRecepcion] = useState(configuracionInicial.horarioRecepcion ?? "");
  const [reglasBasicas, setReglasBasicas] = useState(configuracionInicial.reglasBasicas ?? "");

  const [subiendo, setSubiendo] = useState(false);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [guardado, setGuardado] = useState(false);

  async function handleSeleccionarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorLogo(null);

    if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
      setErrorLogo("Solo se aceptan imágenes PNG, JPG, WEBP o SVG.");
      return;
    }
    if (archivo.size > TAMANO_MAXIMO) {
      setErrorLogo("La imagen no debe superar 2 MB.");
      return;
    }

    setSubiendo(true);
    try {
      const extension = archivo.name.split(".").pop() ?? "png";
      // Nombre fijo (no un UUID por subida) — así reemplazar el logo
      // sobrescribe el archivo anterior en vez de acumular versiones.
      const path = `${tenantId}/logo.${extension}`;

      const { error: errorSubida } = await supabase.storage.from("logos").upload(path, archivo, {
        contentType: archivo.type,
        upsert: true,
      });
      if (errorSubida) throw errorSubida;

      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      // Cache-busting: la URL pública es la misma ruta de siempre, así
      // que sin esto el navegador podría seguir mostrando la imagen
      // vieja cacheada tras reemplazar el logo.
      const urlConVersion = `${data.publicUrl}?v=${Date.now()}`;
      setLogoUrl(urlConVersion);
    } catch (e) {
      setErrorLogo(obtenerMensajeError(e, "No se pudo subir la imagen. Intenta de nuevo."));
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleGuardar() {
    startTransition(async () => {
      await actualizarConfiguracionResidencial({
        nombre,
        configuracion: { logoUrl: logoUrl || undefined, horarioRecepcion: horarioRecepcion || undefined, reglasBasicas: reglasBasicas || undefined },
      });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    });
  }

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo del residencial" className="h-16 w-16 rounded-lg border border-border object-contain" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            Sin logo
          </div>
        )}
        <div className="flex-1 space-y-1.5">
          <Label>Logo del residencial</Label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={subiendo}>
              {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {subiendo ? "Subiendo…" : logoUrl ? "Cambiar imagen" : "Subir imagen"}
            </Button>
            <input ref={inputRef} type="file" accept={TIPOS_PERMITIDOS.join(",")} onChange={handleSeleccionarArchivo} className="hidden" />
          </div>
          {errorLogo && <p className="text-xs text-destructive">{errorLogo}</p>}
          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP o SVG — máximo 2 MB. Se muestra en el menú lateral y el menú móvil.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre del residencial</Label>
        <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="horario">Horario de recepción de paquetes</Label>
        <Input
          id="horario"
          placeholder="Lunes a sábado, 8:00 a 20:00"
          value={horarioRecepcion}
          onChange={(e) => setHorarioRecepcion(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reglas">Reglas básicas para el equipo de portería</Label>
        <textarea
          id="reglas"
          rows={4}
          placeholder="Ej. Paquetes de valor declarado alto se resguardan en caja fuerte, no en el estante general."
          value={reglasBasicas}
          onChange={(e) => setReglasBasicas(e.target.value)}
          className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleGuardar} disabled={pending || !nombre.trim() || subiendo}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        {guardado && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" /> Guardado
          </span>
        )}
      </div>
    </div>
  );
}

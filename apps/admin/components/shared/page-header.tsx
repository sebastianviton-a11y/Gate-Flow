interface PageHeaderProps {
  title: string;
  description: string;
}

/**
 * Antes, cada una de las 7 pantallas repetía el mismo bloque de JSX para
 * su encabezado (h1 + p), literal, sin extraer. Cualquier ajuste futuro de
 * tipografía o espaciado del encabezado habría requerido tocar 7 archivos.
 */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

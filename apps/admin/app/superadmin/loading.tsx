import { Skeleton } from "@gateflow/ui";

/**
 * Cubre /superadmin y TODAS sus subrutas (empresas, residenciales,
 * detalle de cada uno) con un solo archivo — Next.js lo propaga a
 * toda la subárbol de rutas, igual que (app)/loading.tsx cubre
 * dashboard/unidades/configuración/etc. Antes de este archivo,
 * /superadmin era el único segmento de toda la aplicación sin ningún
 * estado de carga, porque vive fuera del árbol de (app)/ y no hereda
 * el suyo.
 */
export default function SuperAdminLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

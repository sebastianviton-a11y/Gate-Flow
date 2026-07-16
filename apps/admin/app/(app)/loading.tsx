import { Skeleton } from "@gateflow/ui";

/**
 * Se activa mientras el layout protegido resuelve getSessionContext()
 * (una llamada real a Supabase) antes del primer paint. Sin esto, la
 * primera carga de cualquier pantalla protegida no tenía ningún estado
 * de carga — pantalla en blanco hasta que resolviera la sesión.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

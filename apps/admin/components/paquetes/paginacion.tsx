import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Paginacion({
  pagina,
  porPagina,
  total,
  buildHref,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  buildHref: (pagina: number) => string;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {total === 0 ? "Sin resultados" : `${(pagina - 1) * porPagina + 1}–${Math.min(pagina * porPagina, total)} de ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <Link
          href={buildHref(Math.max(1, pagina - 1))}
          aria-disabled={pagina <= 1}
          className={`flex h-8 w-8 items-center justify-center rounded-md border border-border ${
            pagina <= 1 ? "pointer-events-none opacity-40" : "hover:bg-muted"
          }`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="px-2">
          {pagina} / {totalPaginas}
        </span>
        <Link
          href={buildHref(Math.min(totalPaginas, pagina + 1))}
          aria-disabled={pagina >= totalPaginas}
          className={`flex h-8 w-8 items-center justify-center rounded-md border border-border ${
            pagina >= totalPaginas ? "pointer-events-none opacity-40" : "hover:bg-muted"
          }`}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

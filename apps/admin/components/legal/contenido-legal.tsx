import { Fragment } from "react";
import { parsearMarkdown, type Bloque, type Inline } from "@/lib/legal/markdown";

/** Texto legal publicado, pintado con elementos de React (sin HTML crudo). */
export function ContenidoLegal({ contenido }: { contenido: string }) {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]" data-testid="legal-contenido">
      {parsearMarkdown(contenido).map((b, i) => (
        <BloqueLegal key={i} bloque={b} />
      ))}
    </div>
  );
}

function BloqueLegal({ bloque }: { bloque: Bloque }) {
  switch (bloque.tipo) {
    case "titulo": {
      const clases = {
        2: "pt-2 font-display text-lg font-bold sm:text-xl",
        3: "pt-1 font-display text-base font-semibold sm:text-lg",
        4: "font-display text-[15px] font-semibold",
        5: "text-[15px] font-semibold",
      }[bloque.nivel];
      const Etiqueta = `h${bloque.nivel}` as "h2" | "h3" | "h4" | "h5";
      return (
        <Etiqueta id={bloque.id} className={`scroll-mt-6 ${clases}`}>
          <Inlines nodos={bloque.contenido} />
        </Etiqueta>
      );
    }
    case "parrafo":
      return (
        <p>
          <Inlines nodos={bloque.contenido} />
        </p>
      );
    case "lista": {
      const Lista = bloque.ordenada ? "ol" : "ul";
      return (
        <Lista start={bloque.ordenada && bloque.inicio !== 1 ? bloque.inicio : undefined} className={`space-y-1.5 pl-6 ${bloque.ordenada ? "list-decimal" : "list-disc"}`}>
          {bloque.items.map((item, i) => (
            <li key={i}>
              <Inlines nodos={item} />
            </li>
          ))}
        </Lista>
      );
    }
    case "cita":
      return (
        <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
          <Inlines nodos={bloque.contenido} />
        </blockquote>
      );
    case "separador":
      return <hr className="border-border" />;
  }
}

function Inlines({ nodos }: { nodos: Inline[] }) {
  return (
    <>
      {nodos.map((n, i) => (
        <Fragment key={i}>
          {n.tipo === "texto" ? (
            n.texto
          ) : n.tipo === "negrita" ? (
            <strong className="font-semibold">
              <Inlines nodos={n.hijos} />
            </strong>
          ) : n.tipo === "cursiva" ? (
            <em>
              <Inlines nodos={n.hijos} />
            </em>
          ) : (
            <a href={n.href} className="text-primary underline" rel={n.href.startsWith("http") ? "noopener noreferrer" : undefined}>
              <Inlines nodos={n.hijos} />
            </a>
          )}
        </Fragment>
      ))}
    </>
  );
}

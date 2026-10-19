/**
 * Markdown MÍNIMO para los textos legales (legal/README.md): títulos,
 * párrafos, listas, citas, separadores, **negrita**, *cursiva* y enlaces
 * http(s)/mailto. Se convierte en una estructura que la página pinta con
 * elementos de React: nunca HTML crudo, así que el texto no puede
 * inyectar marcado ni scripts. Lo que no reconoce queda como texto.
 */

export type Inline =
  | { tipo: "texto"; texto: string }
  | { tipo: "negrita"; hijos: Inline[] }
  | { tipo: "cursiva"; hijos: Inline[] }
  | { tipo: "enlace"; href: string; hijos: Inline[] };

export type Bloque =
  | { tipo: "titulo"; nivel: 2 | 3 | 4 | 5; id: string; contenido: Inline[] }
  | { tipo: "parrafo"; contenido: Inline[] }
  | { tipo: "lista"; ordenada: boolean; inicio: number; items: Inline[][] }
  | { tipo: "cita"; contenido: Inline[] }
  | { tipo: "separador" };

const RE_TITULO = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const RE_SEPARADOR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_VINETA = /^[-*+]\s+(.*)$/;
const RE_NUMERO = /^(\d{1,4})[.)]\s+(.*)$/;
const RE_CITA = /^>\s?(.*)$/;

/** Solo enlaces seguros: http(s) absolutos, mailto: y anclas internas. */
export function hrefSeguro(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\/[^\s]+$/i.test(h)) return h;
  if (/^mailto:[^\s]+$/i.test(h)) return h;
  if (/^#[\w-]+$/.test(h)) return h;
  return null;
}

export function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "seccion"
  );
}

export function parsearInline(texto: string): Inline[] {
  const salida: Inline[] = [];
  let buffer = "";
  const vaciar = () => {
    if (buffer) salida.push({ tipo: "texto", texto: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);
    const actual = resto.charAt(0);
    // \* \_ \[ … : el carácter literal.
    if (actual === "\\" && resto.length > 1 && "*_[]()\\#>-".includes(resto.charAt(1))) {
      buffer += resto.charAt(1);
      i += 2;
      continue;
    }
    const negrita = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(resto);
    if (negrita) {
      vaciar();
      salida.push({ tipo: "negrita", hijos: parsearInline(negrita[1] ?? "") });
      i += negrita[0].length;
      continue;
    }
    const previo = i > 0 ? texto.charAt(i - 1) : "";
    const cursiva = /^\*(?=\S)([^*]*?\S)\*/.exec(resto) ?? (/[A-Za-z0-9]/.test(previo) ? null : /^_(?=\S)([^_]*?\S)_(?![A-Za-z0-9])/.exec(resto));
    if (cursiva) {
      vaciar();
      salida.push({ tipo: "cursiva", hijos: parsearInline(cursiva[1] ?? "") });
      i += cursiva[0].length;
      continue;
    }
    const enlace = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(resto);
    if (enlace) {
      const href = hrefSeguro(enlace[2] ?? "");
      vaciar();
      if (href) salida.push({ tipo: "enlace", href, hijos: parsearInline(enlace[1] ?? "") });
      else salida.push(...parsearInline(enlace[1] ?? ""));
      i += enlace[0].length;
      continue;
    }
    buffer += actual;
    i += 1;
  }
  vaciar();
  return salida;
}

/** Ítem de lista en la línea (sin sangría): texto del ítem, o null. */
function itemDeLista(linea: string, ordenada: boolean): string | null {
  const m = (ordenada ? RE_NUMERO : RE_VINETA).exec(linea);
  if (!m) return null;
  return (ordenada ? m[2] : m[1]) ?? "";
}

function esInicioDeBloque(t: string): boolean {
  return RE_TITULO.test(t) || RE_SEPARADOR.test(t) || RE_VINETA.test(t) || RE_NUMERO.test(t) || RE_CITA.test(t);
}

export function parsearMarkdown(contenido: string): Bloque[] {
  const lineas = contenido.replace(/\r\n?/g, "\n").split("\n");
  const linea = (n: number) => lineas[n] ?? "";
  const bloques: Bloque[] = [];
  const ids = new Map<string, number>();
  const idUnico = (texto: string) => {
    const base = slug(texto);
    const n = (ids.get(base) ?? 0) + 1;
    ids.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  let i = 0;
  while (i < lineas.length) {
    const t = linea(i).trim();
    if (!t) {
      i++;
      continue;
    }
    const titulo = RE_TITULO.exec(t);
    if (titulo) {
      const texto = titulo[2] ?? "";
      const nivel = ((titulo[1] ?? "#").length + 1) as 2 | 3 | 4 | 5;
      bloques.push({ tipo: "titulo", nivel, id: idUnico(texto), contenido: parsearInline(texto) });
      i++;
      continue;
    }
    if (RE_SEPARADOR.test(t)) {
      bloques.push({ tipo: "separador" });
      i++;
      continue;
    }
    const numero = RE_NUMERO.exec(t);
    if (RE_VINETA.test(t) || numero) {
      const ordenada = !RE_VINETA.test(t);
      const inicio = numero ? Number(numero[1]) : 1;
      const items: string[] = [];
      while (i < lineas.length) {
        const cruda = linea(i);
        const lt = cruda.trim();
        const item = lt ? itemDeLista(lt, ordenada) : null;
        if (item !== null) {
          items.push(item.trim());
        } else if (lt && /^\s{2,}\S/.test(cruda) && items.length) {
          items[items.length - 1] = `${items[items.length - 1] ?? ""} ${lt}`;
        } else {
          break;
        }
        i++;
      }
      bloques.push({ tipo: "lista", ordenada, inicio, items: items.map(parsearInline) });
      continue;
    }
    if (RE_CITA.test(t)) {
      const partes: string[] = [];
      while (i < lineas.length) {
        const m = RE_CITA.exec(linea(i).trim());
        if (!m) break;
        partes.push(m[1] ?? "");
        i++;
      }
      bloques.push({ tipo: "cita", contenido: parsearInline(partes.join(" ").trim()) });
      continue;
    }
    const partes: string[] = [];
    while (i < lineas.length) {
      const lt = linea(i).trim();
      if (!lt || esInicioDeBloque(lt)) break;
      partes.push(lt);
      i++;
    }
    bloques.push({ tipo: "parrafo", contenido: parsearInline(partes.join(" ")) });
  }
  return bloques;
}

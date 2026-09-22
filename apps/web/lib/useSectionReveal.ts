"use client";

import { useEffect, useRef, useState } from "react";

// Puerto directo del motion system documentado en Motion.dc.html /
// Landing.dc.html / Mobile-*.dc.html: un solo IntersectionObserver por
// árbol (desktop o mobile), dispara una vez por sección y se desconecta.
// Respeta prefers-reduced-motion y no anima nada si el observer no está
// disponible (contenido visible por defecto sin JS).
export function useSectionReveal(threshold: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [seen, setSeen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !window.IntersectionObserver) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = containerRef.current;
    if (!root) return;

    const io = new IntersectionObserver(
      (entries) => {
        const add: Record<string, boolean> = {};
        entries.forEach((entry) => {
          const id = entry.target.getAttribute("data-motion");
          if (entry.isIntersecting && id) {
            add[id] = true;
            io.unobserve(entry.target);
          }
        });
        if (Object.keys(add).length) {
          setSeen((prev) => ({ ...prev, ...add }));
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );

    root.querySelectorAll("[data-motion]").forEach((el) => io.observe(el));
    setArmed(true);

    return () => io.disconnect();
  }, [threshold]);

  function sectionClass(id: string) {
    return armed ? `gf-armed${seen[id] ? " gf-in" : ""}` : "";
  }

  return { containerRef, sectionClass };
}

export function useFaqAccordion(defaultOpen = 0) {
  const [open, setOpen] = useState<number>(defaultOpen);
  function toggle(index: number) {
    setOpen((current) => (current === index ? -1 : index));
  }
  return { open, toggle };
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Puerto 1:1 de la clase `Controller` de reference/index.html (handoff V2
// aprobado): mismo estado, misma forma de `vals()`, mismos timings de
// autoplay/gaSeq y misma condición de prefers-reduced-motion. Cada árbol
// (desktop y mobile) monta su propia instancia con su propio prefijo de id
// ("d" / "m"), igual que `new Controller(root, prefix)` en la referencia.

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const V2_SECTIONS = [
  "problema",
  "como",
  "producto",
  "trazabilidad",
  "seguridad",
  "precios",
  "faq",
  "probar",
] as const;

export type V2SectionKey = (typeof V2_SECTIONS)[number];

type State = {
  seen: Partial<Record<V2SectionKey, true>>;
  armed: boolean;
  active: number; // 0..3 — paso activo de "Cómo funciona"
  manual: boolean;
  open: number; // -1..7 — pregunta abierta del FAQ (por defecto 3)
  focus: "" | "g" | "a"; // selector desktop Guardia/Administración
  ga: "g" | "a"; // pestaña mobile Guardia/Administración
  gaManual: boolean;
  menu: boolean;
  run: "" | "run-a" | "run-b"; // secuencia del hero
};

const initialState: State = {
  seen: {},
  armed: false,
  active: 0,
  manual: false,
  open: 3,
  focus: "",
  ga: "g",
  gaManual: false,
  menu: false,
  run: "",
};

function computeVals(state: State, update: (patch: Partial<State>) => void) {
  const seen = state.seen;
  const sc = (id: V2SectionKey) => (state.armed ? "gf-armed" + (seen[id] ? " gf-in" : "") : "");
  const m = {} as Record<V2SectionKey, string>;
  V2_SECTIONS.forEach((id) => {
    m[id] = sc(id);
  });

  const active = state.active;
  const step = (k: number) => ({
    cls: active === k ? "is-active" : "",
    pressed: (active === k ? "true" : "false") as "true" | "false",
    pick: () => update({ active: k, manual: true }),
  });
  const steps = { s0: step(0), s1: step(1), s2: step(2), s3: step(3) };

  const pos = [0.3, 0.33, 0.5, 0.83];
  const tick = (q: number) => (q <= active ? "is-done" : "");
  const demo = {
    p: pos[active],
    rail: active / 3,
    t0: tick(0),
    t1: tick(1),
    t2: tick(2),
    t3: tick(3),
  };

  const open = state.open;
  const q = (j: number) => ({
    c: open === j ? "is-open" : "",
    e: (open === j ? "true" : "false") as "true" | "false",
    t: () => update({ open: open === j ? -1 : j }),
  });
  const f0 = q(0);
  const f1 = q(1);
  const f2 = q(2);
  const f3 = q(3);
  const f4 = q(4);
  const f5 = q(5);
  const f6 = q(6);
  const f7 = q(7);
  const faq = {
    c0: f0.c, c1: f1.c, c2: f2.c, c3: f3.c, c4: f4.c, c5: f5.c, c6: f6.c, c7: f7.c,
    e0: f0.e, e1: f1.e, e2: f2.e, e3: f3.e, e4: f4.e, e5: f5.e, e6: f6.e, e7: f7.e,
    t0: f0.t, t1: f1.t, t2: f2.t, t3: f3.t, t4: f4.t, t5: f5.t, t6: f6.t, t7: f7.t,
  };

  const f = state.focus;
  const view = state.ga;
  const mo = state.menu;
  const run = state.run;

  return {
    m,
    steps,
    demo,
    faq,
    seg: {
      g: f === "g" ? "is-on" : "",
      a: f === "a" ? "is-on" : "",
      gp: (f === "g" ? "true" : "false") as "true" | "false",
      ap: (f === "a" ? "true" : "false") as "true" | "false",
    },
    frame: { g: f === "a" ? "is-dim" : "", a: f === "g" ? "is-dim" : "" },
    pickG: () => update({ focus: f === "g" ? "" : "g" }),
    pickA: () => update({ focus: f === "a" ? "" : "a" }),
    ga: {
      g: view === "g" ? "is-on" : "",
      a: view === "a" ? "is-on" : "",
      pg: (view === "g" ? "true" : "false") as "true" | "false",
      pa: (view === "a" ? "true" : "false") as "true" | "false",
      x: view === "a" ? "translateX(100%)" : "none",
      pickG: () => update({ ga: "g", gaManual: true }),
      pickA: () => update({ ga: "a", gaManual: true }),
    },
    menu: {
      cls: mo ? "is-open" : "",
      exp: (mo ? "true" : "false") as "true" | "false",
      toggle: () => update({ menu: !mo }),
      close: () => update({ menu: false }),
    },
    hero: { run, replay: () => update({ run: run === "run-b" ? "run-a" : "run-b" }) },
  };
}

export type GateFlowV2Vals = ReturnType<typeof computeVals>;

export function useGateFlowV2(prefix: "d" | "m") {
  const [state, setState] = useState<State>(initialState);
  const update = useCallback((patch: Partial<State>) => setState((s) => ({ ...s, ...patch })), []);
  const autoT = useRef<ReturnType<typeof setTimeout>[] | null>(null);
  const gaT = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Corre antes del primer paint (como el <script> de la referencia, que
  // se ejecuta durante el parseo, antes de pintar) para no mostrar un
  // parpadeo visible→oculto al "armar" las secciones.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMQ.matches || !("IntersectionObserver" in window)) {
      // Sin observer / con movimiento reducido: nunca se arma. Todo se ve
      // en su estado final. Los controles manuales siguen funcionando.
      return;
    }
    setState((s) => ({ ...s, armed: true }));

    const pre = prefix + "-";
    const io = new IntersectionObserver(
      (entries) => {
        const add: Partial<Record<V2SectionKey, true>> = {};
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const key = e.target.id.replace(pre, "") as V2SectionKey;
            add[key] = true;
            io.unobserve(e.target);
          }
        });
        if (!Object.keys(add).length) return;

        if (add.como && !autoT.current) {
          const step = prefix === "m" ? 2200 : 2300;
          autoT.current = [1, 2, 3].map((k) =>
            setTimeout(() => {
              setState((s) => (s.manual ? s : { ...s, active: k }));
            }, step * k + 600),
          );
        }
        if (add.producto && prefix === "m" && !gaT.current) {
          gaT.current = setTimeout(() => {
            setState((s) => (s.gaManual ? s : { ...s, ga: "a" }));
          }, 2700);
        }
        setState((s) => ({ ...s, seen: { ...s.seen, ...add } }));
      },
      { threshold: 0.35, rootMargin: "0px 0px -15% 0px" },
    );

    V2_SECTIONS.forEach((key) => {
      const el = document.getElementById(`${prefix}-${key}`);
      if (el) io.observe(el);
    });

    return () => {
      io.disconnect();
      (autoT.current || []).forEach(clearTimeout);
      if (gaT.current) clearTimeout(gaT.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  const v = computeVals(state, update);

  // Usado por el modal de video: mientras reproduce, el paso activo de
  // "Cómo funciona" sigue al tiempo del video (ver VideoModal.tsx).
  const syncActiveFromVideo = useCallback((k: number) => {
    setState((s) => (s.active === k ? s : { ...s, active: k, manual: true }));
  }, []);

  return { v, syncActiveFromVideo };
}

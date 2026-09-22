"use client";

import { useState } from "react";
import { AssetImage, AssetVideo } from "./Asset";
import { FAQ_ITEMS } from "@/lib/faq";
import { useFaqAccordion, useSectionReveal } from "@/lib/useSectionReveal";

// Puerto 1:1 de project/Mobile-1.dc.html (390×4780) + project/Mobile-2.dc.html
// (390×5224) del canvas aprobado "Gate Flow — Landing", unidos en un solo
// scroll continuo (eran dos artboards del mismo diseño, no dos páginas).
// Se conserva un solo header (el de Mobile-1, con menú hamburguesa); el
// header duplicado de Mobile-2 no se repite aquí porque en una sola página
// continua sería un segundo nav idéntico sin motivo.
export default function MobileLanding() {
  const { containerRef, sectionClass } = useSectionReveal(0.15);
  const { open, toggle } = useFaqAccordion(0);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div ref={containerRef} className="gf-mobile">
      <div style={{ position: "relative", width: "100%", overflow: "hidden", display: "flex", flexDirection: "column", background: "#FFFFFF", color: "#0D1B2A" }}>
        {/* 00 HERO — mini-lienzo de diseño fijo (390×1090) escalado con el
           ancho disponible; tope de 640px para que en tablet no se agrande
           de forma desproporcionada (ver globals.css .gf-scale). */}
        <section
          id="m-inicio"
          className="gf-scale"
          style={{ ["--gf-w" as string]: 390, flexShrink: 0, maxWidth: 640, aspectRatio: "390 / 1090", margin: "0 auto" }}
        >
        <div className="gf-scale-inner" style={{ position: "relative", width: 390, height: 1090, overflow: "hidden", background: "#FFFFFF" }}>
          <header
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 390,
              height: 64,
              padding: "0 10px 0 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#FFFFFF",
              borderBottom: "1px solid #EEF1F4",
              zIndex: 10,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Logo dark />
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>Gate Flow</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <a href="#m-precios" className="gf-btn" style={navCta}>Probar gratis</a>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
                aria-expanded={menuOpen}
                style={{ width: 44, height: 44, border: 0, background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#0D1B2A" }}
              >
                {menuOpen ? (
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 4l12 12M16 4L4 16" stroke="#0D1B2A" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 7h14M3 13h14" stroke="#0D1B2A" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </header>

          {menuOpen && (
            <div className="gf-menu" style={{ position: "absolute", left: 0, top: 64, width: 390, padding: "6px 20px 20px", background: "#FFFFFF", borderBottom: "1px solid #DDE3E8", boxShadow: "0 24px 32px -24px rgba(13,27,42,0.35)", zIndex: 9, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
              <MenuLink onClick={() => setMenuOpen(false)} href="#m-como" n="02" label="Cómo funciona" />
              <MenuLink onClick={() => setMenuOpen(false)} href="#m-precios" n="06" label="Precios" />
              <MenuLink onClick={() => setMenuOpen(false)} href="#m-faq" n="07" label="Preguntas" />
              <a href="#ingresar" onClick={() => setMenuOpen(false)} className="gf-tap" style={{ height: 56, display: "flex", alignItems: "center", textDecoration: "none", fontSize: 16, fontWeight: 600, color: "#3A4A5A" }}>Ingresar</a>
            </div>
          )}

          <div style={{ position: "absolute", left: 20, top: 92, width: 350, display: "flex", flexDirection: "column" }}>
            <h1 className="h-up" style={{ ["--d" as string]: "0ms", margin: 0, fontSize: 46, lineHeight: 0.96, fontWeight: 800, letterSpacing: "-0.05em" }}>
              Cada paquete,
              <br />
              bajo control.
            </h1>
            <div className="h-up" style={{ ["--d" as string]: "50ms", marginTop: 14, fontSize: 22, lineHeight: 1.18, fontWeight: 700, letterSpacing: "-0.02em", color: "#00755C" }}>
              Desde que llega hasta que se entrega.
            </div>
            <div className="h-up" style={{ ["--d" as string]: "100ms", display: "flex", flexDirection: "column" }}>
              <p style={{ margin: "18px 0 0", fontSize: 16, lineHeight: 1.55, color: "#3A4A5A" }}>
                Gate Flow simplifica la recepción y entrega de paquetes en residenciales, conectando a guardias, residentes y administración en un mismo flujo.
              </p>
              <a href="#m-precios" className="gf-btn" style={{ marginTop: 24, height: 56, display: "flex", alignItems: "center", justifyContent: "center", background: "#00C49A", color: "#0D1B2A", fontWeight: 800, borderRadius: 10, textDecoration: "none", fontSize: 16 }}>
                Probar gratis 7 días
              </a>
              <a href="#m-como" className="gf-link" style={{ marginTop: 6, height: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
                <span style={{ borderBottom: "2px solid #00C49A", paddingBottom: 2 }}>Ver cómo funciona</span>
                <span aria-hidden="true">→</span>
              </a>
              <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "#55636F", textAlign: "center" }}>
                Sin tarjeta · Configuración simple
                <br />
                Desde USD 29/mes
              </div>
            </div>
          </div>

          <div className="h-up" style={{ ["--d" as string]: "260ms", position: "absolute", left: 20, top: 596, display: "flex", gap: 10, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#55636F", zIndex: 2 }}>
            <span style={{ color: "#0D1B2A", fontWeight: 600 }}>TORRE A</span>
            <span>·</span>
            <span>DEPTO. 102</span>
          </div>
          <div className="h-rise" style={{ ["--d" as string]: "120ms", position: "absolute", left: 12, top: 603, fontSize: 200, lineHeight: 1, fontWeight: 800, letterSpacing: "-0.07em", color: "#0D1B2A", whiteSpace: "nowrap", zIndex: 1 }}>102</div>

          <div data-motion="band" className={sectionClass("band")} style={{ position: "absolute", left: 0, top: 780, width: 390, height: 310, background: "#0D1B2A", zIndex: 1 }}>
            <div style={{ position: "absolute", left: 20, top: 24, display: "flex", gap: 10 }}>
              <div className="s-wipe" style={{ ["--d" as string]: "0ms", position: "relative", width: 196, height: 162, borderRadius: 10, overflow: "hidden" }}>
                <AssetImage src="/img/hero-foto-paquete-mobile.jpg" alt="Fotografía real del paquete" width={196} height={162} />
                <div style={{ position: "absolute", left: 8, bottom: 8, height: 20, padding: "0 6px", display: "flex", alignItems: "center", background: "rgba(13,27,42,0.85)", color: "#FFFFFF", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 9.5 }}>
                  FOTOGRAFÍA DEL PAQUETE
                </div>
              </div>
              <div className="s-wipe" style={{ ["--d" as string]: "760ms", width: 144, height: 162, borderRadius: 10, overflow: "hidden" }}>
                <AssetImage src="/img/hero-qr-mobile.png" alt="QR real del paquete GF-2026-0000073" width={144} height={162} />
              </div>
            </div>
            <div style={{ position: "absolute", left: 20, top: 212, width: 350, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", color: "#FFFFFF" }}>
              <MiniStep d1="200ms" d2="260ms" label="Llega" value="Portería" />
              <MiniStep d1="340ms" d2="400ms" label="Se registra" value="3:04:28 p.m." />
              <MiniStep d1="480ms" d2="540ms" label="Se notifica" value="Residente" />
              <MiniStep d1="620ms" d2="680ms" label="Se entrega" value="Con QR" teal tealDelay="780ms" />
            </div>
          </div>
        </div>
        </section>

        {/* 01 PROBLEMA */}
        <section id="m-problema" data-motion="problema" className={sectionClass("problema")} style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#FFFFFF" }}>
          <div style={{ padding: "56px var(--gf-gap) 0", display: "flex", flexDirection: "column" }}>
            <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 14 }}>
              <MobileEyebrow>01 / EL PROBLEMA</MobileEyebrow>
              <h2 style={{ margin: 0, fontSize: "var(--gf-m-h2)", lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.035em" }}>
                Recibir un paquete es fácil. <span style={{ color: "#56677A" }}>Llevar el control de cientos, no tanto.</span>
              </h2>
            </div>
            <div style={{ marginTop: 28, height: 2, background: "#0D1B2A" }} />
            <MobileProblemRow d="100ms" n="01" q="¿Llegó mi paquete?" right={<StatePill bg="#E8EDF1" fg="#0D1B2A" dot="#0D1B2A" label="Recibido" note="Fecha de recepción" />} />
            <MobileProblemRow d="180ms" n="02" q="¿Quién lo recibió?" right={<MonoPair a="RECIBIDO POR" b="Guardia" />} />
            <MobileProblemRow last d="260ms" n="03" q="¿Ya fue entregado y a quién?" right={<StatePill bg="#DDF7EF" fg="#00664F" dot="#00C49A" label="Entregado" note="¿Quién recibe? · Firma" boldNote />} />
            <p style={{ margin: "24px 0 0", fontSize: "var(--gf-m-body)", lineHeight: 1.55, color: "#3A4A5A", maxWidth: 640 }}>
              Gate Flow deja cada movimiento registrado para que guardias y administración tengan la misma información.
            </p>
          </div>
        </section>

        {/* 02 CÓMO FUNCIONA */}
        <section id="m-como" data-motion="como" className={sectionClass("como")} style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#F4F6F8" }}>
          <div style={{ padding: "56px var(--gf-gap) 64px", display: "flex", flexDirection: "column" }}>
            <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 14 }}>
              <MobileEyebrow>02 / CÓMO FUNCIONA</MobileEyebrow>
              <h2 style={{ margin: 0, fontSize: "var(--gf-m-h2)", lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.04em", maxWidth: 640 }}>Del repartidor al residente, sin perder el rastro.</h2>
            </div>
            <div style={{ marginTop: 32, maxWidth: 640, display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)" }}>
              <MobileStage d="120ms" grow="200ms" growColor="#0D1B2A" dotColor="#0D1B2A" n="01" label="Recibido" labelD="160ms" />
              <MobileStage d="320ms" grow="400ms" growColor="#1E88E5" dotColor="#0D1B2A" n="02" label="Registrado" labelD="360ms" />
              <MobileStage d="520ms" grow="600ms" growColor="#00C49A" dotColor="#1E88E5" n="03" label="Notificado" labelD="560ms" />
              <MobileStage d="720ms" n="04" label="Entregado" labelD="760ms" dotColor="#00C49A" labelColor="#00755C" last />
            </div>
            <div className="s-up" style={{ ["--d" as string]: "200ms", marginTop: 28, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 350, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#55636F" }}>
                <span><span style={{ color: "#0D1B2A", fontWeight: 600 }}>VIDEO</span> · 0:48</span>
                <span>GATE FLOW EN USO</span>
              </div>
              {/* Video vertical real: no se agranda como el resto (un
                 teléfono no debería verse gigante en tablet), tope 350px
                 igual que en el diseño aprobado. */}
              <div style={{ width: "100%", maxWidth: 350, aspectRatio: "350 / 622", borderRadius: 16, overflow: "hidden", background: "#0D1B2A", boxShadow: "0 40px 70px -40px rgba(13,27,42,0.6)" }}>
                <AssetVideo src="/video/hero-vertical.mp4" poster="/video/hero-vertical-poster.jpg" ariaLabel="Video de Gate Flow en uso, 48 segundos" width={350} height={622} />
              </div>
            </div>
          </div>
        </section>

        {/* 03 GUARDIA + ADMIN */}
        <section id="m-producto" data-motion="producto" className={sectionClass("producto")} style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#0D1B2A", color: "#FFFFFF" }}>
          <div style={{ padding: "56px var(--gf-gap) 64px", display: "flex", flexDirection: "column" }}>
            <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#8FA3B5" }}>03 / GUARDIA + ADMINISTRACIÓN</div>
              <h2 style={{ margin: 0, fontSize: "var(--gf-m-h2)", lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.04em", maxWidth: 640 }}>
                Simple para quien recibe.
                <br />
                <span style={{ color: "#00C49A" }}>Claro para quien administra.</span>
              </h2>
            </div>

            <div style={{ marginTop: 32, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#8FA3B5" }}>GUARDIA · APP EN CASETA</div>
            {/* Mock del teléfono con su badge: mini-lienzo (330×640) que se
               escala como unidad para que el recuadro verde no se desalinee
               del recorte de la captura — tope 380px: un "teléfono" no debe
               agrandarse más que eso aunque el resto de la sección crezca. */}
            <div className="gf-scale" style={{ ["--gf-w" as string]: 330, marginTop: 12, marginLeft: 10, maxWidth: 380, aspectRatio: "330 / 640" }}>
            <div className="gf-scale-inner" style={{ position: "relative", width: 330, height: 640, overflow: "hidden", borderRadius: "44px 44px 0 0" }}>
              <div style={{ width: 330, height: 660, padding: "10px 10px 0", background: "#16283B", border: "1px solid #2B3F55", borderBottom: 0, borderRadius: "44px 44px 0 0", boxSizing: "border-box" }}>
                <div style={{ width: 308, height: 650, borderRadius: "36px 36px 0 0", overflow: "hidden", background: "#F4F6F8" }}>
                  <AssetImage src="/img/guardia-porteria-mobile.png" alt="App real del guardia: Portería con Registrar paquete, Escanear QR, Entregar paquete, Buscar paquete y Paquetes pendientes" width={308} height={650} />
                </div>
              </div>
              <div className="s-pop" style={{ ["--d" as string]: "150ms", position: "absolute", left: 21, top: 561, width: 286, height: 74, border: "2px solid #00C49A", borderRadius: 10, boxShadow: "0 0 0 5px rgba(0,196,154,0.18)", boxSizing: "border-box" }} />
            </div>
            </div>

            <div style={{ position: "relative", height: 92, maxWidth: 380 }}>
              <div className="s-grow" style={{ ["--d" as string]: "420ms", ["--t" as string]: "420ms", position: "absolute", left: 164, top: 0, width: 2, height: 92, background: "#00C49A" }} />
              <div className="s-up" style={{ ["--d" as string]: "620ms", position: "absolute", left: 180, top: 34, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "#00C49A" }}>
                <span>PAQUETES PENDIENTES</span>
                <span aria-hidden="true">↓</span>
              </div>
            </div>

            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#8FA3B5" }}>ADMINISTRACIÓN · PANEL WEB</div>
            {/* Dashboard con badge: mismo mecanismo, tope 560px (una captura
               de panel sí puede crecer más que un mock de teléfono). */}
            <div className="s-up gf-scale" style={{ ["--d" as string]: "800ms", ["--gf-w" as string]: 350, position: "relative", marginTop: 12, maxWidth: 560, aspectRatio: "350 / 278" }}>
            <div className="gf-scale-inner" style={{ width: 350, height: 278, borderRadius: 12, overflow: "hidden", background: "#F4F6F8" }}>
              <AssetImage src="/img/admin-dashboard-mobile-1.png" alt="Dashboard real: 15 paquetes requieren atención y 15 pendientes" width={350} height={278} />
              <div className="s-pop" style={{ ["--d" as string]: "1000ms", position: "absolute", left: 1, top: 162, width: 236, height: 112, border: "2px solid #00C49A", borderRadius: 10, boxShadow: "0 0 0 5px rgba(0,196,154,0.18)", boxSizing: "border-box" }} />
            </div>
            </div>
            <div className="s-up" style={{ ["--d" as string]: "900ms", marginTop: 12, width: "100%", maxWidth: 560, borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
              <AssetImage src="/img/admin-dashboard-mobile-2.png" alt="Dashboard real: actividad reciente con paquetes recibidos y entregados" width={350} height={300} />
            </div>
          </div>
        </section>

        {/* Header estático de continuidad para el resto del scroll (Mobile-2) */}
        <header style={{ position: "relative", flexShrink: 0, width: "100%", height: 64, padding: "0 10px 0 var(--gf-gap)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", borderBottom: "1px solid #E3E8EC", boxShadow: "0 8px 20px -14px rgba(13,27,42,0.35)", zIndex: 10, boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Logo dark />
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>Gate Flow</span>
          </div>
          <a href="#m-precios" className="gf-btn" style={navCta}>Probar gratis</a>
        </header>

        {/* 04 TRAZABILIDAD */}
        <section id="m-trazabilidad" style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#FFFFFF" }}>
          <div style={{ padding: "56px var(--gf-gap) 64px", display: "flex", flexDirection: "column" }}>
            <div data-motion="trzh" className={sectionClass("trzh")}>
              <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 14 }}>
                <MobileEyebrow>04 / TRAZABILIDAD</MobileEyebrow>
                <h2 style={{ margin: 0, fontSize: "var(--gf-m-h2)", lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.035em", maxWidth: 640 }}>
                  Cuando alguien pregunta qué pasó con un paquete, <span style={{ color: "#00755C" }}>la respuesta está ahí.</span>
                </h2>
              </div>
            </div>
            <div data-motion="trzu" className={sectionClass("trzu")} style={{ marginTop: 32, maxWidth: 480 }}>
              <div className="s-up" style={{ ["--d" as string]: "60ms", display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#0D1B2A", fontWeight: 600 }}>UNIDAD</div>
                <div style={{ fontSize: "var(--gf-m-record)", lineHeight: 0.86, fontWeight: 800, letterSpacing: "-0.065em", marginTop: 14, marginLeft: -4, whiteSpace: "nowrap" }}>
                  MZA 1
                  <br />
                  LTE 8
                </div>
                <RecordTableMobile />
                <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", color: "#55636F" }}>CAPTURAS REALES · DATOS DE PRUEBA, SOLO DEMOSTRATIVOS</div>
              </div>
            </div>

            <div style={{ marginTop: 36, maxWidth: 640, display: "flex", flexDirection: "column" }}>
              <div data-motion="t1" className={sectionClass("t1")} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)" }}>
                <MobileTimelineDot bg="#0D1B2A" grow="260ms" />
                <div style={{ paddingLeft: 8, paddingBottom: 36, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="s-up" style={{ ["--d" as string]: "60ms", fontSize: "var(--gf-m-q)", fontWeight: 800, letterSpacing: "-0.03em" }}>Recibido</div>
                  <div className="s-up" style={{ ["--d" as string]: "100ms", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, color: "#55636F" }}>
                    Recibido en portería
                    <br />
                    Oscar Reyes · 16/8/2026, 5:28:39 p.m.
                  </div>
                  <div style={{ marginTop: 8, maxWidth: 340 }}>
                    <div className="s-wipe" style={{ ["--d" as string]: "160ms", display: "flex", gap: 10 }}>
                      <AssetImage src="/img/trazabilidad-foto-mobile.jpg" alt="Fotografía real del paquete" width={150} height={151} style={{ flex: "150 1 0%", width: "auto", borderRadius: 10 }} />
                      <AssetImage src="/img/trazabilidad-qr-mobile.png" alt="QR real del paquete GF-2026-0000079" width={140} height={154} style={{ flex: "140 1 0%", width: "auto", borderRadius: 10, border: "1px solid #E3E8EC" }} />
                    </div>
                  </div>
                </div>
              </div>

              <div data-motion="t2" className={sectionClass("t2")} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)" }}>
                <MobileTimelineDot bg="#1E88E5" grow="260ms" />
                <div style={{ paddingLeft: 8, paddingBottom: 36, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="s-up" style={{ ["--d" as string]: "60ms", fontSize: "var(--gf-m-q)", fontWeight: 800, letterSpacing: "-0.03em", color: "#0D5BA8" }}>Notificado</div>
                  <div className="s-up" style={{ ["--d" as string]: "100ms", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, color: "#55636F" }}>Desde la app del guardia</div>
                  <div style={{ marginTop: 8, maxWidth: 300 }}>
                    <div className="s-wipe" style={{ ["--d" as string]: "160ms" }}>
                      <AssetImage src="/img/trazabilidad-notificado-mobile.png" alt="App real del guardia: Guardar y enviar notificación" width={300} height={140} style={{ borderRadius: 10, border: "1px solid #E3E8EC" }} />
                    </div>
                  </div>
                </div>
              </div>

              <div data-motion="t3" className={sectionClass("t3")} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span className="s-pop" style={{ ["--d" as string]: "0ms", width: 22, height: 22, borderRadius: 999, background: "#00C49A", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M2 5.2l2 2L8 3" fill="none" stroke="#0D1B2A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
                <div style={{ paddingLeft: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="s-up" style={{ ["--d" as string]: "60ms", fontSize: "var(--gf-m-q)", fontWeight: 800, letterSpacing: "-0.03em", color: "#00755C" }}>Entregado</div>
                  <div className="s-up" style={{ ["--d" as string]: "100ms", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, color: "#55636F" }}>Con firma y evidencia</div>
                  <div style={{ marginTop: 8, maxWidth: 250 }}>
                    <div className="s-wipe" style={{ ["--d" as string]: "160ms" }}>
                      <AssetImage src="/img/trazabilidad-entregado-mobile.png" alt="App real del guardia: firma de quien recibe y Entregar 1 paquete" width={250} height={230} style={{ borderRadius: 10, border: "1px solid #E3E8EC" }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 05 SEGURIDAD */}
        <section id="m-seguridad" data-motion="seguridad" className={sectionClass("seguridad")} style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#F4F6F8" }}>
          <div style={{ padding: "48px var(--gf-gap) 56px", display: "flex", flexDirection: "column" }}>
            <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 12 }}>
              <MobileEyebrow>05 / SEGURIDAD</MobileEyebrow>
              <h2 style={{ margin: 0, fontSize: "var(--gf-m-stat)", lineHeight: 1.12, fontWeight: 800, letterSpacing: "-0.03em", maxWidth: 560 }}>La información de cada residencial permanece separada.</h2>
            </div>
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column" }}>
              <MobileSecurityCell borderTop="#0D1B2A">ACCESO SEGÚN ROL</MobileSecurityCell>
              <MobileSecurityCell borderTop="#D5DCE2">INFORMACIÓN SEPARADA POR RESIDENCIAL</MobileSecurityCell>
              <MobileSecurityCell borderTop="#D5DCE2">HISTORIAL DE OPERACIÓN</MobileSecurityCell>
              <div style={{ height: 52, display: "flex", alignItems: "center", gap: 24, borderTop: "1px solid #D5DCE2", borderBottom: "1px solid #D5DCE2", fontSize: 15, fontWeight: 700 }}>
                <a href="#privacidad" className="gf-link" style={{ height: 44, display: "flex", alignItems: "center", textDecoration: "none" }}><span style={{ borderBottom: "2px solid #00C49A" }}>Privacidad</span></a>
                <a href="#terminos" className="gf-link" style={{ height: 44, display: "flex", alignItems: "center", textDecoration: "none" }}><span style={{ borderBottom: "2px solid #00C49A" }}>Términos</span></a>
              </div>
            </div>
          </div>
        </section>

        {/* 06 PRECIOS */}
        <section id="m-precios" style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#FFFFFF" }}>
          <div style={{ padding: "56px var(--gf-gap) 0", display: "flex", flexDirection: "column" }}>
            <div data-motion="preh" className={sectionClass("preh")}>
              <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
                <MobileEyebrow>06 / PRECIOS</MobileEyebrow>
                <h2 style={{ margin: 0, fontSize: "var(--gf-m-h2)", lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.04em" }}>Todo Gate Flow incluido.</h2>
                <p style={{ margin: 0, fontSize: "var(--gf-m-body)", lineHeight: 1.45, color: "#3A4A5A" }}>Elige según el tamaño de tu residencial.</p>
              </div>
            </div>
            <div style={{ marginTop: 28, maxWidth: 560, display: "flex", flexDirection: "column" }}>
              <MobilePricingBlock id="p1" sectionClass={sectionClass("p1")} n="50" price="29" features={["Todas las funciones", "Guardias ilimitados", "Administradores ilimitados", "Paquetes ilimitados", "Soporte"]} />
              <MobilePricingBlock id="p2" sectionClass={sectionClass("p2")} n="150" price="49" note="Exactamente las mismas funciones." />
              <div style={{ height: 2, background: "#0D1B2A" }} />
              <div style={{ marginTop: 18, fontSize: "var(--gf-m-stat)", lineHeight: 1.2, fontWeight: 800, letterSpacing: "-0.02em" }}>
                ¿Más de 150 viviendas? <span style={{ color: "#00755C" }}>Hablemos.</span>
              </div>
              <a href="#contacto" className="gf-link" style={{ marginTop: 6, height: 44, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
                <span style={{ borderBottom: "2px solid #00C49A", paddingBottom: 2 }}>Contactar</span>
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </section>

        {/* 07 FAQ */}
        <section id="m-faq" data-motion="faq" className={sectionClass("faq")} style={{ position: "relative", flexShrink: 0, width: "100%", overflow: "hidden", background: "#F4F6F8" }}>
          <div style={{ padding: "56px var(--gf-gap) 64px", display: "flex", flexDirection: "column" }}>
            <div className="s-up" style={{ ["--d" as string]: "0ms", display: "flex", flexDirection: "column", gap: 14 }}>
              <MobileEyebrow>07 / PREGUNTAS</MobileEyebrow>
              <h2 style={{ margin: 0, fontSize: "var(--gf-m-h2)", lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.035em" }}>Preguntas frecuentes</h2>
            </div>
            <div style={{ marginTop: 22, maxWidth: 680, height: 2, background: "#0D1B2A" }} />
            <div style={{ maxWidth: 680 }}>
              {FAQ_ITEMS.map((item, i) => (
                <MobileFaqRow key={item.question} item={item} isOpen={open === i} onToggle={() => toggle(i)} />
              ))}
            </div>
          </div>
        </section>

        {/* CTA FINAL — mismo mecanismo de mini-lienzo que el hero: el "7"
           gigante se superpone al titular y a la franja navy exactamente
           como en el diseño, a cualquier tamaño (tope 640px). */}
        <section
          id="m-probar"
          data-motion="probar"
          className={`${sectionClass("probar")} gf-scale`}
          style={{ ["--gf-w" as string]: 390, flexShrink: 0, maxWidth: 640, aspectRatio: "390 / 690", margin: "0 auto" }}
        >
        <div className="gf-scale-inner" style={{ position: "relative", width: 390, height: 690, overflow: "hidden", background: "#FFFFFF" }}>
          <h2 className="s-up" style={{ ["--d" as string]: "0ms", position: "absolute", left: 20, top: 56, width: 350, margin: 0, fontSize: 40, lineHeight: 0.98, fontWeight: 800, letterSpacing: "-0.05em", zIndex: 2 }}>
            Una semana es suficiente para verlo funcionando.
          </h2>
          <div style={{ position: "absolute", left: 20, top: 440, display: "flex", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#55636F", zIndex: 2 }}>
            <span style={{ color: "#0D1B2A", fontWeight: 600 }}>7 DÍAS</span>
            <span>·</span>
            <span>PRUEBA GRATIS</span>
          </div>
          <div className="s-rise-lg" style={{ ["--d" as string]: "100ms", position: "absolute", left: 214, top: 223, fontSize: 280, lineHeight: 1, fontWeight: 800, letterSpacing: "-0.06em", color: "#0D1B2A", whiteSpace: "nowrap", zIndex: 1 }}>7</div>
          <div style={{ position: "absolute", left: 0, top: 470, width: 390, height: 220, background: "#0D1B2A", zIndex: 1 }} />
          <div style={{ position: "absolute", left: 20, top: 498, width: 350, display: "flex", flexDirection: "column", zIndex: 2 }}>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "#C9D4DE" }}>
              Prueba Gate Flow durante 7 días en tu residencial. <span style={{ color: "#FFFFFF", fontWeight: 700 }}>Sin tarjeta. Sin compromiso.</span>
            </p>
            <a href="#comenzar" className="gf-btn" style={{ marginTop: 20, height: 56, display: "flex", alignItems: "center", justifyContent: "center", background: "#00C49A", color: "#0D1B2A", fontWeight: 800, borderRadius: 10, textDecoration: "none", fontSize: 16 }}>
              Comenzar prueba gratis
            </a>
          </div>
        </div>
        </section>

        {/* FOOTER */}
        <footer style={{ position: "relative", flexShrink: 0, width: "100%", padding: "28px var(--gf-gap)", background: "#0D1B2A", borderTop: "1px solid #22364B", color: "#FFFFFF", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Logo />
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em" }}>Gate Flow</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <a href="#contacto" className="gf-tap" style={footLink}>Contacto</a>
            <a href="#soporte" className="gf-tap" style={footLink}>Soporte</a>
            <a href="#privacidad" className="gf-tap" style={footLink}>Privacidad</a>
            <a href="#terminos" className="gf-tap" style={footLink}>Términos</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

const navCta: React.CSSProperties = { height: 44, padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "center", background: "#00C49A", color: "#0D1B2A", fontWeight: 800, borderRadius: 10, textDecoration: "none", fontSize: 14 };
const footLink: React.CSSProperties = { height: 44, display: "flex", alignItems: "center", textDecoration: "none", color: "#C9D4DE", fontSize: 15, fontWeight: 600 };

function Logo({ dark }: { dark?: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill={dark ? "#0D1B2A" : "#00C49A"} />
      <path d="M9 8v12M19 8v12" stroke={dark ? "#fff" : "#0D1B2A"} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2.6" fill={dark ? "#00C49A" : "#0D1B2A"} />
    </svg>
  );
}

function MenuLink({ href, n, label, onClick }: { href: string; n: string; label: string; onClick: () => void }) {
  return (
    <a href={href} onClick={onClick} className="gf-tap" style={{ height: 56, display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid #EEF1F4", textDecoration: "none", fontSize: 18, fontWeight: 700, color: "#0D1B2A" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#55636F" }}>{n}</span>
      {label}
    </a>
  );
}

function MobileEyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#55636F" }}>{children}</div>;
}

function MiniStep({ d1, d2, label, value, teal, tealDelay }: { d1: string; d2: string; label: string; value: string; teal?: boolean; tealDelay?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingRight: 6 }}>
      <div className="s-fill" style={{ ["--d" as string]: d1, height: 3, background: "#00C49A" }} />
      <div className={teal ? "s-teal" : "s-dim"} style={{ ["--d" as string]: teal ? tealDelay : d2, fontSize: 13, fontWeight: 800, color: teal ? "#00C49A" : undefined }}>{label}</div>
      <div className="s-up" style={{ ["--d" as string]: d2, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8FA3B5" }}>{value}</div>
    </div>
  );
}

function MobileProblemRow({ d, n, q, right, last }: { d: string; n: string; q: string; right: React.ReactNode; last?: boolean }) {
  return (
    <div className="s-up" style={{ ["--d" as string]: d, padding: "18px 0", borderBottom: last ? undefined : "1px solid #DDE3E8", display: "grid", gridTemplateColumns: "34px minmax(0, 1fr)", rowGap: 10 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#55636F", paddingTop: 6 }}>{n}</div>
      <div style={{ fontSize: "var(--gf-m-q)", lineHeight: 1.2, fontWeight: 800, letterSpacing: "-0.025em" }}>{q}</div>
      <div />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</div>
    </div>
  );
}

function StatePill({ bg, fg, dot, label, note, boldNote }: { bg: string; fg: string; dot: string; label: string; note: string; boldNote?: boolean }) {
  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", background: bg, color: fg, borderRadius: 999, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: boldNote ? undefined : "#55636F", fontWeight: boldNote ? 600 : undefined }}>{note}</span>
    </>
  );
}

function MonoPair({ a, b }: { a: string; b: string }) {
  return (
    <>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#55636F", letterSpacing: "0.1em" }}>{a}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{b}</span>
    </>
  );
}

function MobileStage({ d, grow, growColor, dotColor, n, label, labelD, labelColor, last }: { d: string; grow?: string; growColor?: string; dotColor: string; n: string; label: string; labelD: string; labelColor?: string; last?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span className="s-pop" style={{ ["--d" as string]: d, width: 12, height: 12, borderRadius: 999, background: dotColor, marginTop: 12, flexShrink: 0 }} />
        {!last && <span className="s-grow" style={{ ["--d" as string]: grow, ["--t" as string]: "200ms", width: 3, flexGrow: 1, background: growColor }} />}
      </div>
      <div style={{ height: 64, display: "flex", alignItems: "baseline", gap: 12, paddingLeft: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#55636F" }}>{n}</span>
        <span className="s-dim" style={{ ["--d" as string]: labelD, fontSize: "var(--gf-m-q)", fontWeight: 800, letterSpacing: "-0.035em", color: labelColor }}>{label}</span>
      </div>
    </>
  );
}

function RecordTableMobile() {
  const rows: [string, string][] = [
    ["CÓDIGO", "GF-2026-0000079"],
    ["EMPRESA", "Amazon"],
    ["UBICACIÓN", "A1"],
    ["RECIBIDO POR", "Oscar Reyes"],
    ["FECHA", "16/8/2026, 5:28:39 p.m."],
  ];
  return (
    <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: "contents" }}>
          <div style={{ padding: "10px 0", borderTop: "1px solid #DDE3E8", borderBottom: i === rows.length - 1 ? "1px solid #DDE3E8" : undefined, color: "#55636F", letterSpacing: "0.08em" }}>{k}</div>
          <div style={{ padding: "10px 0", borderTop: "1px solid #DDE3E8", borderBottom: i === rows.length - 1 ? "1px solid #DDE3E8" : undefined }}>{k === "CÓDIGO" ? <span style={{ fontWeight: 600 }}>{v}</span> : v}</div>
        </div>
      ))}
    </div>
  );
}

function MobileTimelineDot({ bg, grow }: { bg: string; grow: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span className="s-pop" style={{ ["--d" as string]: "0ms", width: 14, height: 14, borderRadius: 999, background: bg, marginTop: 10, flexShrink: 0 }} />
      <span className="s-grow" style={{ ["--d" as string]: grow, ["--t" as string]: "320ms", width: 2, flexGrow: 1, background: "#0D1B2A" }} />
    </div>
  );
}

function MobileSecurityCell({ children, borderTop }: { children: React.ReactNode; borderTop: string }) {
  return (
    <div style={{ height: 52, display: "flex", alignItems: "center", borderTop: `1px solid ${borderTop}`, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em" }}>
      {children}
    </div>
  );
}

function MobilePricingBlock({ sectionClass, n, price, features, note }: { id: string; sectionClass: string; n: string; price: string; features?: string[]; note?: string }) {
  return (
    <div data-motion={n === "50" ? "p1" : "p2"} className={sectionClass} style={{ display: "flex", flexDirection: "column", paddingBottom: 36 }}>
      <div style={{ height: 2, background: "#0D1B2A" }} />
      <div style={{ marginTop: 18, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "#55636F" }}>HASTA</div>
      <div className="s-rise" style={{ ["--d" as string]: "0ms", marginTop: 4, marginLeft: -6, fontSize: "var(--gf-m-price)", lineHeight: 0.8, fontWeight: 800, letterSpacing: "-0.07em" }}>{n}</div>
      <div style={{ marginTop: 10, fontSize: 20, fontWeight: 700 }}>viviendas</div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #DDE3E8", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "#55636F" }}>USD</span>
        <span style={{ fontSize: "var(--gf-m-pricefig)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{price}</span>
        <span style={{ fontSize: 16, color: "#3A4A5A" }}>/ mes</span>
      </div>
      {features ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6, fontSize: 15, fontWeight: 600 }}>
          {features.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 16, fontSize: 20, lineHeight: 1.25, fontWeight: 800, letterSpacing: "-0.02em" }}>{note}</div>
      )}
      <div style={{ marginTop: 14, fontFamily: "var(--font-mono)", fontSize: 12, color: "#55636F" }}>7 días gratis · SIN TARJETA</div>
      <a href="#m-precios" className="gf-btn" style={{ marginTop: 14, height: 52, display: "flex", alignItems: "center", justifyContent: "center", background: "#00C49A", color: "#0D1B2A", fontWeight: 800, borderRadius: 10, textDecoration: "none", fontSize: 16 }}>
        Probar gratis
      </a>
    </div>
  );
}

function MobileFaqRow({ item, isOpen, onToggle }: { item: { question: string; answer: string | null }; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className={`gf-faq ${isOpen ? "is-open" : ""}`} style={{ borderBottom: "1px solid #D5DCE2" }}>
      <button
        type="button"
        className="gf-tap"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{ width: "100%", minHeight: 64, padding: "16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, background: "none", border: 0, cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 17, lineHeight: 1.3, fontWeight: 800, color: "#0D1B2A" }}
      >
        <span>{item.question}</span>
        <span className="gf-ico" aria-hidden="true" style={{ width: 24, flexShrink: 0, textAlign: "center", fontSize: 24, fontWeight: 500, color: "#55636F", lineHeight: 1 }}>+</span>
      </button>
      <div className="gf-ans">
        <div style={{ overflow: "hidden" }}>
          <div style={{ paddingBottom: 18 }}>
            {item.answer ? (
              <div style={{ fontSize: 15, lineHeight: 1.5, color: "#3A4A5A" }}>{item.answer}</div>
            ) : (
              <span className="gf-pending-note">[CONTENIDO POR CONFIRMAR]</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

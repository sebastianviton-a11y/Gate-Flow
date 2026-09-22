"use client";

import { AssetImage, AssetVideo } from "./Asset";
import { FAQ_ITEMS } from "@/lib/faq";
import { useFaqAccordion, useSectionReveal } from "@/lib/useSectionReveal";

// Puerto 1:1 de project/Landing.dc.html (1440×8000) del canvas aprobado
// "Gate Flow — Landing". Las secciones, textos, colores, tamaños y
// posiciones son los del diseño aprobado — no reinterpretar.
// Placeholders: los `src` de AssetImage/AssetVideo apuntan a rutas en
// /public/img y /public/video que todavía no existen (ver reporte).
export default function DesktopLanding() {
  const { containerRef, sectionClass } = useSectionReveal(0.2);
  const { open, toggle } = useFaqAccordion(0);

  return (
    <div ref={containerRef} className="gf-desktop">
      <div
        className="gf-scale"
        style={{ ["--gf-w" as string]: 1440, maxWidth: 1440, aspectRatio: "1440 / 8000", margin: "0 auto" }}
      >
        <div
          className="gf-scale-inner"
          style={{
            width: 1440,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: "#FFFFFF",
            color: "#0D1B2A",
          }}
        >
        {/* 00 HERO */}
        <section
          id="inicio"
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 900, overflow: "hidden", background: "#FFFFFF" }}
        >
          <nav
            className="gf-nav"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 1440,
              height: 88,
              padding: "0 72px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              zIndex: 6,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo dark />
              <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>Gate Flow</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 32, fontSize: 15, fontWeight: 600 }}>
              <a href="#como" style={{ textDecoration: "none" }}>
                Cómo funciona
              </a>
              <a href="#precios" style={{ textDecoration: "none" }}>
                Precios
              </a>
              <a href="#ingresar" style={{ textDecoration: "none" }}>
                Ingresar
              </a>
            </div>
          </nav>

          <div style={{ position: "absolute", left: 72, top: 136, width: 640, zIndex: 3 }}>
            <h1
              className="h-up"
              style={{ ["--d" as string]: "0ms", margin: 0, fontSize: 88, lineHeight: 0.94, fontWeight: 800, letterSpacing: "-0.055em" }}
            >
              Cada paquete,
              <br />
              bajo control.
            </h1>
            <div
              className="h-up"
              style={{
                ["--d" as string]: "60ms",
                marginTop: 22,
                width: 520,
                fontSize: 30,
                lineHeight: 1.14,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "#00755C",
              }}
            >
              Desde que llega hasta que se entrega.
            </div>
          </div>

          <div
            className="h-up"
            style={{
              ["--d" as string]: "300ms",
              position: "absolute",
              left: 728,
              top: 222,
              display: "flex",
              gap: 14,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.14em",
              color: "#55636F",
              zIndex: 2,
            }}
          >
            <span style={{ color: "#0D1B2A", fontWeight: 600 }}>TORRE A</span>
            <span>·</span>
            <span>DEPTO. 102</span>
          </div>
          <div
            className="h-drift"
            style={{
              ["--d" as string]: "120ms",
              position: "absolute",
              left: 716,
              top: 195,
              fontSize: 400,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: "-0.07em",
              color: "#0D1B2A",
              whiteSpace: "nowrap",
              zIndex: 1,
            }}
          >
            102
          </div>

          <div style={{ position: "absolute", left: 0, top: 548, width: 1440, height: 352, background: "#0D1B2A", zIndex: 1 }} />

          <div
            className="h-up"
            style={{
              ["--d" as string]: "120ms",
              position: "absolute",
              left: 72,
              top: 596,
              width: 470,
              display: "flex",
              flexDirection: "column",
              zIndex: 3,
            }}
          >
            <p style={{ margin: 0, fontSize: 18, lineHeight: 1.55, color: "#C9D4DE" }}>
              Gate Flow simplifica la recepción y entrega de paquetes en residenciales, conectando a guardias, residentes y
              administración en un mismo flujo.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 30 }}>
              <a href="#precios" className="gf-btn" style={btnPrimary}>
                Probar gratis 7 días
              </a>
              <a href="#como" className="gf-link" style={linkOnDark}>
                Ver cómo funciona
                <span className="gf-arr" aria-hidden="true">
                  →
                </span>
              </a>
            </div>
            <div style={{ marginTop: 20, fontFamily: "var(--font-mono)", fontSize: 13, color: "#8FA3B5" }}>
              Sin tarjeta · Configuración simple · Desde USD 29/mes
            </div>
          </div>

          <div className="h-up" style={{ ["--d" as string]: "360ms", position: "absolute", left: 728, top: 560, width: 352, height: 31, borderRadius: 6, overflow: "hidden", zIndex: 3 }}>
            <AssetImage
              src="/img/hero-estado-recibido.png"
              alt="Estado Recibido y código GF-2026-0000073 en la app del guardia"
              width={352}
              height={31}
            />
          </div>
          <div
            className="h-wipe"
            style={{ ["--d" as string]: "420ms", position: "absolute", left: 728, top: 603, width: 352, height: 170, borderRadius: 10, overflow: "hidden", zIndex: 3 }}
          >
            <AssetImage src="/img/hero-foto-paquete.jpg" alt="Fotografía real del paquete tomada al registrarlo" width={352} height={170} />
            <div
              style={{
                position: "absolute",
                left: 10,
                bottom: 10,
                height: 24,
                padding: "0 8px",
                display: "flex",
                alignItems: "center",
                background: "rgba(13,27,42,0.85)",
                color: "#FFFFFF",
                borderRadius: 5,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              FOTOGRAFÍA DEL PAQUETE
            </div>
          </div>

          <div className="h-wipe" style={{ ["--d" as string]: "1180ms", position: "absolute", left: 1152, top: 540, width: 216, height: 242, borderRadius: 14, overflow: "hidden", zIndex: 3 }}>
            <AssetImage src="/img/hero-qr.png" alt="QR real del paquete GF-2026-0000073 en la app del guardia" width={216} height={242} />
          </div>

          <div
            style={{
              position: "absolute",
              left: 728,
              top: 800,
              width: 640,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              zIndex: 3,
              color: "#FFFFFF",
            }}
          >
            <FlowStep d1="620ms" d2="700ms" label="Llega" value="GF-2026-0000073" />
            <FlowStep d1="780ms" d2="860ms" label="Se registra" value="3:04:28 p.m." />
            <FlowStep d1="940ms" d2="1020ms" label="Se notifica" value="Residente" />
            <FlowStep d1="1100ms" d2="1180ms" label="Se entrega" value="Con QR" teal last />
          </div>
        </section>

        {/* 01 PROBLEMA */}
        <section
          id="problema"
          data-motion="problema"
          className={sectionClass("problema")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 560, overflow: "hidden", background: "#FFFFFF" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 110, width: 488, display: "flex", flexDirection: "column" }}>
            <Eyebrow>01 / EL PROBLEMA</Eyebrow>
            <h2 style={{ margin: "22px 0 0", fontSize: 48, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-0.04em" }}>
              Recibir un paquete es fácil. <span style={{ color: "#56677A" }}>Llevar el control de cientos, no tanto.</span>
            </h2>
          </div>

          <div style={{ position: "absolute", left: 640, top: 118, width: 728, display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) 200px" }}>
            <div style={{ gridColumn: "1 / 4", height: 2, background: "#0D1B2A" }} />
            <ProblemRow d="120ms" n="01" q="¿Llegó mi paquete?" right={<StatePill bg="#E8EDF1" fg="#0D1B2A" dot="#0D1B2A" label="Recibido" note="Fecha de recepción" />} />
            <ProblemRow d="210ms" n="02" q="¿Quién lo recibió?" right={<MonoPair a="RECIBIDO POR" b="Guardia" />} />
            <ProblemRow
              d="300ms"
              n="03"
              q="¿Ya fue entregado y a quién?"
              right={<StatePill bg="#DDF7EF" fg="#00664F" dot="#00C49A" label="Entregado" note="¿Quién recibe? · Firma" boldNote />}
            />
          </div>

          <p style={{ position: "absolute", left: 72, top: 392, width: 440, margin: 0, fontSize: 18, lineHeight: 1.55, color: "#3A4A5A" }}>
            Gate Flow deja cada movimiento registrado para que guardias y administración tengan la misma información.
          </p>
        </section>

        {/* 02 CÓMO FUNCIONA */}
        <section
          id="como"
          data-motion="como"
          className={sectionClass("como")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 1280, overflow: "hidden", background: "#F4F6F8" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 100, width: 900, display: "flex", flexDirection: "column" }}>
            <Eyebrow>02 / CÓMO FUNCIONA</Eyebrow>
            <h2 style={{ margin: "22px 0 0", fontSize: 64, lineHeight: 1.02, fontWeight: 800, letterSpacing: "-0.045em" }}>
              Del repartidor al residente,
              <br />
              sin perder el rastro.
            </h2>
          </div>

          <div style={{ position: "absolute", left: 72, top: 316, width: 1296, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <StageCol d1="100ms" d2="220ms" n="01" label="Recibido" bar="#0D1B2A" arrow />
            <StageCol d1="340ms" d2="460ms" n="02" label="Registrado" bar="#0D1B2A" arrow />
            <StageCol d1="580ms" d2="700ms" n="03" label="Notificado" bar="#1E88E5" arrow />
            <StageCol d1="820ms" d2="940ms" n="04" label="Entregado" bar="#00C49A" labelColor="#00755C" />
          </div>

          <div
            className="s-up"
            style={{
              ["--d" as string]: "160ms",
              position: "absolute",
              left: 72,
              top: 452,
              width: 1296,
              height: 729,
              background: "#0D1B2A",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 60px 100px -60px rgba(13,27,42,0.7)",
            }}
          >
            <div style={{ position: "absolute", left: 32, top: 28, display: "flex", gap: 14, fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#8FA3B5" }}>
              <span style={{ color: "#FFFFFF", fontWeight: 600 }}>VIDEO</span>
              <span>·</span>
              <span>1:19</span>
            </div>
            <AssetVideo
              src="/video/producto-horizontal.mp4"
              poster="/video/producto-horizontal-poster.jpg"
              ariaLabel="Video de Gate Flow en uso, formato horizontal, 1 minuto 19 segundos"
              width={1296}
              height={729}
              style={{ position: "absolute", left: 0, top: 0 }}
            />
            <div style={{ position: "absolute", left: 604, top: 320, width: 88, height: 88, pointerEvents: "none" }}>
              <div className="gf-play" style={{ width: 88, height: 88, borderRadius: 999, background: "#00C49A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="28" height="28" viewBox="0 0 26 26" aria-hidden="true">
                  <path d="M8 5v16l13-8z" fill="#0D1B2A" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* 03 GUARDIA + ADMIN */}
        <section
          id="producto"
          data-motion="producto"
          className={sectionClass("producto")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 1160, overflow: "hidden", background: "#0D1B2A", color: "#FFFFFF" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 120, width: 1200, display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#8FA3B5" }}>03 / GUARDIA + ADMINISTRACIÓN</div>
            <h2 style={{ margin: "22px 0 0", fontSize: 64, lineHeight: 1.02, fontWeight: 800, letterSpacing: "-0.045em" }}>
              Simple para quien recibe.
              <br />
              <span style={{ color: "#00C49A" }}>Claro para quien administra.</span>
            </h2>
          </div>

          <div style={{ position: "absolute", left: 72, top: 326, fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#8FA3B5" }}>GUARDIA · APP EN CASETA</div>
          <div style={{ position: "absolute", left: 600, top: 300, fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#8FA3B5" }}>ADMINISTRACIÓN · PANEL WEB</div>

          <div
            style={{
              position: "absolute",
              left: 72,
              top: 360,
              width: 420,
              height: 960,
              padding: 12,
              background: "#16283B",
              border: "1px solid #2B3F55",
              borderRadius: 56,
              zIndex: 2,
              boxSizing: "border-box",
            }}
          >
            <div style={{ width: 394, height: 934, borderRadius: 44, overflow: "hidden", background: "#F4F6F8" }}>
              <AssetImage
                src="/img/guardia-porteria.png"
                alt="App real del guardia: Portería con Registrar paquete, Escanear QR, Entregar paquete, Buscar paquete y Paquetes pendientes"
                width={394}
                height={934}
                style={{ height: "auto" }}
              />
            </div>
          </div>

          <div
            className="s-up"
            style={{
              ["--d" as string]: "100ms",
              position: "absolute",
              left: 600,
              top: 330,
              width: 1300,
              height: 900,
              borderRadius: 14,
              overflow: "hidden",
              background: "#F4F6F8",
              boxShadow: "0 60px 100px -50px rgba(0,0,0,0.6)",
              zIndex: 1,
            }}
          >
            <AssetImage
              src="/img/admin-dashboard.png"
              alt="Panel real de administración: Dashboard con paquetes pendientes, recibidos y entregados hoy, y actividad reciente"
              width={1300}
              height={900}
              style={{ height: "auto" }}
            />
          </div>

          <div className="s-pop" style={{ ["--d" as string]: "200ms", position: "absolute", left: 99, top: 1078, width: 366, height: 100, border: "2px solid #00C49A", borderRadius: 12, boxShadow: "0 0 0 6px rgba(0,196,154,0.18)", zIndex: 4, boxSizing: "border-box" }} />
          <div className="s-fill" style={{ ["--d" as string]: "420ms", ["--t" as string]: "160ms", position: "absolute", left: 465, top: 1109, width: 76, height: 2, background: "#00C49A", zIndex: 4 }} />
          <div className="s-grow" style={{ ["--d" as string]: "560ms", ["--t" as string]: "320ms", transformOrigin: "center bottom", position: "absolute", left: 539, top: 633, width: 2, height: 478, background: "#00C49A", zIndex: 4 }} />
          <div className="s-fill" style={{ ["--d" as string]: "860ms", ["--t" as string]: "240ms", position: "absolute", left: 539, top: 633, width: 325, height: 2, background: "#00C49A", zIndex: 4 }} />
          <div className="s-pop" style={{ ["--d" as string]: "1080ms", position: "absolute", left: 862, top: 574, width: 250, height: 120, border: "2px solid #00C49A", borderRadius: 12, boxShadow: "0 0 0 6px rgba(0,196,154,0.18)", zIndex: 4, boxSizing: "border-box" }} />
          <div className="s-up" style={{ ["--d" as string]: "1000ms", position: "absolute", left: 552, top: 842, padding: "5px 8px", background: "#0D1B2A", border: "1px solid #00C49A", borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "#00C49A", zIndex: 4 }}>
            PAQUETES PENDIENTES
          </div>
        </section>

        {/* 04 TRAZABILIDAD */}
        <section
          id="trazabilidad"
          data-motion="trazabilidad"
          className={sectionClass("trazabilidad")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 1040, overflow: "hidden", background: "#FFFFFF" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 96, width: 1100, display: "flex", flexDirection: "column" }}>
            <Eyebrow>04 / TRAZABILIDAD</Eyebrow>
            <h2 style={{ margin: "22px 0 0", fontSize: 64, lineHeight: 1.02, fontWeight: 800, letterSpacing: "-0.045em" }}>
              Cuando alguien pregunta qué pasó con un paquete, <span style={{ color: "#00755C" }}>la respuesta está ahí.</span>
            </h2>
          </div>

          <div className="s-up" style={{ ["--d" as string]: "120ms", position: "absolute", left: 72, top: 400, width: 488, display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#0D1B2A", fontWeight: 600 }}>UNIDAD</div>
            <div style={{ fontSize: 132, lineHeight: 0.84, fontWeight: 800, letterSpacing: "-0.065em", marginTop: 16, marginLeft: -6, whiteSpace: "nowrap" }}>
              MZA 1
              <br />
              LTE 8
            </div>
            <RecordTable />
            <div style={{ marginTop: 14, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", color: "#55636F" }}>
              CAPTURAS REALES · DATOS DE PRUEBA, SOLO DEMOSTRATIVOS
            </div>
          </div>

          <div style={{ position: "absolute", left: 640, top: 400, width: 728, display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) 340px" }}>
            <TimelineDot d="150ms" bg="#0D1B2A" grow="380ms" />
            <div className="s-up" style={{ ["--d" as string]: "200ms", paddingBottom: 40, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em" }}>Recibido</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, color: "#55636F" }}>
                Recibido en portería
                <br />
                Oscar Reyes · 16/8/2026, 5:28:39 p.m.
              </div>
            </div>
            <div className="s-wipe" style={{ ["--d" as string]: "300ms", paddingBottom: 40, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <AssetImage src="/img/trazabilidad-foto.jpg" alt="Fotografía real del paquete en el panel de administración" width={170} height={171} style={{ borderRadius: 10 }} />
              <AssetImage src="/img/trazabilidad-qr.png" alt="QR real del paquete GF-2026-0000079" width={156} height={171} style={{ borderRadius: 10, border: "1px solid #E3E8EC" }} />
            </div>

            <TimelineDot d="620ms" bg="#1E88E5" grow="850ms" />
            <div className="s-up" style={{ ["--d" as string]: "670ms", paddingBottom: 40, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "#0D5BA8" }}>Notificado</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, color: "#55636F" }}>Desde la app del guardia</div>
            </div>
            <div className="s-wipe" style={{ ["--d" as string]: "760ms", paddingBottom: 40 }}>
              <AssetImage src="/img/trazabilidad-notificado.png" alt="App real del guardia: Guardar y enviar notificación" width={300} height={140} style={{ borderRadius: 10, border: "1px solid #E3E8EC" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span className="s-pop" style={{ ["--d" as string]: "1090ms", width: 24, height: 24, borderRadius: 999, background: "#00C49A", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 5.2l2 2L8 3" fill="none" stroke="#0D1B2A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
            <div className="s-up" style={{ ["--d" as string]: "1140ms", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "#00755C" }}>Entregado</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5, color: "#55636F" }}>Con firma y evidencia</div>
            </div>
            <div className="s-wipe" style={{ ["--d" as string]: "1240ms" }}>
              <AssetImage src="/img/trazabilidad-entregado.png" alt="App real del guardia: firma de quien recibe y botón Entregar 1 paquete" width={240} height={221} style={{ borderRadius: 10, border: "1px solid #E3E8EC" }} />
            </div>
          </div>
        </section>

        {/* 05 SEGURIDAD */}
        <section
          id="seguridad"
          data-motion="seguridad"
          className={sectionClass("seguridad")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 320, overflow: "hidden", background: "#F4F6F8" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 88, width: 488, display: "flex", flexDirection: "column" }}>
            <Eyebrow>05 / SEGURIDAD</Eyebrow>
            <h2 style={{ margin: "20px 0 0", fontSize: 36, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.03em" }}>
              La información de cada residencial permanece separada.
            </h2>
          </div>
          <div style={{ position: "absolute", left: 640, top: 92, width: 728, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 40 }}>
            <SecurityCell borderTop="#0D1B2A">ACCESO SEGÚN ROL</SecurityCell>
            <SecurityCell borderTop="#0D1B2A">INFORMACIÓN SEPARADA POR RESIDENCIAL</SecurityCell>
            <SecurityCell borderTop="#D5DCE2" borderBottom="#D5DCE2">HISTORIAL DE OPERACIÓN</SecurityCell>
            <div style={{ height: 58, borderTop: "1px solid #D5DCE2", borderBottom: "1px solid #D5DCE2", display: "flex", alignItems: "center", gap: 24, fontSize: 15, fontWeight: 700 }}>
              <a href="#privacidad" className="gf-link" style={underlineLink}>Privacidad</a>
              <a href="#terminos" className="gf-link" style={underlineLink}>Términos</a>
            </div>
          </div>
        </section>

        {/* 06 PRECIOS */}
        <section
          id="precios"
          data-motion="precios"
          className={sectionClass("precios")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 1040, overflow: "hidden", background: "#FFFFFF" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 100, width: 900, display: "flex", flexDirection: "column" }}>
            <Eyebrow>06 / PRECIOS</Eyebrow>
            <h2 style={{ margin: "22px 0 0", fontSize: 64, lineHeight: 1.02, fontWeight: 800, letterSpacing: "-0.045em" }}>Todo Gate Flow incluido.</h2>
            <p style={{ margin: "16px 0 0", fontSize: 20, color: "#3A4A5A" }}>Elige según el tamaño de tu residencial.</p>
          </div>

          <div style={{ position: "absolute", left: 72, top: 330, width: 1296, height: 2, background: "#0D1B2A" }} />
          <div style={{ position: "absolute", left: 719, top: 332, width: 1, height: 530, background: "#DDE3E8" }} />

          <PricingColumn
            left={72}
            d="80ms"
            n="50"
            price="29"
            features={["Todas las funciones", "Guardias ilimitados", "Administradores ilimitados", "Paquetes ilimitados", "Soporte"]}
          />
          <PricingColumn left={768} d="200ms" n="150" price="49" note="Exactamente las mismas funciones." />

          <div style={{ position: "absolute", left: 72, top: 882, width: 1296, height: 76, borderTop: "2px solid #0D1B2A", display: "flex", alignItems: "center", justifyContent: "space-between", boxSizing: "border-box" }}>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>
              ¿Más de 150 viviendas? <span style={{ color: "#00755C" }}>Hablemos.</span>
            </div>
            <a href="#contacto" className="gf-link" style={underlineLink}>
              Contactar
              <span className="gf-arr" aria-hidden="true">→</span>
            </a>
          </div>
        </section>

        {/* 07 FAQ */}
        <section
          id="faq"
          data-motion="faq"
          className={sectionClass("faq")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 880, overflow: "hidden", background: "#F4F6F8" }}
        >
          <div className="s-up" style={{ position: "absolute", left: 72, top: 100, width: 488, display: "flex", flexDirection: "column" }}>
            <Eyebrow>07 / PREGUNTAS</Eyebrow>
            <h2 style={{ margin: "22px 0 0", fontSize: 48, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-0.04em" }}>Preguntas frecuentes</h2>
          </div>
          <div style={{ position: "absolute", left: 640, top: 100, width: 728, display: "flex", flexDirection: "column" }}>
            <div style={{ height: 2, background: "#0D1B2A" }} />
            {FAQ_ITEMS.map((item, i) => (
              <FaqRow key={item.question} item={item} isOpen={open === i} onToggle={() => toggle(i)} />
            ))}
          </div>
        </section>

        {/* CTA FINAL */}
        <section
          id="probar"
          data-motion="probar"
          className={sectionClass("probar")}
          style={{ position: "relative", flexShrink: 0, width: 1440, height: 700, overflow: "hidden", background: "#FFFFFF" }}
        >
          <div className="s-up" style={{ ["--d" as string]: "0ms", position: "absolute", left: 72, top: 100, width: 780, zIndex: 2 }}>
            <h2 style={{ margin: 0, fontSize: 88, lineHeight: 0.95, fontWeight: 800, letterSpacing: "-0.055em" }}>
              Una semana es suficiente para verlo funcionando.
            </h2>
          </div>
          <div style={{ position: "absolute", left: 72, top: 430, display: "flex", gap: 14, fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#55636F", zIndex: 2 }}>
            <span style={{ color: "#0D1B2A", fontWeight: 600 }}>7 DÍAS</span>
            <span>·</span>
            <span>PRUEBA GRATIS</span>
          </div>
          <div className="s-rise-lg" style={{ ["--d" as string]: "120ms", position: "absolute", left: 930, top: -77, fontSize: 640, lineHeight: 1, fontWeight: 800, letterSpacing: "-0.06em", color: "#0D1B2A", whiteSpace: "nowrap", zIndex: 1 }}>
            7
          </div>
          <div style={{ position: "absolute", left: 0, top: 488, width: 1440, height: 212, background: "#0D1B2A", zIndex: 1 }} />
          <div style={{ position: "absolute", left: 72, top: 488, width: 1296, height: 212, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
            <p style={{ margin: 0, fontSize: 20, lineHeight: 1.5, color: "#C9D4DE" }}>
              Prueba Gate Flow durante 7 días en tu residencial.
              <br />
              <span style={{ color: "#FFFFFF", fontWeight: 700 }}>Sin tarjeta. Sin compromiso.</span>
            </p>
            {/* CTA real hacia el flujo de trial/onboarding — todavía no construido.
               href="#comenzar" es un ancla en la misma página (igual que en el
               diseño aprobado), preparada para reconectarse a la ruta real sin
               tocar este componente. NO usar el login de admin como destino. */}
            <a href="#comenzar" className="gf-btn" style={btnPrimaryLg}>
              Comenzar prueba gratis
            </a>
          </div>
        </section>

        {/* FOOTER */}
        <footer
          className="gf-foot"
          style={{
            position: "relative",
            flexShrink: 0,
            width: 1440,
            height: 120,
            padding: "0 72px",
            background: "#0D1B2A",
            borderTop: "1px solid #22364B",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#FFFFFF",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Logo />
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>Gate Flow</span>
          </div>
          <div style={{ display: "flex", gap: 36, fontSize: 15, fontWeight: 600 }}>
            <a href="#contacto" style={{ textDecoration: "none", color: "#C9D4DE" }}>Contacto</a>
            <a href="#soporte" style={{ textDecoration: "none", color: "#C9D4DE" }}>Soporte</a>
            <a href="#privacidad" style={{ textDecoration: "none", color: "#C9D4DE" }}>Privacidad</a>
            <a href="#terminos" style={{ textDecoration: "none", color: "#C9D4DE" }}>Términos</a>
          </div>
        </footer>
        </div>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  height: 56,
  padding: "0 28px",
  display: "flex",
  alignItems: "center",
  background: "#00C49A",
  color: "#0D1B2A",
  fontSize: 16,
  fontWeight: 800,
  borderRadius: 10,
  textDecoration: "none",
};
const btnPrimaryLg: React.CSSProperties = { ...btnPrimary, height: 60, padding: "0 32px", fontSize: 17 };
const linkOnDark: React.CSSProperties = {
  height: 56,
  display: "flex",
  alignItems: "center",
  color: "#FFFFFF",
  fontSize: 16,
  fontWeight: 700,
  textDecoration: "none",
  borderBottom: "2px solid #00C49A",
  boxSizing: "border-box",
};
const underlineLink: React.CSSProperties = {
  height: 56,
  display: "flex",
  alignItems: "center",
  fontSize: 16,
  fontWeight: 700,
  textDecoration: "none",
  borderBottom: "2px solid #00C49A",
  boxSizing: "border-box",
};

function Logo({ dark }: { dark?: boolean }) {
  return (
    <svg width={dark ? 28 : 26} height={dark ? 28 : 26} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill={dark ? "#0D1B2A" : "#00C49A"} />
      <path d="M9 8v12M19 8v12" stroke={dark ? "#fff" : "#0D1B2A"} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="14" cy="14" r="2.6" fill={dark ? "#00C49A" : "#0D1B2A"} />
    </svg>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#55636F" }}>{children}</div>;
}

function FlowStep({ d1, d2, label, value, teal, last }: { d1: string; d2: string; label: string; value: string; teal?: boolean; last?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingRight: last ? 0 : 20 }}>
      <div className="h-fill" style={{ ["--d" as string]: d1, height: 3, background: "#00C49A" }} />
      <div className={teal ? "h-teal" : "h-dim"} style={{ ["--d" as string]: d2, fontSize: 18, fontWeight: 800, color: teal ? "#00C49A" : undefined }}>
        {label}
      </div>
      <div className="h-up" style={{ ["--d" as string]: d2, fontFamily: "var(--font-mono)", fontSize: 13, color: "#8FA3B5" }}>
        {value}
      </div>
    </div>
  );
}

function ProblemRow({ d, n, q, right }: { d: string; n: string; q: string; right: React.ReactNode }) {
  return (
    <>
      <div className="s-up" style={{ ["--d" as string]: d, height: 108, display: "flex", alignItems: "center", borderBottom: "1px solid #DDE3E8", fontFamily: "var(--font-mono)", fontSize: 13, color: "#55636F" }}>{n}</div>
      <div className="s-up" style={{ ["--d" as string]: d, height: 108, display: "flex", alignItems: "center", borderBottom: "1px solid #DDE3E8", fontSize: 31, fontWeight: 800, letterSpacing: "-0.03em" }}>{q}</div>
      <div className="s-up" style={{ ["--d" as string]: d, height: 108, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, borderBottom: "1px solid #DDE3E8" }}>{right}</div>
    </>
  );
}

function StatePill({ bg, fg, dot, label, note, boldNote }: { bg: string; fg: string; dot: string; label: string; note: string; boldNote?: boolean }) {
  return (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px", background: bg, color: fg, borderRadius: 999, fontSize: 12, fontWeight: 800 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: boldNote ? undefined : "#55636F", fontWeight: boldNote ? 600 : undefined }}>{note}</span>
    </>
  );
}

function MonoPair({ a, b }: { a: string; b: string }) {
  return (
    <>
      <span style={{ color: "#55636F", letterSpacing: "0.1em", fontFamily: "var(--font-mono)", fontSize: 13 }}>{a}</span>
      <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: 13 }}>{b}</span>
    </>
  );
}

function StageCol({ d1, d2, n, label, bar, labelColor, arrow }: { d1: string; d2: string; n: string; label: string; bar: string; labelColor?: string; arrow?: boolean }) {
  return (
    <div style={{ paddingRight: arrow ? 24 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="s-fill" style={{ ["--d" as string]: d1, height: 4, marginBottom: 10, marginRight: arrow ? -24 : 0, background: bar }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 13, color: "#55636F" }}>
        <span>{n}</span>
        {arrow && <span aria-hidden="true">→</span>}
      </div>
      <div className="s-dim" style={{ ["--d" as string]: d2, fontSize: 40, fontWeight: 800, letterSpacing: "-0.035em", color: labelColor }}>{label}</div>
    </div>
  );
}

function RecordTable() {
  const rows: [string, string][] = [
    ["CÓDIGO", "GF-2026-0000079"],
    ["EMPRESA", "Amazon"],
    ["UBICACIÓN", "A1"],
    ["RECIBIDO POR", "Oscar Reyes"],
    ["FECHA", "16/8/2026, 5:28:39 p.m."],
  ];
  return (
    <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
      {rows.map(([k, v], i) => (
        <div key={k} style={{ display: "contents" }}>
          <div style={{ padding: "11px 0", borderTop: "1px solid #DDE3E8", borderBottom: i === rows.length - 1 ? "1px solid #DDE3E8" : undefined, color: "#55636F", letterSpacing: "0.08em" }}>{k}</div>
          <div style={{ padding: "11px 0", borderTop: "1px solid #DDE3E8", borderBottom: i === rows.length - 1 ? "1px solid #DDE3E8" : undefined, fontWeight: k === "CÓDIGO" ? 600 : undefined }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function TimelineDot({ d, bg, grow }: { d: string; bg: string; grow: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span className="s-pop" style={{ ["--d" as string]: d, width: 16, height: 16, borderRadius: 999, background: bg, marginTop: 10 }} />
      <span className="s-grow" style={{ ["--d" as string]: grow, width: 2, flexGrow: 1, background: "#0D1B2A" }} />
    </div>
  );
}

function SecurityCell({ children, borderTop, borderBottom }: { children: React.ReactNode; borderTop: string; borderBottom?: string }) {
  return (
    <div style={{ height: 58, borderTop: `1px solid ${borderTop}`, borderBottom: borderBottom ? `1px solid ${borderBottom}` : undefined, display: "flex", alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, letterSpacing: "0.1em" }}>
      {children}
    </div>
  );
}

function PricingColumn({ left, d, n, price, features, note }: { left: number; d: string; n: string; price: string; features?: string[]; note?: string }) {
  return (
    <div style={{ position: "absolute", left, top: 364, width: 600, display: "flex", flexDirection: "column" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.14em", color: "#55636F" }}>HASTA</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 8 }}>
        <span className="s-rise" style={{ ["--d" as string]: d, display: "inline-block", fontSize: 260, lineHeight: 0.8, fontWeight: 800, letterSpacing: "-0.07em", marginLeft: -10 }}>{n}</span>
        <span style={{ fontSize: 24, fontWeight: 700 }}>viviendas</span>
      </div>
      <div style={{ marginTop: 36, paddingTop: 22, borderTop: "1px solid #DDE3E8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "#55636F" }}>USD</span>
          <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-0.03em" }}>{price}</span>
          <span style={{ fontSize: 17, color: "#3A4A5A" }}>/ mes</span>
        </div>
        <a href="#precios" className="gf-btn" style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", background: "#00C49A", color: "#0D1B2A", borderRadius: 10, fontSize: 16, fontWeight: 800, textDecoration: "none" }}>
          Probar gratis
        </a>
      </div>
      {features ? (
        <div style={{ marginTop: 22, height: 110, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", rowGap: 8, fontSize: 15, fontWeight: 600, color: "#0D1B2A" }}>
          {features.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 22, height: 110, fontSize: 22, lineHeight: 1.25, fontWeight: 800, letterSpacing: "-0.02em" }}>{note}</div>
      )}
      <div style={{ marginTop: 14, fontFamily: "var(--font-mono)", fontSize: 12, color: "#55636F" }}>7 días gratis · SIN TARJETA</div>
    </div>
  );
}

function FaqRow({ item, isOpen, onToggle }: { item: { question: string; answer: string | null }; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className={`gf-faq ${isOpen ? "is-open" : ""}`} style={{ borderBottom: "1px solid #D5DCE2" }}>
      <button
        type="button"
        className="gf-q"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{ width: "100%", padding: "22px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, background: "none", border: 0, cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", color: "inherit" }}
      >
        <span>{item.question}</span>
        <span className="gf-ico" aria-hidden="true" style={{ fontSize: 24, fontWeight: 500, color: "#55636F", lineHeight: 1 }}>+</span>
      </button>
      <div className="gf-ans">
        <div style={{ overflow: "hidden" }}>
          <div style={{ paddingBottom: 22 }}>
            {item.answer ? (
              <div style={{ fontSize: 16, lineHeight: 1.5, color: "#3A4A5A" }}>{item.answer}</div>
            ) : (
              <span className="gf-pending-note">[CONTENIDO POR CONFIRMAR]</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import "./v2.css";
import DesktopLandingV2 from "./DesktopLandingV2";
import MobileLandingV2 from "./MobileLandingV2";
import VideoModal from "./VideoModal";
import { useGateFlowV2 } from "./useGateFlowV2";

// Ensambla la landing V2 completa: ambos arboles (desktop + mobile) existen
// siempre en el DOM — el corte de 960px que decide cual se ve es CSS puro
// (.gfv2-mobile / .gfv2-desktop en v2.css), igual que en la referencia
// (.pv-desk / .pv-mob). Cada arbol tiene su propio controlador
// (useGateFlowV2("d") / ("m")); este componente solo coordina el modal de
// video, que sincroniza el paso activo del arbol que lo abrio ("owner"),
// tal como `openVideo(ctrl)` en reference/index.html.
export default function GateFlowV2() {
  const desktop = useGateFlowV2("d");
  const mobile = useGateFlowV2("m");
  const [videoOpen, setVideoOpen] = useState(false);
  const [owner, setOwner] = useState<"d" | "m" | null>(null);

  function openVideo(which: "d" | "m") {
    setOwner(which);
    setVideoOpen(true);
  }

  function closeVideo() {
    setVideoOpen(false);
  }

  function syncFromVideo(step: number) {
    if (owner === "d") desktop.syncActiveFromVideo(step);
    if (owner === "m") mobile.syncActiveFromVideo(step);
  }

  return (
    <>
      <DesktopLandingV2 v={desktop.v} onOpenVideo={() => openVideo("d")} />
      <MobileLandingV2 v={mobile.v} onOpenVideo={() => openVideo("m")} />
      <VideoModal open={videoOpen} onClose={closeVideo} onTimeSync={syncFromVideo} />
    </>
  );
}

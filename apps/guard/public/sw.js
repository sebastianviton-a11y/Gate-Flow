// Service worker de GateFlow Guardia — Sprint 1.5.
//
// ALCANCE DELIBERADAMENTE LIMITADO: esto cachea el "app shell" (la propia
// aplicación) para que abra incluso sin señal, NO sincroniza datos de
// paquetes ni implementa cola offline. Eso es trabajo de Sprint 03+,
// vía el motor de sincronización dedicado descrito en
// 02-ARCHITECTURE.md §5 (PowerSync o equivalente) — no se construye aquí
// una solución offline improvisada que luego haya que descartar.
const CACHE_NAME = "gateflow-guard-shell-v1";
const APP_SHELL = ["/guard", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Estrategia network-first para todo lo demás: si hay red, siempre se
// prefiere el dato fresco (esto NO es un sistema offline-first todavía,
// solo resiliencia de carga del shell — ver nota arriba).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

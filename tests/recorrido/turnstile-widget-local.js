// Sustituto LOCAL de https://challenges.cloudflare.com/turnstile/v0/api.js
// (lo sirve el recorrido con page.route; nunca se publica). Emula las
// claves de sitio de prueba de Cloudflare:
//   1x… → entrega el token ficticio XXXX.DUMMY.TOKEN.XXXX
//   2x… → error-callback (siempre bloquea)
// Con window.__zzTurnstileManual = true no entrega token hasta que la
// prueba llama a window.__zzTurnstile.emitir(); desde ahí, automático.
(function () {
  var widgets = {};
  var n = 0;
  var auto = !window.__zzTurnstileManual;
  var estado = { renders: 0, resets: 0, emitidos: 0 };
  function emitir(id) {
    var w = widgets[id];
    if (!w) return;
    setTimeout(function () {
      if (!widgets[id]) return;
      if (/^1x/.test(w.opts.sitekey)) {
        w.token = "XXXX.DUMMY.TOKEN.XXXX";
        estado.emitidos++;
        if (w.opts.callback) w.opts.callback(w.token);
      } else if (w.opts["error-callback"]) {
        w.opts["error-callback"]("110100");
      }
    }, 200);
  }
  window.__zzTurnstile = {
    estado: estado,
    emitir: function () {
      auto = true;
      Object.keys(widgets).forEach(emitir);
    },
  };
  window.turnstile = {
    render: function (el, opts) {
      var id = "zz-" + ++n;
      widgets[id] = { el: el, opts: opts, token: null };
      estado.renders++;
      el.setAttribute("data-zz-sitekey", opts.sitekey);
      el.setAttribute("data-zz-action", opts.action || "");
      el.textContent = "Verificación (emulada en la prueba local)";
      if (auto) emitir(id);
      return id;
    },
    reset: function (id) {
      if (!widgets[id]) return;
      widgets[id].token = null;
      estado.resets++;
      if (auto) emitir(id);
    },
    remove: function (id) {
      delete widgets[id];
    },
    getResponse: function (id) {
      return widgets[id] ? widgets[id].token : undefined;
    },
  };
})();

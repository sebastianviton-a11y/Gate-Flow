// ============================================================
// Buzón SMTP LOCAL para el recorrido de prueba: el servidor de Auth
// (GoTrue) manda aquí sus correos (confirmación, invitación) y nada sale
// de la máquina. Solo escucha en 127.0.0.1 y SOLO acepta destinatarios
// @gateflow.invalid (dominio reservado, nunca entregable): cualquier
// otro se rechaza con 550, así ningún correo puede llegar a una persona.
// Guarda cada mensaje y expone una búsqueda por destinatario.
// ============================================================
import net from "node:net";

const DOMINIO_PERMITIDO = /@gateflow\.invalid$/i;

/** quoted-printable → texto (los enlaces de GoTrue llegan así). */
export function decodificarQuotedPrintable(texto) {
  return texto.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function iniciarSmtpLocal({ puerto }) {
  const mensajes = [];
  const rechazados = [];
  const servidor = net.createServer((socket) => {
    let estado = "comando";
    let destinatarios = [];
    let datos = "";
    let resto = "";
    const enviar = (linea) => socket.write(`${linea}\r\n`);
    enviar("220 gf-smtp-local ESMTP");
    socket.on("data", (trozo) => {
      resto += trozo.toString("utf8");
      while (true) {
        if (estado === "datos") {
          const fin = resto.indexOf("\r\n.\r\n");
          if (fin === -1) return;
          datos += resto.slice(0, fin);
          resto = resto.slice(fin + 5);
          const crudo = datos.replace(/^\.\./gm, ".");
          mensajes.push({ para: destinatarios, crudo, texto: decodificarQuotedPrintable(crudo), recibido: new Date() });
          datos = "";
          destinatarios = [];
          estado = "comando";
          enviar("250 OK guardado");
          continue;
        }
        const i = resto.indexOf("\r\n");
        if (i === -1) return;
        const linea = resto.slice(0, i);
        resto = resto.slice(i + 2);
        const cmd = linea.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") {
          enviar("250-gf-smtp-local");
          enviar("250 8BITMIME");
        } else if (cmd === "MAIL") enviar("250 OK");
        else if (cmd === "RCPT") {
          const correo = (/<([^>]+)>/.exec(linea)?.[1] ?? "").trim();
          if (DOMINIO_PERMITIDO.test(correo)) {
            destinatarios.push(correo.toLowerCase());
            enviar("250 OK");
          } else {
            rechazados.push(correo);
            enviar("550 solo @gateflow.invalid en el buzon local");
          }
        } else if (cmd === "DATA") {
          estado = "datos";
          enviar("354 fin con <CRLF>.<CRLF>");
        } else if (cmd === "RSET") {
          destinatarios = [];
          enviar("250 OK");
        } else if (cmd === "NOOP") enviar("250 OK");
        else if (cmd === "QUIT") {
          enviar("221 adios");
          socket.end();
          return;
        } else enviar("502 no implementado");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => {
    servidor.listen(puerto, "127.0.0.1", () =>
      resolve({
        mensajes,
        rechazados,
        cerrar: () => servidor.close(),
        /** Último correo para ese destinatario (espera hasta ms). */
        async esperar(para, { ms = 20_000, despuesDe = 0 } = {}) {
          const limite = Date.now() + ms;
          while (Date.now() < limite) {
            const m = mensajes.filter((x) => x.para.includes(para.toLowerCase()) && x.recibido.getTime() >= despuesDe).at(-1);
            if (m) return m;
            await new Promise((r) => setTimeout(r, 200));
          }
          return null;
        },
      }),
    );
  });
}

/** Enlaces del correo (href="…"), ya decodificados. */
export function enlaces(mensaje) {
  return [...mensaje.texto.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

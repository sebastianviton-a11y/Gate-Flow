// ============================================================
// Gateway local que imita lo mínimo de Supabase para la capa C local:
//   /rest/v1/*      → PostgREST local (mismo JWT; PostgREST lo verifica)
//   /auth/v1/user   → usuario del JWT de la sesión (HS256, secreto local
//                     de la corrida); sin JWT válido → 401
//   /auth/v1/logout → 204
//   resto           → 404 (incluido el refresh: la sesión no expira
//                     durante la corrida)
// Con `auth` (URL de un GoTrue local real), /auth/v1/* se reenvía a ese
// servidor en lugar de imitarse (recorrido de registro con Auth real).
// Escucha solo en 127.0.0.1. El secreto es aleatorio por corrida y
// nunca se imprime.
// ============================================================
import crypto from "node:crypto";
import http from "node:http";

const b64url = (b) => Buffer.from(b).toString("base64url");

export function firmarJwt(payload, secreto) {
  const cabecera = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = crypto.createHmac("sha256", secreto).update(`${cabecera}.${cuerpo}`).digest("base64url");
  return `${cabecera}.${cuerpo}.${firma}`;
}

export function verificarJwt(token, secreto) {
  const partes = String(token ?? "").split(".");
  if (partes.length !== 3) return null;
  const esperada = crypto.createHmac("sha256", secreto).update(`${partes[0]}.${partes[1]}`).digest();
  const recibida = Buffer.from(partes[2], "base64url");
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  try {
    const claims = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Cookie de sesión que lee @supabase/ssr (formato "base64-…"). */
export function cookieSesion({ urlSupabase, secreto, userId, email }) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const usuario = { id: userId, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date(0).toISOString() };
  const access = firmarJwt({ sub: userId, email, role: "authenticated", aud: "authenticated", exp }, secreto);
  const sesion = { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "zz-autotest-sin-refresh", user: usuario };
  const nombre = `sb-${new URL(urlSupabase).hostname.split(".")[0]}-auth-token`;
  return { nombre, valor: "base64-" + b64url(JSON.stringify(sesion)) };
}

function reenviar(req, res, destino, ruta, alFallar) {
  const cabeceras = { ...req.headers, host: destino.host };
  delete cabeceras.apikey;
  const p = http.request({ hostname: destino.hostname, port: destino.port, method: req.method, path: ruta, headers: cabeceras }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  p.on("error", alFallar);
  req.pipe(p);
}

export function iniciarGateway({ puerto, postgrest, secreto, auth = null }) {
  const destino = new URL(postgrest);
  const destinoAuth = auth ? new URL(auth) : null;
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status, cuerpo) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(cuerpo));
    };
    if (destinoAuth && url.pathname.startsWith("/auth/v1/") && req.method === "OPTIONS") {
      // Como el gateway de Supabase (Kong): el preflight CORS se responde
      // aquí; GoTrue solo no admite la cabecera apikey de supabase-js.
      res.writeHead(204, {
        "access-control-allow-origin": req.headers.origin ?? "*",
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
        "access-control-max-age": "600",
        vary: "Origin",
      });
      return res.end();
    }
    if (destinoAuth && url.pathname.startsWith("/auth/v1/")) {
      return reenviar(req, res, destinoAuth, url.pathname.slice("/auth/v1".length) + url.search, () => json(502, { message: "auth no disponible" }));
    }
    if (url.pathname === "/auth/v1/user") {
      const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
      const c = token ? verificarJwt(token, secreto) : null;
      if (!c?.sub || c.role !== "authenticated") return json(401, { code: 401, msg: "invalid JWT" });
      return json(200, { id: c.sub, aud: "authenticated", role: "authenticated", email: c.email ?? null, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date(0).toISOString() });
    }
    if (url.pathname === "/auth/v1/logout") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      return reenviar(req, res, destino, url.pathname.slice("/rest/v1".length) + url.search, () => json(502, { message: "postgrest no disponible" }));
    }
    json(404, { message: "no soportado por el gateway de pruebas" });
  });
  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(puerto, "127.0.0.1", () => resolve(servidor));
  });
}

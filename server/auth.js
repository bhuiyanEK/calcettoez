/**
 * auth.js – Lightweight shared-password middleware
 * No external dependencies. Cookie-based session (signed with secret).
 * One password for everyone — stored in ACCESS_PASSWORD env var or config.
 */
"use strict";

const crypto = require("crypto");

// ── Config (edit ACCESS_PASSWORD or set env var) ──
const PASSWORD = process.env.ACCESS_PASSWORD || "calcetto2025";
const SECRET   = process.env.COOKIE_SECRET   || "fcm-secret-" + PASSWORD;
const COOKIE   = "fcm_auth";
const MAX_AGE  = 7 * 24 * 60 * 60; // 7 days in seconds

// ── Helpers ───────────────────────────────────
function sign(value) {
  return value + "." + crypto.createHmac("sha256", SECRET).update(value).digest("base64");
}
function verify(signed) {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot === -1) return null;
  const value = signed.slice(0, dot);
  if (sign(value) !== signed) return null;
  return value;
}
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach(part => {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k.trim()] = decodeURIComponent(v.join("=").trim());
  });
  return out;
}
function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies[COOKIE]) === "ok";
}

// ── Login HTML page ───────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>FantaCalcetto – Accesso</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',system-ui,sans-serif;background:#0f1117;color:#e8eaf0;
         min-height:100vh;display:flex;align-items:center;justify-content:center}
    .box{background:#1a1d27;border:1px solid #2a2f47;border-radius:16px;
         padding:2.5rem 2rem;width:100%;max-width:360px;text-align:center}
    h1{font-size:1.5rem;margin-bottom:.4rem;color:#fff}
    p{color:#8892a4;font-size:.9rem;margin-bottom:1.75rem}
    input{width:100%;padding:.7rem 1rem;background:#22263a;border:1px solid #2a2f47;
          border-radius:8px;color:#e8eaf0;font-size:1rem;font-family:inherit;
          margin-bottom:1rem;transition:border-color .15s}
    input:focus{outline:none;border-color:#3d7eff;box-shadow:0 0 0 3px rgba(61,126,255,.15)}
    button{width:100%;padding:.75rem;background:#3d7eff;color:#fff;border:none;
           border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;
           font-family:inherit;transition:filter .15s}
    button:hover{filter:brightness(1.1)}
    .err{color:#e74c3c;font-size:.85rem;margin-top:.5rem;display:none}
    .err.show{display:block}
  </style>
</head>
<body>
  <div class="box">
    <div style="font-size:3rem;margin-bottom:.75rem">⚽</div>
    <h1>FantaCalcetto</h1>
    <p>Inserisci la password del gruppo per accedere</p>
    <form method="POST" action="/__login">
      <input type="password" name="password" placeholder="Password" autofocus required/>
      <button type="submit">Entra</button>
      {{ERROR}}
    </form>
  </div>
</body>
</html>`;

// ── Middleware factory ────────────────────────
function authMiddleware(req, res, next) {
  if (req.url.startsWith("/players") ||
    req.url.startsWith("/match") ||
    req.url.startsWith("/chemistry") ||
    req.url.startsWith("/suggestions") ||
    req.url.startsWith("/report") ||
    req.url.startsWith("/matches")) {

  return next(); // 🔥 bypass auth
}
}

// ── Login POST handler ────────────────────────
function loginHandler(req, res) {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    const params = new URLSearchParams(body);
    if (params.get("password") === PASSWORD) {
      const token = sign("ok");
      res.setHeader("Set-Cookie",
        `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}; Path=/`
      );
      res.setHeader("Location", "/");
      res.statusCode = 302;
      res.end();
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.statusCode = 401;
      res.end(LOGIN_HTML.replace("{{ERROR}}", `<p class="err show">❌ Password errata</p>`));
    }
  });
}

module.exports = { authMiddleware, loginHandler };

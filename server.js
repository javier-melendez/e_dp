const crypto = require("crypto");
const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");

const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_COOKIE_NAME = "ebandeja_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const MAX_LOGIN_ATTEMPTS = 5;

if (!APP_PASSWORD) {
  console.error("Falta APP_PASSWORD. Define la variable de entorno antes de iniciar.");
  process.exit(1);
}

const sessions = new Map();
const failedLoginsByIp = new Map();

app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(publicDir));
app.use("/public", express.static(publicDir));

app.get("/api/auth/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ authenticated: hasValidSession(req) });
});

app.post("/api/auth/login", (req, res) => {
  res.set("Cache-Control", "no-store");

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    const retryAfter = secondsUntilRateLimitReset(ip);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Demasiados intentos fallidos. Intenta de nuevo en unos minutos."
    });
  }

  const candidate = typeof req.body?.password === "string" ? req.body.password : "";
  if (!safeEqual(candidate, APP_PASSWORD)) {
    registerFailedAttempt(ip);
    return res.status(401).json({ error: "Contrasena incorrecta" });
  }

  clearFailedAttempts(ip);

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);

  return res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    sessions.delete(token);
  }

  clearSessionCookie(res);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.get("*", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log("E-Bandeja disponible en http://localhost:" + port);
});

function hasValidSession(req) {
  cleanupExpiredSessions();

  const token = getSessionToken(req);
  if (!token) {
    return false;
  }

  const session = sessions.get(token);
  if (!session) {
    return false;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce((result, pair) => {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      return result;
    }

    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch (_error) {
      result[key] = value;
    }
    return result;
  }, {});
}

function setSessionCookie(res, token) {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
}

function clearSessionCookie(res) {
  const isProduction = process.env.NODE_ENV === "production";

  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/"
  });
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function getClientIp(req) {
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

function isRateLimited(ip) {
  const attempt = failedLoginsByIp.get(ip);
  if (!attempt) {
    return false;
  }

  if (Date.now() - attempt.windowStartedAt >= LOGIN_WINDOW_MS) {
    failedLoginsByIp.delete(ip);
    return false;
  }

  return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function registerFailedAttempt(ip) {
  const now = Date.now();
  const attempt = failedLoginsByIp.get(ip);

  if (!attempt || now - attempt.windowStartedAt >= LOGIN_WINDOW_MS) {
    failedLoginsByIp.set(ip, { count: 1, windowStartedAt: now });
    return;
  }

  attempt.count += 1;
}

function clearFailedAttempts(ip) {
  failedLoginsByIp.delete(ip);
}

function secondsUntilRateLimitReset(ip) {
  const attempt = failedLoginsByIp.get(ip);
  if (!attempt) {
    return 0;
  }

  const remainingMs = LOGIN_WINDOW_MS - (Date.now() - attempt.windowStartedAt);
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function safeEqual(input, secret) {
  const inputBuffer = Buffer.from(String(input), "utf8");
  const secretBuffer = Buffer.from(String(secret), "utf8");

  if (inputBuffer.length !== secretBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(inputBuffer, secretBuffer);
}

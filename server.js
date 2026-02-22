const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");

const APP_PASSWORD = process.env.APP_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "e_bandeja_docs";

const SESSION_COOKIE_NAME = "ebandeja_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const MAX_LOGIN_ATTEMPTS = 5;

const FILE_URL_TTL_SECONDS = 60 * 60 * 24;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const STORAGE_FOLDER_PENDING = "pending";
const STORAGE_FOLDER_SIGNED = "signed";
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream"
]);

if (!APP_PASSWORD) {
  console.error("Falta APP_PASSWORD. Define la variable de entorno antes de iniciar.");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en variables de entorno.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const sessions = new Map();
const failedLoginsByIp = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

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

app.get(
  "/api/documents",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const records = await listDocumentRecords();
    const documents = await Promise.all(records.map((record) => toClientDocument(record)));

    res.set("Cache-Control", "no-store");
    res.json({ documents });
  })
);

app.post(
  "/api/documents",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = validateUploadedFile(req.file);
    const id = generateId();
    const fileName = sanitizeFileName(file.originalname, file.extension);
    const pathInBucket = buildStoragePath(STORAGE_FOLDER_PENDING, id, fileName);

    await uploadToStorage(pathInBucket, file);

    const record = {
      id,
      name: fileName,
      type: file.extension,
      status: "Pendiente",
      createdAt: new Date().toISOString(),
      pendingPath: pathInBucket,
      signedPath: null,
      currentPath: pathInBucket
    };

    const document = await toClientDocument(record);
    res.status(201).json({ document });
  })
);

app.post(
  "/api/documents/:id/sign",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const docId = normalizeDocumentId(req.params.id);
    if (!docId) {
      return res.status(400).json({ error: "Identificador de documento invalido." });
    }

    const existingRecord = await findDocumentRecordById(docId);
    if (!existingRecord) {
      return res.status(404).json({ error: "Documento no encontrado." });
    }

    const file = validateUploadedFile(req.file);
    const fileName = sanitizeFileName(file.originalname, file.extension);
    const signedPath = buildStoragePath(STORAGE_FOLDER_SIGNED, docId, fileName);

    await uploadToStorage(signedPath, file, { upsert: true });

    const stalePaths = [];
    if (existingRecord.pendingPath) {
      stalePaths.push(existingRecord.pendingPath);
    }
    if (existingRecord.signedPath && existingRecord.signedPath !== signedPath) {
      stalePaths.push(existingRecord.signedPath);
    }
    await removeFromStorage(stalePaths);

    const record = {
      id: docId,
      name: fileName,
      type: file.extension,
      status: "Firmado",
      createdAt: new Date().toISOString(),
      pendingPath: null,
      signedPath: signedPath,
      currentPath: signedPath
    };

    const document = await toClientDocument(record);
    res.json({ document });
  })
);

app.delete(
  "/api/documents/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const docId = normalizeDocumentId(req.params.id);
    if (!docId) {
      return res.status(400).json({ error: "Identificador de documento invalido." });
    }

    const existingRecord = await findDocumentRecordById(docId);
    if (!existingRecord) {
      return res.status(404).json({ error: "Documento no encontrado." });
    }

    await removeFromStorage([existingRecord.pendingPath, existingRecord.signedPath, existingRecord.currentPath]);
    res.json({ ok: true });
  })
);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "El archivo supera el tamano maximo permitido (20MB)." });
  }

  if (error && error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: "Error interno del servidor." });
});

app.get("*", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "index.html"));
});

startServer();

async function startServer() {
  try {
    await ensureBucketExists();
    app.listen(port, () => {
      console.log("E-Bandeja disponible en http://localhost:" + port);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error.message || error);
    process.exit(1);
  }
}

function requireAuth(req, res, next) {
  if (!hasValidSession(req)) {
    return res.status(401).json({ error: "No autenticado." });
  }

  return next();
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

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

function normalizeDocumentId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(value)) {
    return "";
  }

  return value;
}

function sanitizeFileName(fileName, extension) {
  const extensionWithDot = extension ? "." + extension : "";
  const lowerName = String(fileName || "").toLowerCase();
  const withoutExtension = lowerName.endsWith(extensionWithDot) ? String(fileName || "").slice(0, -extensionWithDot.length) : String(fileName || "");
  const cleanedBase = withoutExtension
    .replace(/[\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const safeBase = cleanedBase || "documento";
  return safeBase + extensionWithDot;
}

function generateId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return String(Date.now()) + "-" + crypto.randomBytes(4).toString("hex");
}

function getExtension(fileName) {
  const parts = String(fileName || "").split(".");
  return parts.length > 1 ? String(parts.pop()).toLowerCase() : "";
}

function validateUploadedFile(file) {
  if (!file) {
    throw createHttpError(400, "No se recibio ningun archivo.");
  }

  const extension = getExtension(file.originalname);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw createHttpError(400, "Formato invalido. Solo se permiten PDF y DOCX.");
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw createHttpError(400, "Tipo MIME no permitido para este archivo.");
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw createHttpError(400, "El archivo recibido esta vacio.");
  }

  return {
    ...file,
    extension
  };
}

function buildStoragePath(folder, id, fileName) {
  return folder + "/" + id + "__" + encodeURIComponent(fileName);
}

function parseStorageObject(folder, object) {
  const name = String(object?.name || "");
  if (!name) {
    return null;
  }

  const separator = name.indexOf("__");
  if (separator <= 0) {
    return null;
  }

  const id = normalizeDocumentId(name.slice(0, separator));
  if (!id) {
    return null;
  }

  const encodedFileName = name.slice(separator + 2);
  const decodedFileName = safeDecodeURIComponent(encodedFileName);
  const extension = getExtension(decodedFileName);
  if (!decodedFileName || !ALLOWED_EXTENSIONS.has(extension)) {
    return null;
  }

  return {
    id,
    name: decodedFileName,
    type: extension,
    path: folder + "/" + name,
    createdAt: object.created_at || object.updated_at || new Date().toISOString()
  };
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_error) {
    return String(value || "");
  }
}

async function listFolderObjects(folder) {
  const results = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .list(folder, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });

    if (error) {
      throw createHttpError(500, "No se pudo listar archivos en Supabase Storage.");
    }

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const object of data) {
      const parsed = parseStorageObject(folder, object);
      if (parsed) {
        results.push(parsed);
      }
    }

    if (data.length < 1000) {
      break;
    }

    offset += data.length;
  }

  return results;
}

async function listDocumentRecords() {
  const [pendingFiles, signedFiles] = await Promise.all([
    listFolderObjects(STORAGE_FOLDER_PENDING),
    listFolderObjects(STORAGE_FOLDER_SIGNED)
  ]);

  const byId = new Map();

  for (const pending of pendingFiles) {
    byId.set(pending.id, {
      id: pending.id,
      pendingPath: pending.path,
      pendingName: pending.name,
      pendingType: pending.type,
      pendingCreatedAt: pending.createdAt,
      signedPath: null,
      signedName: "",
      signedType: "",
      signedCreatedAt: ""
    });
  }

  for (const signed of signedFiles) {
    const current = byId.get(signed.id) || {
      id: signed.id,
      pendingPath: null,
      pendingName: "",
      pendingType: "",
      pendingCreatedAt: "",
      signedPath: null,
      signedName: "",
      signedType: "",
      signedCreatedAt: ""
    };

    current.signedPath = signed.path;
    current.signedName = signed.name;
    current.signedType = signed.type;
    current.signedCreatedAt = signed.createdAt;
    byId.set(signed.id, current);
  }

  const records = [];
  for (const value of byId.values()) {
    const hasSigned = Boolean(value.signedPath);
    const hasPending = Boolean(value.pendingPath);
    if (!hasSigned && !hasPending) {
      continue;
    }

    records.push({
      id: value.id,
      name: hasSigned ? value.signedName : value.pendingName,
      type: hasSigned ? value.signedType : value.pendingType,
      status: hasSigned ? "Firmado" : "Pendiente",
      createdAt: hasSigned ? value.signedCreatedAt : value.pendingCreatedAt,
      pendingPath: value.pendingPath || null,
      signedPath: value.signedPath || null,
      currentPath: hasSigned ? value.signedPath : value.pendingPath
    });
  }

  records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return records;
}

async function findDocumentRecordById(docId) {
  const records = await listDocumentRecords();
  return records.find((record) => record.id === docId) || null;
}

async function toClientDocument(record) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(record.currentPath, FILE_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw createHttpError(500, "No se pudo generar URL firmada para el archivo.");
  }

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt,
    fileUrl: data.signedUrl
  };
}

async function uploadToStorage(storagePath, file, options = {}) {
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(storagePath, file.buffer, {
    contentType: file.mimetype || undefined,
    upsert: options.upsert === true
  });

  if (error) {
    throw createHttpError(500, "No se pudo subir el archivo a Supabase Storage.");
  }
}

async function removeFromStorage(paths) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove(uniquePaths);
  if (error) {
    throw createHttpError(500, "No se pudo eliminar el archivo en Supabase Storage.");
  }
}

async function ensureBucketExists() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error("No se pudo validar buckets en Supabase: " + error.message);
  }

  const exists = (buckets || []).some((bucket) => bucket.name === SUPABASE_BUCKET);
  if (exists) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(SUPABASE_BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES)
  });

  if (createError && !/already exists/i.test(createError.message || "")) {
    throw new Error("No se pudo crear el bucket en Supabase: " + createError.message);
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

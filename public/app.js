let documents = [];
let activeDocId = null;
let primaryAction = null;
let loadingDocuments = false;

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  init().catch(() => {
    window.alert("No fue posible iniciar SIGDEP.");
  });
});

async function init() {
  cacheElements();
  bindEvents();
  render();

  const authenticated = await checkAuthStatus();
  if (authenticated) {
    showMainInterface();
    await loadDocuments();
  } else {
    showLoginInterface();
  }
}

function cacheElements() {
  el.loginSection = document.getElementById("loginSection");
  el.mainInterface = document.getElementById("mainInterface");
  el.passwordInput = document.getElementById("passwordInput");
  el.loginBtn = document.getElementById("loginBtn");
  el.logoutBtn = document.getElementById("logoutBtn");
  el.mainUpload = document.getElementById("mainUpload");
  el.secondaryUpload = document.getElementById("secondaryUpload");
  el.overlayCancelBtn = document.getElementById("overlayCancelBtn");
  el.uploadOverlay = document.getElementById("uploadOverlay");
  el.badgeCounter = document.getElementById("badgeCounter");
  el.docList = document.getElementById("docList");
  el.previewPlaceholder = document.getElementById("previewPlaceholder");
  el.previewFrameContainer = document.getElementById("previewFrameContainer");
  el.previewActions = document.getElementById("previewActions");
  el.previewTitle = document.getElementById("previewTitle");
  el.statusDot = document.getElementById("statusDot");
  el.btnDownload = document.getElementById("btnDownload");
  el.btnSign = document.getElementById("btnSign");
  el.previewIframe = document.getElementById("previewIframe");
}

function bindEvents() {
  el.loginBtn.addEventListener("click", () => {
    checkPassword();
  });

  el.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      checkPassword();
    }
  });

  el.logoutBtn.addEventListener("click", async () => {
    await logout();
    window.location.reload();
  });

  el.mainUpload.addEventListener("change", handleNewUpload);
  el.secondaryUpload.addEventListener("change", completeFirma);
  el.overlayCancelBtn.addEventListener("click", () => toggleOverlay(false));

  el.uploadOverlay.addEventListener("click", (event) => {
    if (event.target === el.uploadOverlay) {
      toggleOverlay(false);
    }
  });

  el.btnDownload.addEventListener("click", () => {
    downloadActiveDoc();
  });

  el.btnSign.addEventListener("click", () => {
    toggleOverlay(true);
  });

  el.docList.addEventListener("click", handleDocListClick);
}

async function checkPassword() {
  const password = el.passwordInput.value;
  if (!password) {
    window.alert("Ingresa la contrasena de acceso.");
    return;
  }

  setLoginLoading(true);

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const payload = await safeReadJson(response);
      window.alert(payload.error || "Contrasena incorrecta.");
      return;
    }

    el.passwordInput.value = "";
    showMainInterface();
    await loadDocuments();
  } catch (_error) {
    window.alert("No fue posible validar la contrasena de acceso.");
  } finally {
    setLoginLoading(false);
  }
}

async function checkAuthStatus() {
  try {
    const response = await fetch("/api/auth/status", {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return false;
    }

    const payload = await safeReadJson(response);
    return payload.authenticated === true;
  } catch (_error) {
    return false;
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Accept: "application/json" }
    });
  } catch (_error) {
    // No-op.
  }
}

function showMainInterface() {
  el.loginSection.classList.add("hidden");
  el.mainInterface.classList.remove("hidden-section");
  document.body.classList.remove("items-center");
}

function showLoginInterface() {
  el.mainInterface.classList.add("hidden-section");
  el.loginSection.classList.remove("hidden");
  document.body.classList.add("items-center");
}

function setLoginLoading(isLoading) {
  el.loginBtn.disabled = isLoading;
  el.passwordInput.disabled = isLoading;
  el.loginBtn.textContent = isLoading ? "Validando..." : "Ingresar al sistema";
  el.loginBtn.classList.toggle("opacity-60", isLoading);
  el.loginBtn.classList.toggle("cursor-not-allowed", isLoading);
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

async function loadDocuments(options = {}) {
  if (loadingDocuments) {
    return;
  }

  loadingDocuments = true;

  try {
    const response = await fetch("/api/documents", {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (response.status === 401) {
      showLoginInterface();
      documents = [];
      activeDocId = null;
      render();
      return;
    }

    if (!response.ok) {
      const payload = await safeReadJson(response);
      window.alert(payload.error || "No fue posible cargar la bandeja de derechos de peticion.");
      return;
    }

    const payload = await safeReadJson(response);
    const previousById = new Map(documents.map((doc) => [doc.id, doc]));
    const nextDocuments = Array.isArray(payload.documents) ? payload.documents.map((item) => mapApiDocument(item, previousById.get(item.id))) : [];

    documents = nextDocuments;

    const preferredId = options.focusId || activeDocId;
    if (preferredId && documents.some((doc) => doc.id === preferredId)) {
      activeDocId = preferredId;
    } else if (documents.length > 0) {
      activeDocId = documents[0].id;
    } else {
      activeDocId = null;
    }

    render();

    if (activeDocId) {
      showPreview(activeDocId);
    } else {
      resetPreview();
    }
  } catch (_error) {
    window.alert("No fue posible cargar la bandeja de derechos de peticion.");
  } finally {
    loadingDocuments = false;
  }
}

function mapApiDocument(apiDoc, previousDoc) {
  const type = String(apiDoc.type || "").toLowerCase();
  const isDocx = type === "docx";
  const keepDocxPreview = Boolean(previousDoc && previousDoc.status === apiDoc.status && previousDoc.name === apiDoc.name && previousDoc.docxHtml);

  return {
    id: String(apiDoc.id || ""),
    name: String(apiDoc.name || "derecho_peticion"),
    type: type || getExtension(apiDoc.name),
    status: String(apiDoc.status || "Pendiente"),
    date: formatServerDate(apiDoc.createdAt),
    createdAt: String(apiDoc.createdAt || new Date().toISOString()),
    url: String(apiDoc.fileUrl || ""),
    docxHtml: keepDocxPreview ? previousDoc.docxHtml : "",
    previewError: keepDocxPreview ? previousDoc.previewError : "",
    isPreviewReady: !isDocx || keepDocxPreview,
    isPreviewLoading: false
  };
}

function formatServerDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function handleNewUpload(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) {
    return;
  }

  const extension = getExtension(file.name);
  if (extension !== "pdf" && extension !== "docx") {
    window.alert("Solo se permiten archivos PDF y DOCX para derechos de peticion.");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/documents", {
      method: "POST",
      body: formData
    });

    const payload = await safeReadJson(response);
    if (!response.ok) {
      window.alert(payload.error || "No fue posible cargar el borrador del derecho de peticion.");
      return;
    }

    await loadDocuments({ focusId: payload.document?.id || null });
  } catch (_error) {
    window.alert("No fue posible cargar el borrador del derecho de peticion.");
  }
}

function handleDocListClick(event) {
  const deleteButton = event.target.closest("button[data-delete-id]");
  if (deleteButton) {
    deleteDoc(deleteButton.dataset.deleteId);
    return;
  }

  const card = event.target.closest("article[data-doc-id]");
  if (card) {
    showPreview(card.dataset.docId);
  }
}

function showPreview(id) {
  activeDocId = id;
  const doc = documents.find((item) => item.id === id);
  if (!doc) {
    return;
  }

  el.previewPlaceholder.classList.add("hidden");
  el.previewFrameContainer.classList.remove("hidden");
  el.previewActions.classList.remove("hidden");
  el.previewTitle.textContent = doc.name;

  if (doc.status === "Pendiente") {
    el.statusDot.className = "w-3 h-3 rounded-full bg-amber-500 animate-pulse";
    el.btnDownload.className = "px-4 py-1.5 bg-indigo-600 text-white text-xs rounded-xl font-bold hover:bg-indigo-700 transition";
    el.btnSign.className = "px-4 py-1.5 bg-amber-500 text-white text-xs rounded-xl font-bold hover:bg-amber-600 transition";
    el.btnDownload.disabled = false;
    el.btnSign.disabled = false;
  } else {
    el.statusDot.className = "w-3 h-3 rounded-full bg-green-500";
    el.btnDownload.className = "px-4 py-1.5 bg-green-600 text-white text-xs rounded-xl font-bold hover:bg-green-700 transition";
    el.btnDownload.disabled = false;
    el.btnSign.className = "px-4 py-1.5 bg-green-100 text-green-700 text-xs rounded-xl font-bold cursor-default";
    el.btnSign.disabled = true;
  }

  if (doc.type === "pdf") {
    el.previewIframe.removeAttribute("srcdoc");
    el.previewIframe.src = doc.url;
  } else if (doc.type === "docx") {
    el.previewIframe.removeAttribute("src");

    if (!doc.isPreviewReady) {
      el.previewIframe.srcdoc = buildInfoIframe("Procesando DOCX", "Estamos preparando la vista previa para revision.");
      if (!doc.isPreviewLoading) {
        loadRemoteDocxPreview(doc.id);
      }
    } else if (doc.previewError) {
      el.previewIframe.srcdoc = buildInfoIframe("No se pudo renderizar el DOCX", doc.previewError);
    } else {
      el.previewIframe.srcdoc = buildDocxIframe(doc.docxHtml);
    }
  } else {
    el.previewIframe.removeAttribute("src");
    el.previewIframe.srcdoc = buildInfoIframe("Formato no compatible", "Solo hay vista previa para archivos PDF y DOCX.");
  }

  render();
}

async function loadRemoteDocxPreview(docId) {
  const doc = documents.find((item) => item.id === docId);
  if (!doc || doc.type !== "docx" || doc.isPreviewLoading) {
    return;
  }

  doc.isPreviewLoading = true;
  doc.previewError = "";
  doc.isPreviewReady = false;

  try {
    const response = await fetch(doc.url, { method: "GET" });
    if (!response.ok) {
      throw new Error("No se pudo descargar DOCX");
    }

    const arrayBuffer = await response.arrayBuffer();
    const preview = await buildDocxPreviewFromArrayBuffer(arrayBuffer);

    doc.docxHtml = preview.html;
    doc.previewError = preview.error;
    doc.isPreviewReady = true;
    doc.isPreviewLoading = false;
  } catch (_error) {
    doc.docxHtml = "";
    doc.previewError = "No se pudo cargar la vista previa del archivo DOCX.";
    doc.isPreviewReady = true;
    doc.isPreviewLoading = false;
  }

  if (activeDocId === docId) {
    showPreview(docId);
  } else {
    render();
  }
}

function toggleOverlay(show) {
  el.uploadOverlay.classList.toggle("hidden", !show);
}

async function completeFirma(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file || !activeDocId) {
    return;
  }

  const extension = getExtension(file.name);
  if (extension !== "pdf" && extension !== "docx") {
    window.alert("Solo se permiten archivos PDF y DOCX para derechos de peticion.");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/documents/" + encodeURIComponent(activeDocId) + "/sign", {
      method: "POST",
      body: formData
    });

    const payload = await safeReadJson(response);
    if (!response.ok) {
      window.alert(payload.error || "No fue posible cargar la version firmada.");
      return;
    }

    toggleOverlay(false);
    await loadDocuments({ focusId: payload.document?.id || activeDocId });
  } catch (_error) {
    window.alert("No fue posible cargar la version firmada.");
  }
}

async function deleteDoc(id) {
  if (!id) {
    return;
  }

  try {
    const response = await fetch("/api/documents/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { Accept: "application/json" }
    });

    const payload = await safeReadJson(response);
    if (!response.ok) {
      window.alert(payload.error || "No fue posible eliminar el derecho de peticion.");
      return;
    }

    if (activeDocId === id) {
      activeDocId = null;
    }

    await loadDocuments();
  } catch (_error) {
    window.alert("No fue posible eliminar el derecho de peticion.");
  }
}

function render() {
  el.badgeCounter.textContent = String(documents.length);

  if (documents.length === 0) {
    el.docList.innerHTML = "<div class='p-8 text-center text-slate-300 text-xs italic'>No hay derechos de peticion en la bandeja</div>";
    if (!activeDocId) {
      resetPreview();
    }
    return;
  }

  el.docList.innerHTML = documents
    .map((doc) => {
      const isPending = doc.status === "Pendiente";
      const isActive = activeDocId === doc.id;
      const typeLabel = doc.type === "pdf" ? "PDF" : doc.type === "docx" ? "DOCX" : "DOC";

      return (
        "<article data-doc-id='" + doc.id + "' class='doc-card " +
        (isPending ? "pending" : "completed") +
        " p-4 bg-white border border-slate-100 rounded-2xl shadow-sm cursor-pointer flex items-center justify-between group " +
        (isActive ? "ring-2 ring-indigo-500" : "") +
        "'>" +
        "<div class='flex items-center gap-3 overflow-hidden'>" +
        "<div class='p-2 rounded-lg " +
        (isPending ? "bg-amber-50 text-amber-500" : "bg-green-50 text-green-500") +
        "'>" +
        typeLabel +
        "</div>" +
        "<div class='truncate'>" +
        "<p class='text-sm font-black text-slate-700 truncate'>" + escapeHtml(doc.name) + "</p>" +
        "<p class='text-[10px] text-slate-400 font-bold uppercase tracking-widest'>" + escapeHtml(doc.date) + "</p>" +
        "</div>" +
        "</div>" +
        "<button type='button' data-delete-id='" +
        doc.id +
        "' class='opacity-0 group-hover:opacity-100 p-2 text-slate-300 hover:text-red-500 transition'>" +
        "<svg xmlns='http://www.w3.org/2000/svg' class='h-4 w-4' fill='none' viewBox='0 0 24 24' stroke='currentColor'>" +
        "<path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' />" +
        "</svg>" +
        "</button>" +
        "</article>"
      );
    })
    .join("");
}

function resetPreview() {
  toggleOverlay(false);
  el.previewActions.classList.add("hidden");
  el.previewFrameContainer.classList.add("hidden");
  el.previewPlaceholder.classList.remove("hidden");
  el.previewTitle.textContent = "Vista previa del derecho de peticion";
  el.statusDot.className = "w-3 h-3 rounded-full bg-slate-200";
  el.previewIframe.removeAttribute("src");
  el.previewIframe.removeAttribute("srcdoc");
  primaryAction = null;
}

async function buildDocxPreviewFromArrayBuffer(arrayBuffer) {
  if (!window.mammoth || typeof window.mammoth.convertToHtml !== "function") {
    return {
      html: "",
      error: "No se pudo cargar el visor DOCX. Recarga la pagina e intenta nuevamente."
    };
  }

  try {
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    const html = sanitizeDocxHtml(result.value || "");

    if (!html.trim()) {
      return {
        html: "",
        error: "El DOCX no tiene contenido visible para vista previa."
      };
    }

    return { html, error: "" };
  } catch (_error) {
    return {
      html: "",
      error: "El archivo DOCX no se pudo procesar para la vista previa."
    };
  }
}

function sanitizeDocxHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((node) => {
    node.remove();
  });

  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = (attr.value || "").trim();
      const isScriptAttr = name.startsWith("on");
      const isUnsafeLink = (name === "href" || name === "src" || name === "xlink:href") && /^javascript:/i.test(value);

      if (isScriptAttr || isUnsafeLink) {
        node.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

function buildDocxIframe(innerHtml) {
  return (
    "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
    "<style>" +
    "body{font-family:Calibri,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px;line-height:1.6;}" +
    ".page{background:#fff;max-width:900px;margin:0 auto;padding:40px;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 20px rgba(15,23,42,.06);}" +
    "p{margin:0 0 1em;}" +
    "table{border-collapse:collapse;max-width:100%;}" +
    "td,th{border:1px solid #cbd5e1;padding:6px;vertical-align:top;}" +
    "img{max-width:100%;height:auto;}" +
    "</style></head><body><article class='page'>" +
    innerHtml +
    "</article></body></html>"
  );
}

function buildInfoIframe(title, message) {
  return (
    "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#94a3b8;'>" +
    "<div style='text-align:center;padding:24px;max-width:420px;'>" +
    "<p style='margin:0 0 8px;font-weight:700;color:#475569;'>" + escapeHtml(title) + "</p>" +
    "<p style='margin:0;font-size:13px;line-height:1.5;'>" + escapeHtml(message) + "</p>" +
    "</div></body></html>"
  );
}

function getExtension(fileName) {
  const parts = String(fileName || "").split(".");
  return parts.length > 1 ? String(parts.pop()).toLowerCase() : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function downloadActiveDoc() {
  if (!activeDocId) {
    return;
  }

  const doc = documents.find((d) => d.id === activeDocId);
  if (!doc || !doc.url) {
    window.alert("No hay archivo disponible para descargar.");
    return;
  }

  try {
    const response = await fetch(doc.url, { method: "GET" });
    if (!response.ok) {
      throw new Error("No se pudo descargar el archivo.");
    }

    const blob = await response.blob();
    const ext = doc.type || getExtension(doc.name) || "pdf";
    const safeName = (doc.name || "documento").replace(/\s+/g, "_");
    const filename = safeName.includes(".") ? safeName : safeName + "." + ext;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (_error) {
    window.alert("No fue posible descargar el archivo.");
  }
}

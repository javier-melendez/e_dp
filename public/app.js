let documents = [];
let activeDocId = null;
let primaryAction = null;

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  init().catch(() => {
    window.alert("No fue posible iniciar la aplicacion.");
  });
});

async function init() {
  cacheElements();
  bindEvents();
  render();

  const authenticated = await checkAuthStatus();
  if (authenticated) {
    showMainInterface();
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
  el.btnAction = document.getElementById("btnAction");
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

  el.btnAction.addEventListener("click", () => {
    if (typeof primaryAction === "function") {
      primaryAction();
    }
  });

  el.docList.addEventListener("click", handleDocListClick);
}

async function checkPassword() {
  const password = el.passwordInput.value;

  if (!password) {
    window.alert("Ingresa la contrasena");
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

    if (response.ok) {
      el.passwordInput.value = "";
      showMainInterface();
      return;
    }

    const payload = await safeReadJson(response);
    if (response.status === 429) {
      window.alert(payload.error || "Demasiados intentos fallidos.");
      return;
    }

    window.alert(payload.error || "Contrasena incorrecta");
  } catch (_error) {
    window.alert("No fue posible validar la contrasena.");
  } finally {
    setLoginLoading(false);
  }
}

async function checkAuthStatus() {
  try {
    const response = await fetch("/api/auth/status", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
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
      headers: {
        Accept: "application/json"
      }
    });
  } catch (_error) {
    // No-op: aunque falle el logout remoto, hacemos reload para limpiar UI.
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
  el.loginBtn.textContent = isLoading ? "Validando..." : "Ingresar";
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

async function handleNewUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  const fileType = getExtension(file.name);
  const newDoc = {
    id: generateId(),
    name: file.name,
    type: fileType,
    status: "Pendiente",
    date: formatNow(),
    url: URL.createObjectURL(file),
    docxHtml: "",
    previewError: "",
    isPreviewReady: fileType !== "docx"
  };

  documents.unshift(newDoc);
  event.target.value = "";
  render();
  showPreview(newDoc.id);

  if (fileType === "docx") {
    const preview = await buildDocxPreview(file);
    const currentDoc = documents.find((doc) => doc.id === newDoc.id);
    if (!currentDoc) {
      return;
    }

    currentDoc.docxHtml = preview.html;
    currentDoc.previewError = preview.error;
    currentDoc.isPreviewReady = true;

    if (activeDocId === currentDoc.id) {
      showPreview(currentDoc.id);
    } else {
      render();
    }
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
    el.btnAction.className = "px-4 py-1.5 bg-indigo-600 text-white text-xs rounded-xl font-bold hover:bg-indigo-700 transition";
    el.btnAction.textContent = "Descargar y firmar";
    primaryAction = () => {
      window.alert("Simulacion de descarga: " + doc.name);
      toggleOverlay(true);
    };
  } else {
    el.statusDot.className = "w-3 h-3 rounded-full bg-green-500";
    el.btnAction.className = "px-4 py-1.5 bg-green-100 text-green-700 text-xs rounded-xl font-bold cursor-default";
    el.btnAction.textContent = "Documento firmado";
    primaryAction = null;
  }

  if (doc.type === "pdf") {
    el.previewIframe.removeAttribute("srcdoc");
    el.previewIframe.src = doc.url;
  } else if (doc.type === "docx") {
    el.previewIframe.removeAttribute("src");

    if (!doc.isPreviewReady) {
      el.previewIframe.srcdoc = buildInfoIframe(
        "Procesando DOCX",
        "Estamos generando la vista previa del documento."
      );
    } else if (doc.previewError) {
      el.previewIframe.srcdoc = buildInfoIframe(
        "No se pudo renderizar el DOCX",
        doc.previewError
      );
    } else {
      el.previewIframe.srcdoc = buildDocxIframe(doc.docxHtml);
    }
  } else {
    el.previewIframe.removeAttribute("src");
    el.previewIframe.srcdoc = buildInfoIframe(
      "Formato no compatible",
      "Solo se soporta vista previa para PDF y DOCX."
    );
  }

  render();
}

function toggleOverlay(show) {
  el.uploadOverlay.classList.toggle("hidden", !show);
}

async function completeFirma(event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !activeDocId) {
    return;
  }

  const doc = documents.find((item) => item.id === activeDocId);
  if (!doc) {
    return;
  }

  revokeBlobUrl(doc.url);
  doc.status = "Firmado";
  doc.name = "FIRMADO_" + doc.name;
  doc.type = getExtension(file.name) || doc.type;
  doc.date = formatNow();
  doc.url = URL.createObjectURL(file);
  doc.docxHtml = "";
  doc.previewError = "";
  doc.isPreviewReady = doc.type !== "docx";

  event.target.value = "";
  toggleOverlay(false);
  showPreview(doc.id);
  render();

  if (doc.type === "docx") {
    const preview = await buildDocxPreview(file);
    const currentDoc = documents.find((item) => item.id === doc.id);
    if (!currentDoc) {
      return;
    }

    currentDoc.docxHtml = preview.html;
    currentDoc.previewError = preview.error;
    currentDoc.isPreviewReady = true;

    if (activeDocId === currentDoc.id) {
      showPreview(currentDoc.id);
    } else {
      render();
    }
  }
}

function deleteDoc(id) {
  const index = documents.findIndex((doc) => doc.id === id);
  if (index === -1) {
    return;
  }

  revokeBlobUrl(documents[index].url);
  documents.splice(index, 1);

  if (activeDocId === id) {
    activeDocId = null;
    resetPreview();
  }

  render();
}

function render() {
  el.badgeCounter.textContent = String(documents.length);

  if (documents.length === 0) {
    el.docList.innerHTML = "<div class='p-8 text-center text-slate-300 text-xs italic'>No hay documentos en la bandeja</div>";
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
  el.previewTitle.textContent = "Visor de Documentos";
  el.statusDot.className = "w-3 h-3 rounded-full bg-slate-200";
  el.previewIframe.removeAttribute("src");
  el.previewIframe.removeAttribute("srcdoc");
  primaryAction = null;
}

async function buildDocxPreview(file) {
  if (!window.mammoth || typeof window.mammoth.convertToHtml !== "function") {
    return {
      html: "",
      error: "No se pudo cargar el visor DOCX. Recarga la pagina e intenta otra vez."
    };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
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
      error: "El archivo DOCX no se pudo procesar correctamente."
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

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function getExtension(fileName) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function formatNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function revokeBlobUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

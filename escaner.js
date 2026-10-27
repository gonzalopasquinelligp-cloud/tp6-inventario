// Lectura de QR / código de barras con la cámara y alternativa manual.
// - QR: decodificador jsQR (funciona en cualquier navegador moderno).
// - Códigos de barras 1D de producto (EAN, Code 128…): BarcodeDetector nativo, si el navegador lo ofrece.
import { esc, modal, ICON } from "./ui.js?v=202610272333";

// Posición: "A1", "POS:A1" o una URL terminada en A1.
export function normalizarPosicion(txt) {
  const t = String(txt || "").trim().toUpperCase();
  const m = t.match(/([A-Z][0-9]{1,2})$/);
  return m ? m[1] : t;
}
export function normalizarProducto(txt) {
  const t = String(txt || "").trim().toUpperCase();
  const m = t.match(/(PROD[0-9]{3,})/);
  return m ? m[1] : t;
}

let detectorNativo = null;
async function crearDetector() {
  if (detectorNativo !== null) return detectorNativo;
  detectorNativo = false;
  try {
    if ("BarcodeDetector" in window) {
      const soportados = await window.BarcodeDetector.getSupportedFormats();
      const quiero = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a"].filter((f) => soportados.includes(f));
      if (quiero.length) detectorNativo = new window.BarcodeDetector({ formats: quiero });
    }
  } catch { detectorNativo = false; }
  return detectorNativo;
}

// Decodifica un cuadro (canvas). Devuelve texto o null.
async function decodificar(canvas, ctx) {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = window.jsQR ? window.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" }) : null;
  if (r?.data) return r.data;
  const det = await crearDetector();
  if (det) {
    try { const c = await det.detect(canvas); if (c[0]?.rawValue) return c[0].rawValue; } catch { /* sin acción */ }
  }
  return null;
}

async function decodificarArchivo(file) {
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return decodificar(c, ctx);
}

export function escanear({ titulo = "Escanear", ayuda = "", tipo = "posicion", sugerencias = [] } = {}) {
  return new Promise((resolve) => {
    let flujo = null, activo = true, resuelto = false;
    const html = `
      <div class="flex entre"><h2>${esc(titulo)}</h2><button class="btn chico" data-cerrar>Cancelar</button></div>
      <div id="lector" style="position:relative"><video id="lector-video" playsinline muted style="width:100%;display:block"></video>
        <div style="position:absolute;inset:14%;border:3px solid rgba(255,255,255,.85);border-radius:12px;pointer-events:none"></div></div>
      <div id="lector-estado" class="ayuda" style="margin:8px 0 12px" aria-live="polite">Iniciando cámara…</div>
      <label class="btn chico" style="margin-bottom:12px">${ICON.camara} Leer desde una foto
        <input id="lector-foto" type="file" accept="image/*" capture="environment" hidden></label>
      <div class="sep"></div>
      <form id="lector-manual">
        <label for="lector-txt">${tipo === "posicion" ? "O ingresá la posición manualmente" : "O ingresá el código manualmente"}</label>
        <div class="fila-input">
          <input id="lector-txt" type="text" autocomplete="off" autocapitalize="characters" list="lector-sug" placeholder="${tipo === "posicion" ? "Ej.: A1" : "Ej.: PROD003"}">
          <button class="btn prim" type="submit">Usar</button>
        </div>
        <datalist id="lector-sug">${sugerencias.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
        ${ayuda ? `<div class="ayuda">${ayuda}</div>` : ""}
      </form>`;
    const m = modal(html, { alCerrar: () => { detener(); if (!resuelto) resolve(null); } });
    const estadoEl = m.el.querySelector("#lector-estado");
    const video = m.el.querySelector("#lector-video");

    function detener() {
      activo = false;
      flujo?.getTracks().forEach((t) => t.stop());
      flujo = null;
    }
    const terminar = (texto, metodo) => {
      if (resuelto) return;
      resuelto = true;
      if (navigator.vibrate) navigator.vibrate(80);
      detener(); m.cerrar();
      resolve({ texto: tipo === "posicion" ? normalizarPosicion(texto) : normalizarProducto(texto), metodo, crudo: texto });
    };

    m.el.querySelector("#lector-manual").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = m.el.querySelector("#lector-txt").value.trim();
      if (v) terminar(v, "MANUAL");
    });
    m.el.querySelector("#lector-foto").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      estadoEl.textContent = "Analizando la foto…";
      try {
        const t = await decodificarArchivo(f);
        if (t) terminar(t, "QR");
        else estadoEl.textContent = "No se encontró un código legible en la foto. Probá de nuevo o ingresalo a mano.";
      } catch { estadoEl.textContent = "No se pudo leer la foto."; }
    });

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      estadoEl.textContent = "La cámara requiere una dirección segura (https). Usá la foto o la carga manual.";
      m.el.querySelector("#lector").classList.add("oculto");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (!activo) { s.getTracks().forEach((t) => t.stop()); return; }
        flujo = s; video.srcObject = s; await video.play();
        estadoEl.textContent = "Apuntá la cámara al código. Se lee automáticamente.";
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const ciclo = async () => {
          if (!activo) return;
          if (video.readyState >= 2 && video.videoWidth) {
            const esc2 = Math.min(1, 800 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * esc2); canvas.height = Math.round(video.videoHeight * esc2);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const t = await decodificar(canvas, ctx);
            if (t) return terminar(t, "QR");
          }
          setTimeout(ciclo, 120);
        };
        ciclo();
      })
      .catch((err) => {
        const msg = String(err?.name || err?.message || err);
        estadoEl.textContent = /NotAllowed|Permission/i.test(msg)
          ? "Permiso de cámara denegado. Habilitalo en el navegador o usá la carga manual."
          : "No se pudo iniciar la cámara. Usá la foto o la carga manual.";
        m.el.querySelector("#lector").classList.add("oculto");
      });
  });
}

// Utilidades de interfaz: escape HTML, formatos, avisos, modales, CSV, íconos.
export const TZ = "America/Argentina/Buenos_Aires";

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fFecha = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const fFechaHora = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fHora = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fNum = new Intl.NumberFormat("es-AR");

export const fecha = (v) => (v ? fFecha.format(new Date(v)) : "—");
export const fechaHora = (v) => (v ? fFechaHora.format(new Date(v)).replace(",", "") : "—");
export const hora = (v) => (v ? fHora.format(new Date(v)) : "—");
export const num = (v) => (v === null || v === undefined || v === "" ? "—" : fNum.format(v));
export const signo = (v) => (v === null || v === undefined ? "—" : (v > 0 ? "+" : "") + fNum.format(v));
export const claseSigno = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const fUSD = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fDec = (d) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: d });
export const usd = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `USD\u00a0${fUSD.format(v)}`);
export const dec = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "—" : fDec(d).format(v));
export const pct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${fDec(d).format(v * 100)}\u00a0%`);

// Origen de un dato: se muestra siempre junto al valor.
export const ORIGENES = {
  real: ["Dato real", "Surge de los movimientos y conteos registrados."],
  usuario: ["Cargado por usuario", "Valor informado por la empresa."],
  supuesto: ["Supuesto", "Valor propuesto a falta de dato. Editable."],
  faltante: ["Faltante", "No hay dato: el cálculo que lo necesita no se hace o se indica la limitación."],
};
export const origen = (o, extra = "") => {
  const [t, d] = ORIGENES[o] || [o, ""];
  return `<span class="org org-${esc(o)}" title="${esc(extra || d)}">${esc(t)}</span>`;
};

export function nuevoId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function toast(msg, ms = 2800) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function aviso(tipo, html) {
  return `<div class="aviso ${tipo}" role="${tipo === "error" ? "alert" : "status"}">${html}</div>`;
}

// Modal genérico. Devuelve {el, cerrar}. contenido = HTML.
export function modal(contenido, { alCerrar } = {}) {
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo";
  fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${contenido}</div>`;
  document.body.appendChild(fondo);
  const cerrar = () => { fondo.remove(); alCerrar?.(); };
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  fondo.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", cerrar));
  return { el: fondo.firstElementChild, cerrar };
}

// Pide datos en un modal con campos; resuelve con objeto o null.
export function pedir({ titulo, texto = "", campos = [], confirmar = "Confirmar", peligro = false }) {
  return new Promise((resolve) => {
    let resuelto = false;
    const html = `<h2>${esc(titulo)}</h2>${texto ? `<p class="muted">${texto}</p>` : ""}
      <form>${campos.map((c) => `<div class="campo"><label for="m_${c.id}">${esc(c.etiqueta)}</label>
        ${c.tipo === "select"
          ? `<select id="m_${c.id}" name="${c.id}">${c.opciones.map((o) => `<option value="${esc(o.v)}" ${String(c.valor ?? "") === String(o.v) ? "selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`
          : c.tipo === "textarea"
            ? `<textarea id="m_${c.id}" name="${c.id}" ${c.requerido ? "required" : ""} placeholder="${esc(c.placeholder || "")}">${esc(c.valor || "")}</textarea>`
            : `<input id="m_${c.id}" name="${c.id}" type="${c.tipo || "text"}" value="${esc(c.valor || "")}" ${c.requerido ? "required" : ""} placeholder="${esc(c.placeholder || "")}">`}
        ${c.ayuda ? `<div class="ayuda">${c.ayuda}</div>` : ""}</div>`).join("")}
        <div class="btns"><button class="btn ${peligro ? "peligro" : "prim"}" type="submit">${esc(confirmar)}</button>
        <button class="btn" type="button" data-cerrar>Cancelar</button></div></form>`;
    const m = modal(html, { alCerrar: () => { if (!resuelto) resolve(null); } });
    const f = m.el.querySelector("form");
    f.querySelector("input,textarea,select")?.focus();
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(f).entries());
      for (const c of campos) if (c.requerido && !String(datos[c.id] || "").trim()) { f.querySelector(`[name=${c.id}]`).focus(); return; }
      resuelto = true; m.cerrar(); resolve(datos);
    });
  });
}

export function confirmar(titulo, texto, boton = "Confirmar") {
  return pedir({ titulo, texto, campos: [], confirmar: boton }).then((r) => r !== null);
}

// Exportación CSV (separador ; y BOM para Excel en español)
export function descargarCSV(nombre, filas, columnas) {
  const cols = columnas || Object.keys(filas[0] || {}).map((k) => ({ k, t: k }));
  const celda = (v) => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) v = v.join(" ");
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [cols.map((c) => celda(c.t)).join(";"), ...filas.map((f) => cols.map((c) => celda(typeof c.f === "function" ? c.f(f) : f[c.k])).join(";"))];
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function tabla(columnas, filas, { vacio = "Sin datos para mostrar.", claseFila } = {}) {
  if (!filas.length) return `<div class="vacio">${vacio}</div>`;
  return `<div class="tabla-cont"><table><thead><tr>${columnas.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.t)}</th>`).join("")}</tr></thead>
    <tbody>${filas.map((f) => `<tr class="${claseFila ? claseFila(f) : ""}">${columnas.map((c) => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(f) : esc(f[c.k] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export const CATEGORIAS = {
  COINCIDE: ["Coincide", "ok"],
  FALTANTE: ["Faltante", "error"],
  SOBRANTE: ["Sobrante", "alerta"],
  ESPERADO_VACIA: ["Esperado · posición vacía", "error"],
  ESPERADO_NO_ENCONTRADO: ["Esperado no encontrado", "error"],
  NO_ESPERADO: ["No esperado en esta posición", "alerta"],
  SIN_POSICION: ["Sin posición informada", "info"],
};
export const ESTADOS_REV = {
  SIN_DIFERENCIA: ["Sin diferencia", "ok"],
  PENDIENTE: ["Pendiente de revisión", "alerta"],
  EN_INVESTIGACION: ["En investigación", "info"],
  RECUENTO_SOLICITADO: ["Recuento solicitado", "info"],
  AJUSTE_APROBADO: ["Ajuste aprobado", "prim"],
  JUSTIFICADA_SIN_AJUSTE: ["Justificada sin ajuste", "ok"],
};
export const ESTADOS_JORNADA = {
  ABIERTA: ["Abierta · en conteo", "alerta"], EN_REVISION: ["En revisión", "info"],
  CERRADA: ["Cerrada", "ok"], CERRADA_PARCIAL: ["Cerrada (parcial)", "ok"],
};
export const chip = (mapa, clave) => { const [t, c] = mapa[clave] || [clave, ""]; return `<span class="chip ${c}">${esc(t)}</span>`; };

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  inicio: P('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  buscar: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  ingreso: P('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
  egreso: P('<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M4 3h16"/>'),
  conteo: P('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  conciliar: P('<path d="M4 7h11l-3-3M20 17H9l3 3"/>'),
  informe: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  sync: P('<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>'),
  admin: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  qr: P('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/>'),
  camara: P('<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>'),
  salir: P('<path d="M9 21H5V3h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  csv: P('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>'),
  mas: P('<path d="M12 5v14M5 12h14"/>'),
  costo: P('<path d="M4 19h16"/><path d="M6 15l4-5 3 3 5-7"/><circle cx="18" cy="6" r="1.5"/>'),
};

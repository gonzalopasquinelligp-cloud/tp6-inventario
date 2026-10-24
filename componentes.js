// Componentes reutilizables: mapa del rack y seguimiento de sincronización.
import { esc, num, hora } from "./ui.js?v=202610242324";
import { estadoSync } from "./api.js?v=202610242324";

// posiciones: filas de v_posiciones_estado. opciones.contadas: Set de posiciones contadas; opciones.alcance: Set
export function rackHTML(posiciones, { contadas = null, alcance = null, detalle = true } = {}) {
  const porPos = Object.fromEntries(posiciones.map((p) => [p.posicion, p]));
  const modulos = [...new Set(posiciones.map((p) => p.modulo))].sort();
  const niveles = [...new Set(posiciones.map((p) => p.nivel))].sort((a, b) => b - a);
  let html = `<div class="rack" style="grid-template-columns:26px repeat(${modulos.length},minmax(0,1fr))" role="grid" aria-label="Mapa del rack">`;
  for (const n of niveles) {
    html += `<div class="eje">${n}</div>`;
    for (const m of modulos) {
      const p = porPos[`${m}${n}`];
      if (!p) { html += `<div></div>`; continue; }
      const cls = ["celda", p.estado === "Ocupada" ? "ocupada" : "", !p.activa ? "inactiva" : "",
        alcance && alcance.has(p.posicion) ? (contadas && contadas.has(p.posicion) ? "contada" : "conteo") : (!alcance && p.en_conteo ? "conteo" : "")].join(" ");
      html += `<button type="button" class="${cls}" data-pos="${esc(p.posicion)}" title="${esc(p.posicion)} · ${esc(p.descripcion || "Vacía")}">
        <b>${esc(p.posicion)}</b>${detalle ? (p.producto ? `<span>${esc(p.producto)}<br>${esc(p.lote)} · ${num(p.cantidad)}</span>` : `<span>Vacía</span>`) : ""}</button>`;
    }
  }
  html += `</div><div class="eje" style="display:grid;grid-template-columns:26px repeat(${modulos.length},minmax(0,1fr));gap:6px;margin-top:4px">
    <span></span>${modulos.map((m) => `<span class="eje">${m}</span>`).join("")}</div>
    <div class="leyenda"><span><i style="background:var(--primario-suave)"></i>Ocupada</span><span><i></i>Vacía</span>
    ${alcance ? `<span><i style="background:var(--ok-suave)"></i>Contada</span><span><i style="outline:2px dashed var(--alerta)"></i>Pendiente de contar</span>`
              : `<span><i style="outline:2px dashed var(--alerta)"></i>En jornada de conteo</span>`}</div>`;
  return html;
}

// Muestra y actualiza el estado de sincronización con Google Sheets de un registro.
export function seguirSync(el, registroId, intentos = 25) {
  if (!el) return;
  let n = 0;
  const pintar = (s) => {
    if (!s) el.innerHTML = `<span class="chip">Google Sheets: en cola…</span>`;
    else if (s.pendiente) el.innerHTML = `<span class="chip alerta">Google Sheets: pendiente${s.ultimo_error ? " (reintentará)" : ""}</span>`;
    else el.innerHTML = `<span class="chip ok">Google Sheets: sincronizado ${hora(s.sincronizado_en)}</span>`;
  };
  const ciclo = async () => {
    if (!document.body.contains(el)) return;
    try {
      const s = await estadoSync(registroId);
      pintar(s);
      if (s && !s.pendiente) return;
    } catch { /* se reintenta */ }
    if (++n < intentos) setTimeout(ciclo, 3000);
    else el.innerHTML = `<span class="chip alerta">Google Sheets: pendiente — se enviará automáticamente</span>`;
  };
  pintar(null);
  ciclo();
}

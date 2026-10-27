import { leer, estado } from "./api.js?v=202610272358";
import { esc, num, signo, claseSigno, fechaHora, fecha, ICON, tabla, descargarCSV, aviso } from "./ui.js?v=202610272358";
import { escanear } from "./escaner.js?v=202610272358";
import { rackHTML } from "./componentes.js?v=202610272358";

let datos = [], posEstado = [];

export async function render(el, { params }) {
  [datos, posEstado] = await Promise.all([
    leer("v_disponibilidad", (q) => q.order("posicion")),
    leer("v_posiciones_estado", (q) => q.order("posicion")),
  ]);
  el.innerHTML = `
    <div class="panel">
      <div class="panel-cab"><h2>Disponibilidad</h2>
        <div class="btns"><button class="btn prim" id="escanear">${ICON.qr} Escanear posición</button>
        <button class="btn" id="csv">${ICON.csv} Exportar CSV</button></div></div>
      <div class="filtros">
        <div><label for="f-txt">Código o descripción</label><input id="f-txt" type="text" placeholder="Ej.: PROD003 o bolso"></div>
        <div><label for="f-pos">Posición</label><select id="f-pos"><option value="">Todas</option>${estado.posiciones.map((p) => `<option>${esc(p.codigo)}</option>`).join("")}</select></div>
        <div><label for="f-lote">Lote</label><input id="f-lote" type="text" placeholder="Ej.: L0009"></div>
      </div>
      <div id="ficha"></div>
      <div id="resultado"></div>
      <details class="nota-tabla"><summary>Qué significa cada columna</summary>
        <p><b>Stock disponible</b>: stock del sistema (inicial + movimientos), el que se usa para vender. <b>Último conteo</b>: lo encontrado en la última jornada; no cambia el stock.
        <b>Diferencia pendiente</b>: diferencia de una jornada que el supervisor todavía no resolvió.</p></details>
    </div>
    <div class="panel"><h2>Mapa del rack</h2><div id="rack">${rackHTML(posEstado)}</div></div>`;

  const f = { txt: el.querySelector("#f-txt"), pos: el.querySelector("#f-pos"), lote: el.querySelector("#f-lote") };
  if (params[0]) f.pos.value = params[0].toUpperCase();
  const pintar = () => {
    const t = f.txt.value.trim().toLowerCase(), p = f.pos.value, l = f.lote.value.trim().toUpperCase();
    const filas = datos.filter((d) => (!p || d.posicion === p) && (!l || (d.lote || "").includes(l))
      && (!t || d.producto.toLowerCase().includes(t) || (d.descripcion || "").toLowerCase().includes(t)));
    el.querySelector("#resultado").innerHTML = tabla([
      { t: "Posición", html: (d) => `<b>${esc(d.posicion)}</b>` },
      { t: "Producto", html: (d) => `<b>${esc(d.producto)}</b><div class="nota">${esc(d.descripcion)}</div>` },
      { t: "Lote", k: "lote" },
      { t: "Stock disponible", num: true, html: (d) => `<b>${num(d.stock_disponible)}</b>` },
      { t: "Actualizado", html: (d) => `<span class="small">${fechaHora(d.actualizado_en)}</span>` },
      { t: "Último conteo", num: true, html: (d) => d.ultimo_conteo === null ? `<span class="muted">—</span>`
          : `${num(d.ultimo_conteo)}<div class="nota">${esc(d.ultimo_conteo_jornada)} · ${fecha(d.ultimo_conteo_fecha)}</div>` },
      { t: "Diferencia pendiente", html: (d) => d.dif_pendiente ? `<span class="chip alerta">${signo(d.dif_pendiente)} · ${esc(d.jornadas_pendientes)}</span>` : `<span class="muted">—</span>` },
    ], filas, { vacio: p ? `La posición ${esc(p)} está vacía (sin stock disponible).` : "No hay resultados para ese filtro." });
    fichaPosicion(el.querySelector("#ficha"), p);
  };
  Object.values(f).forEach((x) => x.addEventListener("input", pintar));
  f.pos.addEventListener("change", pintar);
  el.querySelector("#escanear").addEventListener("click", async () => {
    const r = await escanear({ titulo: "Escanear posición", sugerencias: estado.posiciones.map((p) => p.codigo) });
    if (!r) return;
    if (!estado.posiciones.some((p) => p.codigo === r.texto)) {
      el.querySelector("#ficha").innerHTML = aviso("error", `El código leído «${esc(r.texto)}» no corresponde a una posición del rack.`);
      return;
    }
    f.pos.value = r.texto; f.txt.value = ""; f.lote.value = ""; pintar();
  });
  el.querySelector("#csv").addEventListener("click", () => descargarCSV("disponibilidad.csv", datos, [
    { k: "posicion", t: "Posicion" }, { k: "producto", t: "Codigo" }, { k: "descripcion", t: "Descripcion" }, { k: "lote", t: "Lote" },
    { k: "stock_disponible", t: "StockDisponible" }, { t: "Actualizado", f: (d) => fechaHora(d.actualizado_en) },
    { k: "ultimo_conteo", t: "UltimoConteo" }, { k: "ultimo_conteo_jornada", t: "JornadaUltimoConteo" },
    { k: "dif_pendiente", t: "DiferenciaPendiente" }]));
  el.querySelectorAll("#rack [data-pos]").forEach((b) => b.addEventListener("click", () => { f.pos.value = b.dataset.pos; pintar(); el.scrollIntoView(); }));
  pintar();
}

async function fichaPosicion(cont, pos) {
  if (!pos) { cont.innerHTML = ""; return; }
  const pe = posEstado.find((p) => p.posicion === pos);
  cont.innerHTML = `<div class="ficha"><dt>Posición</dt><dd class="pos-grande">${esc(pos)}</dd>
    <dt>Estado</dt><dd>${pe?.producto ? `Ocupada · ${esc(pe.producto)} / ${esc(pe.lote)} · ${num(pe.cantidad)} un.` : "Vacía"}${pe?.en_conteo ? ` · <span class="chip alerta">En conteo ${esc(pe.en_conteo)}</span>` : ""}</dd>
    <dt>Movimientos</dt><dd id="movs-pos"><span class="muted">Cargando…</span></dd></div>`;
  const movs = await leer("v_movimientos", (q) => q.eq("posicion", pos).order("fecha_contable", { ascending: false }).order("id", { ascending: false }).limit(6));
  const d = cont.querySelector("#movs-pos");
  if (d) d.innerHTML = movs.length ? movs.map((m) => `<div class="small">${fecha(m.fecha_contable)} · ${esc(m.tipo)} · ${esc(m.producto)}/${esc(m.lote)} · <span class="${claseSigno(m.cantidad)}">${signo(m.cantidad)}</span> <span class="muted mono">${esc(m.id_publico)}</span></div>`).join("")
    : `<span class="muted small">Sin movimientos (solo stock inicial, si lo hubiera).</span>`;
}

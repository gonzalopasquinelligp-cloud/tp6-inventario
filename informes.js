// Informes: disponibilidad, historial de movimientos, conteos, diferencias, trimestral y conteo histórico del 14/10.
import { rpc, leer, estado } from "./api.js?v=202610242324";
import { esc, num, signo, claseSigno, aviso, ICON, fecha, fechaHora, tabla, chip, CATEGORIAS, ESTADOS_REV, descargarCSV, TZ } from "./ui.js?v=202610242324";

const PESTANAS = [
  ["disp", "Disponibilidad"], ["movs", "Movimientos"], ["conteos", "Conteos"], ["difs", "Diferencias"], ["trim", "Trimestral"], ["caso", "Conteo 14/10"],
];
const TIPOS = ["Ingreso_Orden_Compra", "Salida_Venta", "Retorno_Venta", "Ajuste_Inventario_Ciclico", "Ajuste_Inventario_Anual", "Consumo_Orden_Producción"];

export async function render(el, { params }) {
  const actual = PESTANAS.some(([k]) => k === params[0]) ? params[0] : "disp";
  el.innerHTML = `<div class="pestanas">${PESTANAS.map(([k, t]) => `<button data-p="${k}" class="${k === actual ? "activo" : ""}">${t}</button>`).join("")}</div><div id="inf"></div>`;
  el.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/informes/${b.dataset.p}`; }));
  const cont = el.querySelector("#inf");
  cont.innerHTML = `<div class="cargando">Cargando…</div>`;
  await ({ disp, movs, conteos, difs, trim, caso })[actual](cont);
}

const cab = (titulo, extra = "") => `<div class="panel-cab"><h2>${titulo}</h2><div class="btns">${extra}<button class="btn chico" id="csv">${ICON.csv} Exportar CSV</button></div></div>`;

async function disp(c) {
  const filas = await leer("v_disponibilidad", (q) => q.order("posicion"));
  const total = filas.reduce((a, f) => a + f.stock_disponible, 0);
  c.innerHTML = `<div class="panel">${cab("Disponibilidad actual")}
    <p class="small muted">Stock teórico por posición + producto + lote al ${fechaHora(new Date())} · total <b>${num(total)}</b> un.</p>
    ${tabla([{ t: "Posición", k: "posicion" }, { t: "Código", k: "producto" }, { t: "Descripción", k: "descripcion" }, { t: "Lote", k: "lote" },
      { t: "Disponible", num: true, html: (f) => num(f.stock_disponible) }, { t: "Actualizado", html: (f) => fechaHora(f.actualizado_en) },
      { t: "Último conteo", num: true, html: (f) => num(f.ultimo_conteo) }, { t: "Dif. pendiente", num: true, html: (f) => f.dif_pendiente ? signo(f.dif_pendiente) : "—" }], filas)}</div>`;
  c.querySelector("#csv").addEventListener("click", () => descargarCSV("disponibilidad.csv", filas));
}

async function movs(c) {
  const todos = await leer("v_movimientos", (q) => q.order("fecha_contable", { ascending: false }).order("id", { ascending: false }).limit(2000));
  c.innerHTML = `<div class="panel">${cab("Historial de ingresos, egresos, retornos y ajustes")}
    <div class="filtros">
      <div><label>Desde</label><input type="date" id="d"></div><div><label>Hasta</label><input type="date" id="h"></div>
      <div><label>Tipo</label><select id="t"><option value="">Todos</option>${TIPOS.map((t) => `<option>${t}</option>`).join("")}</select></div>
      <div><label>Origen</label><select id="o"><option value="">Todos</option><option value="HISTORICO">Histórico importado</option><option value="APP">Registrado en la app</option></select></div>
      <div><label>Buscar</label><input id="q" type="text" placeholder="Posición, código, lote, documento"></div>
    </div><div id="res"></div></div>`;
  let vis = todos;
  const pintar = () => {
    const d = c.querySelector("#d").value, h = c.querySelector("#h").value, t = c.querySelector("#t").value, o = c.querySelector("#o").value;
    const q = c.querySelector("#q").value.trim().toUpperCase();
    vis = todos.filter((m) => {
      const f = diaAR(m.fecha_contable);
      return (!d || f >= d) && (!h || f <= h) && (!t || m.tipo === t) && (!o || m.origen === o)
        && (!q || `${m.posicion} ${m.producto} ${m.lote} ${m.documento || ""} ${m.id_publico}`.toUpperCase().includes(q));
    });
    const neto = vis.reduce((a, m) => a + m.cantidad, 0);
    c.querySelector("#res").innerHTML = `<p class="small muted">${vis.length} movimientos · variación neta <b class="${claseSigno(neto)}">${signo(neto)}</b> un.</p>` + tabla([
      { t: "ID", html: (m) => `<span class="mono small">${esc(m.id_publico)}</span>` }, { t: "Fecha", html: (m) => fecha(m.fecha_contable) },
      { t: "Tipo", k: "tipo" }, { t: "Pos.", k: "posicion" }, { t: "Código", k: "producto" }, { t: "Lote", k: "lote" },
      { t: "Cantidad", num: true, html: (m) => `<span class="${claseSigno(m.cantidad)}">${signo(m.cantidad)}</span>` },
      { t: "Documento", html: (m) => esc(m.documento || "—") }, { t: "Usuario", html: (m) => `<span class="small">${esc(m.usuario_email || "—")}</span>` },
      { t: "Origen", html: (m) => m.origen === "HISTORICO" ? `<span class="chip">Histórico · fila ${m.fila_origen}</span>` : `<span class="chip prim">App</span>` },
    ], vis);
  };
  c.querySelectorAll("input,select").forEach((x) => x.addEventListener("input", pintar));
  pintar();
  c.querySelector("#csv").addEventListener("click", () => descargarCSV("movimientos.csv", vis, [
    { k: "id_publico", t: "ID" }, { t: "FechaContable", f: (m) => fechaHora(m.fecha_contable) }, { t: "RegistradoEn", f: (m) => fechaHora(m.registrado_en) },
    { k: "origen", t: "Origen" }, { k: "tipo", t: "TipoMovimiento" }, { k: "tipo_origen", t: "TipoOrigen" }, { k: "posicion", t: "Posicion" },
    { k: "producto", t: "Codigo" }, { k: "lote", t: "Lote" }, { k: "cantidad", t: "Cantidad" }, { k: "cantidad_origen", t: "CantidadOrigen" },
    { k: "documento", t: "Documento" }, { k: "usuario_email", t: "Usuario" }, { k: "aprobado_por_email", t: "AprobadoPor" }, { k: "diferencia", t: "DiferenciaID" }, { k: "fila_origen", t: "FilaOrigen" }]));
}

async function conteos(c) {
  const filas = await leer("v_conteos", (q) => q.order("id", { ascending: false }).limit(2000));
  c.innerHTML = `<div class="panel">${cab("Registros de conteo (todas las lecturas)")}
    <p class="small muted">Incluye recuentos. REF### = conteo de referencia del 14/10.</p>
    ${tabla([{ t: "ID", html: (x) => `<span class="mono small">${esc(x.id_publico)}</span>` }, { t: "Jornada", k: "jornada" },
      { t: "Posición", html: (x) => esc(x.posicion || "sin posición") }, { t: "Lectura", num: true, html: (x) => x.lectura },
      { t: "Encontrado", html: (x) => x.posicion_vacia ? "Posición vacía" : `${esc(x.producto)} / ${esc(x.lote)}` },
      { t: "Cantidad", num: true, html: (x) => num(x.cantidad) },
      { t: "Esperado", html: (x) => x.esperado_producto ? `${esc(x.esperado_producto)} / ${esc(x.esperado_lote)}` : "—" },
      { t: "Método", html: (x) => `<span class="small">${esc(x.metodo_posicion || "")}${x.metodo_producto ? " · " + esc(x.metodo_producto) : ""}</span>` },
      { t: "Usuario", html: (x) => `<span class="small">${esc(x.usuario_email || "")}</span>` }, { t: "Registrado", html: (x) => fechaHora(x.registrado_en) }], filas)}</div>`;
  c.querySelector("#csv").addEventListener("click", () => descargarCSV("conteos.csv", filas, [
    { k: "id_publico", t: "ID" }, { k: "jornada", t: "JornadaID" }, { k: "posicion", t: "Posicion" }, { k: "lectura", t: "Lectura" },
    { k: "producto", t: "Codigo" }, { k: "lote", t: "Lote" }, { k: "cantidad", t: "Cantidad" }, { t: "Vacia", f: (x) => (x.posicion_vacia ? "Si" : "No") },
    { k: "esperado_producto", t: "EsperadoCodigo" }, { k: "esperado_lote", t: "EsperadoLote" }, { k: "metodo_posicion", t: "MetodoPosicion" },
    { k: "metodo_producto", t: "MetodoProducto" }, { k: "usuario_email", t: "Usuario" }, { t: "FechaContable", f: (x) => fechaHora(x.fecha_contable) },
    { t: "RegistradoEn", f: (x) => fechaHora(x.registrado_en) }, { k: "ref_origen", t: "RefOrigen" }]));
}

async function difs(c) {
  const filas = await leer("v_diferencias", (q) => q.order("jornada_id", { ascending: false }).order("posicion"));
  c.innerHTML = `<div class="panel">${cab("Diferencias por jornada, producto, lote y posición")}
    <div class="filtros">
      <div><label>Jornada</label><select id="j"><option value="">Todas</option>${[...new Set(filas.map((f) => f.jornada))].map((j) => `<option>${esc(j)}</option>`).join("")}</select></div>
      <div><label>Producto</label><select id="p"><option value="">Todos</option>${estado.productos.map((p) => `<option>${esc(p.codigo)}</option>`).join("")}</select></div>
      <div><label>Lote</label><input id="l" type="text"></div>
      <div><label>Posición</label><input id="po" type="text"></div>
      <div><label>&nbsp;</label><label class="check" style="min-height:40px"><input type="checkbox" id="sd" checked> Solo con diferencia</label></div>
    </div><div id="res"></div><h3 style="margin-top:16px">Resumen por producto</h3><div id="agr"></div></div>`;
  let vis = filas;
  const pintar = () => {
    const j = c.querySelector("#j").value, p = c.querySelector("#p").value, l = c.querySelector("#l").value.trim().toUpperCase(), po = c.querySelector("#po").value.trim().toUpperCase();
    vis = filas.filter((f) => (!j || f.jornada === j) && (!p || f.producto === p) && (!l || (f.lote || "").includes(l)) && (!po || (f.posicion || "") === po)
      && (!c.querySelector("#sd").checked || f.diferencia !== 0));
    c.querySelector("#res").innerHTML = tabla([{ t: "Jornada", k: "jornada" }, { t: "Posición", html: (f) => esc(f.posicion || "sin posición") },
      { t: "Código", k: "producto" }, { t: "Lote", k: "lote" }, { t: "Teórico", num: true, html: (f) => num(f.teorico) }, { t: "Físico", num: true, html: (f) => num(f.fisico) },
      { t: "Diferencia", num: true, html: (f) => `<span class="${claseSigno(f.diferencia)}">${signo(f.diferencia)}</span>` },
      { t: "Categoría", html: (f) => chip(CATEGORIAS, f.categoria) }, { t: "Revisión", html: (f) => chip(ESTADOS_REV, f.estado_revision) },
      { t: "Ajuste", html: (f) => esc(f.ajuste_id || "—") }], vis);
    const agr = {};
    vis.forEach((f) => { const k = `${f.jornada}|${f.producto}`; agr[k] ??= { jornada: f.jornada, producto: f.producto, t: 0, f: 0, d: 0, n: 0 };
      agr[k].t += f.teorico; agr[k].f += f.fisico; agr[k].d += f.diferencia; agr[k].n += f.diferencia !== 0 ? 1 : 0; });
    c.querySelector("#agr").innerHTML = tabla([{ t: "Jornada", k: "jornada" }, { t: "Producto", k: "producto" }, { t: "Teórico", num: true, html: (a) => num(a.t) },
      { t: "Físico", num: true, html: (a) => num(a.f) }, { t: "Dif. neta", num: true, html: (a) => `<span class="${claseSigno(a.d)}">${signo(a.d)}</span>` },
      { t: "Combinaciones con diferencia", num: true, html: (a) => a.n }], Object.values(agr));
  };
  c.querySelectorAll("input,select").forEach((x) => x.addEventListener("input", pintar));
  pintar();
  c.querySelector("#csv").addEventListener("click", () => descargarCSV("diferencias.csv", vis, [
    { k: "id_publico", t: "ID" }, { k: "jornada", t: "JornadaID" }, { k: "posicion", t: "Posicion" }, { k: "producto", t: "Codigo" }, { k: "lote", t: "Lote" },
    { k: "teorico", t: "Teorico" }, { k: "fisico", t: "Fisico" }, { k: "diferencia", t: "Diferencia" }, { k: "categoria", t: "Categoria" }, { k: "nota", t: "Nota" },
    { k: "estado_revision", t: "EstadoRevision" }, { k: "causa", t: "Causa" }, { k: "revisado_por_email", t: "RevisadoPor" }, { k: "ajuste_id", t: "AjusteMovID" }]));
}

async function trim(c) {
  const hoy = new Date();
  const anios = [2026, 2027].filter((a) => a <= Math.max(hoy.getFullYear() + 1, 2026));
  c.innerHTML = `<div class="panel">${cab("Informe trimestral de movimientos y ajustes")}
    <div class="filtros">
      <div><label>Trimestre</label><select id="tq">${anios.flatMap((a) => [1, 2, 3, 4].map((q) => `<option value="${a}-${q}" ${a === 2026 && q === 4 ? "selected" : ""}>T${q} ${a}</option>`)).join("")}
        <option value="custom">Rango personalizado…</option></select></div>
      <div><label>Desde</label><input type="date" id="d"></div><div><label>Hasta</label><input type="date" id="h"></div>
    </div><div id="res"></div></div>`;
  let filas = [];
  const fijarTrimestre = () => {
    const v = c.querySelector("#tq").value;
    if (v === "custom") return;
    const [a, q] = v.split("-").map(Number);
    const d = new Date(Date.UTC(a, (q - 1) * 3, 1)), h = new Date(Date.UTC(a, q * 3, 0));
    c.querySelector("#d").value = d.toISOString().slice(0, 10); c.querySelector("#h").value = h.toISOString().slice(0, 10);
  };
  const consultar = async () => {
    const d = c.querySelector("#d").value, h = c.querySelector("#h").value;
    const res = c.querySelector("#res");
    if (!d || !h) return;
    try { filas = await rpc("informe_movimientos", { p_desde: d, p_hasta: h }); } catch (e) { res.innerHTML = aviso("error", esc(e.message)); return; }
    const meses = [...new Set(filas.map((f) => f.mes))];
    const sinDatos = filas.filter((f) => !f.hay_datos);
    const tot = (fn) => filas.filter(fn).reduce((a, f) => ({ n: a.n + f.movimientos, e: a.e + f.entradas, s: a.s + f.salidas, t: a.t + f.neto }), { n: 0, e: 0, s: 0, t: 0 });
    const aj = tot((f) => f.tipo.startsWith("Ajuste")), all = tot(() => true);
    const nombreMes = (m) => new Date(m + "T12:00:00Z").toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: TZ });
    res.innerHTML = `
      ${sinDatos.length ? aviso("alerta", `<b>Datos parciales:</b> ${sinDatos.map((f) => `${nombreMes(f.mes)} — ${esc(f.nota)}`).join("<br>")}<br>No se completan meses sin registros.`) : ""}
      <div class="grilla g4" style="margin-bottom:14px">
        <div class="kpi"><div class="etq">Movimientos</div><div class="val">${num(all.n)}</div></div>
        <div class="kpi"><div class="etq">Entradas</div><div class="val">${signo(all.e)}</div></div>
        <div class="kpi"><div class="etq">Salidas</div><div class="val">${signo(all.s)}</div></div>
        <div class="kpi"><div class="etq">Ajustes (neto)</div><div class="val">${signo(aj.t)}</div><div class="sub">${aj.n} ajustes</div></div>
      </div>
      ${tabla([{ t: "Mes", html: (f) => `<b>${esc(nombreMes(f.mes))}</b>` }, { t: "Tipo", html: (f) => f.hay_datos ? esc(f.tipo) : `<span class="muted">Sin datos</span>` },
        { t: "Movimientos", num: true, html: (f) => f.hay_datos ? num(f.movimientos) : "—" }, { t: "Entradas", num: true, html: (f) => f.hay_datos ? num(f.entradas) : "—" },
        { t: "Salidas", num: true, html: (f) => f.hay_datos ? num(f.salidas) : "—" },
        { t: "Neto", num: true, html: (f) => f.hay_datos ? `<span class="${claseSigno(f.neto)}">${signo(f.neto)}</span>` : "—" }], filas)}
      <p class="small muted">Meses incluidos: ${meses.map(nombreMes).join(", ")}. Fechas contables en hora Argentina.</p>`;
  };
  c.querySelector("#tq").addEventListener("change", () => { fijarTrimestre(); consultar(); });
  c.querySelectorAll("input[type=date]").forEach((i) => i.addEventListener("change", () => { c.querySelector("#tq").value = "custom"; consultar(); }));
  fijarTrimestre(); await consultar();
  c.querySelector("#csv").addEventListener("click", () => descargarCSV("informe_trimestral.csv", filas, [
    { k: "mes", t: "Mes" }, { k: "tipo", t: "TipoMovimiento" }, { k: "movimientos", t: "Movimientos" }, { k: "entradas", t: "Entradas" },
    { k: "salidas", t: "Salidas" }, { k: "neto", t: "Neto" }, { t: "HayDatos", f: (f) => (f.hay_datos ? "Si" : "No") }, { k: "nota", t: "Nota" }]));
}

async function caso(c) {
  const [[r], filas] = await Promise.all([leer("v_caso_resumen"), leer("v_caso_conciliacion")]);
  const ctrl = [["Stock inicial al 30/09/2026", r.stock_inicial, 1011], ["Movimientos 01/10–14/10", r.movimientos, 40], ["Variación neta", r.variacion_neta, 583],
    ["Stock teórico al 14/10/2026", r.stock_teorico, 1594], ["Stock físico de referencia", r.stock_fisico, 1569], ["Diferencia neta", r.diferencia_neta, -25],
    ["Diferencias individuales", r.diferencias_individuales, 11]];
  c.innerHTML = `<div class="panel">${cab("Reconstrucción del conteo al 14/10/2026", `<a class="btn chico" href="#/conciliacion">Revisar y ajustar</a>`)}
    <p class="small muted">Stock inicial + movimientos hasta el corte (${fechaHora(r.fecha_corte)}), contra el conteo de referencia por posición, producto y lote.</p>
    ${tabla([{ t: "Control", k: 0, html: (x) => esc(x[0]) }, { t: "Calculado", num: true, html: (x) => `<b>${num(x[1])}</b>` },
      { t: "Valor de control", num: true, html: (x) => num(x[2]) }, { t: "", html: (x) => x[1] === x[2] ? `<span class="chip ok">Coincide</span>` : `<span class="chip error">Revisar</span>` }], ctrl)}
    <h3 style="margin-top:18px">Detalle por posición + producto + lote</h3>
    ${tabla([{ t: "Posición", html: (f) => esc(f.posicion || "sin posición") }, { t: "Código", k: "producto" }, { t: "Lote", k: "lote" },
      { t: "Teórico", num: true, html: (f) => num(f.teorico) }, { t: "Físico", num: true, html: (f) => num(f.fisico) },
      { t: "Diferencia", num: true, html: (f) => `<span class="${claseSigno(f.diferencia)}">${signo(f.diferencia)}</span>` },
      { t: "Categoría", html: (f) => `${chip(CATEGORIAS, f.categoria)}${f.nota ? `<div class="nota">${esc(f.nota)}</div>` : ""}` }], filas,
      { claseFila: (f) => (f.producto === "PROD003" && f.lote === "L0009" && f.diferencia !== 0 ? "resaltar" : "") })}</div>`;
  c.querySelector("#csv").addEventListener("click", () => descargarCSV("conciliacion_14-10-2026.csv", filas, [
    { k: "posicion", t: "Posicion" }, { k: "producto", t: "Codigo" }, { k: "descripcion", t: "Descripcion" }, { k: "lote", t: "Lote" },
    { k: "teorico", t: "StockTeorico" }, { k: "fisico", t: "ConteoReferencia" }, { k: "diferencia", t: "Diferencia" }, { k: "categoria", t: "Categoria" }, { k: "nota", t: "Nota" }]));
}

function diaAR(v) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v));
}

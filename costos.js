// Costo y servicio: costo total de inventario, nivel de servicio (OTIF simulado), política de stock y simulador.
// Los datos vienen del servidor (analisis_datos); los cálculos están en modelo.js con sus fórmulas a la vista.
import { rpc, puede } from "./api.js";
import { esc, num, aviso, ICON, tabla, pedir, toast, descargarCSV, usd, dec, pct, origen, fechaHora } from "./ui.js";
import { analizar, zDeNS, CATEGORIAS, MOTIVOS } from "./modelo.js";

const COLOR = {
  capital: "var(--s1)", almacenamiento: "var(--s2)", orden: "var(--s3)", manipulacion: "var(--s4)",
  devoluciones: "var(--s5)", obsolescencia: "var(--s6)", quiebre: "var(--s7)",
};
const fCorta = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const fLarga = (iso) => iso.split("-").reverse().join("/");

let estadoVista = null;
let alRedimensionar = null;

export function destruir() { if (alRedimensionar) window.removeEventListener("resize", alRedimensionar); alRedimensionar = null; }

export async function render(el, { params }) {
  estadoVista = { el, datos: null, variacion: 0, ns: null, gran: "dia", desde: params[0] || null, hasta: params[1] || null };
  el.innerHTML = `<div class="cs">
    <section class="cs-periodo" aria-label="Período de análisis">
      <form id="f-periodo" class="cs-periodo-form">
        <div><label for="p-desde">Desde</label><input id="p-desde" type="date" required></div>
        <div><label for="p-hasta">Hasta</label><input id="p-hasta" type="date" required></div>
        <div><label for="p-gran">Agrupar por</label><select id="p-gran"><option value="dia">Día</option><option value="semana">Semana (7 días)</option></select></div>
        <button class="btn" type="submit">Actualizar</button>
      </form>
      <p class="cs-fuente" id="fuente"></p>
    </section>
    <div id="msg"></div>
    <div id="cuerpo"><div class="cargando">Cargando datos del período…</div></div>
  </div>`;
  el.querySelector("#f-periodo").addEventListener("submit", (e) => {
    e.preventDefault();
    estadoVista.desde = el.querySelector("#p-desde").value; estadoVista.hasta = el.querySelector("#p-hasta").value;
    estadoVista.gran = el.querySelector("#p-gran").value;
    cargar();
  });
  el.querySelector("#p-gran").addEventListener("change", (e) => { estadoVista.gran = e.target.value; if (estadoVista.datos) pintar(); });
  let t;
  destruir();
  alRedimensionar = () => { clearTimeout(t); t = setTimeout(() => estadoVista?.res && pintarGraficos(estadoVista.res), 200); };
  window.addEventListener("resize", alRedimensionar);
  await cargar();
}

async function cargar() {
  const s = estadoVista, el = s.el;
  el.querySelector("#msg").innerHTML = "";
  try {
    s.datos = await rpc("analisis_datos", { p_desde: s.desde || null, p_hasta: s.hasta || null });
  } catch (e) {
    el.querySelector("#msg").innerHTML = aviso("error", esc(e.message));
    if (!s.datos) el.querySelector("#cuerpo").innerHTML = "";
    return;
  }
  const d = s.datos;
  s.desde = d.desde; s.hasta = d.hasta;
  for (const id of ["p-desde", "p-hasta"]) {
    const inp = el.querySelector("#" + id);
    inp.min = d.fecha_min_datos; inp.max = d.fecha_max_datos;
  }
  el.querySelector("#p-desde").value = d.desde; el.querySelector("#p-hasta").value = d.hasta;
  el.querySelector("#p-gran").value = s.gran;
  if (s.ns === null) s.ns = Number(d.parametros.find((p) => p.clave === "nivel_servicio")?.valor ?? 95);
  el.querySelector("#fuente").innerHTML = `Datos registrados del ${fLarga(d.desde)} al ${fLarga(d.hasta)}: stock al inicio del período y
    ${num(d.movimientos.length)} movimientos. Hay datos desde el ${fLarga(d.fecha_min_datos)} hasta el ${fLarga(d.fecha_max_datos)}.`;
  armarCuerpo();
  pintar();
}

function armarCuerpo() {
  const el = estadoVista.el.querySelector("#cuerpo");
  el.innerHTML = `
    <section class="veredicto" id="veredicto" aria-live="polite">
      <div class="ver-texto" id="ver-texto"></div>
      <form class="simulador" id="simulador" aria-label="Simulador">
        <h2>Simulador</h2>
        <div class="campo"><label for="s-var">Variación de ventas</label>
          <div class="sim-fila"><input id="s-var-r" type="range" min="-50" max="100" step="5" aria-label="Variación de ventas (deslizador)">
          <span class="sim-num"><input id="s-var" type="number" min="-90" max="300" step="1" inputmode="numeric"> %</span></div>
          <div class="ayuda">Multiplica cada retiro por venta registrado. 0 = ventas como se registraron.</div></div>
        <div class="campo"><label for="s-ns">Nivel de servicio objetivo</label>
          <div class="sim-fila"><input id="s-ns-r" type="range" min="80" max="99.5" step="0.5" aria-label="Nivel de servicio (deslizador)">
          <span class="sim-num"><input id="s-ns" type="number" min="50" max="99.9" step="0.1" inputmode="decimal"> %</span></div>
          <div class="ayuda" id="s-z"></div></div>
        <button class="btn chico" type="button" id="s-reset">Volver a los valores cargados</button>
      </form>
    </section>
    <section class="bloque" id="b-graficos"></section>
    <section class="bloque" id="b-politica"></section>
    <section class="bloque" id="b-costos"></section>
    <section class="bloque" id="b-sensib"></section>
    <section class="bloque" id="b-devol"></section>
    <section class="bloque" id="b-param"></section>`;
  const s = estadoVista;
  const v = el.querySelector("#s-var"), vr = el.querySelector("#s-var-r"), n = el.querySelector("#s-ns"), nr = el.querySelector("#s-ns-r");
  v.value = vr.value = s.variacion; n.value = nr.value = s.ns;
  let t;
  const aplicar = () => { clearTimeout(t); t = setTimeout(pintar, 120); };
  const leerVar = (x) => { const k = Number(x); if (Number.isFinite(k) && k >= -90 && k <= 300) { s.variacion = k; aplicar(); } };
  const leerNs = (x) => { const k = Number(x); if (Number.isFinite(k) && k >= 50 && k <= 99.9) { s.ns = k; aplicar(); } };
  vr.addEventListener("input", () => { v.value = vr.value; leerVar(vr.value); });
  v.addEventListener("input", () => { vr.value = v.value; leerVar(v.value); });
  nr.addEventListener("input", () => { n.value = nr.value; leerNs(nr.value); });
  n.addEventListener("input", () => { nr.value = n.value; leerNs(n.value); });
  el.querySelector("#simulador").addEventListener("submit", (e) => e.preventDefault());
  el.querySelector("#s-reset").addEventListener("click", () => {
    s.variacion = 0; s.ns = Number(s.datos.parametros.find((p) => p.clave === "nivel_servicio")?.valor ?? 95);
    v.value = vr.value = s.variacion; n.value = nr.value = s.ns; pintar();
  });
}

function pintar() {
  const s = estadoVista, el = s.el;
  let res;
  try { res = analizar(s.datos, { variacion: s.variacion, ns: s.ns, granularidad: s.gran }); }
  catch (e) { el.querySelector("#msg").innerHTML = aviso("error", `No se pudo calcular: ${esc(e.message)}`); return; }
  s.res = res;
  const nsParam = res.P.leer("nivel_servicio");
  el.querySelector("#s-z").innerHTML = `z = ${dec(zDeNS(s.ns / 100), 3)} · ${s.ns === nsParam.valor ? origen(nsParam.origen, nsParam.razon) : `<span class="org org-sim" title="Valor del simulador: no se guarda.">Valor del simulador</span>`}`;
  pintarVeredicto(res);
  pintarGraficos(res);
  pintarPolitica(res);
  pintarCostos(res);
  pintarSensibilidad(res);
  pintarDevoluciones(res);
  pintarParametros(res);
}

// ---------------------------------------------------------------------
// Veredicto y conclusión
// ---------------------------------------------------------------------
const montoSinUnidad = (v) => usd(v).replace(/^USD\s/, "");

function pintarVeredicto(res) {
  const { tot, conclusion: c } = res;
  const filaComp = (t, a, b, fmt, mejorMenor, nota) => {
    const d = a === null || b === null ? null : b - a;
    const clase = d === null || Math.abs(d) < 1e-9 ? "" : (d < 0) === mejorMenor ? "mejor" : "peor";
    return `<tr><th scope="row">${t}${nota ? `<div class="nota">${nota}</div>` : ""}</th><td>${fmt(a)}</td><td>${fmt(b)}</td>
      <td class="${clase}">${d === null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "") + fmt(Math.abs(d)).replace(/^−/, "")}</td></tr>`;
  };
  const etAct = res.variacion === 0 ? "Actual (registrado)" : `Actual con ${res.variacion > 0 ? "+" : ""}${res.variacion} % de ventas`;
  estadoVista.el.querySelector("#ver-texto").innerHTML = `
    <p class="ver-pregunta">¿Se puede bajar el costo del inventario sin perder nivel de servicio?</p>
    <p class="ver-frase tono-${c.tono}">${esc(c.veredicto)}</p>
    <div class="comp-cont"><table class="comparacion">
      <thead><tr><th></th><th scope="col">${esc(etAct)}</th><th scope="col">Propuesta</th><th scope="col">Diferencia</th></tr></thead>
      <tbody>
        ${filaComp("Costo del período", tot.actual.total, tot.propuesta.total, montoSinUnidad, true, `USD, ${res.series.L} días`)}
        ${filaComp("Inventario promedio valorizado", tot.valorPromActual, tot.valorPromPropuesta, montoSinUnidad, true, "USD")}
        ${filaComp("OTIF simulado", tot.otifActual, tot.otifPropuesta, (x) => pct(x), false, `${num(tot.lineas)} líneas de venta`)}
        ${filaComp("Unidades no entregadas", tot.faltaActual, tot.faltaPropuesta, num, true)}
      </tbody>
    </table></div>
    <ul class="ver-detalle">${c.detalle.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <details class="limites" open><summary>Límites de este resultado</summary><ul>${c.limites.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
}

// ---------------------------------------------------------------------
// Gráficos: costo por período, retiros por ventas y OTIF (mismo eje temporal)
// ---------------------------------------------------------------------
function escalaNice(max) {
  if (!(max > 0)) return { max: 1, paso: 0.25 };
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) { const paso = (m * exp) / 4; if (paso * 4 >= max) return { max: paso * 4, paso }; }
  return { max: 10 * exp, paso: 2.5 * exp };
}
const compacto = (v) => (Math.abs(v) >= 1000 ? `${dec(v / 1000, 1)} k` : dec(v, Math.abs(v) < 10 && v % 1 ? 1 : 0));

function barraPath(x, y, w, h, redondeo) {
  if (h <= 0) return "";
  const r = Math.min(redondeo ? 4 : 0, h, w / 2);
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ""}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ""}V${y + h}Z`;
}

function marcoGrafico({ id, alto, n, yMax, paso, fmtY, titulo, W }) {
  const pl = 52, pr = 12, pt = 10, pb = 26;
  const ancho = W - pl - pr, banda = ancho / n, h = alto - pt - pb;
  const X = (i) => pl + banda * i, Y = (v) => pt + h - (v / yMax) * h;
  let grid = "";
  for (let v = 0; v <= yMax + 1e-9; v += paso) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="g-grid"/><text x="${pl - 8}" y="${Y(v) + 4}" class="g-eje" text-anchor="end">${fmtY(v)}</text>`;
  return { W, pl, pr, pt, pb, h, banda, X, Y, alto, abrir: `<svg viewBox="0 0 ${W} ${alto}" class="grafico" id="${id}" role="img" aria-label="${esc(titulo)}">${grid}`, cerrar: "</svg>" };
}

function pintarGraficos(res) {
  const g = res.periodos, n = g.length;
  const cats = CATEGORIAS.filter((k) => g.some((p) => p.cat[k.id] > 1e-9));
  const etq = (p) => (p.dias === 1 ? fCorta(p.desde) : `${fCorta(p.desde)}–${fCorta(p.hasta)}`);
  const b = estadoVista.el.querySelector("#b-graficos");
  const W = Math.max(300, Math.min(1100, (b.clientWidth || 760) - 42));
  const ejeX = (m) => { const cadaEtq = Math.max(1, Math.ceil((res.granularidad === "semana" ? 84 : 44) / m.banda)); return g.map((p, i) => (i % cadaEtq === 0 ? `<text x="${m.X(i) + m.banda / 2}" y="${m.alto - 8}" class="g-eje" text-anchor="middle">${etq(p)}</text>` : "")).join(""); };
  const resaltes = (m) => g.map((p, i) => `<rect class="g-hl" data-i="${i}" x="${m.X(i)}" y="${m.pt}" width="${m.banda}" height="${m.h}"/>`).join("");
  const golpes = (m) => g.map((p, i) => `<rect class="g-hit" data-i="${i}" x="${m.X(i)}" y="0" width="${m.banda}" height="${m.alto}"/>`).join("");
  const anchoBarra = (m) => Math.max(4, Math.min(24, m.banda * 0.62));

  // 1. Costo por categoría (apilado) + línea de la propuesta en régimen
  const e1 = escalaNice(Math.max(...g.map((p) => Math.max(p.total, p.propuesta))));
  const m1 = marcoGrafico({ id: "g-costo", alto: 230, n, yMax: e1.max, paso: e1.paso, fmtY: (v) => compacto(v), titulo: "Costo de inventario por período, por categoría", W });
  let barras1 = "";
  g.forEach((p, i) => {
    const w = anchoBarra(m1), x = m1.X(i) + (m1.banda - w) / 2;
    let base = 0;
    const visibles = cats.filter((k) => p.cat[k.id] > 1e-9);
    visibles.forEach((k, j) => {
      const v = p.cat[k.id], y0 = m1.Y(base + v), y1 = m1.Y(base);
      const alto = Math.max(0, y1 - y0 - (j < visibles.length - 1 ? 2 : 0));
      barras1 += `<path d="${barraPath(x, y0 + (j < visibles.length - 1 ? 2 : 0), w, alto, j === visibles.length - 1)}" fill="${COLOR[k.id]}"/>`;
      base += v;
    });
  });
  const linProp = g.map((p, i) => `${i ? "L" : "M"}${m1.X(i)},${m1.Y(p.propuesta)}H${m1.X(i) + m1.banda}`).join("");
  const svg1 = m1.abrir + resaltes(m1) + barras1 + `<path d="${linProp}" class="g-prop"/>`
    + `<text x="${m1.X(n - 1) + m1.banda - 2}" y="${m1.Y(g[n - 1].propuesta) - 6}" class="g-etq" text-anchor="end">Propuesta</text>` + ejeX(m1) + golpes(m1) + m1.cerrar;

  // 2. Retiros por ventas (unidades)
  const e2 = escalaNice(Math.max(...g.map((p) => p.ventas)));
  const m2 = marcoGrafico({ id: "g-ventas", alto: 150, n, yMax: e2.max, paso: e2.paso, fmtY: compacto, titulo: "Retiros por ventas por período, en unidades", W });
  const barras2 = g.map((p, i) => { const w = anchoBarra(m2), x = m2.X(i) + (m2.banda - w) / 2; return `<path d="${barraPath(x, m2.Y(p.ventas), w, m2.Y(0) - m2.Y(p.ventas), true)}" class="g-ventas"/>`; }).join("");
  const svg2 = m2.abrir + resaltes(m2) + barras2 + ejeX(m2) + golpes(m2) + m2.cerrar;

  // 3. OTIF simulado (0–100 %)
  const m3 = marcoGrafico({ id: "g-otif", alto: 160, n, yMax: 1, paso: 0.25, fmtY: (v) => `${Math.round(v * 100)} %`, titulo: "OTIF simulado por período", W });
  const linea = (campo) => { let d = "", abierto = false; g.forEach((p, i) => { const v = p[campo]; if (v === null) { abierto = false; return; } d += `${abierto ? "L" : "M"}${m3.X(i) + m3.banda / 2},${m3.Y(v)}`; abierto = true; }); return d; };
  const puntos = (campo, clase) => g.map((p, i) => (p[campo] === null ? "" : `<circle cx="${m3.X(i) + m3.banda / 2}" cy="${m3.Y(p[campo])}" r="4" class="${clase}"/>`)).join("");
  const svg3 = m3.abrir + resaltes(m3) + `<path d="${linea("otifActual")}" class="g-l-act"/>${puntos("otifActual", "g-p-act")}<path d="${linea("otifPropuesta")}" class="g-l-prop"/>${puntos("otifPropuesta", "g-p-prop")}` + ejeX(m3) + golpes(m3) + m3.cerrar;
  const igualOtif = g.every((p) => p.otifActual === p.otifPropuesta);
  const sinLineas = g.filter((p) => p.lA === 0).length;

  const nota = res.variacion === 0 ? "con las ventas registradas" : `con ventas ${res.variacion > 0 ? "+" : ""}${res.variacion} %`;
  b.innerHTML = `<div class="bloque-cab"><h2>Costo, retiros y servicio por ${res.granularidad === "semana" ? "semana" : "día"}</h2>
      <p class="bloque-sub">Situación actual ${nota}. Los tres gráficos comparten el eje de fechas.</p></div>
    <div class="graficos" id="graficos">
      <figure><figcaption><b>Costo de inventario</b> en USD por período
        <span class="leyenda-g">${cats.map((k) => `<span><i style="background:${COLOR[k.id]}"></i>${esc(k.t)}</span>`).join("")}<span><i class="i-linea"></i>Propuesta en régimen (promedio por período)</span></span></figcaption>${svg1}</figure>
      <figure><figcaption><b>Retiros por ventas</b> en unidades${res.variacion ? ` (registradas × ${dec(res.f, 2)})` : ""}</figcaption>${svg2}</figure>
      <figure><figcaption><b>OTIF simulado</b> en % de líneas entregadas completas el mismo día
        <span class="leyenda-g"><span><i class="i-act"></i>Actual</span><span><i class="i-prop"></i>Propuesta</span></span>
        ${igualOtif ? `<span class="g-aviso">Las dos líneas coinciden en todos los períodos con ventas.</span>` : ""}
        ${sinLineas ? `<span class="g-aviso">${sinLineas} período(s) sin ventas: sin punto de OTIF.</span>` : ""}</figcaption>${svg3}</figure>
      <div class="g-tip" id="g-tip" hidden></div>
    </div>
    <details class="traza"><summary>Cómo se calcula</summary><ul>
      <li><b>Capital inmovilizado</b> = stock del día × costo unitario × ${dec(res.P.v("tasa_capital"), 2)} % ÷ 365, sumado por día.</li>
      <li><b>Almacenamiento</b> = stock del día × costo unitario × ${dec(res.P.v("tasa_almacenamiento"), 2)} % ÷ 365. <b>Obsolescencia</b>: igual, con ${dec(res.P.v("tasa_obsolescencia"), 2)} %.</li>
      <li><b>Órdenes de compra</b> = recepciones por orden de compra del día × ${usd(res.P.v("costo_orden"))}. En los datos, cada línea de ingreso es una orden.</li>
      <li><b>Devoluciones</b> = por cada retorno: costo por evento del motivo + cantidad × costo unitario × % de valor perdido del motivo.</li>
      <li><b>Manipulación</b> = unidades movidas × ${usd(res.P.v("costo_manipulacion"))}. <b>Quiebre</b> = unidades no entregadas × ${res.P.v("costo_quiebre") === null ? "costo faltante (no se monetiza)" : usd(res.P.v("costo_quiebre"))}.</li>
      <li><b>Propuesta en régimen</b> = costo total de la propuesta del período ÷ ${res.series.L} días × días del período (no es una trayectoria simulada día por día).</li>
      <li><b>OTIF simulado</b>: cada retiro por venta registrado es una línea de pedido para ese día. Se entrega completa si hay stock suficiente; si no, falla la línea y la diferencia se pierde (no se acumula). Actual: se repiten las recepciones, retornos y ajustes registrados. Propuesta: arranca con el stock objetivo y repone Q cuando la posición llega al punto de reorden; el pedido llega a los días del plazo de reposición.</li>
      <li>Stock del día = stock al inicio del período + movimientos registrados hasta ese día (todos los tipos). Fuente: movimientos del ${fLarga(res.series.dias[0])} al ${fLarga(res.series.dias[res.series.L - 1])}.</li>
    </ul></details>
    <details class="traza"><summary>Ver los datos en tabla</summary>
      ${tabla([{ t: "Período", html: (p) => esc(p.dias === 1 ? fLarga(p.desde) : `${fLarga(p.desde)} – ${fLarga(p.hasta)}`) },
        ...cats.map((k) => ({ t: k.t, num: true, html: (p) => usd(p.cat[k.id]) })),
        { t: "Total actual", num: true, html: (p) => `<b>${usd(p.total)}</b>` }, { t: "Propuesta (régimen)", num: true, html: (p) => usd(p.propuesta) },
        { t: "Retiros (un.)", num: true, html: (p) => dec(p.ventas, 1) }, { t: "Líneas", num: true, html: (p) => num(p.lA) },
        { t: "OTIF actual", num: true, html: (p) => pct(p.otifActual) }, { t: "OTIF propuesta", num: true, html: (p) => pct(p.otifPropuesta) }], g)}
    </details>`;

  // Hover: resalta el mismo período en los tres gráficos y muestra el detalle
  const cont = b.querySelector("#graficos"), tip = b.querySelector("#g-tip");
  const mostrar = (i, ev) => {
    const p = g[i];
    cont.querySelectorAll(".g-hl").forEach((r) => r.classList.toggle("on", r.dataset.i === String(i)));
    tip.innerHTML = `<b>${esc(p.dias === 1 ? fLarga(p.desde) : `${fLarga(p.desde)} – ${fLarga(p.hasta)}`)}</b>
      ${cats.filter((k) => p.cat[k.id] > 1e-9).map((k) => `<div><i style="background:${COLOR[k.id]}"></i>${esc(k.t)}<span>${usd(p.cat[k.id])}</span></div>`).join("")}
      <div class="tip-tot">Total actual<span>${usd(p.total)}</span></div><div>Propuesta (régimen)<span>${usd(p.propuesta)}</span></div>
      <div>Retiros<span>${dec(p.ventas, 1)} un.</span></div>
      <div>OTIF actual / propuesta<span>${pct(p.otifActual)} / ${pct(p.otifPropuesta)}</span></div>`;
    tip.hidden = false;
    const r = cont.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(r.width - tw - 4, x + 14 + tw > r.width ? x - tw - 14 : x + 14))}px`;
    tip.style.top = `${Math.max(4, y - 20)}px`;
  };
  cont.querySelectorAll(".g-hit").forEach((h) => {
    h.addEventListener("pointermove", (ev) => mostrar(Number(h.dataset.i), ev));
    h.addEventListener("pointerdown", (ev) => mostrar(Number(h.dataset.i), ev));
  });
  cont.addEventListener("pointerleave", () => { tip.hidden = true; cont.querySelectorAll(".g-hl").forEach((r) => r.classList.remove("on")); });
}

// ---------------------------------------------------------------------
// Política de stock por producto
// ---------------------------------------------------------------------
function pintarPolitica(res) {
  const P = res.P;
  const conOrigen = (valor, fila, fmt = (x) => dec(x, 2)) => `${fila.valor === null ? "—" : fmt(valor)} ${origen(fila.origen, fila.razon)}`;
  const tSS = (x) => {
    const p = x.pol;
    if (!p.calculable) return `Falta: ${p.faltan.join(", ")}`;
    if (p.sinDemanda) return "Sin ventas en el período: SS = 0";
    return p.combinada
      ? `SS = z × √(LT × σ² + d² × σLT²) = ${dec(p.z, 3)} × √(${dec(p.LT)} × ${dec(p.sigma, 2)}² + ${dec(p.dbar, 2)}² × ${dec(p.sLT)}²) = ${dec(p.ssExacto, 2)} → ${p.SS}`
      : `SS = z × σ × √LT = ${dec(p.z, 3)} × ${dec(p.sigma, 2)} × √${dec(p.LT)} = ${dec(p.ssExacto, 2)} → ${p.SS} (se redondea hacia arriba)`;
  };
  const tROP = (p) => (p.calculable && !p.sinDemanda ? `ROP = d × LT + SS = ${dec(p.dbar, 3)} × ${dec(p.LT)} + ${p.SS} = ${dec(p.ropExacto, 2)} → ${p.ROP}` : "");
  const tQ = (p) => {
    if (!p.calculable || p.sinDemanda) return "Sin demanda: no se repone.";
    const eoq = p.EOQ === null ? "EOQ no calculable (falta costo unitario o costo por orden)" : `EOQ = √(2 × D × S ÷ H) = √(2 × ${dec(p.Da, 1)} × ${dec(p.S, 2)} ÷ ${dec(p.H, 3)}) = ${dec(p.EOQ, 1)}`;
    return `${eoq}; D = d × 365; H = costo unitario × (capital + almacenamiento + obsolescencia) = ${dec(p.c, 2)} × ${dec(p.tasas, 2)} %. Q = máx(EOQ, lote mínimo ${p.lote ?? "—"}) = ${p.Q}`;
  };
  const filas = res.filas;
  const b = estadoVista.el.querySelector("#b-politica");
  b.innerHTML = `<div class="bloque-cab"><h2>Política de stock por producto</h2>
      <p class="bloque-sub">Nivel de servicio ${dec(res.ns, 1)} % (z = ${dec(zDeNS(res.ns / 100), 3)})${res.variacion ? ` · ventas ${res.variacion > 0 ? "+" : ""}${res.variacion} %` : ""}. SS = stock de seguridad, ROP = punto de reorden, Q = lote a pedir. Pasá el cursor sobre un valor para ver la cuenta.</p>
      <div class="btns"><button class="btn chico" id="csv-pol">${ICON.csv} Exportar CSV</button></div></div>
    ${tabla([
      { t: "Producto", html: (x) => `<div class="col-prod"><b>${esc(x.prod.codigo)}</b><div class="nota">${esc(x.prod.descripcion)}</div></div>` },
      { t: "Retiros", num: true, html: (x) => `<span title="Suma de los retiros por venta del período${res.variacion ? ` × ${dec(res.f, 2)}` : ""}.">${dec(x.pol.demandaTotal, 1)}</span>` },
      { t: "Demanda por día", num: true, html: (x) => `<span title="d = retiros del período ÷ ${x.pol.n} días">${dec(x.pol.dbar, 2)}</span>` },
      { t: "σ por día", num: true, html: (x) => `<span title="Desvío estándar muestral de los retiros diarios (n = ${x.pol.n}, incluye días sin venta)">${dec(x.pol.sigma, 2)}</span>` },
      { t: "Confianza", html: (x) => x.pol.sinDemanda ? `<span class="conf conf-nd">Sin ventas</span>`
          : x.pol.bajaConfianza ? `<span class="conf conf-baja" title="${esc(x.pol.motivosConf.join(" y "))}">Baja</span><div class="nota">${x.pol.diasVenta} de ${x.pol.n} días con venta</div>`
          : `<span class="conf conf-ok">Aceptable</span><div class="nota">${x.pol.diasVenta} de ${x.pol.n} días con venta</div>` },
      { t: "Plazo, días", num: true, html: (x) => conOrigen(x.pol.LT, P.leer("lead_time", x.prod.codigo), (v) => dec(v, 1)) },
      { t: "SS", num: true, html: (x) => `<span class="calc ${depSup(x, P)}" title="${esc(tSS(x))}">${x.pol.SS ?? "—"}</span>` },
      { t: "ROP", num: true, html: (x) => `<span class="calc" title="${esc(tROP(x.pol))}">${x.pol.ROP ?? "—"}</span>` },
      { t: "Lote Q", num: true, html: (x) => `<span class="calc dep-sup" title="${esc(tQ(x.pol))}">${x.pol.calculable ? x.pol.Q : "—"}</span>` },
      { t: "Objetivo SS + Q", num: true, html: (x) => `<b class="calc dep-sup" title="Stock máximo de la política: SS + Q = ${x.pol.SS ?? "—"} + ${x.pol.Q}. Promedio esperado: SS + Q ÷ 2 = ${dec(x.pol.promedio, 1)}">${x.pol.objetivo ?? "—"}</b>` },
      { t: "Stock al cierre", num: true, html: (x) => `<span title="Stock registrado al ${fLarga(res.series.dias[res.series.L - 1])}${res.variacion ? " con la variación de ventas aplicada" : ""}">${num(x.stockFin)}</span>` },
      { t: "Cobertura, días", num: true, html: (x) => x.cobertura === null ? `<span title="Sin ventas: cobertura indefinida">—</span>` : `<span title="Cobertura = stock al cierre ÷ d = ${num(x.stockFin)} ÷ ${dec(x.pol.dbar, 2)}">${dec(x.cobertura, 1)}</span>` },
      { t: "Riesgo de quiebre", html: (x) => `<span class="riesgo r-${x.riesgo.nivel}" title="${esc(x.riesgo.detalle)}">${esc(x.riesgo.t)}</span>${x.reponer ? `<div class="nota">Stock al cierre ≤ punto de reorden: corresponde pedir.</div>` : ""}` },
    ], filas)}
    <details class="traza"><summary>Cómo se calcula</summary><ul>
      <li><b>d y σ</b>: demanda diaria promedio y desvío estándar muestral de los retiros por venta de cada día del período (${res.series.L} días), incluidos los días sin venta. Baja confianza si hay menos de ${dec(P.v("min_periodos_confianza"), 0)} períodos ${origen(P.leer("min_periodos_confianza").origen)} o menos de ${dec(P.v("min_dias_venta_confianza"), 0)} días con venta ${origen(P.leer("min_dias_venta_confianza").origen, P.leer("min_dias_venta_confianza").razon)}.</li>
      <li><b>Stock de seguridad</b>: SS = z × σ × √LT. Si se carga el desvío del plazo (σLT), se usa SS = z × √(LT × σ² + d² × σLT²). Se redondea hacia arriba.</li>
      <li><b>Punto de reorden</b>: ROP = d × LT + SS.</li>
      <li><b>Lote Q</b>: el mayor entre el lote económico EOQ = √(2 × D × S ÷ H) y el lote mínimo. D = demanda anual (d × 365), S = costo por orden, H = costo anual de mantener una unidad.</li>
      <li><b>Riesgo de quiebre</b>: «Alto» si en la simulación del período la política propuesta dejó unidades sin entregar; «Sin quiebre, baja confianza» si entregó todo pero σ es poco confiable; «Bajo» si entregó todo con σ confiable. La probabilidad teórica de quiebre por ciclo es 1 − nivel de servicio.</li>
      <li>Los valores con subrayado punteado dependen de al menos un supuesto.</li>
    </ul></details>`;
  b.querySelector("#csv-pol").addEventListener("click", () => descargarCSV(`politica_stock_${res.series.dias[0]}_${res.series.dias[res.series.L - 1]}.csv`, filas, [
    { t: "Producto", f: (x) => x.prod.codigo }, { t: "Descripcion", f: (x) => x.prod.descripcion },
    { t: "RetirosPeriodo", f: (x) => dec(x.pol.demandaTotal, 2) }, { t: "DemandaDiaria", f: (x) => dec(x.pol.dbar, 4) }, { t: "Desvio", f: (x) => dec(x.pol.sigma, 4) },
    { t: "Periodos", f: (x) => x.pol.n }, { t: "DiasConVenta", f: (x) => x.pol.diasVenta }, { t: "BajaConfianza", f: (x) => (x.pol.bajaConfianza ? "Si" : "No") },
    { t: "PlazoDias", f: (x) => x.pol.LT }, { t: "OrigenPlazo", f: (x) => P.leer("lead_time", x.prod.codigo).origen }, { t: "NivelServicio", f: () => res.ns },
    { t: "z", f: (x) => dec(x.pol.z, 4) }, { t: "StockSeguridad", f: (x) => x.pol.SS }, { t: "PuntoReorden", f: (x) => x.pol.ROP },
    { t: "EOQ", f: (x) => dec(x.pol.EOQ, 2) }, { t: "LoteQ", f: (x) => x.pol.Q }, { t: "StockObjetivo", f: (x) => x.pol.objetivo },
    { t: "StockCierre", f: (x) => x.stockFin }, { t: "CoberturaDias", f: (x) => dec(x.cobertura, 2) }, { t: "Riesgo", f: (x) => x.riesgo.t },
    { t: "CostoActualUSD", f: (x) => dec(x.actual.tot.total, 2) }, { t: "CostoPropuestaUSD", f: (x) => dec(x.prop.total, 2) },
    { t: "VariacionVentasPct", f: () => res.variacion }, { t: "Desde", f: () => res.series.dias[0] }, { t: "Hasta", f: () => res.series.dias[res.series.L - 1] }]));
}

function depSup(x, P) {
  const o = ["lead_time", "desvio_lead_time"].map((k) => P.leer(k, x.prod.codigo).origen);
  return o.includes("supuesto") || P.leer("nivel_servicio").origen === "supuesto" ? "dep-sup" : "";
}

// ---------------------------------------------------------------------
// Modelo de costos por producto
// ---------------------------------------------------------------------
function pintarCostos(res) {
  const P = res.P;
  const usadas = CATEGORIAS.filter((k) => res.tot.actual[k.id] > 1e-9 || res.tot.propuesta[k.id] > 1e-9);
  const ceros = CATEGORIAS.filter((k) => !usadas.includes(k));
  const motivoCero = {
    manipulacion: () => `${usd(P.v("costo_manipulacion"))} por unidad ${origen(P.leer("costo_manipulacion").origen, P.leer("costo_manipulacion").razon)}`,
    obsolescencia: () => `${dec(P.v("tasa_obsolescencia"), 2)} % anual ${origen(P.leer("tasa_obsolescencia").origen, P.leer("tasa_obsolescencia").razon)}`,
    quiebre: () => P.v("costo_quiebre") === null ? `no se monetiza ${origen("faltante", P.leer("costo_quiebre").razon)}; se mide en unidades y OTIF` : "sin unidades no entregadas",
    devoluciones: () => "sin retornos en el período", orden: () => "sin recepciones en el período",
    capital: () => "sin stock valorizado", almacenamiento: () => "sin stock valorizado",
  };
  const cu = (x) => P.leer("costo_unitario", x.prod.codigo);
  const b = estadoVista.el.querySelector("#b-costos");
  b.innerHTML = `<div class="bloque-cab"><h2>Costo de inventario por producto</h2>
      <p class="bloque-sub">Período de ${res.series.L} días, en USD. Situación actual${res.variacion ? ` con ventas ${res.variacion > 0 ? "+" : ""}${res.variacion} %` : " registrada"} contra la política propuesta en régimen.</p></div>
    ${tabla([
      { t: "Producto", html: (x) => `<b>${esc(x.prod.codigo)}</b>` },
      { t: "Costo unitario", num: true, html: (x) => `${usd(cu(x).valor)} ${origen(cu(x).origen, cu(x).razon)}` },
      { t: "Inventario promedio", num: true, html: (x) => `<span title="Promedio de (stock del día × costo unitario) en ${res.series.L} días = ${dec(x.actual.stockPromedio, 1)} un. promedio">${usd(x.actual.valorPromedio)}</span>` },
      ...usadas.map((k) => ({ t: k.t, num: true, html: (x) => `<span class="${x.actual.tot[k.id] && cu(x).origen === "supuesto" && ["capital", "almacenamiento", "obsolescencia", "devoluciones"].includes(k.id) ? "dep-sup" : ""}">${usd(x.actual.tot[k.id])}</span>` })),
      { t: "Total actual", num: true, html: (x) => `<b>${usd(x.actual.tot.total)}</b>` },
      { t: "Total propuesta", num: true, html: (x) => `<b class="dep-sup" title="Capital y almacenamiento: (SS + Q ÷ 2) × costo unitario × tasa × ${res.series.L} ÷ 365 · Órdenes: retiros ÷ Q × costo por orden · Devoluciones y manipulación: iguales a la situación actual">${x.pol.calculable ? usd(x.prop.total) : "—"}</b>` },
      { t: "Diferencia", num: true, html: (x) => { const d = x.prop.total - x.actual.tot.total; return x.pol.calculable ? `<span class="${d < -0.005 ? "mejor" : d > 0.005 ? "peor" : ""}">${d > 0 ? "+" : d < 0 ? "−" : ""}${usd(Math.abs(d))}</span>` : "—"; } },
    ], res.filas)}
    <div class="categorias-cero">
      <p><b>Categorías sin costo en este período:</b></p>
      <ul>${ceros.map((k) => `<li>${esc(k.t)}: ${motivoCero[k.id]()}</li>`).join("")}
        <li>Scrap y retrabajo: no aplican (no hay procesos ni registros de scrap o retrabajo en el depósito).</li></ul>
    </div>
    <details class="traza"><summary>Cómo se calcula</summary><ul>
      <li><b>Actual</b>: suma diaria de cada categoría sobre el stock registrado (ver «Cómo se calcula» de los gráficos).</li>
      <li><b>Propuesta</b>: capital = (SS + Q ÷ 2) × costo unitario × ${dec(P.v("tasa_capital"), 2)} % × ${res.series.L} ÷ 365; almacenamiento y obsolescencia igual con su tasa; órdenes = retiros del período ÷ Q × ${usd(P.v("costo_orden"))}; devoluciones y manipulación iguales a la situación actual (no dependen de la política de stock); quiebre = unidades no entregadas × costo de quiebre, solo si está cargado.</li>
      <li>El costo unitario se supone igual al costo de reposición.</li>
    </ul></details>`;
}

// ---------------------------------------------------------------------
// Sensibilidad a aumentos de ventas
// ---------------------------------------------------------------------
function pintarSensibilidad(res) {
  const b = estadoVista.el.querySelector("#b-sensib");
  b.innerHTML = `<div class="bloque-cab"><h2>Si las ventas aumentan</h2>
      <p class="bloque-sub">Misma historia con cada retiro multiplicado por la variación. La política propuesta se recalcula con la demanda nueva; la actual repite sus recepciones registradas. Nivel de servicio ${dec(res.ns, 1)} %.</p></div>
    ${tabla([
      { t: "Ventas", html: (s) => `<b>${s.variacion === 0 ? "Registradas" : `+${s.variacion} %`}</b>` },
      { t: "Costo actual", num: true, html: (s) => usd(s.costoActual) },
      { t: "Costo propuesta", num: true, html: (s) => usd(s.costoPropuesta) },
      { t: "Diferencia", num: true, html: (s) => { const d = s.costoPropuesta - s.costoActual; return `<span class="${d < 0 ? "mejor" : d > 0 ? "peor" : ""}">${d > 0 ? "+" : d < 0 ? "−" : ""}${usd(Math.abs(d))}</span>`; } },
      { t: "OTIF actual", num: true, html: (s) => pct(s.otifActual) },
      { t: "OTIF propuesta", num: true, html: (s) => `<span class="${s.otifPropuesta < s.otifActual ? "peor" : ""}">${pct(s.otifPropuesta)}</span>` },
      { t: "No entregadas (actual / propuesta)", num: true, html: (s) => `${num(s.faltaActual)} / <span class="${s.faltaPropuesta > 0 ? "peor" : ""}">${num(s.faltaPropuesta)}</span>` },
    ], res.sensibilidad, { claseFila: (s) => (s.variacion === res.variacion ? "fila-actual" : "") })}`;
}

// ---------------------------------------------------------------------
// Devoluciones del período (motivo)
// ---------------------------------------------------------------------
function pintarDevoluciones(res) {
  const P = res.P;
  const lista = res.series.productos.flatMap((p) => p.retornos.map((r) => ({ ...r, producto: p.codigo })));
  const costo = (r) => { const c = P.v("costo_unitario", r.producto); return (P.v(`dev_evento_${r.motivo}`) || 0) + (c === null ? 0 : r.cantidad * c * (P.v(`dev_perdida_${r.motivo}`) || 0) / 100); };
  const editable = puede("supervisor");
  const b = estadoVista.el.querySelector("#b-devol");
  b.innerHTML = `<div class="bloque-cab"><h2>Devoluciones del período</h2>
      <p class="bloque-sub">El motivo define el costo de cada devolución. Si no se cargó, se usa el supuesto «${esc(MOTIVOS.cancelacion_pago)}».</p></div>
    ${tabla([
      { t: "Fecha", html: (r) => fLarga(r.fecha) },
      { t: "Movimiento", html: (r) => `<span class="mono small">${esc(r.id_publico)}</span><div class="nota">${esc(r.documento || "")}</div>` },
      { t: "Producto", html: (r) => `${esc(r.producto)}<div class="nota">${esc(r.posicion || "")} · ${esc(r.lote || "")}</div>` },
      { t: "Cantidad", num: true, html: (r) => num(r.cantidad) },
      { t: "Motivo", html: (r) => `${esc(MOTIVOS[r.motivo] || r.motivo)} ${r.motivoSupuesto ? origen("supuesto", "Retorno sin motivo cargado: se supone cancelación de la compra por imposibilidad de pago.") : origen("usuario", `Cargado por ${r.motivo_por || "un usuario"}`)}${r.motivo_obs ? `<div class="nota">${esc(r.motivo_obs)}</div>` : ""}` },
      { t: "Costo", num: true, html: (r) => `<span class="dep-sup" title="Costo por evento ${usd(P.v(`dev_evento_${r.motivo}`))} + ${r.cantidad} un. × ${usd(P.v("costo_unitario", r.producto))} × ${dec(P.v(`dev_perdida_${r.motivo}`), 1)} % perdido">${usd(costo(r))}</span>` },
      ...(editable ? [{ t: "", html: (r) => `<button class="btn chico" data-motivo="${r.id}">Cambiar motivo</button>` }] : []),
    ], lista, { vacio: "No hay retornos de venta en el período." })}`;
  b.querySelectorAll("[data-motivo]").forEach((btn) => btn.addEventListener("click", async () => {
    const r = lista.find((x) => String(x.id) === btn.dataset.motivo);
    const d = await pedir({ titulo: `Motivo de ${r.id_publico}`, texto: `${esc(r.producto)} · ${num(r.cantidad)} un. · ${fLarga(r.fecha)}`,
      campos: [{ id: "motivo", etiqueta: "Motivo", tipo: "select", valor: r.motivo, opciones: Object.entries(MOTIVOS).map(([v, t]) => ({ v, t })) },
        { id: "obs", etiqueta: "Detalle (obligatorio si es «Otro motivo»)", valor: r.motivo_obs || "" }], confirmar: "Guardar motivo" });
    if (!d) return;
    try { await rpc("clasificar_retorno", { p_movimiento_id: r.id, p_motivo: d.motivo, p_observacion: d.obs || null }); toast("Motivo guardado"); await cargar(); }
    catch (e) { estadoVista.el.querySelector("#msg").innerHTML = aviso("error", esc(e.message)); window.scrollTo(0, 0); }
  }));
}

// ---------------------------------------------------------------------
// Parámetros y supuestos
// ---------------------------------------------------------------------
const GRUPOS = { financiero: "Financieros", operativo: "Operativos", calidad: "Calidad", quiebre: "Quiebre", servicio: "Servicio", confianza: "Confianza estadística", abastecimiento: "Abastecimiento" };

function pintarParametros(res) {
  const P = res.P, admin = puede("administrador");
  const globales = Object.values(P.g).sort((a, b) => a.orden - b.orden);
  const porCat = {};
  for (const x of globales) (porCat[x.categoria] ||= []).push(x);
  const defsProd = Object.values(P.defs).filter((d) => d.ambito === "producto").sort((a, b) => a.orden - b.orden);
  const valor = (x) => (x.valor === null ? `<span class="falta-valor">sin dato</span>` : `<b>${String(x.unidad).startsWith("USD") ? usd(x.valor).replace(/^USD\s/, "") : dec(x.valor, 2)}</b>`);
  const conteo = { supuesto: 0, faltante: 0, usuario: 0 };
  for (const x of globales) conteo[x.origen]++;
  for (const p of res.series.productos) for (const d of defsProd) conteo[P.leer(d.clave, p.codigo).origen]++;
  const b = estadoVista.el.querySelector("#b-param");
  b.innerHTML = `<div class="bloque-cab"><h2>Parámetros y supuestos</h2>
      <p class="bloque-sub">${conteo.supuesto} supuestos · ${conteo.faltante} faltantes · ${conteo.usuario} cargados por usuario. ${admin ? "Tocá «Editar» para cambiar un valor; el cambio queda en la auditoría." : "Solo un administrador puede editarlos."}</p>
      <div class="leyenda-org">${origen("real")} ${origen("usuario")} ${origen("supuesto")} ${origen("faltante")}</div></div>
    <div class="param-grupos">
    ${Object.entries(porCat).map(([cat, xs]) => `<div class="param-grupo"><h3>${esc(GRUPOS[cat] || cat)}</h3>
      <ul class="param-lista">${xs.map((x) => `<li class="param o-${x.origen}">
        <div class="param-cab"><span class="param-nombre">${esc(x.etiqueta)}</span>${origen(x.origen, x.razon)}</div>
        <div class="param-valor">${valor(x)} <span class="unidad">${esc(x.unidad)}</span>${admin ? ` <button class="btn chico" data-p="${esc(x.clave)}" data-prod="">Editar</button>` : ""}</div>
        <p class="param-razon">${esc(x.razon)}</p>
        <p class="param-desc">${esc(x.descripcion)}${x.actualizado_por && x.actualizado_por !== "carga inicial" ? ` Último cambio: ${esc(x.actualizado_por)}, ${fechaHora(x.actualizado_en)}.` : ""}</p></li>`).join("")}</ul></div>`).join("")}
    </div>
    <h3 class="param-prod-titulo">Por producto</h3>
    ${tabla([{ t: "Producto", html: (p) => `<b>${esc(p.codigo)}</b><div class="nota">${esc(p.descripcion)}</div>` },
      ...defsProd.map((d) => ({ t: `${d.etiqueta}, ${d.unidad}`, html: (p) => { const x = P.leer(d.clave, p.codigo);
        return `<div class="celda-param o-${x.origen}" title="${esc(x.razon)}">${valor(x)} ${origen(x.origen, x.razon)}${admin ? `<button class="btn chico" data-p="${esc(d.clave)}" data-prod="${esc(p.codigo)}" aria-label="Editar ${esc(d.etiqueta)} de ${esc(p.codigo)}">Editar</button>` : ""}</div>`; } }))],
      res.series.productos)}
    <p class="small muted">No hay montos en pesos en los datos cargados: todos los valores están en USD y no se usa tipo de cambio.</p>`;
  b.querySelectorAll("[data-p]").forEach((btn) => btn.addEventListener("click", () => editarParametro(btn.dataset.p, btn.dataset.prod)));
}

async function editarParametro(clave, prod) {
  const P = estadoVista.res.P, x = P.leer(clave, prod || undefined);
  const d = await pedir({
    titulo: `${x.etiqueta}${prod ? ` · ${prod}` : ""}`,
    texto: `${esc(x.descripcion)} Rango: ${x.minimo ?? "—"} a ${x.maximo ?? "—"} ${esc(x.unidad)}. Dejá el valor vacío si no hay dato (queda como faltante).`,
    campos: [
      { id: "valor", etiqueta: `Valor (${x.unidad})`, tipo: "number", valor: x.valor ?? "" },
      { id: "origen", etiqueta: "Origen del valor", tipo: "select", valor: x.origen === "faltante" ? "usuario" : x.origen, opciones: [{ v: "usuario", t: "Cargado por usuario (dato de la empresa)" }, { v: "supuesto", t: "Supuesto (estimación a falta de dato)" }] },
      { id: "razon", etiqueta: "Razón o fuente", tipo: "textarea", valor: x.razon, requerido: true },
    ], confirmar: "Guardar parámetro" });
  if (!d) return;
  const v = String(d.valor).trim() === "" ? null : Number(String(d.valor).replace(",", "."));
  if (v !== null && !Number.isFinite(v)) { toast("El valor debe ser un número"); return; }
  try {
    await rpc("admin_guardar_parametro", { p_clave: clave, p_producto: prod || "", p_valor: v, p_origen: v === null ? "faltante" : d.origen, p_razon: d.razon });
    toast("Parámetro guardado"); await cargar();
  } catch (e) { estadoVista.el.querySelector("#msg").innerHTML = aviso("error", esc(e.message)); window.scrollTo(0, 0); }
}

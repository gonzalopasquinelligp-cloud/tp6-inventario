// Costo y servicio: tablero para decidir si se puede bajar el costo del inventario sin perder nivel de servicio.
// Los datos vienen del servidor (analisis_datos); los cálculos están en modelo.js con sus fórmulas a la vista.
import { rpc, puede } from "./api.js?v=202610241513";
import { esc, num, aviso, ICON, tabla, pedir, toast, descargarCSV, usd, dec, pct, origen, fechaHora } from "./ui.js?v=202610241513";
import { analizar, zDeNS, CATEGORIAS, MOTIVOS } from "./modelo.js?v=202610241513";

const fCorta = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const fLarga = (iso) => iso.split("-").reverse().join("/");
const usd0 = (v) => (v === null || v === undefined ? "—" : `USD ${Math.round(v).toLocaleString("es-AR")}`);
const signoVar = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} %`;

let estadoVista = null;
let alRedimensionar = null;

export function destruir() { if (alRedimensionar) window.removeEventListener("resize", alRedimensionar); alRedimensionar = null; }

export async function render(el, { params }) {
  estadoVista = { el, datos: null, variacion: 0, ns: null, gran: "dia", desde: params[0] || null, hasta: params[1] || null, sel: null };
  el.innerHTML = `<div class="cs">
    <section class="cs-ctrl" aria-label="Período y escenario">
      <button class="cs-resumen" type="button" id="cs-abrir" aria-expanded="false" aria-controls="cs-panel">
        <span id="cs-resumen-txt">Cargando período…</span><span class="cs-cambiar">Cambiar</span></button>
      <div class="cs-panel" id="cs-panel">
        <form id="f-periodo" class="cs-grupo">
          <span class="cs-grupo-t">Período</span>
          <div class="cs-campo"><label for="p-desde">Desde</label><input id="p-desde" type="date" required></div>
          <div class="cs-campo"><label for="p-hasta">Hasta</label><input id="p-hasta" type="date" required></div>
          <div class="cs-campo"><label for="p-gran">Ver por</label><select id="p-gran"><option value="dia">Día</option><option value="semana">Semana</option></select></div>
          <button class="btn" type="submit">Ver período</button>
        </form>
        <form class="cs-grupo simulador" id="simulador" aria-label="Probar un escenario">
          <span class="cs-grupo-t">Escenario de prueba<small>No cambia los datos guardados</small></span>
          <div class="cs-campo sim-campo"><label for="s-var">Variación de ventas</label>
            <div class="sim-fila"><input id="s-var-r" type="range" min="-50" max="100" step="5" aria-label="Variación de ventas, deslizador">
            <span class="sim-num"><input id="s-var" type="number" min="-90" max="300" step="1" inputmode="numeric"> %</span></div></div>
          <div class="cs-campo sim-campo"><label for="s-ns">Nivel de servicio buscado</label>
            <div class="sim-fila"><input id="s-ns-r" type="range" min="80" max="99.9" step="0.1" aria-label="Nivel de servicio, deslizador">
            <span class="sim-num"><input id="s-ns" type="number" min="50" max="99.9" step="0.1" inputmode="decimal"> %</span></div>
            <div class="ayuda" id="s-z"></div></div>
          <button class="btn" type="button" id="s-reset">Volver a lo guardado</button>
        </form>
      </div>
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
  el.querySelector("#cs-abrir").addEventListener("click", (e) => {
    const abierto = e.currentTarget.getAttribute("aria-expanded") === "true";
    e.currentTarget.setAttribute("aria-expanded", String(!abierto));
    el.querySelector(".cs-ctrl").classList.toggle("abierto", !abierto);
  });
  conectarSimulador();
  let t;
  destruir();
  alRedimensionar = () => { clearTimeout(t); t = setTimeout(() => estadoVista?.res && pintarGrafico(estadoVista.res), 200); };
  window.addEventListener("resize", alRedimensionar);
  await cargar();
}

function conectarSimulador() {
  const s = estadoVista, el = s.el;
  const v = el.querySelector("#s-var"), vr = el.querySelector("#s-var-r"), n = el.querySelector("#s-ns"), nr = el.querySelector("#s-ns-r");
  let t;
  const aplicar = () => { clearTimeout(t); t = setTimeout(() => s.datos && pintar(), 120); };
  const leerVar = (x) => { const k = Number(x); if (Number.isFinite(k) && k >= -90 && k <= 300) { s.variacion = k; aplicar(); } };
  const leerNs = (x) => { const k = Number(x); if (Number.isFinite(k) && k >= 50 && k <= 99.9) { s.ns = k; aplicar(); } };
  vr.addEventListener("input", () => { v.value = vr.value; leerVar(vr.value); });
  v.addEventListener("input", () => { vr.value = v.value; leerVar(v.value); });
  nr.addEventListener("input", () => { n.value = nr.value; leerNs(nr.value); });
  n.addEventListener("input", () => { nr.value = n.value; leerNs(n.value); });
  el.querySelector("#simulador").addEventListener("submit", (e) => e.preventDefault());
  el.querySelector("#s-reset").addEventListener("click", () => {
    s.variacion = 0; s.ns = Number(s.datos?.parametros.find((p) => p.clave === "nivel_servicio")?.valor ?? 95);
    v.value = vr.value = s.variacion; n.value = nr.value = s.ns; if (s.datos) pintar();
  });
}

async function cargar() {
  const s = estadoVista, el = s.el;
  el.querySelector("#msg").innerHTML = "";
  try {
    s.datos = await rpc("analisis_datos", { p_desde: s.desde || null, p_hasta: s.hasta || null });
  } catch (e) {
    el.querySelector("#msg").innerHTML = aviso("error", `No se pudieron leer los datos del período: ${esc(e.message)}. Revisá las fechas y tocá «Ver período».`);
    if (!s.datos) el.querySelector("#cuerpo").innerHTML = "";
    return;
  }
  const d = s.datos;
  s.desde = d.desde; s.hasta = d.hasta;
  for (const id of ["p-desde", "p-hasta"]) { const inp = el.querySelector("#" + id); inp.min = d.fecha_min_datos; inp.max = d.fecha_max_datos; }
  el.querySelector("#p-desde").value = d.desde; el.querySelector("#p-hasta").value = d.hasta;
  el.querySelector("#p-gran").value = s.gran;
  if (s.ns === null) s.ns = Number(d.parametros.find((p) => p.clave === "nivel_servicio")?.valor ?? 95);
  el.querySelector("#s-var").value = el.querySelector("#s-var-r").value = s.variacion;
  el.querySelector("#s-ns").value = el.querySelector("#s-ns-r").value = s.ns;
  armarCuerpo();
  pintar();
}

function armarCuerpo() {
  estadoVista.el.querySelector("#cuerpo").innerHTML = `
    <section class="respuesta" id="respuesta" aria-live="polite"></section>
    <section class="bloque" id="b-grafico"></section>
    <section class="bloque" id="b-servicio"></section>
    <div class="dos-col">
      <section class="bloque" id="b-acciones"></section>
      <section class="bloque" id="b-categorias"></section>
    </div>
    <details class="seccion"><summary>Cálculo por producto: stock de seguridad, punto de pedido y lote</summary><div id="b-politica"></div></details>
    <details class="seccion"><summary>Costo por producto</summary><div id="b-costos"></div></details>
    <details class="seccion"><summary>Qué pasa si las ventas aumentan</summary><div id="b-sensib"></div></details>
    <details class="seccion"><summary>Devoluciones del período</summary><div id="b-devol"></div></details>
    <details class="seccion"><summary>Parámetros y supuestos (costos, plazos, lotes)</summary><div id="b-param"></div></details>
    <details class="seccion" id="sec-limites"><summary>Límites del resultado y cómo se calcula</summary><div id="b-limites"></div></details>`;
}

function pintar() {
  const s = estadoVista, el = s.el;
  let res;
  try { res = analizar(s.datos, { variacion: s.variacion, ns: s.ns, granularidad: s.gran }); }
  catch (e) { el.querySelector("#msg").innerHTML = aviso("error", `No se pudo calcular: ${esc(e.message)}`); return; }
  s.res = res;
  const nsParam = res.P.leer("nivel_servicio");
  el.querySelector("#s-z").innerHTML = s.ns === nsParam.valor ? `z = ${dec(zDeNS(s.ns / 100), 3)} ${origen(nsParam.origen, nsParam.razon)}`
    : `z = ${dec(zDeNS(s.ns / 100), 3)} <span class="org org-sim" title="Valor de prueba: no se guarda.">Prueba</span>`;
  el.querySelector("#cs-resumen-txt").innerHTML = `<b>${fCorta(res.series.dias[0])}–${fCorta(res.series.dias[res.series.L - 1])}</b>`
    + ` · ventas ${signoVar(res.variacion)} · servicio ${dec(res.ns, 1)} %`;
  pintarRespuesta(res);
  pintarGrafico(res);
  pintarServicio(res);
  pintarCategorias(res);
  pintarAcciones(res);
  pintarPolitica(res);
  pintarCostos(res);
  pintarSensibilidad(res);
  pintarDevoluciones(res);
  pintarParametros(res);
  pintarLimites(res);
}

// ---------------------------------------------------------------------
// Respuesta: veredicto y tres números (costo, entregas, faltantes)
// ---------------------------------------------------------------------
function pintarRespuesta(res) {
  const c = res.conclusion, t = res.tot, P = res.P;
  const titulo = c.tono === "si" ? "Sí, se puede" : c.veredicto.startsWith("No sin") ? "No sin perder servicio" : "No conviene";
  const baja = res.filas.filter((x) => x.pol.bajaConfianza && !x.pol.sinDemanda).length;
  const conVentas = res.filas.filter((x) => !x.pol.sinDemanda).length;
  const prueba = res.variacion !== 0 || res.ns !== P.v("nivel_servicio");
  const periodo = `${fLarga(res.series.dias[0])} al ${fLarga(res.series.dias[res.series.L - 1])} (${res.series.L} días)`;
  const delta = (a, b, mejorMenor, fmt) => {
    if (a === null || b === null) return "";
    const d = b - a;
    if (Math.abs(d) < 1e-9) return `<span class="fig-delta">sin cambio</span>`;
    const p = a ? ` (${d > 0 ? "+" : "−"}${dec(Math.abs(d / a) * 100, 0)} %)` : "";
    return `<span class="fig-delta ${(d < 0) === mejorMenor ? "mejor" : "peor"}">${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}${p}</span>`;
  };
  const figura = (serie, etiqueta, valor, hoy, dlt, formula) => `<div class="fig" tabindex="0" title="${esc(formula)}">
      <div class="fig-t">${etiqueta}</div>
      <div class="fig-v">${valor}</div>
      <div class="fig-c">Hoy ${hoy} ${dlt}</div>
      <div class="fig-f">${esc(formula)}</div></div>`;
  // Las conclusiones que más ayudan a decidir: qué explica la diferencia, qué pasa con el stock,
  // si depende del supuesto de costo por orden y cuánto margen hay ante más ventas.
  const d = c.detalle, porque = [...new Set([d[0], d[1], d[2], d[d.length - 1]].filter(Boolean))];
  const m = res.nsMinimoCompleto;
  porque.push(m ? `El nivel de servicio más bajo que entrega el 100 % en la simulación es ${dec(m.ns, 1)} %, con un costo de ${usd(m.costoPropuesta)}. Ver «Nivel de servicio».`
    : "Ningún nivel de servicio hasta 99,9 % entrega el 100 % en la simulación. Ver «Nivel de servicio».");
  estadoVista.el.querySelector("#respuesta").innerHTML = `
    <p class="resp-pregunta">¿Se puede bajar el costo del inventario sin dejar de entregar?</p>
    <div class="ver-frase tono-${c.tono}">
      <span class="resp-titulo">${titulo}</span>
      <span class="resp-texto">${esc(c.veredicto.replace(/^(Sí|No sin perder servicio|No)\.\s*/, ""))}</span>
    </div>
    ${prueba ? `<p class="resp-escenario"><span class="org org-sim">Prueba</span> Escenario de prueba: ventas ${signoVar(res.variacion)}, nivel de servicio ${dec(res.ns, 1)} %. No se guarda.</p>` : ""}
    <div class="figuras" id="kpis" aria-label="Propuesta contra hoy">
      ${figura("prop", `Costo del inventario en ${res.series.L} días`, usd0(t.propuesta.total), usd0(t.actual.total), delta(t.actual.total, t.propuesta.total, true, usd0),
        `Capital + almacenamiento + órdenes de compra + devoluciones, ${periodo}. Propuesta en régimen: stock promedio SS + Q ÷ 2.`)}
      ${figura("prop", "Entregas que se cumplen (OTIF)", pct(t.otifPropuesta), pct(t.otifActual), delta(t.otifActual, t.otifPropuesta, false, (x) => pct(x)),
        `Líneas de venta entregadas completas ÷ ${t.lineas} líneas del período. Simulado: cada retiro por venta es un pedido de ese día.`)}
      ${figura("prop", "Unidades que faltarían", `${num(t.faltaPropuesta)} un.`, `${num(t.faltaActual)} un.`, delta(t.faltaActual, t.faltaPropuesta, true, (x) => `${num(x)} un.`),
        "Unidades pedidas que no se habrían podido entregar por falta de stock, en la simulación del período.")}
    </div>
    <div class="resp-pie">
      <div><h3>Por qué</h3><ul class="resp-porque">${porque.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      ${baja ? `<p class="resp-aviso"><span class="conf conf-baja">Baja confianza</span> ${baja} de ${conVentas} productos vendieron pocos días: tomá el resultado como orientativo. <a href="#sec-limites" id="ir-limites">Ver límites del resultado</a></p>` : ""}
    </div>`;
  estadoVista.el.querySelector("#ir-limites")?.addEventListener("click", (e) => {
    e.preventDefault(); const sec = estadoVista.el.querySelector("#sec-limites"); sec.open = true; sec.scrollIntoView({ block: "start" });
  });
}

// ---------------------------------------------------------------------
// Gráfico: ventas, entregas y costo en tres paneles con las mismas fechas
// ---------------------------------------------------------------------
function escalaNice(max) {
  if (!(max > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= max) return m * exp;
  return 10 * exp;
}
const compacto = (v) => (Math.abs(v) >= 1000 ? `${dec(v / 1000, 1)} k` : dec(v, 0));
function columna(x, y, w, h) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Series acumuladas por período: costo (USD) y entregas cumplidas (%), hoy y propuesta.
function acumulados(g) {
  let cA = 0, cP = 0, lA = 0, okA = 0, lP = 0, okP = 0;
  return g.map((p) => {
    cA += p.total; cP += p.propuesta; lA += p.lA; okA += p.okA; lP += p.lP; okP += p.okP;
    return { cA, cP, oA: lA ? okA / lA : null, oP: lP ? okP / lP : null, lA, okA, lP, okP };
  });
}

function pintarGrafico(res) {
  const g = res.periodos, n = g.length, ac = acumulados(g);
  const b = estadoVista.el.querySelector("#b-grafico");
  const movil = (b.clientWidth || 760) < 560;
  const W = Math.max(300, Math.min(1100, (b.clientWidth || 760) - (movil ? 28 : 40)));
  const pl = movil ? 34 : 48, pr = movil ? 84 : 132, ancho = W - pl - pr, banda = ancho / n;
  const X = (i) => pl + banda * i, Xc = (i) => X(i) + banda / 2;
  const wCol = Math.max(3, Math.min(24, banda * 0.55));
  // Tres paneles con su propia escala (nunca dos ejes en el mismo panel)
  const p1 = { y: 26, h: movil ? 70 : 80 }, p2 = { y: p1.y + p1.h + 50, h: movil ? 70 : 80 }, p3 = { y: p2.y + p2.h + 50, h: movil ? 96 : 110 };
  const H = p3.y + p3.h + 26;
  const mV = escalaNice(Math.max(...g.map((p) => p.ventas)));
  const otifs = ac.flatMap((a) => [a.oA, a.oP]).filter((x) => x !== null);
  const oMin = Math.min(0.9, Math.floor(Math.min(...otifs, 1) * 10) / 10);
  const mC = escalaNice(Math.max(ac[n - 1].cA, ac[n - 1].cP));
  const YV = (v) => p1.y + p1.h - (v / mV) * p1.h;
  const YO = (v) => p2.y + p2.h - ((v - oMin) / (1 - oMin)) * p2.h;
  const YC = (v) => p3.y + p3.h - (v / mC) * p3.h;
  const linea = (val, Y) => { let d = "", abierto = false; ac.forEach((a, i) => { const v = val(a); if (v === null) { abierto = false; return; } d += `${abierto ? "L" : "M"}${Xc(i)},${Y(v)}`; abierto = true; }); return d; };
  const grid = (Y, v, txt) => `<line x1="${pl}" x2="${W - pr + 8}" y1="${Y(v)}" y2="${Y(v)}" class="g-grid"/><text x="${pl - 6}" y="${Y(v) + 4}" class="g-eje" text-anchor="end">${txt}</text>`;
  // Etiquetas al final de las líneas; si se pisan, una sola etiqueta para las dos
  const fin = (yA, yB, txtA, txtB, txtAmbas) => {
    const x = W - pr + 12;
    if (Math.abs(yA - yB) < 2) return `<text x="${x}" y="${yA + 4}" class="g-etq">${txtAmbas}</text>`;
    let a = yA, bb = yB; if (Math.abs(a - bb) < 30) { const m = (a + bb) / 2; a = m + (a > bb ? 15 : -15); bb = m + (bb >= yA ? 15 : -15); }
    return `<text x="${x}" y="${a + 4}" class="g-etq"><tspan class="g-etq-s">${nomHoy}</tspan> ${txtA}</text><text x="${x}" y="${bb + 4}" class="g-etq"><tspan class="g-etq-s">${nomProp}</tspan> ${txtB}</text>`;
  };
  const u = ac[n - 1];
  const nomHoy = "Hoy", nomProp = movil ? "Prop." : "Propuesta", monto = movil ? (v) => Math.round(v).toLocaleString("es-AR") : usd0;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="grafico" id="g-costo" aria-hidden="true">`;
  // Panel 1: ventas (columnas)
  s += `<text x="0" y="${p1.y - 12}" class="g-tit">Ventas, unidades por ${res.granularidad === "semana" ? "semana" : "día"}${res.variacion ? ` (registradas ${signoVar(res.variacion)})` : ""}</text>`;
  s += grid(YV, 0, "0") + grid(YV, mV, compacto(mV));
  const iMax = g.reduce((k, p, i) => (p.ventas > g[k].ventas ? i : k), 0);
  g.forEach((p, i) => { s += `<path d="${columna(Xc(i) - wCol / 2, YV(p.ventas), wCol, YV(0) - YV(p.ventas))}" class="g-col-ventas"/>`; });
  if (g[iMax].ventas > 0 && g[iMax].ventas < mV) s += `<text x="${Xc(iMax)}" y="${YV(g[iMax].ventas) - 5}" class="g-etq" text-anchor="middle">${dec(g[iMax].ventas, 0)}</text>`;
  s += `<text x="${W - pr + 12}" y="${p1.y + p1.h / 2 + 4}" class="g-etq"><tspan class="g-etq-s">Total</tspan> ${dec(res.tot.ventas, 0)}</text>`;
  // Panel 2: entregas cumplidas acumuladas
  s += `<text x="0" y="${p2.y - 12}" class="g-tit">Entregas que se cumplen, acumulado</text>`;
  s += grid(YO, oMin, `${dec(oMin * 100, 0)} %`) + grid(YO, 1, "100 %");
  s += `<path d="${linea((a) => a.oA, YO)}" class="g-l g-l-hoy"/><path d="${linea((a) => a.oP, YO)}" class="g-l g-l-prop"/>`;
  g.forEach((p, i) => { if (p.lP > p.okP && ac[i].oP !== null) s += `<circle cx="${Xc(i)}" cy="${YO(ac[i].oP)}" r="5" class="g-falta"/>`; });
  if (u.oA !== null && u.oP !== null) s += fin(YO(u.oA), YO(u.oP), pct(u.oA), pct(u.oP), `<tspan class="g-etq-s">Ambas</tspan> ${pct(u.oP)}`);
  // Panel 3: costo acumulado
  s += `<text x="0" y="${p3.y - 12}" class="g-tit">Costo del inventario acumulado, USD</text>`;
  s += grid(YC, 0, "0") + grid(YC, mC / 2, compacto(mC / 2)) + grid(YC, mC, compacto(mC));
  s += `<path d="${linea((a) => a.cA, YC)}" class="g-l g-l-hoy"/><path d="${linea((a) => a.cP, YC)}" class="g-l g-l-prop"/>`;
  s += fin(YC(u.cA), YC(u.cP), monto(u.cA), monto(u.cP), `<tspan class="g-etq-s">Ambas</tspan> ${monto(u.cP)}`);
  // Eje de fechas compartido
  const cada = Math.max(1, Math.ceil((res.granularidad === "semana" ? 92 : 44) / banda));
  s += g.map((p, i) => (i % cada === 0 || i === n - 1 && (n - 1) % cada > cada / 2 ? `<text x="${Xc(i)}" y="${H - 6}" class="g-eje" text-anchor="middle">${p.dias === 1 ? fCorta(p.desde) : `${fCorta(p.desde)}–${fCorta(p.hasta)}`}</text>` : "")).join("");
  // Cursor: línea vertical que cruza los tres paneles
  s += `<g id="g-cursor" class="g-cursor" visibility="hidden"><line y1="${p1.y - 4}" y2="${p3.y + p3.h}" class="g-cursor-l"/>
    <circle r="4.5" class="g-pt g-pt-hoy" data-y="oA"/><circle r="4.5" class="g-pt g-pt-prop" data-y="oP"/>
    <circle r="4.5" class="g-pt g-pt-hoy" data-y="cA"/><circle r="4.5" class="g-pt g-pt-prop" data-y="cP"/></g>`;
  s += g.map((p, i) => `<rect class="g-hit" data-i="${i}" x="${X(i)}" y="0" width="${banda}" height="${H}"/>`).join("");
  s += "</svg>";

  const faltas = g.filter((p) => p.lP > p.okP);
  b.innerHTML = `<div class="bloque-cab"><h2>Día por día: ventas, entregas y costo</h2>
      <p class="bloque-sub">Las tres franjas comparten las fechas: leé una columna de arriba abajo. ${movil ? "Tocá" : "Pasá el cursor o tocá"} una fecha para ver los valores${movil ? "" : "; con el teclado, flechas izquierda y derecha"}.</p></div>
    <div class="leyenda-g" aria-hidden="true"><span><i class="sw sw-ventas"></i>Ventas</span><span><i class="sw-l sw-l-hoy"></i>Hoy</span><span><i class="sw-l sw-l-prop"></i>Propuesta</span>${faltas.length ? `<span><i class="sw-falta"></i>Día con faltante (propuesta)</span>` : ""}</div>
    <div class="graficos" id="graficos" tabindex="0" role="group" aria-label="Gráfico de ventas, entregas y costo por fecha. Usá las flechas para recorrer las fechas; los datos están también en la tabla de abajo.">${s}<div class="g-tip" id="g-tip" role="status" hidden></div></div>
    ${faltas.length ? `<p class="g-nota"><b>La propuesta no alcanza a entregar todo</b> en ${faltas.map((p) => p.dias === 1 ? fCorta(p.desde) : `${fCorta(p.desde)}–${fCorta(p.hasta)}`).join(", ")}: ${num(res.tot.faltaPropuesta)} un. sin entregar en el período.</p>` : ""}
    <p class="g-nota">Hoy: stock y recepciones registrados. Propuesta: stock de seguridad + lote, con su costo en régimen repartido por igual en cada día. Entregas simuladas: cada retiro por venta es un pedido del mismo día.</p>
    <details class="traza"><summary>Ver los datos del gráfico en una tabla</summary>${tabla([
      { t: "Fecha", html: (p) => (p.dias === 1 ? fLarga(p.desde) : `${fLarga(p.desde)} – ${fLarga(p.hasta)}`) },
      { t: "Ventas, un.", num: true, html: (p) => dec(p.ventas, 0) },
      { t: "Entregas hoy", num: true, html: (p, i) => (p.lA ? `${p.okA} de ${p.lA}` : "—") },
      { t: "Entregas propuesta", num: true, html: (p) => (p.lP ? `${p.okP} de ${p.lP}` : "—") },
      { t: "Acum. hoy", num: true, html: (p) => pct(ac[g.indexOf(p)].oA) },
      { t: "Acum. propuesta", num: true, html: (p) => pct(ac[g.indexOf(p)].oP) },
      { t: "Costo hoy", num: true, html: (p) => usd(p.total) },
      { t: "Costo propuesta", num: true, html: (p) => usd(p.propuesta) },
      { t: "Acum. hoy", num: true, html: (p) => usd(ac[g.indexOf(p)].cA) },
      { t: "Acum. propuesta", num: true, html: (p) => usd(ac[g.indexOf(p)].cP) },
    ], g)}</details>`;

  const cont = b.querySelector("#graficos"), tip = b.querySelector("#g-tip"), svg = cont.querySelector("svg"), cursor = svg.querySelector("#g-cursor");
  const escala = () => svg.getBoundingClientRect().width / W;
  const entregas = (l, ok) => (l === 0 ? "sin ventas" : ok === l ? `${ok} de ${l} completas` : `${ok} de ${l}: faltó en ${l - ok}`);
  const fila = (cl, t, v) => { const d = document.createElement("div"); if (cl) { const i = document.createElement("i"); i.className = cl; d.append(i); } d.append(document.createTextNode(t)); const sp = document.createElement("span"); sp.textContent = v; d.append(sp); return d; };
  const mostrar = (i) => {
    i = Math.max(0, Math.min(n - 1, i)); estadoVista.sel = i;
    const p = g[i], a = ac[i];
    cursor.setAttribute("visibility", "visible");
    cursor.querySelector("line").setAttribute("x1", Xc(i)); cursor.querySelector("line").setAttribute("x2", Xc(i));
    const ys = { oA: a.oA === null ? null : YO(a.oA), oP: a.oP === null ? null : YO(a.oP), cA: YC(a.cA), cP: YC(a.cP) };
    cursor.querySelectorAll("circle").forEach((c) => { const y = ys[c.dataset.y]; c.setAttribute("cx", Xc(i)); c.setAttribute("cy", y ?? -20); c.setAttribute("visibility", y === null ? "hidden" : "visible"); });
    const t = document.createElement("b"); t.textContent = p.dias === 1 ? fLarga(p.desde) : `${fLarga(p.desde)} – ${fLarga(p.hasta)}`;
    const sec = (txt) => { const d = document.createElement("div"); d.className = "tip-sec"; d.textContent = txt; return d; };
    tip.replaceChildren(t,
      fila("tl tl-ventas", "Ventas", `${dec(p.ventas, 0)} un.`),
      sec("Entregas ese día"), fila("tl tl-hoy", "Hoy", entregas(p.lA, p.okA)), fila("tl tl-prop", "Propuesta", entregas(p.lP, p.okP)),
      sec("Entregas acumuladas"), fila("tl tl-hoy", "Hoy", pct(a.oA)), fila("tl tl-prop", "Propuesta", pct(a.oP)),
      sec("Costo acumulado"), fila("tl tl-hoy", "Hoy", usd(a.cA)), fila("tl tl-prop", "Propuesta", usd(a.cP)));
    tip.hidden = false;
    const k = escala(), cw = cont.clientWidth, tw = tip.offsetWidth, x = Xc(i) * k;
    tip.style.left = `${Math.max(0, Math.min(cw - tw, x + 16 + tw > cw ? x - tw - 16 : x + 16))}px`;
    tip.style.top = `${Math.max(0, p2.y * k - 30)}px`;
  };
  const ocultar = () => { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); };
  cont.querySelectorAll(".g-hit").forEach((h) => {
    h.addEventListener("pointermove", () => mostrar(Number(h.dataset.i)));
    h.addEventListener("pointerdown", () => mostrar(Number(h.dataset.i)));
  });
  cont.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") ocultar(); });
  const fuera = (e) => { if (!document.body.contains(cont)) { document.removeEventListener("pointerdown", fuera); return; } if (!cont.contains(e.target)) ocultar(); };
  document.addEventListener("pointerdown", fuera);
  cont.addEventListener("focus", () => mostrar(estadoVista.sel ?? n - 1));
  cont.addEventListener("blur", ocultar);
  cont.addEventListener("keydown", (e) => {
    const paso = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (paso === undefined) { if (e.key === "Escape") ocultar(); return; }
    e.preventDefault(); mostrar((estadoVista.sel ?? n - 1) + paso);
  });
}

// ---------------------------------------------------------------------
// Nivel de servicio: costo y entregas en cada nivel (SS, ROP y lote vinculados)
// ---------------------------------------------------------------------
function pintarServicio(res) {
  const b = estadoVista.el.querySelector("#b-servicio"), m = res.nsMinimoCompleto;
  b.innerHTML = `<div class="bloque-cab"><h2>Nivel de servicio: cuánto cuesta entregar todo</h2>
      <p class="bloque-sub">Cada fila recalcula la propuesta con otro nivel de servicio: cambia z y con él el stock de seguridad, el punto de pedido y el máximo de cada producto.${res.variacion ? ` Ventas ${signoVar(res.variacion)}.` : ""} Tocá «Usar» para ver ese nivel en todo el tablero.</p></div>
    ${m ? `<p class="serv-clave"><b>${dec(m.ns, 1)}\u00a0% es el nivel más bajo que entrega el 100\u00a0%</b> en la simulación del período: cuesta ${usd(m.costoPropuesta)} contra ${usd(m.costoActual)} de hoy. La prueba usa los mismos ${res.series.L} días con los que se calcula el stock de seguridad: con otras ventas un nivel bajo puede quedarse corto.</p>`
      : `<p class="serv-clave"><b>Ningún nivel hasta 99,9\u00a0% entrega el 100\u00a0%</b> en la simulación: la propuesta deja unidades sin entregar aun con el máximo stock de seguridad.</p>`}
    ${tabla([
      { t: "Nivel de servicio", html: (c) => `<b>${dec(c.ns, 1)}\u00a0%</b>${c === m ? ` <span class="chip ok">Más barato que entrega todo</span>` : ""}${c.ns === res.ns ? ` <span class="chip prim">En uso</span>` : ""}` },
      { t: "Costo propuesta", num: true, html: (c) => `<span class="${c.costoPropuesta > c.costoActual ? "peor" : ""}" title="Costo en régimen del período con este nivel. Hoy: ${usd(c.costoActual)}">${usd(c.costoPropuesta)}</span>` },
      { t: "Entregas (OTIF)", num: true, html: (c) => `<span class="${c.faltaPropuesta > 0 ? "peor" : ""}">${pct(c.otifPropuesta)}</span>` },
      { t: "Faltan, un.", num: true, html: (c) => `<span class="${c.faltaPropuesta > 0 ? "peor" : ""}">${num(c.faltaPropuesta)}</span>` },
      { t: "", html: (c) => (c.ns === res.ns ? "" : `<button class="btn chico" type="button" data-ns="${c.ns}">Usar</button>`) },
      { t: "z", num: true, html: (c) => `<span title="z de la normal estándar para ${dec(c.ns, 1)} %">${dec(c.z, 3)}</span>` },
      { t: "Stock de seguridad, un.", num: true, html: (c) => `<span title="Suma de SS = z × σ × √plazo de los productos con ventas">${num(c.ssTotal)}</span>` },
      { t: "Máximo, un.", num: true, html: (c) => `<span title="Suma de SS + Q de los productos con ventas">${num(c.maxTotal)}</span>` },
    ], res.curvaServicio, { claseFila: (c) => (c.ns === res.ns ? "fila-actual" : "") })}
    <p class="g-nota">El nivel de servicio es la probabilidad de no quedarse sin stock mientras llega un pedido. 100 % no se puede calcular con esta fórmula (z sería infinito): la meta de entregar todo se mide con el OTIF simulado, que tiene que dar 100 % y 0 unidades faltantes.</p>`;
  b.querySelectorAll("[data-ns]").forEach((btn) => btn.addEventListener("click", () => {
    const v = Number(btn.dataset.ns), el = estadoVista.el;
    estadoVista.ns = v; el.querySelector("#s-ns").value = el.querySelector("#s-ns-r").value = v; pintar();
    el.querySelector("#b-servicio").scrollIntoView({ block: "start" });
  }));
}

// ---------------------------------------------------------------------
// En qué se va el costo (hoy contra propuesta)
// ---------------------------------------------------------------------
function pintarCategorias(res) {
  const t = res.tot;
  const cats = CATEGORIAS.filter((k) => t.actual[k.id] > 0.005 || t.propuesta[k.id] > 0.005);
  const max = Math.max(...cats.map((k) => Math.max(t.actual[k.id], t.propuesta[k.id])), 1);
  const barra = (v, cl) => `<div class="cb-fila"><div class="cb-pista"><div class="cb-barra ${cl}" style="width:${(v / max) * 100}%"></div></div><span class="cb-val">${usd0(v)}</span></div>`;
  estadoVista.el.querySelector("#b-categorias").innerHTML = `<div class="bloque-cab"><h2>En qué se va el costo</h2>
      <p class="bloque-sub">Total del período por tipo de costo.</p></div>
    <div class="leyenda-g"><span><i class="sw sw-hoy"></i>Hoy</span><span><i class="sw sw-prop"></i>Propuesta</span></div>
    <div class="cb">${cats.map((k) => `<div class="cb-item"><div class="cb-nombre">${esc(k.t)}</div>${barra(t.actual[k.id], "hoy")}${barra(t.propuesta[k.id], "prop")}</div>`).join("")}</div>
    <p class="small muted">Manipulación, obsolescencia, scrap y retrabajo no suman costo hoy; el quiebre no se monetiza (falta el dato). Ver «Costo por producto».</p>`;
}

// ---------------------------------------------------------------------
// Qué hacer con cada producto
// ---------------------------------------------------------------------
function accion(x) {
  const p = x.pol;
  if (!p.calculable) return { cl: "a-falta", t: "Falta dato", d: `Falta: ${p.faltan.join(", ")}.` };
  if (p.sinDemanda) return { cl: "a-nd", t: "Sin ventas: no reponer", d: `No se vendió en el período. Hay ${num(x.stockFin)} un. inmovilizadas.` };
  if (x.stockFin <= p.ROP) return { cl: "a-pedir", t: `Pedir ${num(p.Q)} un.`, d: `Stock ${num(x.stockFin)} ≤ punto de pedido ${num(p.ROP)}.` };
  if (x.stockFin > p.objetivo) return { cl: "a-exceso", t: `Sobran ${num(x.stockFin - p.objetivo)} un.`, d: `Stock ${num(x.stockFin)} > objetivo ${num(p.objetivo)}: no comprar hasta bajar al punto de pedido.` };
  return { cl: "a-ok", t: "En rango", d: `Stock entre el punto de pedido (${num(p.ROP)}) y el objetivo (${num(p.objetivo)}).` };
}

function pintarAcciones(res) {
  const conVentas = res.filas.filter((x) => !x.pol.sinDemanda);
  const todasBaja = conVentas.length > 0 && conVentas.every((x) => x.pol.bajaConfianza);
  const orden = { "a-pedir": 0, "a-falta": 1, "a-exceso": 2, "a-ok": 3, "a-nd": 4 };
  const filas = res.filas.map((x) => ({ ...x, acc: accion(x) })).sort((p, q) => orden[p.acc.cl] - orden[q.acc.cl]);
  const n = (cl) => filas.filter((x) => x.acc.cl === cl).length;
  estadoVista.el.querySelector("#b-acciones").innerHTML = `<div class="bloque-cab"><h2>Qué hacer con cada producto</h2>
      <p class="bloque-sub">Stock al ${fLarga(res.series.dias[res.series.L - 1])} contra la política propuesta: ${n("a-pedir")} para pedir, ${n("a-exceso")} con sobrante, ${n("a-ok")} en rango${n("a-nd") ? `, ${n("a-nd")} sin ventas` : ""}.${todasBaja ? " Todos vendieron pocos días: las cantidades son orientativas." : ""}</p></div>
    ${tabla([
      { t: "Producto", html: (x) => `<b>${esc(x.prod.codigo)}</b><div class="nota">${esc(x.prod.descripcion)}</div>` },
      { t: "Acción", html: (x) => `<span class="accion-chip ${x.acc.cl}">${esc(x.acc.t)}</span><div class="nota">${esc(x.acc.d)}</div>${!todasBaja && x.pol.bajaConfianza && !x.pol.sinDemanda ? `<div class="nota">Pocas ventas: orientativo.</div>` : ""}` },
      { t: "Stock", num: true, html: (x) => num(x.stockFin) },
      { t: "Pedir cuando baje a", num: true, html: (x) => (x.pol.calculable && !x.pol.sinDemanda ? num(x.pol.ROP) : "—") },
      { t: "Máximo", num: true, html: (x) => (x.pol.calculable && !x.pol.sinDemanda ? num(x.pol.objetivo) : "—") },
    ], filas)}`;
}

// ---------------------------------------------------------------------
// Límites y cómo se calcula
// ---------------------------------------------------------------------
function pintarLimites(res) {
  const P = res.P;
  estadoVista.el.querySelector("#b-limites").innerHTML = `
    <h3>Límites de este resultado</h3><ul class="lista">${res.conclusion.limites.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${res.conclusion.detalle.length > 3 ? `<h3>Más conclusiones</h3><ul class="lista">${res.conclusion.detalle.slice(3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <h3>Cómo se calcula</h3><ul class="lista">
      <li><b>Costo de hoy</b> = capital (stock del día × costo unitario × ${dec(P.v("tasa_capital"), 2)} % ÷ 365) + almacenamiento (igual con ${dec(P.v("tasa_almacenamiento"), 2)} %) + órdenes de compra (${usd(P.v("costo_orden"))} por recepción) + devoluciones (costo por evento + valor perdido según el motivo).</li>
      <li><b>Propuesta</b>: stock de seguridad SS = z × σ × √plazo; pedir cuando el stock baja a ROP = demanda diaria × plazo + SS; lote Q = máx(lote económico, lote mínimo); máximo = SS + Q. Su costo usa el stock promedio SS + Q ÷ 2 y la cantidad de pedidos (retiros ÷ Q).</li>
      <li><b>Entregas (OTIF)</b>: cada retiro por venta registrado es un pedido de ese día. Se entrega completo si hay stock; si no, falta. Hoy: con las recepciones registradas. Propuesta: arranca en el máximo y repone Q al llegar al punto de pedido; el pedido llega a los días del plazo.</li>
      <li>Período: ${fLarga(res.series.dias[0])} al ${fLarga(res.series.dias[res.series.L - 1])} (${res.series.L} días). Fuente: stock inicial y movimientos registrados.</li>
    </ul>`;
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

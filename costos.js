// Costo y servicio: tablero para decidir si se puede bajar el costo del inventario sin perder nivel de servicio.
// Los datos vienen del servidor (analisis_datos); los cálculos están en modelo.js con sus fórmulas a la vista.
import { rpc, puede, leer } from "./api.js?v=202610272333";
import { esc, num, aviso, ICON, tabla, pedir, toast, descargarCSV, usd, dec, pct, origen, fechaHora, TZ } from "./ui.js?v=202610272333";
import { analizar, zDeNS, CATEGORIAS, MOTIVOS } from "./modelo.js?v=202610272333";

const fCorta = (iso) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const fLarga = (iso) => iso.split("-").reverse().join("/");
const hoyLocal = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
// Aviso cuando el período pasa el último día con movimientos: esos días cuentan como días sin ventas.
export const avisoSinDatos = (d) => (d.hasta > d.fecha_max_datos
  ? `Del ${fLarga(sumarDia(d.fecha_max_datos))} al ${fLarga(d.hasta)} no hay movimientos registrados: se toman como días sin ventas ni compras. Si hubo movimientos, cargalos para que el análisis sea correcto.`
  : "");
function sumarDia(iso) { const f = new Date(`${iso}T12:00:00Z`); f.setUTCDate(f.getUTCDate() + 1); return f.toISOString().slice(0, 10); }
const usd0 = (v) => (v === null || v === undefined ? "—" : `USD\u00a0${Math.round(v).toLocaleString("es-AR")}`);
// Texto del nivel de servicio en uso: un valor o los tres niveles por clase ABC.
const nsTxt = (res) => (res.porClase.activo
  ? `por clase ABC (A ${dec(res.porClase.niveles.A.valor, 1)}\u00a0%, B ${dec(res.porClase.niveles.B.valor, 1)}\u00a0%, C ${dec(res.porClase.niveles.C.valor, 1)}\u00a0%)`
  : `${dec(res.ns, 1)}\u00a0%`);
const signoVar = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}\u00a0%`;

let estadoVista = null;
let alRedimensionar = null;

export function destruir() { if (alRedimensionar) window.removeEventListener("resize", alRedimensionar); alRedimensionar = null; }

export async function render(el, { params }) {
  estadoVista = { el, datos: null, variacion: 0, ns: null, porClase: false, gran: "dia", desde: params[0] || null, hasta: params[1] || null, sel: null };
  el.innerHTML = `<div class="cs">
    <section class="cs-ctrl" aria-label="Período y escenario">
      <button class="cs-resumen" type="button" id="cs-abrir" aria-expanded="false" aria-controls="cs-panel">
        <span id="cs-resumen-txt">Cargando período…</span><span class="cs-cambiar">Cambiar</span></button>
      <div class="cs-panel" id="cs-panel">
        <form id="f-periodo" class="cs-grupo">
          <span class="cs-grupo-t">Período</span>
          <div class="cs-campo"><label for="p-desde">Desde</label><input id="p-desde" type="date" required></div>
          <div class="cs-campo"><label for="p-hasta">Hasta</label><input id="p-hasta" type="date" required></div>
          <div class="cs-rapido"><button class="btn chico" type="button" data-hasta="ultimo">Hasta el último movimiento</button><button class="btn chico" type="button" data-hasta="hoy">Hasta hoy</button></div>
          <div class="cs-campo"><label for="p-gran">Ver por</label><select id="p-gran"><option value="dia">Día</option><option value="semana">Semana</option></select></div>
          <button class="btn" type="submit">Ver período</button>
        </form>
        <form class="cs-grupo simulador" id="simulador" aria-label="Probar un escenario">
          <span class="cs-grupo-t">Probar otro escenario<small>Mové las ventas y el nivel de servicio. No se guarda nada.</small></span>
          <div class="cs-campo sim-campo"><label for="s-var">Variación de ventas</label>
            <div class="sim-fila"><input id="s-var-r" type="range" min="-50" max="100" step="5" aria-label="Variación de ventas, deslizador">
            <span class="sim-num"><input id="s-var" type="number" min="-90" max="300" step="1" inputmode="numeric"> %</span></div></div>
          <div class="cs-campo"><label for="s-modo">Nivel de servicio</label>
            <select id="s-modo"><option value="unico">Uno para todos</option><option value="clase">Por clase ABC</option></select></div>
          <div class="cs-campo sim-campo oculto" id="s-clases"></div>
          <div class="cs-campo sim-campo" id="s-unico"><label for="s-ns">Nivel de servicio buscado</label>
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
  el.querySelectorAll("#f-periodo [data-hasta]").forEach((b) => b.addEventListener("click", () => {
    el.querySelector("#p-hasta").value = b.dataset.hasta === "hoy" ? hoyLocal() : estadoVista.datos?.fecha_max_datos || hoyLocal();
    el.querySelector("#f-periodo").requestSubmit();
  }));
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
  el.querySelector("#s-modo").addEventListener("change", (e) => { s.porClase = e.target.value === "clase"; if (s.datos) pintar(); });
  el.querySelector("#s-reset").addEventListener("click", () => {
    s.variacion = 0; s.porClase = false; el.querySelector("#s-modo").value = "unico";
    s.ns = Number(s.datos?.parametros.find((p) => p.clave === "nivel_servicio")?.valor ?? 95);
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
  // Exactitud de inventario: registros de las jornadas de conteo (si no se pueden leer, el indicador queda sin dato)
  try { s.difs = await leer("v_diferencias", (q) => q, "jornada,jornada_tipo,fecha_corte,diferencia"); } catch { s.difs = null; }
  for (const id of ["p-desde", "p-hasta"]) { const inp = el.querySelector("#" + id); inp.min = d.fecha_min_datos; inp.max = hoyLocal(); }
  el.querySelector('#f-periodo [data-hasta="ultimo"]').textContent = `Hasta el último movimiento (${fCorta(d.fecha_max_datos)})`;
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
    <section class="bloque" id="b-politica"></section>
    <section class="bloque" id="b-categorias"></section>
    <section class="bloque" id="b-grafico"></section>
    <section class="bloque" id="b-servicio"></section>
    <section class="bloque" id="b-metas"></section>
    <details class="seccion"><summary>Costo por producto</summary><div id="b-costos"></div></details>
    <details class="seccion"><summary>Qué pasa si las ventas aumentan</summary><div id="b-sensib"></div></details>
    <details class="seccion"><summary>Devoluciones del período</summary><div id="b-devol"></div></details>
    <details class="seccion" id="sec-limites"><summary>Límites del resultado y cómo se calcula</summary><div id="b-limites"></div></details>
    <section class="bloque" id="b-param"></section>`;
}

function pintar() {
  const s = estadoVista, el = s.el;
  let res;
  try { res = analizar(s.datos, { variacion: s.variacion, ns: s.ns, granularidad: s.gran, porClase: s.porClase }); }
  catch (e) { el.querySelector("#msg").innerHTML = aviso("error", `No se pudo calcular: ${esc(e.message)}`); return; }
  s.res = res;
  const nsParam = res.P.leer("nivel_servicio");
  el.querySelector("#s-z").innerHTML = s.ns === nsParam.valor ? `z = ${dec(zDeNS(s.ns / 100), 3)} ${origen(nsParam.origen, nsParam.razon)}`
    : `z = ${dec(zDeNS(s.ns / 100), 3)} <span class="org org-sim" title="Valor de prueba: no se guarda.">Prueba</span>`;
  el.querySelector("#cs-resumen-txt").innerHTML = `<b>${fCorta(res.series.dias[0])}–${fCorta(res.series.dias[res.series.L - 1])}</b>`
    + ` · ventas ${signoVar(res.variacion)} · servicio ${res.porClase.activo ? "por clase ABC" : `${dec(res.ns, 1)}\u00a0%`}`;
  const pc = res.porClase, modo = el.querySelector("#s-modo");
  modo.querySelector('[value="clase"]').disabled = !pc.disponible;
  if (!pc.disponible && s.porClase) { s.porClase = false; modo.value = "unico"; }
  el.querySelector("#s-unico").classList.toggle("oculto", pc.activo);
  el.querySelector("#s-clases").classList.toggle("oculto", !pc.activo);
  el.querySelector("#s-clases").innerHTML = pc.disponible ? `<span class="cs-clases">${["A", "B", "C"].map((k) => `<span><span class="clase abc-${k}">${k}</span> ${dec(pc.niveles[k].valor, 1)}\u00a0% ${origen(pc.niveles[k].origen, pc.niveles[k].razon)}</span>`).join("")}</span>` : "";
  pintarRespuesta(res);
  pintarMetas(res);
  pintarGrafico(res);
  pintarServicio(res);
  pintarCategorias(res);
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
  const c = res.conclusion, t = res.tot, P = res.P, mg = res.margen;
  const margenTxt = (x) => (x.hasta === null ? "falta ya" : x.falla === null ? `más de +${x.hasta}\u00a0%` : `+${x.hasta}\u00a0%`);
  // Recomendación: la acción y el motivo, con los números que la sostienen.
  const A = t.actual.total, B = t.propuesta.total, dif = B - A, difPct = A > 0 ? Math.abs(dif / A) * 100 : null;
  const pctTxt = difPct === null ? "" : ` (${dif < 0 ? "−" : "+"}${dec(difPct, 1)}\u00a0%)`;
  const faltaServicio = !c.veredicto.startsWith("Sí") && dif < -0.005;
  const titulo = c.tono === "si" ? "Aplicar la política propuesta" : faltaServicio ? "No aplicar: faltaría mercadería" : "No aplicar: cuesta más que hoy";
  const frase = c.tono === "si"
    ? `Baja el costo del inventario en ${res.series.L} días de ${usd(A)} a ${usd(B)}${pctTxt} y entrega el ${pct(t.otifPropuesta)} de los pedidos.`
    : faltaServicio
      ? `Bajaría el costo del inventario en ${res.series.L} días de ${usd(A)} a ${usd(B)}${pctTxt}, pero dejaría ${num(t.faltaPropuesta)} unidades sin entregar (entregas ${pct(t.otifPropuesta)}, hoy ${pct(t.otifActual)}).`
      : `En ${res.series.L} días costaría ${usd(B)} contra ${usd(A)} de hoy${pctTxt}.`;
  const baja = res.filas.filter((x) => x.pol.bajaConfianza && !x.pol.sinDemanda).length;
  const conVentas = res.filas.filter((x) => !x.pol.sinDemanda).length;
  const prueba = res.variacion !== 0 || res.ns !== P.v("nivel_servicio") || res.porClase.activo;
  const periodo = `${fLarga(res.series.dias[0])} al ${fLarga(res.series.dias[res.series.L - 1])} (${res.series.L} días)`;
  const delta = (a, b, mejorMenor, fmt, relativo = true) => {
    if (a === null || b === null) return "";
    const d = b - a;
    if (Math.abs(d) < 1e-9) return `<span class="fig-delta">sin cambio</span>`;
    const p = a && relativo ? ` (${d > 0 ? "+" : "−"}${dec(Math.abs(d / a) * 100, 0)}\u00a0%)` : "";
    return `<span class="fig-delta ${(d < 0) === mejorMenor ? "mejor" : "peor"}">${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}${p}</span>`;
  };
  const formulas = [];
  const figura = (serie, etiqueta, valor, hoy, dlt, formula, nota = "") => { formulas.push([etiqueta, formula]); return `<div class="fig" tabindex="0" title="${esc(formula)}">
      <div class="fig-t">${etiqueta}</div>
      <div class="fig-v">${valor}</div>
      <div class="fig-c">Hoy ${hoy} ${dlt}</div>${nota ? `
      <div class="fig-f">${nota}</div>` : ""}
      </div>`; };
  const porque = motivos(res);
  const cuenta = conteoOrigen(res);
  estadoVista.el.querySelector("#respuesta").innerHTML = `
    <p class="resp-pregunta">Recomendación · ${periodo}</p>
    <div class="ver-frase tono-${c.tono}">
      <span class="resp-titulo">${titulo}</span>
      <span class="resp-texto">${frase}</span>
    </div>
    <p class="resp-cambia"><b>${c.tono === "si" ? "Qué cambia" : "Qué cambiaría"}:</b> ${accionCompra(res)}</p>
    ${cuentas(res, periodo)}
    <div class="resp-ir">
      <button class="btn prim" type="button" data-ir="b-politica">Ver la política propuesta</button>
      <button class="btn" type="button" data-ir="b-param">Revisar costos y supuestos<span class="resp-ir-n">${cuenta.supuesto} supuestos, ${cuenta.faltante} faltantes</span></button>
    </div>
    ${avisoSinDatos(estadoVista.datos) ? aviso("alerta", avisoSinDatos(estadoVista.datos)) : ""}
    ${prueba ? `<p class="resp-escenario"><span class="org org-sim">Prueba</span> Escenario de prueba: ventas ${signoVar(res.variacion)}, nivel de servicio ${nsTxt(res)}. No se guarda.</p>` : ""}
    <div class="figuras" id="kpis" aria-label="Servicio: propuesta contra hoy">
      ${figura("prop", "Entregas que se cumplen (OTIF)", pct(t.otifPropuesta), pct(t.otifActual), delta(t.otifActual, t.otifPropuesta, false, (x) => `${dec(x * 100, 1)} puntos`, false),
        `Líneas de venta entregadas completas ÷ ${t.lineas} líneas del período. Simulado: cada retiro por venta es un pedido de ese día.`)}
      ${figura("prop", "Unidades que faltarían", `${num(t.faltaPropuesta)}\u00a0un.`, `${num(t.faltaActual)}\u00a0un.`, delta(t.faltaActual, t.faltaPropuesta, true, (x) => `${num(x)}\u00a0un.`),
        "Unidades pedidas que no se habrían podido entregar por falta de stock, en la simulación del período.")}
      ${figura("prop", "Aguanta subas de ventas de hasta", margenTxt(mg.propuesta), margenTxt(mg.actual), "",
        `Mayor aumento de ventas, de 5 en 5 %, sin unidades faltantes, con la política calculada hoy (sin recalcularla).${mg.propuesta.falla !== null ? ` Con +${mg.propuesta.falla} % la propuesta deja ${num(mg.propuesta.falta)} un. sin entregar.` : ""}${mg.actual.falla !== null ? ` Hoy falta mercadería desde +${mg.actual.falla} %.` : ""}`)}
    </div>
    <details class="traza"><summary>Cómo se calcula cada número</summary><ul>${formulasCosto(res, periodo).map(([t, f]) => `<li><b>${t}</b>: ${esc(f)}</li>`).join("")}${formulas.map(([t, f]) => `<li><b>${t}</b>: ${esc(f)}</li>`).join("")}</ul></details>
    <p class="resp-metas" id="resp-metas"></p>
    <div class="resp-pie">
      ${porque.length ? `<div><h3>A tener en cuenta</h3><ul class="resp-porque">${porque.map((x) => `<li>${x}</li>`).join("")}</ul></div>` : ""}
      <p class="resp-aviso"><a href="#/gestion/${res.series.dias[0]}/${res.series.dias[res.series.L - 1]}">Ver valorización, rotación y clasificación ABC / XYZ en el tablero de gestión</a></p>
      ${baja ? `<p class="resp-aviso"><span class="conf conf-baja">Baja confianza</span> ${baja} de ${conVentas} productos vendieron pocos días: tomá el resultado como orientativo. <a href="#sec-limites" id="ir-limites">Ver límites del resultado</a></p>` : ""}
    </div>`;
  estadoVista.el.querySelectorAll("#respuesta [data-ir]").forEach((btn) => btn.addEventListener("click", () =>
    estadoVista.el.querySelector("#" + btn.dataset.ir).scrollIntoView({ block: "start" })));
  estadoVista.el.querySelector("#ir-limites")?.addEventListener("click", (e) => {
    e.preventDefault(); const sec = estadoVista.el.querySelector("#sec-limites"); sec.open = true; sec.scrollIntoView({ block: "start" });
  });
}

const cantOrd = (n) => (n < 10 ? dec(n, 1).replace(/,0$/, "") : num(Math.round(n)));
const lista = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs.join(""));
const montoSigno = (v) => `${v > 0 ? "+" : "−"}${usd(Math.abs(v))}`;

// La acción concreta de la propuesta: cuándo y cuánto comprar.
function accionCompra(res) {
  const sinVentas = res.filas.filter((x) => x.pol.calculable && x.pol.sinDemanda).map((x) => x.prod.codigo);
  return `comprar cada producto cuando su stock baja al punto de pedido, siempre en el mismo lote${sinVentas.length ? `, y no reponer ${lista(sinVentas)} hasta que vuelvan a venderse` : ""}.`;
}

// Tasa de tener stock en los días del período (capital + almacenamiento + obsolescencia, anuales).
const tasaPeriodo = (P, L) => ((P.v("tasa_capital") || 0) + (P.v("tasa_almacenamiento") || 0) + (P.v("tasa_obsolescencia") || 0)) * L / 365;

// Las dos cuentas, separadas porque no se pueden sumar:
// 1) el costo del período (se repite cada período) y 2) la plata en mercadería (cambia una sola vez).
function cuentas(res, periodo) {
  const t = res.tot, P = res.P, L = res.series.L, sOrden = P.v("costo_orden");
  const suma = (lado, ks) => ks.reduce((a, k) => a + t[lado][k], 0);
  const TENER = ["capital", "almacenamiento", "obsolescencia"];
  const dif = (a, b) => (Math.abs(b - a) < 0.005 ? `<span class="muted">sin cambio</span>` : `<span class="${b < a ? "mejor" : "peor"}">${b - a > 0 ? "+" : "−"}${usd0(Math.abs(b - a))}</span>`);
  const tasas = [["capital", "tasa_capital"], ["depósito", "tasa_almacenamiento"], ["obsolescencia", "tasa_obsolescencia"]].filter(([, k]) => P.v(k));
  const filas = [
    { t: "Compras", n: `${sOrden === null ? "costo por compra sin dato" : `${usd0(sOrden)} cada una, por producto`}`, a: t.actual.orden, b: t.propuesta.orden,
      na: `${cantOrd(t.ordenesActual)} compras`, nb: `${cantOrd(t.ordenesPropuesta)} compras` },
    { t: "Tener la mercadería", n: `${dec(tasaPeriodo(P, L), 2)}\u00a0% de su valor en ${L} días (${tasas.map(([x, k]) => `${x} ${dec(P.v(k) * L / 365, 2)}\u00a0%`).join(" + ")})`,
      a: suma("actual", TENER), b: suma("propuesta", TENER) },
    { t: "Devoluciones", a: t.actual.devoluciones, b: t.propuesta.devoluciones },
    { t: "Manipulación", a: t.actual.manipulacion, b: t.propuesta.manipulacion },
    { t: "Unidades no entregadas", a: t.actual.quiebre, b: t.propuesta.quiebre },
  ].filter((f, i) => i < 2 || f.a > 0.005 || f.b > 0.005);
  const vA = t.valorPromActual, vP = t.valorPromPropuesta, dV = Math.round(vP) - Math.round(vA);
  const plata = dV < 0 ? { cl: "mejor", t: `Se liberan ${usd0(-dV)}`, n: "Es plata que deja de estar en mercadería al bajar el stock, una sola vez. No se suma al ahorro del período: lo que se ahorra por tener menos mercadería ya está en «Tener la mercadería»." }
    : dV > 0 ? { cl: "peor", t: `Hay que invertir ${usd0(dV)}`, n: "Es la compra extra para pasar a lotes más grandes, una sola vez. No es un gasto: esa mercadería se vende después. Lo que cuesta tenerla ya está en «Tener la mercadería»." }
    : { cl: "", t: "Sin cambio", n: "La propuesta tiene, en promedio, la misma mercadería que hoy." };
  return `<div class="cuentas">
    <section class="cuenta" aria-label="Costo del período">
      <h3>Costo del inventario en ${L} días <small>se repite en cada período</small></h3>
      <table class="cuenta-t"><thead><tr><th scope="col"></th><th scope="col" class="num">Hoy</th><th scope="col" class="num">Propuesta</th><th scope="col" class="num">Diferencia</th></tr></thead><tbody>
      ${filas.map((f) => `<tr><th scope="row">${f.t}${f.n ? `<div class="nota">${esc(f.n)}</div>` : ""}</th>
        <td class="num" data-t="Hoy">${usd0(f.a)}${f.na ? `<div class="nota">${f.na}</div>` : ""}</td><td class="num" data-t="Propuesta">${usd0(f.b)}${f.nb ? `<div class="nota">${f.nb}</div>` : ""}</td><td class="num" data-t="Diferencia">${dif(f.a, f.b)}</td></tr>`).join("")}
      </tbody><tfoot><tr><th scope="row">${t.propuesta.total <= t.actual.total ? "Ahorro" : "Costo extra"} en ${L} días</th><td class="num" data-t="Hoy">${usd0(t.actual.total)}</td><td class="num" data-t="Propuesta">${usd0(t.propuesta.total)}</td><td class="num" data-t="Diferencia"><b>${dif(t.actual.total, t.propuesta.total)}</b></td></tr></tfoot></table>
      <p class="nota">No incluye el precio de la mercadería: se compran las mismas unidades con las dos políticas.</p>
    </section>
    <section class="cuenta" aria-label="Plata en mercadería">
      <h3>Plata en mercadería <small>una sola vez</small></h3>
      <p class="cuenta-linea">Mercadería en depósito, en promedio: <b>hoy ${usd0(vA)} → propuesta ${usd0(vP)}</b></p>
      <p class="cuenta-grande ${plata.cl}">${plata.t}</p>
      <p class="nota">${plata.n}</p>
    </section>
  </div>`;
}

// Fórmulas de las dos cuentas, para «Cómo se calcula cada número».
function formulasCosto(res, periodo) {
  const P = res.P, L = res.series.L;
  return [
    [`Costo del inventario en ${L} días`, `Compras + tener la mercadería + devoluciones, ${periodo}. Compras: hoy, recepciones registradas × costo por compra; propuesta, retiros ÷ lote Q de cada producto × costo por compra. Tener la mercadería: valor promedio del stock × ${dec(tasaPeriodo(P, L), 2)} % (lo que cuesta tenerla ${L} días); hoy, con el stock registrado de cada día; propuesta, con (SS + Q ÷ 2) × costo unitario.`],
    ["Plata en mercadería", `Promedio de los ${L} días del valor del stock de todos los productos (unidades × costo unitario). Propuesta: suma de (SS + Q ÷ 2) × costo unitario. Es un saldo, no un gasto del período: no se suma al costo.`],
  ];
}

// A tener en cuenta: si la conclusión depende del costo por compra y dónde faltaría mercadería.
function motivos(res) {
  const out = [];
  const eq = res.equilibrioOrden;
  if (eq && eq.valor === null) out.push(`<b>La conclusión no depende del costo por compra:</b> la propuesta cuesta ${eq.propuestaSiempreMasBarata ? "menos" : "más"} que hoy con cualquier valor entre ${usd0(eq.desde)} y ${usd0(eq.hasta)}.`);
  else if (eq) out.push(`<b>La conclusión depende del costo por compra:</b> con ${usd(eq.valor)} por compra las dos cuestan lo mismo; ${eq.propuestaMasCaraDebajo ? "por debajo" : "por encima"} la propuesta cuesta más. Hoy se usan ${usd(res.P.v("costo_orden") ?? 0)}.`);
  const conFalta = res.filas.filter((x) => x.simP.unidadesFaltantes > 0);
  if (conFalta.length) out.push(`<b>Faltaría mercadería en</b> ${conFalta.map((x) => `${esc(x.prod.codigo)} (${num(x.simP.unidadesFaltantes)} un.)`).join(", ")}.`);
  return out;
}

// Cantidad de parámetros por origen (globales y por producto).
function conteoOrigen(res) {
  const P = res.P, n = { supuesto: 0, faltante: 0, usuario: 0, real: 0 };
  for (const x of Object.values(P.g)) n[x.origen] = (n[x.origen] || 0) + 1;
  const defsProd = Object.values(P.defs).filter((d) => d.ambito === "producto");
  for (const p of res.series.productos) for (const d of defsProd) { const o = P.leer(d.clave, p.codigo).origen; n[o] = (n[o] || 0) + 1; }
  return n;
}

// ---------------------------------------------------------------------
// Objetivos e indicadores (SMART): meta, plazo, hoy, propuesta y ficha de cada uno
// ---------------------------------------------------------------------
const diaLocal = (v) => new Date(v).toLocaleDateString("sv-SE", { timeZone: TZ });
const fechaMeta = (v) => { const t = String(Math.round(v)); return `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)}`; };

function exactitud(difs, hasta) {
  if (!difs) return null;
  const porJ = {};
  for (const d of difs) if (diaLocal(d.fecha_corte) <= hasta) (porJ[d.jornada] ||= { jornada: d.jornada, corte: d.fecha_corte, lineas: 0, ok: 0, unidades: 0 });
  for (const d of difs) { const j = porJ[d.jornada]; if (!j) continue; j.lineas++; if (d.diferencia === 0) j.ok++; j.unidades += Math.abs(d.diferencia); }
  const ult = Object.values(porJ).sort((a, b) => (a.corte < b.corte ? 1 : -1))[0];
  return ult ? { ...ult, valor: ult.ok / ult.lineas } : null;
}

function indicadores(res) {
  const P = res.P, t = res.tot, L = res.series.L, hasta = res.series.dias[L - 1];
  const meta = (k) => P.leer(k);
  const plazo = meta("meta_plazo");
  const ex = exactitud(estadoVista.difs, hasta);
  const red = (a, b) => (a > 0 ? (a - b) / a * 100 : null);
  const ult = res.curvaServicio[res.curvaServicio.length - 1], m = res.nsMinimoCompleto;
  const periodo = `${fLarga(res.series.dias[0])} al ${fLarga(hasta)}`;
  const cumple = (v, mt, mayor) => (mt.valor === null || v === null ? null : mayor ? v >= mt.valor - 1e-9 : v <= mt.valor + 1e-9);
  const mOtif = meta("meta_otif"), mFal = meta("meta_faltantes"), mCos = meta("meta_reduccion_costo"), mEx = meta("meta_exactitud");
  const redProp = red(t.actual.total, t.propuesta.total);
  return { plazo, ex, lista: [
    { id: "otif", t: "Entregas completas (OTIF)", meta: mOtif, metaTxt: mOtif.valor === null ? "sin meta" : `≥ ${dec(mOtif.valor, 1)}\u00a0%`,
      hoy: pct(t.otifActual), prop: pct(t.otifPropuesta), ok: cumple(t.otifPropuesta === null ? null : t.otifPropuesta * 100, mOtif, true),
      S: "Porcentaje de líneas de venta entregadas completas y el mismo día en que se pidieron, en todos los productos.",
      M: `OTIF = líneas entregadas completas ÷ líneas de venta del período (${t.lineas} líneas, ${periodo}). Simulado: cada retiro por venta registrado es una línea de pedido.`,
      A: `En la simulación la propuesta entrega ${pct(t.otifPropuesta)} con nivel de servicio ${nsTxt(res)}. ${m ? `El nivel más bajo que entrega todo es ${dec(m.ns, 1)}\u00a0%.` : "Ningún nivel hasta 99,9 % entrega todo."}`,
      R: "Es la condición de la pregunta: bajar el costo sin dejar de entregar." },
    { id: "faltantes", t: "Unidades no entregadas", meta: mFal, metaTxt: mFal.valor === null ? "sin meta" : `≤ ${num(mFal.valor)}\u00a0un.`,
      hoy: `${num(t.faltaActual)}\u00a0un.`, prop: `${num(t.faltaPropuesta)}\u00a0un.`, ok: cumple(t.faltaPropuesta, mFal, false),
      S: "Unidades pedidas que no se pudieron entregar por falta de stock, sumando todos los productos.",
      M: `Suma de unidades pedidas y no entregadas en la simulación del período (${periodo}).`,
      A: `La propuesta deja ${num(t.faltaPropuesta)} un. sin entregar en el período; la situación actual, ${num(t.faltaActual)} un.`,
      R: "Cada unidad no entregada es una venta perdida. Su costo no está cargado, por eso se controla en unidades." },
    { id: "costo", t: "Baja del costo de inventario", meta: mCos, metaTxt: mCos.valor === null ? "sin meta" : `≥ ${dec(mCos.valor, 1)}\u00a0% menos que hoy`,
      hoy: usd(t.actual.total), prop: `${usd(t.propuesta.total)} (${redProp === null ? "—" : `${redProp >= 0 ? "−" : "+"}${dec(Math.abs(redProp), 1)}\u00a0%`})`, ok: cumple(redProp, mCos, true),
      S: "Costo total del inventario: capital inmovilizado, almacenamiento, órdenes de compra y devoluciones, en USD.",
      M: `Baja = (costo de hoy − costo de la propuesta) ÷ costo de hoy, mismo período (${periodo}, ${L} días). Línea de base: ${usd(t.actual.total)}.`,
      A: `La simulación da ${redProp === null ? "—" : `${dec(redProp, 1)}\u00a0%`} con nivel de servicio ${nsTxt(res)} y ${dec(red(ult.costoActual, ult.costoPropuesta), 1)}\u00a0% con ${dec(ult.ns, 1)}\u00a0%. Depende de supuestos (costos unitarios, costo por orden).`,
      R: "Es el costo que se busca bajar: plata inmovilizada y gastos de reposición." },
    { id: "exactitud", t: "Exactitud de inventario", meta: mEx, metaTxt: mEx.valor === null ? "sin meta" : `≥ ${dec(mEx.valor, 1)}\u00a0% de registros`,
      hoy: ex ? pct(ex.valor) : "sin conteo", prop: "no depende de la política", ok: ex ? cumple(ex.valor * 100, mEx, true) : null, soloHoy: true,
      S: "Porcentaje de registros (posición + producto + lote) en los que lo contado coincide con el sistema.",
      M: ex ? `Exactitud = registros sin diferencia ÷ registros contados en el último conteo hasta el ${fLarga(hasta)}: ${ex.jornada}, ${ex.ok} de ${ex.lineas} registros (${num(ex.unidades)} un. de diferencia en valor absoluto).` : "Registros sin diferencia ÷ registros contados en el último conteo del período. No hay conteos hasta esa fecha.",
      A: "Sin dato propio de la empresa. Se alcanza con conteos cíclicos frecuentes y ajustes aprobados; revisar la meta con el primer mes de conteos.",
      R: "La política de stock usa el stock del sistema: si no coincide con lo físico, el punto de pedido falla y aparecen faltantes." },
  ] };
}

function pintarMetas(res) {
  const { plazo, lista } = indicadores(res);
  const hoy = diaLocal(new Date());
  const pz = plazo.valor === null ? null : String(Math.round(plazo.valor));
  const quedan = pz ? Math.round((Date.parse(`${pz.slice(0, 4)}-${pz.slice(4, 6)}-${pz.slice(6, 8)}`) - Date.parse(hoy)) / 86400000) : null;
  const plazoTxt = pz ? `${fechaMeta(plazo.valor)}${quedan >= 0 ? ` (quedan ${quedan} días)` : " (vencida)"}` : "sin fecha";
  const estado = (x) => (x.ok === null ? `<span class="est est-nd">Sin dato o sin meta</span>`
    : x.ok ? `<span class="est est-ok"><b aria-hidden="true">✓</b> ${x.soloHoy ? "Hoy cumple" : "La propuesta cumple"}</span>`
    : `<span class="est est-no"><b aria-hidden="true">✕</b> ${x.soloHoy ? "Hoy no cumple" : "La propuesta no cumple"}</span>`);
  const evaluables = lista.filter((x) => x.ok !== null), ok = evaluables.filter((x) => x.ok).length;
  const linea = estadoVista.el.querySelector("#resp-metas");
  if (linea) linea.innerHTML = evaluables.length ? `<b>Metas al ${plazoTxt.replace(/ \(.*/, "")}:</b> ${ok} de ${lista.length} se cumplen${evaluables.length < lista.length ? ` (${lista.length - evaluables.length} sin dato o sin meta)` : ""}. <a href="#b-metas">Ver indicadores</a>` : "";
  estadoVista.el.querySelector("#b-metas").innerHTML = `<div class="bloque-cab"><h2>Objetivos e indicadores</h2>
      <p class="bloque-sub">Fecha límite: ${plazoTxt} ${origen(plazo.origen, plazo.razon)}. Responsable: supervisor de depósito.</p></div>
    <div class="metas">${lista.map((x) => `<article class="meta">
      <div class="meta-cab"><h3>${x.t}</h3>${estado(x)}</div>
      <p class="meta-obj">Meta: <b>${x.metaTxt}</b> ${origen(x.meta.origen, x.meta.razon)}</p>
      <dl class="meta-val"><div><dt>Hoy</dt><dd>${x.hoy}</dd></div><div><dt>Propuesta</dt><dd>${x.prop}</dd></div></dl>
      <details class="traza"><summary>Cómo se mide</summary><dl class="smart">
        <dt>Qué mide</dt><dd>${esc(x.S)}</dd><dt>Cálculo</dt><dd>${esc(x.M)}</dd><dt>Por qué es alcanzable</dt><dd>${esc(x.A)}</dd>
        <dt>Por qué importa</dt><dd>${esc(x.R)}</dd></dl></details>
    </article>`).join("")}</div>
    ${lista.some((x) => x.meta.origen === "faltante") || plazo.origen === "faltante" ? `<p class="g-nota">Hay metas sin cargar: el administrador las carga en «Parámetros y supuestos».</p>` : ""}`;
  estadoVista.el.querySelector("#resp-metas a")?.addEventListener("click", (e) => { e.preventDefault(); estadoVista.el.querySelector("#b-metas").scrollIntoView({ block: "start" }); });
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
const compacto = (v) => (Math.abs(v) >= 1000 ? `${dec(v / 1000, 1)}\u00a0k` : dec(v, 0));
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
  s += grid(YO, oMin, `${dec(oMin * 100, 0)}\u00a0%`) + grid(YO, 1, "100\u00a0%");
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
      <p class="bloque-sub">${movil ? "Tocá" : "Pasá el cursor por"} una fecha para ver sus valores.</p></div>
    <div class="leyenda-g" aria-hidden="true"><span><i class="sw sw-ventas"></i>Ventas</span><span><i class="sw-l sw-l-hoy"></i>Hoy</span><span><i class="sw-l sw-l-prop"></i>Propuesta</span>${faltas.length ? `<span><i class="sw-falta"></i>Día con faltante (propuesta)</span>` : ""}</div>
    <div class="graficos" id="graficos" tabindex="0" role="group" aria-label="Gráfico de ventas, entregas y costo por fecha. Usá las flechas para recorrer las fechas; los datos están también en la tabla de abajo.">${s}<div class="g-tip" id="g-tip" role="status" hidden></div></div>
    ${faltas.length ? `<p class="g-nota"><b>La propuesta no alcanza a entregar todo</b> en ${faltas.map((p) => p.dias === 1 ? fCorta(p.desde) : `${fCorta(p.desde)}–${fCorta(p.hasta)}`).join(", ")}: ${num(res.tot.faltaPropuesta)} un. sin entregar en el período.</p>` : ""}
    <details class="traza"><summary>Cómo se calcula</summary><ul><li><b>Hoy</b>: stock y recepciones registrados.</li><li><b>Propuesta</b>: stock de seguridad + lote; su costo en régimen se reparte por igual en cada día.</li><li><b>Entregas</b>: cada salida por venta es un pedido del mismo día.</li></ul></details>
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
  const b = estadoVista.el.querySelector("#b-servicio"), m = res.nsMinimoCompleto, pc = res.porClase;
  const enUso = (c) => (c.clase ? pc.activo : !pc.activo && c.ns === res.ns);
  const filasServ = pc.disponible ? [...res.curvaServicio, { clase: true, costoPropuesta: pc.costo, costoActual: pc.costoActual, otifPropuesta: pc.otif,
    faltaPropuesta: pc.falta, ssTotal: pc.ssTotal, maxTotal: pc.maxTotal }] : res.curvaServicio;
  b.innerHTML = `<div class="bloque-cab"><h2>Nivel de servicio: cuánto cuesta entregar todo</h2>
      <p class="bloque-sub">Cada nivel cambia z y, con él, el stock de seguridad, el punto de pedido y el máximo de cada producto.${res.variacion ? ` Ventas ${signoVar(res.variacion)}.` : ""}</p></div>
    ${m ? `<p class="serv-clave"><b>${dec(m.ns, 1)}\u00a0% es el nivel más bajo que entrega el 100\u00a0%</b> en la simulación del período: cuesta ${usd(m.costoPropuesta)} contra ${usd(m.costoActual)} de hoy. La prueba usa los mismos ${res.series.L} días con los que se calcula el stock de seguridad: con otras ventas un nivel bajo puede quedarse corto.</p>`
      : `<p class="serv-clave"><b>Ningún nivel hasta 99,9\u00a0% entrega el 100\u00a0%</b> en la simulación: la propuesta deja unidades sin entregar aun con el máximo stock de seguridad.</p>`}
    ${pc.disponible ? (() => { const tope = res.curvaServicio[res.curvaServicio.length - 1];
      return `<p class="serv-clave"><b>Por clase ABC</b> (A ${dec(pc.niveles.A.valor, 1)}\u00a0%, B ${dec(pc.niveles.B.valor, 1)}\u00a0%, C ${dec(pc.niveles.C.valor, 1)}\u00a0%) cuesta ${usd(pc.costo)} y aguanta subas de ventas de hasta ${pc.margen?.falla === null ? "más de " : ""}+${pc.margen?.hasta ?? 0}\u00a0%; con ${dec(tope.ns, 1)}\u00a0% para todos, ${usd(tope.costoPropuesta)} y +${tope.margen?.hasta ?? 0}\u00a0%.</p>`; })() : ""}
    ${tabla([
      { t: "Nivel de servicio", html: (c) => `<b>${c.clase ? "Por clase ABC" : `${dec(c.ns, 1)}\u00a0%`}</b>${c.clase ? `<div class="nota">A ${dec(pc.niveles.A.valor, 1)} %, B ${dec(pc.niveles.B.valor, 1)} %, C ${dec(pc.niveles.C.valor, 1)} %</div>` : ""}${c === m ? ` <span class="chip ok">Más barato que entrega todo</span>` : ""}${enUso(c) ? ` <span class="chip prim">En uso</span>` : ""}` },
      { t: "Costo propuesta", num: true, html: (c) => `<span class="${c.costoPropuesta > c.costoActual ? "peor" : ""}" title="Costo en régimen del período con este nivel. Hoy: ${usd(c.costoActual)}">${usd(c.costoPropuesta)}</span>` },
      { t: "Entregas (OTIF)", num: true, html: (c) => `<span class="${c.faltaPropuesta > 0 ? "peor" : ""}">${pct(c.otifPropuesta)}</span>` },
      { t: "Faltan, un.", num: true, html: (c) => `<span class="${c.faltaPropuesta > 0 ? "peor" : ""}">${num(c.faltaPropuesta)}</span>` },
      { t: "Aguanta subas de ventas", num: true, html: (c) => { const g = c.clase ? pc.margen : c.margen; return g ? `<span title="Mayor aumento de ventas sin faltantes, sin recalcular la política">${g.hasta === null ? "—" : g.falla === null ? `más de +${g.hasta}\u00a0%` : `+${g.hasta}\u00a0%`}</span>` : "—"; } },
      { t: "", html: (c) => (enUso(c) ? "" : `<button class="btn chico" type="button" data-ns="${c.clase ? "clase" : c.ns}">Usar</button>`) },
      { t: "z", num: true, html: (c) => (c.clase ? "según clase" : `<span title="z de la normal estándar para ${dec(c.ns, 1)} %">${dec(c.z, 3)}</span>`) },
      { t: "Stock de seguridad, un.", num: true, html: (c) => `<span title="Suma de SS = z × σ × √plazo de los productos con ventas">${num(c.ssTotal)}</span>` },
      { t: "Máximo, un.", num: true, html: (c) => `<span title="Suma de SS + Q de los productos con ventas">${num(c.maxTotal)}</span>` },
    ], filasServ, { claseFila: (c) => (enUso(c) ? "fila-actual" : "") })}
    <p class="g-nota">100 % no se calcula: z sería infinito.</p>`;
  b.querySelectorAll("[data-ns]").forEach((btn) => btn.addEventListener("click", () => {
    const el = estadoVista.el;
    if (btn.dataset.ns === "clase") { estadoVista.porClase = true; el.querySelector("#s-modo").value = "clase"; pintar(); }
    else { const v = Number(btn.dataset.ns); estadoVista.porClase = false; el.querySelector("#s-modo").value = "unico"; estadoVista.ns = v; el.querySelector("#s-ns").value = el.querySelector("#s-ns-r").value = v; pintar(); }
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
      <p class="bloque-sub">Hoy contra la propuesta, en los ${res.series.L} días del período.</p></div>
    <div class="leyenda-g"><span><i class="sw sw-hoy"></i>Hoy</span><span><i class="sw sw-prop"></i>Propuesta</span></div>
    <div class="cb">${cats.map((k) => `<div class="cb-item"><div class="cb-nombre">${esc(k.t)}</div>${barra(t.actual[k.id], "hoy")}${barra(t.propuesta[k.id], "prop")}</div>`).join("")}</div>
    <p class="small muted">Sin costo en el período: manipulación, obsolescencia y quiebre (falta el dato).</p>`;
}

// ---------------------------------------------------------------------
// Acción sugerida para cada producto según su stock al cierre
// ---------------------------------------------------------------------
function accion(x) {
  const p = x.pol;
  if (!p.calculable) return { cl: "a-falta", t: "Falta dato", d: `Falta: ${p.faltan.join(", ")}.` };
  if (p.sinDemanda) return { cl: "a-nd", t: "Sin ventas: no reponer", d: `No se vendió en el período. Hay ${num(x.stockFin)} un. inmovilizadas.` };
  if (x.stockFin <= p.ROP) return { cl: "a-pedir", t: `Pedir ${num(p.Q)} un.`, d: `Stock ${num(x.stockFin)} ≤ punto de pedido ${num(p.ROP)}.` };
  if (x.stockFin > p.objetivo) return { cl: "a-exceso", t: `Sobran ${num(x.stockFin - p.objetivo)} un.`, d: `Stock ${num(x.stockFin)} > máximo ${num(p.objetivo)}: no comprar hasta bajar al punto de pedido.` };
  return { cl: "a-ok", t: "En rango", d: `Stock entre el punto de pedido (${num(p.ROP)}) y el máximo (${num(p.objetivo)}).` };
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
      <li><b>Costo de hoy</b> en ${res.series.L} días = capital (valor promedio del stock × ${dec((P.v("tasa_capital") || 0) * res.series.L / 365, 2)} %) + almacenamiento (igual con ${dec((P.v("tasa_almacenamiento") || 0) * res.series.L / 365, 2)} %) + órdenes de compra (${usd(P.v("costo_orden"))} por recepción) + devoluciones (costo por evento + valor perdido según el motivo).</li>
      <li><b>Propuesta</b>: stock de seguridad SS = z × σ × √plazo; pedir cuando el stock baja a ROP = demanda diaria × plazo + SS; lote Q = máx(lote económico, lote mínimo); máximo = SS + Q. Su costo usa el stock promedio SS + Q ÷ 2 y la cantidad de pedidos (retiros ÷ Q).</li>
      <li><b>Entregas (OTIF)</b>: cada retiro por venta registrado es un pedido de ese día. Se entrega completo si hay stock; si no, falta. Hoy: con las recepciones registradas. Propuesta: arranca en el máximo y repone Q al llegar al punto de pedido; el pedido llega a los días del plazo.</li>
      <li><b>Costo de compra</b> (demanda × costo unitario): no se suma porque es igual en las dos políticas; se compran las mismas unidades.</li>
      <li>Período: ${fLarga(res.series.dias[0])} al ${fLarga(res.series.dias[res.series.L - 1])} (${res.series.L} días). Fuente: stock inicial y movimientos registrados.</li>
    </ul>`;
}

// ---------------------------------------------------------------------
// Política de stock por producto
// ---------------------------------------------------------------------
function pintarPolitica(res) {
  const P = res.P, L = res.series.L;
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
    const Dp = p.Da * L / 365, Hp = p.H * L / 365;
    const eoq = p.EOQ === null ? "EOQ no calculable (falta costo unitario o costo por orden)" : `EOQ = √(2 × D × S ÷ H) = √(2 × ${dec(Dp, 1)} × ${dec(p.S, 2)} ÷ ${dec(Hp, 4)}) = ${dec(p.EOQ, 1)}, con D = ventas en ${L} días y H = costo de tener una unidad ${L} días (${dec(p.c, 2)} × ${dec(p.tasas * L / 365, 2)} %)`;
    return `${eoq}; Q = máx(EOQ, lote mínimo ${p.lote ?? "—"}) = ${p.Q}`;
  };
  const filas = res.filas;
  const conVentas = filas.filter((x) => !x.pol.sinDemanda);
  const todasBaja = conVentas.length > 0 && conVentas.every((x) => x.pol.bajaConfianza);
  const orden = { "a-pedir": 0, "a-falta": 1, "a-exceso": 2, "a-ok": 3, "a-nd": 4 };
  const conAcc = filas.map((x) => ({ ...x, acc: accion(x) })).sort((p, q) => orden[p.acc.cl] - orden[q.acc.cl]);
  const n = (cl) => conAcc.filter((x) => x.acc.cl === cl).length;
  const regla = (x) => { const p = x.pol;
    if (!p.calculable) return `<span class="falta-valor">Falta: ${esc(p.faltan.join(", "))}</span>`;
    if (p.sinDemanda) return "No reponer hasta que se venda";
    return `<span title="${esc(tROP(p))} · ${esc(tQ(p))}">Pedir <b>${num(p.Q)} un.</b> cuando queden <b>${num(p.ROP)}</b></span>`; };
  const b = estadoVista.el.querySelector("#b-politica");
  b.innerHTML = `<div class="bloque-cab"><h2>Política propuesta: cuándo y cuánto comprar</h2>
      <p class="bloque-sub">Nivel de servicio ${nsTxt(res)}${res.variacion ? ` · ventas ${signoVar(res.variacion)}` : ""}. Stock al ${fLarga(res.series.dias[res.series.L - 1])}: ${n("a-pedir")} para pedir, ${n("a-exceso")} con sobrante, ${n("a-ok")} en rango${n("a-nd") ? `, ${n("a-nd")} sin ventas` : ""}.${todasBaja ? " Todos vendieron pocos días: las cantidades son orientativas." : ""}</p>
      <div class="btns"><button class="btn chico" id="csv-pol">${ICON.csv} Exportar CSV</button></div></div>
    ${tabla([
      { t: "Producto", html: (x) => `<b>${esc(x.prod.codigo)}</b><div class="nota">${esc(x.prod.descripcion)}</div>` },
      { t: "Regla de compra", html: regla },
      { t: "Ahora", html: (x) => `<span class="accion-chip ${x.acc.cl}">${esc(x.acc.t)}</span><div class="nota">${esc(x.acc.d)}</div>${!todasBaja && x.pol.bajaConfianza && !x.pol.sinDemanda ? `<div class="nota">Pocas ventas: orientativo.</div>` : ""}` },
      { t: "Stock de seguridad", num: true, html: (x) => (x.pol.calculable && !x.pol.sinDemanda ? `<span title="${esc(tSS(x))}">${num(x.pol.SS)}</span>` : "—") },
      { t: "Máximo", num: true, html: (x) => (x.pol.calculable && !x.pol.sinDemanda ? `<span title="Stock de seguridad + lote = ${x.pol.SS} + ${x.pol.Q}">${num(x.pol.objetivo)}</span>` : "—") },
      { t: "Stock al cierre", num: true, html: (x) => num(x.stockFin) },
    ], conAcc)}
    <details class="traza"><summary>Detalle del cálculo por producto (demanda, desvío, z, lote económico)</summary>
      <p class="small muted">SS = stock de seguridad, ROP = punto de pedido, Q = lote a pedir. Pasá el cursor sobre un valor para ver la cuenta.</p>
    ${tabla([
      { t: "Producto", html: (x) => `<div class="col-prod"><b>${esc(x.prod.codigo)}</b><div class="nota">${esc(x.prod.descripcion)}</div></div>` },
      { t: "Retiros", num: true, html: (x) => `<span title="Suma de los retiros por venta del período${res.variacion ? ` × ${dec(res.f, 2)}` : ""}.">${dec(x.pol.demandaTotal, 1)}</span>` },
      { t: "Demanda por día", num: true, html: (x) => `<span title="d = retiros del período ÷ ${x.pol.n} días">${dec(x.pol.dbar, 2)}</span>` },
      { t: "σ por día", num: true, html: (x) => `<span title="Desvío estándar muestral de los retiros diarios (n = ${x.pol.n}, incluye días sin venta)">${dec(x.pol.sigma, 2)}</span>` },
      { t: "Variabilidad (CV)", num: true, html: (x) => { const p = x.pol; if (p.sinDemanda || !p.dbar || p.sigma === null) return "—";
          const cv = p.sigma ** 2 / p.dbar ** 2;
          return `<span title="CV = σ² ÷ d² = ${dec(p.sigma, 2)}² ÷ ${dec(p.dbar, 2)}² = ${dec(cv, 2)}. Con CV menor a 0,2 alcanza un modelo determinístico; con 0,2 o más corresponde el probabilístico (stock de seguridad).">${dec(cv, 2)}</span><div class="nota">${cv < 0.2 ? "Determinístico" : "Probabilístico"}</div>`; } },
      { t: "Confianza", html: (x) => x.pol.sinDemanda ? `<span class="conf conf-nd">Sin ventas</span>`
          : x.pol.bajaConfianza ? `<span class="conf conf-baja" title="${esc(x.pol.motivosConf.join(" y "))}">Baja</span><div class="nota">${x.pol.diasVenta} de ${x.pol.n} días con venta</div>`
          : `<span class="conf conf-ok">Aceptable</span><div class="nota">${x.pol.diasVenta} de ${x.pol.n} días con venta</div>` },
      { t: "Nivel de servicio", num: true, html: (x) => `<span title="z = ${dec(x.pol.z, 3)}">${dec(x.pol.ns, 1)}\u00a0%</span><div class="nota">Clase ${res.porClase.abc[x.prod.codigo] || "C"}</div>` },
      { t: "Plazo, días", num: true, html: (x) => conOrigen(x.pol.LT, P.leer("lead_time", x.prod.codigo), (v) => dec(v, 1)) },
      { t: "SS", num: true, html: (x) => `<span class="calc ${depSup(x, P)}" title="${esc(tSS(x))}">${x.pol.SS ?? "—"}</span>` },
      { t: "ROP", num: true, html: (x) => `<span class="calc" title="${esc(tROP(x.pol))}">${x.pol.ROP ?? "—"}</span>` },
      { t: "Lote Q", num: true, html: (x) => `<span class="calc dep-sup" title="${esc(tQ(x.pol))}">${x.pol.calculable ? x.pol.Q : "—"}</span>` },
      { t: "Objetivo SS + Q", num: true, html: (x) => `<b class="calc dep-sup" title="Stock máximo de la política: SS + Q = ${x.pol.SS ?? "—"} + ${x.pol.Q}. Promedio esperado: SS + Q ÷ 2 = ${dec(x.pol.promedio, 1)}">${x.pol.objetivo ?? "—"}</b>` },
      { t: "Stock al cierre", num: true, html: (x) => `<span title="Stock registrado al ${fLarga(res.series.dias[res.series.L - 1])}${res.variacion ? " con la variación de ventas aplicada" : ""}">${num(x.stockFin)}</span>` },
      { t: "Cobertura, días", num: true, html: (x) => x.cobertura === null ? `<span title="Sin ventas: cobertura indefinida">—</span>` : `<span title="Cobertura = stock al cierre ÷ d = ${num(x.stockFin)} ÷ ${dec(x.pol.dbar, 2)}">${dec(x.cobertura, 1)}</span>` },
      { t: "Riesgo de quiebre", html: (x) => `<span class="riesgo r-${x.riesgo.nivel}" title="${esc(x.riesgo.detalle)}">${esc(x.riesgo.t)}</span>${x.reponer ? `<div class="nota">Stock al cierre ≤ punto de reorden: corresponde pedir.</div>` : ""}` },
    ], filas)}</details>
    <details class="traza"><summary>Cómo se calcula</summary><ul>
      <li><b>d y σ</b>: demanda diaria promedio y desvío estándar muestral de los retiros por venta de cada día del período (${res.series.L} días), incluidos los días sin venta. Baja confianza si hay menos de ${dec(P.v("min_periodos_confianza"), 0)} períodos ${origen(P.leer("min_periodos_confianza").origen)} o menos de ${dec(P.v("min_dias_venta_confianza"), 0)} días con venta ${origen(P.leer("min_dias_venta_confianza").origen, P.leer("min_dias_venta_confianza").razon)}.</li>
      <li><b>Modelo</b>: cantidad fija con revisión continua: se pide un lote Q cada vez que el stock baja al punto de pedido. El período de revisión es 0 porque cada movimiento actualiza el stock al instante (LT = plazo de reposición). Se usa el modelo probabilístico cuando el coeficiente de variabilidad CV = σ² ÷ d² es 0,2 o más.</li>
      <li><b>Stock de seguridad</b>: SS = z × σ × √LT. Si se carga el desvío del plazo (σLT), se usa SS = z × √(LT × σ² + d² × σLT²). Se redondea hacia arriba.</li>
      <li><b>Punto de reorden</b>: ROP = d × LT + SS.</li>
      <li><b>Lote Q</b>: el mayor entre el lote económico EOQ = √(2 × D × S ÷ H) y el lote mínimo. D = ventas del período (${res.series.L} días), S = costo por compra, H = costo de tener una unidad durante el período. Da lo mismo medir D y H por día, por período o por año, siempre que sea el mismo.</li>
      <li><b>Riesgo de quiebre</b>: «Alto» si en la simulación del período la política propuesta dejó unidades sin entregar; «Sin quiebre, baja confianza» si entregó todo pero σ es poco confiable; «Bajo» si entregó todo con σ confiable. La probabilidad teórica de quiebre por ciclo es 1 − nivel de servicio.</li>
      <li>Los valores con subrayado punteado dependen de al menos un supuesto.</li>
    </ul></details>`;
  b.querySelector("#csv-pol").addEventListener("click", () => descargarCSV(`politica_stock_${res.series.dias[0]}_${res.series.dias[res.series.L - 1]}.csv`, filas, [
    { t: "Producto", f: (x) => x.prod.codigo }, { t: "Descripcion", f: (x) => x.prod.descripcion },
    { t: "RetirosPeriodo", f: (x) => dec(x.pol.demandaTotal, 2) }, { t: "DemandaDiaria", f: (x) => dec(x.pol.dbar, 4) }, { t: "Desvio", f: (x) => dec(x.pol.sigma, 4) },
    { t: "Periodos", f: (x) => x.pol.n }, { t: "DiasConVenta", f: (x) => x.pol.diasVenta }, { t: "BajaConfianza", f: (x) => (x.pol.bajaConfianza ? "Si" : "No") },
    { t: "PlazoDias", f: (x) => x.pol.LT }, { t: "OrigenPlazo", f: (x) => P.leer("lead_time", x.prod.codigo).origen }, { t: "NivelServicio", f: (x) => x.pol.ns }, { t: "ClaseABC", f: (x) => res.porClase.abc[x.prod.codigo] || "C" },
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
    obsolescencia: () => `${dec(P.v("tasa_obsolescencia"), 2)} % por año ${origen(P.leer("tasa_obsolescencia").origen, P.leer("tasa_obsolescencia").razon)}`,
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
      <li><b>Propuesta</b>: capital = (SS + Q ÷ 2) × costo unitario × ${dec((P.v("tasa_capital") || 0) * res.series.L / 365, 2)} % (lo que cuesta en ${res.series.L} días); almacenamiento y obsolescencia igual con su tasa; órdenes = retiros del período ÷ Q × ${usd(P.v("costo_orden"))}; devoluciones y manipulación iguales a la situación actual (no dependen de la política de stock); quiebre = unidades no entregadas × costo de quiebre, solo si está cargado.</li>
      <li>El costo unitario se supone igual al costo de reposición.</li>
    </ul></details>`;
}

// ---------------------------------------------------------------------
// Sensibilidad a aumentos de ventas
// ---------------------------------------------------------------------
function pintarSensibilidad(res) {
  const b = estadoVista.el.querySelector("#b-sensib");
  b.innerHTML = `<div class="bloque-cab"><h2>Si las ventas aumentan</h2>
      <p class="bloque-sub">La propuesta se recalcula para cada aumento; hoy repite sus compras. Nivel de servicio ${nsTxt(res)}.</p></div>
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
      <p class="bloque-sub">Sin motivo cargado se toma «${esc(MOTIVOS.cancelacion_pago)}».</p></div>
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
const GRUPOS = { meta: "Metas de los indicadores", clasificacion: "Clasificación ABC / XYZ", financiero: "Financieros", operativo: "Operativos", calidad: "Calidad", quiebre: "Quiebre", servicio: "Servicio", confianza: "Confianza estadística", abastecimiento: "Abastecimiento" };

function pintarParametros(res) {
  const P = res.P, admin = puede("administrador");
  const globales = Object.values(P.g).sort((a, b) => a.orden - b.orden);
  const porCat = {};
  for (const x of globales) (porCat[x.categoria] ||= []).push(x);
  const defsProd = Object.values(P.defs).filter((d) => d.ambito === "producto").sort((a, b) => a.orden - b.orden);
  const valor = (x) => (x.valor === null ? `<span class="falta-valor">sin dato</span>` : `<b>${x.unidad === "fecha AAAAMMDD" ? fechaMeta(x.valor) : String(x.unidad).startsWith("USD") ? usd(x.valor).replace(/^USD\s/, "") : dec(x.valor, 2)}</b>`);
  const conteo = conteoOrigen(res);
  const b = estadoVista.el.querySelector("#b-param");
  b.innerHTML = `<div class="bloque-cab"><h2>Costos y supuestos que usa el cálculo</h2>
      <p class="bloque-sub">${conteo.supuesto} supuestos · ${conteo.faltante} faltantes · ${conteo.usuario} cargados por usuario. Al cambiar un valor se recalcula todo el tablero.${admin ? "" : " Los edita un administrador."}</p>
      <div class="leyenda-org">${origen("real")} ${origen("usuario")} ${origen("supuesto")} ${origen("faltante")}</div></div>
    <div class="param-grupos">
    ${Object.entries(porCat).map(([cat, xs]) => `<div class="param-grupo"><h3>${esc(GRUPOS[cat] || cat)}</h3>
      <ul class="param-lista">${xs.map((x) => `<li class="param o-${x.origen}">
        <div class="param-cab"><span class="param-nombre">${esc(x.etiqueta)}</span>${origen(x.origen, x.razon)}</div>
        <div class="param-valor">${valor(x)} <span class="unidad">${esc(x.unidad)}</span>${/anual/.test(x.unidad) && x.valor !== null ? ` <span class="unidad">= ${dec(x.valor * res.series.L / 365, 2)}\u00a0% en ${res.series.L} días</span>` : ""}${admin ? ` <button class="btn chico" data-p="${esc(x.clave)}" data-prod="">Editar</button>` : ""}</div>
        <p class="param-razon">${esc(x.razon)}</p>
        <p class="param-desc">${esc(x.descripcion)}${x.actualizado_por && x.actualizado_por !== "carga inicial" ? ` Último cambio: ${esc(x.actualizado_por)}, ${fechaHora(x.actualizado_en)}.` : ""}</p></li>`).join("")}</ul></div>`).join("")}
    </div>
    <h3 class="param-prod-titulo">Por producto</h3>
    ${tabla([{ t: "Producto", html: (p) => `<b>${esc(p.codigo)}</b><div class="nota">${esc(p.descripcion)}</div>` },
      ...defsProd.map((d) => ({ t: `${d.etiqueta}, ${d.unidad}`, html: (p) => { const x = P.leer(d.clave, p.codigo);
        return `<div class="celda-param o-${x.origen}" title="${esc(x.razon)}">${valor(x)} ${origen(x.origen, x.razon)}${admin ? `<button class="btn chico" data-p="${esc(d.clave)}" data-prod="${esc(p.codigo)}" aria-label="Editar ${esc(d.etiqueta)} de ${esc(p.codigo)}">Editar</button>` : ""}</div>`; } }))],
      res.series.productos)}
`;
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

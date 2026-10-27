// Tablero de gestión: valorización, rotación y clasificación ABC / XYZ del inventario.
// Usa los mismos datos que «Costo y servicio» (analisis_datos); los cálculos están en modelo.js.
import { rpc, leer } from "./api.js?v=202610272255";
import { esc, num, aviso, ICON, tabla, descargarCSV, usd, dec, pct, origen, TZ } from "./ui.js?v=202610272255";
import { clasificar } from "./modelo.js?v=202610272255";

const fLarga = (iso) => iso.split("-").reverse().join("/");
const usd0 = (v) => (v === null || v === undefined ? "—" : `USD ${Math.round(v).toLocaleString("es-AR")}`);
const diaLocal = (v) => new Date(v).toLocaleDateString("sv-SE", { timeZone: TZ });
const USO = {
  A: "Pocos productos, mucho valor: conteo cíclico frecuente con tolerancia cero y nivel de servicio alto.",
  B: "Control intermedio: conteo periódico y revisión de la política cada mes.",
  C: "Mucho producto, poco valor: conteos espaciados y lotes más grandes para pedir menos veces.",
};
const USO_XYZ = {
  X: "Demanda estable: alcanza un stock de seguridad chico.",
  Y: "Demanda variable: stock de seguridad según el nivel de servicio.",
  Z: "Demanda muy irregular: el stock de seguridad estadístico es poco confiable; conviene revisar a mano o pedir contra pedido.",
};

let vista = null;

export async function render(el, { params }) {
  vista = { el, desde: params[0] || null, hasta: params[1] || null };
  el.innerHTML = `
    <div class="gs-cab">
      <form id="g-periodo" class="cs-grupo" aria-label="Período">
        <div class="cs-campo"><label for="g-desde">Desde</label><input id="g-desde" type="date" required></div>
        <div class="cs-campo"><label for="g-hasta">Hasta</label><input id="g-hasta" type="date" required></div>
        <button class="btn" type="submit">Ver período</button>
      </form>
      <a class="btn" href="#/costos">${ICON.costo} Costo y servicio</a>
    </div>
    <div id="g-msg"></div><div id="g-cuerpo"><div class="cargando">Cargando datos del período…</div></div>`;
  el.querySelector("#g-periodo").addEventListener("submit", (e) => {
    e.preventDefault(); vista.desde = el.querySelector("#g-desde").value; vista.hasta = el.querySelector("#g-hasta").value; cargar();
  });
  await cargar();
}

async function cargar() {
  const el = vista.el;
  let datos, difs = null;
  try { datos = await rpc("analisis_datos", { p_desde: vista.desde || null, p_hasta: vista.hasta || null }); }
  catch (e) { el.querySelector("#g-msg").innerHTML = aviso("error", `No se pudieron leer los datos del período: ${esc(e.message)}. Revisá las fechas y tocá «Ver período».`); return; }
  try { difs = await leer("v_diferencias", (q) => q, "jornada,fecha_corte,diferencia"); } catch { /* sin exactitud */ }
  el.querySelector("#g-msg").innerHTML = "";
  vista.desde = datos.desde; vista.hasta = datos.hasta;
  for (const id of ["g-desde", "g-hasta"]) { const i = el.querySelector("#" + id); i.min = datos.fecha_min_datos; i.max = datos.fecha_max_datos; }
  el.querySelector("#g-desde").value = datos.desde; el.querySelector("#g-hasta").value = datos.hasta;
  pintar(clasificar(datos), exactitud(difs, datos.hasta));
}

function exactitud(difs, hasta) {
  if (!difs) return null;
  const porJ = {};
  for (const d of difs) {
    if (diaLocal(d.fecha_corte) > hasta) continue;
    const j = (porJ[d.jornada] ||= { jornada: d.jornada, corte: d.fecha_corte, lineas: 0, ok: 0 });
    j.lineas++; if (d.diferencia === 0) j.ok++;
  }
  const u = Object.values(porJ).sort((a, b) => (a.corte < b.corte ? 1 : -1))[0];
  return u ? { ...u, valor: u.ok / u.lineas } : null;
}

function pintar(r, ex) {
  const { filas, tot, L, cortes, S } = r;
  const periodo = `${fLarga(S.dias[0])} al ${fLarga(S.dias[L - 1])} (${L} días)`;
  const orden = [...filas].sort((a, b) => (b.consumo || 0) - (a.consumo || 0));
  const maxC = Math.max(...filas.map((x) => x.consumo || 0), 1);
  const maxCv = Math.max(...filas.map((x) => x.cv || 0), cortes.cY.valor * 1.2);
  const cuenta = (k, v) => filas.filter((x) => x[k] === v).length;
  const todosZ = filas.filter((x) => !x.sinVentas).every((x) => x.xyz === "Z");
  const notas = [];
  const fig = (t, v, nota) => { notas.push([t, nota]); return `<div class="fig" tabindex="0" title="${esc(nota)}"><div class="fig-t">${t}</div><div class="fig-v">${v}</div></div>`; };
  const supCosto = filas.some((x) => x.origenCosto.origen === "supuesto");
  const barra = (v, max, cl, txt) => `<div class="gb"><div class="gb-pista"><div class="gb-barra ${cl}" style="width:${Math.max(0, v) / max * 100}%" title="${esc(txt)}"></div></div></div>`;
  const marcas = (max) => [cortes.cX.valor, cortes.cY.valor].map((c) => `<i class="gb-corte" style="left:${c / max * 100}%" aria-hidden="true"></i>`).join("");

  vista.el.querySelector("#g-cuerpo").innerHTML = `
    <section class="bloque">
      <div class="bloque-cab"><h2>Inventario del período</h2><p class="bloque-sub">${periodo}. ${supCosto ? `Valores con costos unitarios ${origen("supuesto", "Costos unitarios estimados: se editan en Costo y servicio › Parámetros y supuestos.")}.` : ""}</p></div>
      <div class="figuras figuras-4">
        ${fig("Valor del inventario al cierre", usd0(tot.valorFin), `Stock al ${fLarga(S.dias[L - 1])} × costo unitario, sumando los ${filas.length} productos.`)}
        ${fig("Rotación, veces por año", tot.rotacion === null ? "—" : dec(tot.rotacion, 1), `Consumo valorizado anualizado ÷ inventario promedio valorizado = (${usd0(tot.consumo)} × 365 ÷ ${L}) ÷ ${usd0(tot.valorProm)}.`)}
        ${fig("Días de inventario", tot.dias === null ? "—" : dec(tot.dias, 0), `Inventario promedio valorizado ÷ consumo valorizado por día = ${usd0(tot.valorProm)} ÷ (${usd0(tot.consumo)} ÷ ${L}).`)}
        ${fig("Exactitud del último conteo", ex ? pct(ex.valor) : "sin conteo", ex ? `${ex.jornada}: ${ex.ok} de ${ex.lineas} registros sin diferencia.` : "No hay conteos hasta el final del período.")}
      </div>
      ${tot.sinVentas ? `<p class="g-nota"><b>${tot.sinVentas} producto${tot.sinVentas > 1 ? "s" : ""} sin ventas en el período</b> (${filas.filter((x) => x.sinVentas).map((x) => esc(x.codigo)).join(", ")}): ${usd0(filas.filter((x) => x.sinVentas).reduce((a, x) => a + (x.valorFin || 0), 0))} inmovilizados. </p>` : ""}
      <details class="traza"><summary>Cómo se calcula cada número</summary><ul>${notas.map(([t, n]) => `<li><b>${t}</b>: ${esc(n)}</li>`).join("")}</ul>
        <p>Rotación y días anualizan ${L} días: sirven para comparar productos, no como dato anual.</p></details>
    </section>

    <section class="bloque" id="g-abc">
      <div class="bloque-cab"><h2>Clasificación ABC por consumo valorizado</h2>
        <p class="bloque-sub">Consumo = ventas del período × costo unitario. A: hasta ${dec(cortes.cA.valor, 0)} % del acumulado ${origen(cortes.cA.origen, cortes.cA.razon)}; B: hasta ${dec(cortes.cB.valor, 0)} % ${origen(cortes.cB.origen, cortes.cB.razon)}; C: el resto.</p></div>
      <div class="leyenda-g" aria-hidden="true"><span><i class="sw abc-A"></i>A · ${cuenta("abc", "A")}</span><span><i class="sw abc-B"></i>B · ${cuenta("abc", "B")}</span><span><i class="sw abc-C"></i>C · ${cuenta("abc", "C")}</span></div>
      ${tabla([
        { t: "Producto", html: (x) => `<b>${esc(x.codigo)}</b><div class="nota">${esc(x.descripcion)}</div>` },
        { t: "Clase", html: (x) => `<span class="clase abc-${x.abc}">${x.abc}</span>` },
        { t: "Consumo", num: true, html: (x) => `<span title="${dec(x.ventas, 0)} un. × ${usd(x.c)}">${usd0(x.consumo)}</span>` },
        { t: "", html: (x) => barra(x.consumo || 0, maxC, `abc-${x.abc}`, `${x.codigo}: ${usd0(x.consumo)}, ${dec(x.parte, 1)} % del consumo`) },
        { t: "% del total", num: true, html: (x) => `${dec(x.parte, 1)} %` },
        { t: "% acumulado", num: true, html: (x) => `${dec(x.acumulado, 1)} %` },
      ], orden)}
      <p class="g-nota">${cuenta("abc", "A")} de ${filas.length} productos explican el ${dec(orden.filter((x) => x.abc === "A").reduce((a, x) => a + x.parte, 0), 1)} % del consumo valorizado.</p>
    </section>

    <section class="bloque" id="g-xyz">
      <div class="bloque-cab"><h2>Clasificación XYZ por variabilidad de la demanda</h2>
        <p class="bloque-sub">CV = σ ÷ demanda diaria, con los ${L} días del período (incluye días sin venta). X: hasta ${dec(cortes.cX.valor, 2)} ${origen(cortes.cX.origen, cortes.cX.razon)}; Y: hasta ${dec(cortes.cY.valor, 2)} ${origen(cortes.cY.origen, cortes.cY.razon)}; Z: más.</p></div>
      ${tabla([
        { t: "Producto", html: (x) => `<b>${esc(x.codigo)}</b>` },
        { t: "Clase", html: (x) => (x.xyz ? `<span class="clase xyz-${x.xyz}">${x.xyz}</span>` : `<span class="muted small">Sin ventas</span>`) },
        { t: "Demanda por día", num: true, html: (x) => dec(x.dbar, 2) },
        { t: "σ por día", num: true, html: (x) => dec(x.sigma, 2) },
        { t: "CV", num: true, html: (x) => (x.cv === null ? "—" : `<span title="${dec(x.sigma, 2)} ÷ ${dec(x.dbar, 2)}">${dec(x.cv, 2)}</span>`) },
        { t: "", html: (x) => (x.cv === null ? "" : `<div class="gb"><div class="gb-pista">${marcas(maxCv)}<div class="gb-barra xyz-${x.xyz}" style="width:${x.cv / maxCv * 100}%" title="${esc(`${x.codigo}: CV ${dec(x.cv, 2)}`)}"></div></div></div>`) },
      ], [...filas].sort((a, b) => (a.cv ?? 99) - (b.cv ?? 99)))}
      ${todosZ ? `<p class="g-nota"><b>Todos los productos con ventas son Z:</b> venden pocos días y en cantidades grandes. Con ${L} días no se puede saber si es su comportamiento habitual; hace falta más historia.</p>` : ""}
    </section>

    <section class="bloque" id="g-matriz">
      <div class="bloque-cab"><h2>Matriz ABC × XYZ</h2><p class="bloque-sub">Cuánto control merece cada producto y cómo reponerlo.</p></div>
      <div class="tabla-cont"><table class="matriz"><thead><tr><th></th>${["X", "Y", "Z"].map((k) => `<th scope="col"><span class="clase xyz-${k}">${k}</span></th>`).join("")}<th scope="col">Sin ventas</th></tr></thead>
        <tbody>${["A", "B", "C"].map((a) => `<tr><th scope="row"><span class="clase abc-${a}">${a}</span></th>${["X", "Y", "Z", null].map((k) => {
          const xs = filas.filter((x) => x.abc === a && x.xyz === k);
          return `<td class="${xs.length ? "lleno" : ""}">${xs.length ? xs.map((x) => `<b>${esc(x.codigo)}</b>`).join(" ") : "—"}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div>
      <dl class="uso">${["A", "B", "C"].map((k) => `<dt><span class="clase abc-${k}">${k}</span></dt><dd>${USO[k]}</dd>`).join("")}
        ${["X", "Y", "Z"].map((k) => `<dt><span class="clase xyz-${k}">${k}</span></dt><dd>${USO_XYZ[k]}</dd>`).join("")}</dl>
    </section>

    <section class="bloque" id="g-valor">
      <div class="bloque-cab"><h2>Valorización y rotación por producto</h2>
        <div class="btns"><button class="btn chico" id="g-csv">${ICON.csv} Exportar CSV</button></div></div>
      ${tabla([
        { t: "Producto", html: (x) => `<b>${esc(x.codigo)}</b><div class="nota">${esc(x.descripcion)}</div>` },
        { t: "Clase", html: (x) => `<span class="clase abc-${x.abc}">${x.abc}</span>${x.xyz ? `<span class="clase xyz-${x.xyz}">${x.xyz}</span>` : ""}` },
        { t: "Costo unitario", num: true, html: (x) => `${usd(x.c)} ${origen(x.origenCosto.origen, x.origenCosto.razon)}` },
        { t: "Stock al cierre", num: true, html: (x) => num(x.stockFin) },
        { t: "Valor al cierre", num: true, html: (x) => usd0(x.valorFin) },
        { t: "Valor promedio", num: true, html: (x) => `<span title="Stock promedio ${dec(x.stockProm, 1)} un. × ${usd(x.c)}">${usd0(x.valorProm)}</span>` },
        { t: "Rotación, veces/año", num: true, html: (x) => (x.rotacion === null ? "—" : `<span title="(${usd0(x.consumo)} × 365 ÷ ${L}) ÷ ${usd0(x.valorProm)}">${dec(x.rotacion, 1)}</span>`) },
        { t: "Días de inventario", num: true, html: (x) => (x.dias === null ? "—" : `<span title="Stock promedio ÷ demanda diaria = ${dec(x.stockProm, 1)} ÷ ${dec(x.dbar, 2)}">${dec(x.dias, 0)}</span>`) },
      ], orden)}
    </section>`;

  vista.el.querySelector("#g-csv").addEventListener("click", () => descargarCSV(`gestion_inventario_${S.dias[0]}_${S.dias[L - 1]}.csv`, orden, [
    { t: "Producto", f: (x) => x.codigo }, { t: "Descripcion", f: (x) => x.descripcion }, { t: "ClaseABC", f: (x) => x.abc }, { t: "ClaseXYZ", f: (x) => x.xyz || "" },
    { t: "VentasUnidades", f: (x) => x.ventas }, { t: "CostoUnitarioUSD", f: (x) => dec(x.c, 2) }, { t: "ConsumoUSD", f: (x) => dec(x.consumo, 2) },
    { t: "ParteConsumoPct", f: (x) => dec(x.parte, 2) }, { t: "AcumuladoPct", f: (x) => dec(x.acumulado, 2) }, { t: "DemandaDiaria", f: (x) => dec(x.dbar, 4) },
    { t: "Desvio", f: (x) => dec(x.sigma, 4) }, { t: "CV", f: (x) => dec(x.cv, 4) }, { t: "StockCierre", f: (x) => x.stockFin },
    { t: "ValorCierreUSD", f: (x) => dec(x.valorFin, 2) }, { t: "ValorPromedioUSD", f: (x) => dec(x.valorProm, 2) },
    { t: "RotacionAnual", f: (x) => dec(x.rotacion, 2) }, { t: "DiasInventario", f: (x) => dec(x.dias, 1) },
    { t: "Desde", f: () => S.dias[0] }, { t: "Hasta", f: () => S.dias[L - 1] }]));
}

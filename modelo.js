// Modelo de costo de inventario y nivel de servicio.
// Funciones puras (sin pantalla): reciben los datos reales que entrega el servidor
// (analisis_datos) y devuelven cada resultado junto con su fórmula y sus datos de entrada.

export const MOTIVOS = {
  cancelacion_pago: "Cancelación por imposibilidad de pago",
  calidad: "Defecto de calidad",
  error_entrega: "Error de entrega",
  otro: "Otro motivo",
};
export const MOTIVO_SUPUESTO = "cancelacion_pago";

export const CATEGORIAS = [
  { id: "capital", t: "Capital inmovilizado", grupo: "Financiero" },
  { id: "almacenamiento", t: "Almacenamiento", grupo: "Operativo" },
  { id: "orden", t: "Órdenes de compra", grupo: "Operativo" },
  { id: "manipulacion", t: "Manipulación", grupo: "Operativo" },
  { id: "devoluciones", t: "Devoluciones", grupo: "Calidad" },
  { id: "obsolescencia", t: "Obsolescencia", grupo: "Calidad" },
  { id: "quiebre", t: "Quiebre", grupo: "Quiebre" },
];

const DIA_MS = 86400000;
const r2 = (x) => Math.round(x * 100) / 100;

// z de la normal estándar para una probabilidad p (algoritmo de Acklam, error < 1,2e-9).
export function zDeNS(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export function listaDias(desde, hasta) {
  const out = [];
  for (let t = Date.parse(desde + "T00:00:00Z"); t <= Date.parse(hasta + "T00:00:00Z"); t += DIA_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ---------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------
export function prepararParametros(lista) {
  const g = {}, p = {}, defs = {};
  for (const x of lista) {
    defs[x.clave] = { clave: x.clave, ambito: x.ambito, categoria: x.categoria, etiqueta: x.etiqueta, unidad: x.unidad,
      minimo: x.minimo, maximo: x.maximo, descripcion: x.descripcion, orden: x.orden };
    const fila = { ...defs[x.clave], producto: x.producto || "", valor: x.valor === null || x.valor === undefined ? null : Number(x.valor),
      origen: x.origen, razon: x.razon, actualizado_por: x.actualizado_por, actualizado_en: x.actualizado_en };
    if (x.ambito === "global") g[x.clave] = fila;
    else if (x.producto) (p[x.producto] ||= {})[x.clave] = fila;
  }
  const leer = (clave, prod) => (prod ? p[prod]?.[clave] : g[clave]) || { ...(defs[clave] || { clave, etiqueta: clave, unidad: "" }), valor: null, origen: "faltante", razon: "Sin valor cargado." };
  return { g, p, defs, leer, v: (clave, prod) => leer(clave, prod).valor };
}

// ---------------------------------------------------------------------
// Series diarias por producto a partir de los movimientos reales
// ---------------------------------------------------------------------
export function prepararSeries(datos) {
  const dias = listaDias(datos.desde, datos.hasta);
  const idx = Object.fromEntries(dias.map((d, i) => [d, i]));
  const L = dias.length;
  const cero = () => new Array(L).fill(0);
  const vacio = () => Array.from({ length: L }, () => []);
  const productos = datos.productos.map((pr) => ({
    codigo: pr.codigo, descripcion: pr.descripcion, activo: pr.activo, s0: Number(pr.stock_inicio) || 0,
    ventas: cero(), lineas: vacio(), recep: cero(), ordenes: cero(), ajustes: cero(), otros: cero(),
    movidas: cero(), retornos: [], eventos: vacio(), stock: cero(),
  }));
  const porCod = Object.fromEntries(productos.map((p) => [p.codigo, p]));
  for (const m of datos.movimientos) {
    const i = idx[m.fecha]; const p = porCod[m.producto];
    if (i === undefined || !p) continue;
    const c = Number(m.cantidad);
    p.eventos[i].push({ tipo: m.tipo, cantidad: c });
    p.movidas[i] += Math.abs(c);
    if (m.tipo === "Salida_Venta") { p.ventas[i] += -c; p.lineas[i].push(-c); }
    else if (m.tipo === "Ingreso_Orden_Compra") { p.recep[i] += c; p.ordenes[i] += 1; }
    else if (m.tipo === "Retorno_Venta") {
      p.retornos.push({ id: m.id, id_publico: m.id_publico, fecha: m.fecha, dia: i, cantidad: c, documento: m.documento,
        posicion: m.posicion, lote: m.lote, motivo: m.motivo || MOTIVO_SUPUESTO, motivoSupuesto: !m.motivo, motivo_obs: m.motivo_obs, motivo_por: m.motivo_por });
    } else if (String(m.tipo).startsWith("Ajuste")) p.ajustes[i] += c;
    else p.otros[i] += c;
  }
  for (const p of productos) {
    let s = p.s0;
    for (let i = 0; i < L; i++) { for (const e of p.eventos[i]) s += e.cantidad; p.stock[i] = s; }
  }
  return { dias, L, productos };
}

// ---------------------------------------------------------------------
// Simulaciones día por día (la demanda no atendida se pierde, no se acumula)
// ---------------------------------------------------------------------
const escalar = (q, f) => Math.max(0, Math.round(q * f));

// Política actual: se repiten las recepciones, retornos y ajustes registrados; solo cambian las ventas.
export function simularActual(prod, f) {
  const L = prod.stock.length;
  let on = prod.s0;
  const stock = new Array(L).fill(0), lin = new Array(L).fill(0), linOk = new Array(L).fill(0), falta = new Array(L).fill(0);
  for (let t = 0; t < L; t++) {
    for (const e of prod.eventos[t]) {
      if (e.tipo === "Salida_Venta") {
        const q = escalar(-e.cantidad, f);
        if (q <= 0) continue;
        lin[t]++;
        if (on >= q) { on -= q; linOk[t]++; } else { falta[t] += q - on; on = 0; }
      } else on = Math.max(0, on + e.cantidad);
    }
    stock[t] = on;
  }
  return { stock, lin, linOk, falta, ...totalesSim(lin, linOk, falta) };
}

// Política propuesta (s, Q): arranca en régimen con el stock objetivo (SS + Q); al cerrar cada día,
// si la posición (stock + pedidos en camino) queda en el punto de reorden o debajo, se pide Q.
// El pedido llega al inicio del día t + plazo. Los retornos registrados se suman; los ajustes de conteo no.
export function simularPropuesta(prod, pol, f) {
  const L = prod.stock.length;
  const stock = new Array(L).fill(0), lin = new Array(L).fill(0), linOk = new Array(L).fill(0), falta = new Array(L).fill(0);
  if (!pol.calculable) return { stock, lin, linOk, falta, ordenes: 0, ...totalesSim(lin, linOk, falta) };
  let on = pol.objetivo; const camino = []; let ordenes = 0;
  const lt = Math.max(1, Math.ceil(pol.LT));
  const retPorDia = new Array(L).fill(0);
  for (const r of prod.retornos) retPorDia[r.dia] += r.cantidad;
  for (let t = 0; t < L; t++) {
    for (let k = camino.length - 1; k >= 0; k--) if (camino[k].dia === t) { on += camino[k].q; camino.splice(k, 1); }
    on += retPorDia[t];
    for (const q0 of prod.lineas[t]) {
      const q = escalar(q0, f);
      if (q <= 0) continue;
      lin[t]++;
      if (on >= q) { on -= q; linOk[t]++; } else { falta[t] += q - on; on = 0; }
    }
    stock[t] = on;
    if (pol.Q > 0) {
      let posicion = on + camino.reduce((a, c) => a + c.q, 0);
      while (posicion <= pol.ROP) { camino.push({ dia: t + lt, q: pol.Q }); posicion += pol.Q; ordenes++; }
    }
  }
  return { stock, lin, linOk, falta, ordenes, ...totalesSim(lin, linOk, falta) };
}

function totalesSim(lin, linOk, falta) {
  const lineas = lin.reduce((a, b) => a + b, 0), ok = linOk.reduce((a, b) => a + b, 0);
  return { lineas, lineasOk: ok, unidadesFaltantes: falta.reduce((a, b) => a + b, 0), otif: lineas ? ok / lineas : null };
}

// ---------------------------------------------------------------------
// Costos por día de la situación actual (sobre una trayectoria de stock)
// ---------------------------------------------------------------------
export function costosDiarios(prod, P, stock, faltaDia) {
  const L = stock.length;
  const c = P.v("costo_unitario", prod.codigo);
  const rc = P.v("tasa_capital"), ra = P.v("tasa_almacenamiento"), ro = P.v("tasa_obsolescencia");
  const S = P.v("costo_orden"), M = P.v("costo_manipulacion"), cq = P.v("costo_quiebre");
  const cat = Object.fromEntries(CATEGORIAS.map((k) => [k.id, new Array(L).fill(0)]));
  const valor = new Array(L).fill(0);
  for (let t = 0; t < L; t++) {
    const v = c === null ? 0 : Math.max(0, stock[t]) * c;
    valor[t] = v;
    if (c !== null) {
      cat.capital[t] = v * (rc || 0) / 100 / 365;
      cat.almacenamiento[t] = v * (ra || 0) / 100 / 365;
      cat.obsolescencia[t] = v * (ro || 0) / 100 / 365;
    }
    cat.orden[t] = prod.ordenes[t] * (S || 0);
    cat.manipulacion[t] = prod.movidas[t] * (M || 0);
    cat.quiebre[t] = cq === null ? 0 : (faltaDia?.[t] || 0) * cq;
  }
  for (const r of prod.retornos) {
    const ev = P.v(`dev_evento_${r.motivo}`) || 0, perd = P.v(`dev_perdida_${r.motivo}`) || 0;
    cat.devoluciones[r.dia] += ev + (c === null ? 0 : r.cantidad * c * perd / 100);
  }
  const tot = Object.fromEntries(CATEGORIAS.map((k) => [k.id, cat[k.id].reduce((a, b) => a + b, 0)]));
  tot.total = CATEGORIAS.reduce((a, k) => a + tot[k.id], 0);
  return { cat, tot, valor, valorPromedio: valor.reduce((a, b) => a + b, 0) / L, stockPromedio: stock.reduce((a, b) => a + Math.max(0, b), 0) / L, sinCosto: c === null };
}

// ---------------------------------------------------------------------
// Política propuesta por producto: SS, ROP, lote, stock objetivo y costo en régimen
// ---------------------------------------------------------------------
export function politica(prod, P, { f, ns, L }) {
  const d = prod.ventas.map((x) => x * f);
  const n = d.length;
  const dbar = d.reduce((a, b) => a + b, 0) / n;
  const sigma = n > 1 ? Math.sqrt(d.reduce((a, x) => a + (x - dbar) ** 2, 0) / (n - 1)) : null;
  const diasVenta = prod.ventas.filter((x) => x > 0).length;
  const minPer = P.v("min_periodos_confianza") ?? 12, minDV = P.v("min_dias_venta_confianza") ?? 6;
  const motivosConf = [];
  if (n < minPer) motivosConf.push(`${n} períodos (mínimo ${minPer})`);
  if (diasVenta < minDV) motivosConf.push(`${diasVenta} día(s) con venta (mínimo ${minDV})`);
  const c = P.v("costo_unitario", prod.codigo);
  const LT = P.v("lead_time", prod.codigo), sLT = P.v("desvio_lead_time", prod.codigo);
  const lote = P.v("lote_minimo", prod.codigo);
  const S = P.v("costo_orden") || 0;
  const tasas = (P.v("tasa_capital") || 0) + (P.v("tasa_almacenamiento") || 0) + (P.v("tasa_obsolescencia") || 0);
  const z = zDeNS(ns / 100);
  const base = { codigo: prod.codigo, n, dbar, sigma, diasVenta, bajaConfianza: motivosConf.length > 0, motivosConf, z, ns, LT, sLT, lote, c, S, tasas,
    demandaTotal: d.reduce((a, b) => a + b, 0) };
  const faltan = [];
  if (LT === null) faltan.push("plazo de reposición");
  if (sigma === null) faltan.push("al menos 2 períodos de historia");
  if (faltan.length) return { ...base, calculable: false, faltan, SS: null, ROP: null, Q: 0, objetivo: null, promedio: null };
  const combinada = sLT !== null && sLT > 0;
  const ssExacto = combinada ? z * Math.sqrt(LT * sigma ** 2 + dbar ** 2 * sLT ** 2) : z * sigma * Math.sqrt(LT);
  const SS = dbar > 0 ? Math.ceil(ssExacto - 1e-9) : 0;
  const ropExacto = dbar * LT + SS;
  const ROP = dbar > 0 ? Math.ceil(ropExacto - 1e-9) : 0;
  const H = c === null ? null : c * tasas / 100;                    // USD por unidad por año
  const Da = dbar * 365;
  const EOQ = dbar > 0 && H > 0 && S > 0 ? Math.sqrt(2 * Da * S / H) : null;
  const Q = dbar > 0 ? Math.max(Math.ceil((EOQ || 0) - 1e-9), lote || 0, 1) : 0;
  const objetivo = SS + Q;
  const promedio = SS + Q / 2;
  return { ...base, calculable: true, faltan, combinada, ssExacto, SS, ropExacto, ROP, H, Da, EOQ, Q, objetivo, promedio,
    ordenesPeriodo: Q > 0 ? base.demandaTotal / Q : 0, sinDemanda: dbar === 0 };
}

export function costoPropuesta(pol, P, L, actual, faltantes) {
  const out = Object.fromEntries(CATEGORIAS.map((k) => [k.id, 0]));
  const c = pol.c;
  if (pol.calculable && c !== null) {
    const valorProm = pol.promedio * c;
    out.capital = valorProm * (P.v("tasa_capital") || 0) / 100 * L / 365;
    out.almacenamiento = valorProm * (P.v("tasa_almacenamiento") || 0) / 100 * L / 365;
    out.obsolescencia = valorProm * (P.v("tasa_obsolescencia") || 0) / 100 * L / 365;
  }
  out.orden = pol.calculable ? pol.ordenesPeriodo * pol.S : actual.tot.orden;
  out.manipulacion = actual.tot.manipulacion;          // mismas unidades movidas que la situación comparada
  out.devoluciones = actual.tot.devoluciones;          // las devoluciones registradas no dependen de la política
  const cq = P.v("costo_quiebre");
  out.quiebre = cq === null ? 0 : faltantes * cq;
  out.total = CATEGORIAS.reduce((a, k) => a + out[k.id], 0);
  out.valorPromedio = pol.calculable && c !== null ? pol.promedio * c : null;
  return out;
}

// ---------------------------------------------------------------------
// Análisis completo
// ---------------------------------------------------------------------
export function analizar(datos, { variacion = 0, ns = null, granularidad = "dia" } = {}) {
  const P = prepararParametros(datos.parametros);
  const S = prepararSeries(datos);
  const nsUsado = ns ?? P.v("nivel_servicio") ?? 95;
  const res = calcular(S, P, variacion, nsUsado);
  res.P = P; res.series = S; res.variacion = variacion; res.ns = nsUsado; res.granularidad = granularidad;
  res.periodos = agrupar(S, res, granularidad);
  res.sensibilidad = [0, 10, 20, 30, 50].map((v) => {
    const r = v === variacion ? res : calcular(S, P, v, nsUsado);
    return { variacion: v, costoActual: r.tot.actual.total, costoPropuesta: r.tot.propuesta.total,
      otifActual: r.tot.otifActual, otifPropuesta: r.tot.otifPropuesta, faltaActual: r.tot.faltaActual, faltaPropuesta: r.tot.faltaPropuesta };
  });
  // Curva costo–servicio: la misma historia con cada nivel de servicio (SS, ROP y lote se recalculan con su z).
  const niveles = [...new Set([80, 85, 90, 95, 97.5, 99, 99.5, 99.9, nsUsado])].sort((x, y) => x - y);
  res.curvaServicio = niveles.map((ns) => {
    const r = ns === nsUsado ? res : calcular(S, P, variacion, ns);
    const calc = r.filas.filter((x) => x.pol.calculable && !x.pol.sinDemanda);
    return { ns, z: zDeNS(ns / 100), ssTotal: calc.reduce((a, x) => a + x.pol.SS, 0), maxTotal: calc.reduce((a, x) => a + x.pol.objetivo, 0),
      costoPropuesta: r.tot.propuesta.total, costoActual: r.tot.actual.total, valorProm: r.tot.valorPromPropuesta,
      otifPropuesta: r.tot.otifPropuesta, faltaPropuesta: r.tot.faltaPropuesta };
  });
  const cumple = res.curvaServicio.filter((c) => c.faltaPropuesta === 0);
  res.nsMinimoCompleto = cumple.length ? cumple.reduce((m, c) => (c.costoPropuesta < m.costoPropuesta ? c : m)) : null;
  res.equilibrioOrden = equilibrio(S, P, variacion, nsUsado, "costo_orden", 0, 1000);
  res.supuestos = supuestosActivos(P, S);
  res.conclusion = conclusion(res);
  return res;
}

function calcular(S, P, variacion, ns) {
  const f = 1 + variacion / 100;
  const filas = S.productos.map((prod) => {
    const simA = simularActual(prod, f);
    const actual = costosDiarios(prod, P, simA.stock, simA.falta);
    const pol = politica(prod, P, { f, ns, L: S.L });
    const simP = simularPropuesta(prod, pol, f);
    const prop = costoPropuesta(pol, P, S.L, actual, simP.unidadesFaltantes);
    const stockFin = simA.stock[S.L - 1];
    const cobertura = pol.dbar > 0 ? stockFin / pol.dbar : null;
    let riesgo;
    if (!pol.calculable) riesgo = { nivel: "faltante", t: "Sin calcular", detalle: `Falta: ${pol.faltan.join(", ")}.` };
    else if (pol.sinDemanda) riesgo = { nivel: "sin_demanda", t: "Sin demanda", detalle: "Sin ventas en el período: no hay base para estimar el riesgo." };
    else if (simP.unidadesFaltantes > 0) riesgo = { nivel: "alto", t: "Alto", detalle: `En la simulación faltaron ${simP.unidadesFaltantes} un. en ${simP.lineas - simP.lineasOk} de ${simP.lineas} líneas.` };
    else if (pol.bajaConfianza) riesgo = { nivel: "incierto", t: "Sin quiebre, baja confianza", detalle: `La simulación entregó todo, pero σ es de baja confianza: ${pol.motivosConf.join(" y ")}.` };
    else riesgo = { nivel: "bajo", t: "Bajo", detalle: `Sin faltantes en la simulación. Probabilidad teórica de quiebre por ciclo: ${r2((1 - ns / 100) * 100)} %.` };
    const reponer = pol.calculable && !pol.sinDemanda && stockFin <= pol.ROP;
    return { prod, simA, actual, pol, simP, prop, stockFin, cobertura, riesgo, reponer };
  });
  const sumCat = (k, campo) => filas.reduce((a, x) => a + (campo === "actual" ? x.actual.tot[k] : x.prop[k]), 0);
  const tot = { actual: {}, propuesta: {} };
  for (const k of [...CATEGORIAS.map((c) => c.id), "total"]) { tot.actual[k] = sumCat(k, "actual"); tot.propuesta[k] = sumCat(k, "propuesta"); }
  tot.valorPromActual = filas.reduce((a, x) => a + x.actual.valorPromedio, 0);
  tot.valorPromPropuesta = filas.reduce((a, x) => a + (x.prop.valorPromedio || 0), 0);
  const lA = filas.reduce((a, x) => a + x.simA.lineas, 0), okA = filas.reduce((a, x) => a + x.simA.lineasOk, 0);
  const lP = filas.reduce((a, x) => a + x.simP.lineas, 0), okP = filas.reduce((a, x) => a + x.simP.lineasOk, 0);
  tot.lineas = lA; tot.otifActual = lA ? okA / lA : null; tot.otifPropuesta = lP ? okP / lP : null;
  tot.faltaActual = filas.reduce((a, x) => a + x.simA.unidadesFaltantes, 0);
  tot.faltaPropuesta = filas.reduce((a, x) => a + x.simP.unidadesFaltantes, 0);
  tot.ventas = filas.reduce((a, x) => a + x.pol.demandaTotal, 0);
  return { filas, tot, f };
}

// Agrupa por día o por semana (bloques de 7 días desde la fecha «desde»).
function agrupar(S, res, gran) {
  const tam = gran === "semana" ? 7 : 1;
  const grupos = [];
  for (let i = 0; i < S.L; i += tam) {
    const j = Math.min(S.L, i + tam) - 1;
    const g = { desde: S.dias[i], hasta: S.dias[j], dias: j - i + 1, cat: {}, ventas: 0, ventasUSD: 0, lA: 0, okA: 0, lP: 0, okP: 0, total: 0 };
    for (const k of CATEGORIAS) g.cat[k.id] = 0;
    for (const x of res.filas) {
      const c = x.pol.c;
      for (let t = i; t <= j; t++) {
        for (const k of CATEGORIAS) g.cat[k.id] += x.actual.cat[k.id][t];
        const v = x.prod.ventas[t] * res.f;
        g.ventas += v; if (c !== null) g.ventasUSD += v * c;
        g.lA += x.simA.lin[t]; g.okA += x.simA.linOk[t]; g.lP += x.simP.lin[t]; g.okP += x.simP.linOk[t];
      }
    }
    g.total = CATEGORIAS.reduce((a, k) => a + g.cat[k.id], 0);
    g.otifActual = g.lA ? g.okA / g.lA : null; g.otifPropuesta = g.lP ? g.okP / g.lP : null;
    g.propuesta = res.tot.propuesta.total * g.dias / S.L;   // costo en régimen, prorrateado por días
    grupos.push(g);
  }
  return grupos;
}

// Valor de un parámetro global en el que la propuesta y la situación actual cuestan lo mismo
// (búsqueda por bisección). Devuelve null si el signo de la diferencia no cambia en el rango.
function equilibrio(S, P, variacion, ns, clave, a, b) {
  const con = (x) => ({ ...P, v: (k, prod) => (k === clave && !prod ? x : P.v(k, prod)) });
  const dif = (x) => { const r = calcular(S, con(x), variacion, ns); return r.tot.propuesta.total - r.tot.actual.total; };
  let fa = dif(a), fb = dif(b);
  if (Math.sign(fa) === Math.sign(fb)) return { clave, valor: null, desde: a, hasta: b, propuestaSiempreMasBarata: fa < 0, actual: P.v(clave) };
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2, fm = dif(m);
    if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; fb = fm; }
  }
  return { clave, valor: (a + b) / 2, actual: P.v(clave), propuestaMasCaraDebajo: fa > 0 };
}

function supuestosActivos(P, S) {
  const motivosUsados = new Set(S.productos.flatMap((p) => p.retornos.map((r) => r.motivo)));
  const usado = (x) => !/^dev_(evento|perdida)_/.test(x.clave) || motivosUsados.has(x.clave.replace(/^dev_(evento|perdida)_/, ""));
  const globales = Object.values(P.g).filter((x) => x.origen === "supuesto" && usado(x));
  const faltGlob = Object.values(P.g).filter((x) => x.origen === "faltante");
  const porClave = {};
  for (const prod of S.productos) {
    for (const x of Object.values(P.p[prod.codigo] || {})) {
      const e = (porClave[x.clave] ||= { clave: x.clave, etiqueta: x.etiqueta, supuesto: [], faltante: [] });
      if (x.origen === "supuesto") e.supuesto.push(prod.codigo);
      if (x.origen === "faltante") e.faltante.push(prod.codigo);
    }
  }
  const retSup = S.productos.flatMap((p) => p.retornos.filter((r) => r.motivoSupuesto));
  return { globales, faltGlob, porProducto: Object.values(porClave), retornosSupuestos: retSup.length };
}

// ---------------------------------------------------------------------
// Conclusión en texto, solo a partir de los resultados
// ---------------------------------------------------------------------
const pct = (x, dec = 1) => (x === null || x === undefined ? "—" : `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: dec })}\u00a0%`);
const usd = (x) => `USD\u00a0${x.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso) => iso.split("-").reverse().join("/");

export function conclusion(res) {
  const { tot, filas } = res;
  const A = tot.actual.total, B = tot.propuesta.total;
  const dif = B - A, difPct = A > 0 ? dif / A : null;
  const oA = tot.otifActual, oB = tot.otifPropuesta;
  const varTxt = res.variacion === 0 ? "con las ventas registradas" : `con ventas ${res.variacion > 0 ? "+" : ""}${res.variacion} % respecto de las registradas`;
  const empeoraServicio = oB !== null && oA !== null && oB < oA - 1e-9;
  const quiebre = tot.faltaPropuesta > 0;
  const bajaCosto = dif < -0.005;
  let veredicto, tono;
  if (bajaCosto && !empeoraServicio && !quiebre) {
    tono = "si";
    veredicto = `Sí. ${cap(varTxt)}, la política propuesta baja el costo del período de ${usd(A)} a ${usd(B)} (${pctSigno(difPct)}) y el OTIF simulado se mantiene en ${pct(oB)}.`;
  } else if (bajaCosto) {
    tono = "no";
    veredicto = `No sin perder servicio. ${cap(varTxt)}, bajar el stock reduce el costo de ${usd(A)} a ${usd(B)} (${pctSigno(difPct)}), pero el OTIF simulado cae de ${pct(oA)} a ${pct(oB)} y faltan ${tot.faltaPropuesta} unidades.`;
  } else {
    tono = "no";
    veredicto = `No. ${cap(varTxt)}, la política propuesta cuesta ${usd(B)} contra ${usd(A)} de la situación actual (${pctSigno(difPct)}).`;
  }
  const detalle = [];
  // Qué categoría explica la diferencia
  const cambios = CATEGORIAS.map((k) => ({ t: k.t, d: tot.propuesta[k.id] - tot.actual[k.id] })).filter((x) => Math.abs(x.d) >= 0.01).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (cambios.length) detalle.push(`La mayor diferencia está en ${cambios[0].t.toLowerCase()}: ${cambios[0].d > 0 ? "+" : "−"}${usd(Math.abs(cambios[0].d))}${cambios[1] ? `; le sigue ${cambios[1].t.toLowerCase()} (${cambios[1].d > 0 ? "+" : "−"}${usd(Math.abs(cambios[1].d))})` : ""}.`);
  detalle.push(`Inventario promedio valorizado: ${usd(tot.valorPromActual)} en la situación actual contra ${usd(tot.valorPromPropuesta)} con la política propuesta${tot.valorPromPropuesta > tot.valorPromActual + 0.005 ? " (el inventario sube: el ahorro no viene de tener menos stock)" : tot.valorPromPropuesta < tot.valorPromActual - 0.005 ? " (el inventario baja)" : ""}.`);
  const eq = res.equilibrioOrden, sOrden = res.P.leer("costo_orden");
  if (eq && eq.valor === null) detalle.push(`Con cualquier costo por orden entre USD ${eq.desde} y USD ${eq.hasta.toLocaleString("es-AR")} la propuesta ${eq.propuestaSiempreMasBarata ? "cuesta menos" : "cuesta más"} que la situación actual: el signo del resultado no depende de ese supuesto (el monto sí).`);
  else if (eq) detalle.push(`El resultado depende del costo por orden${sOrden.origen === "supuesto" ? " (supuesto)" : ""}: con USD ${eq.valor.toLocaleString("es-AR", { maximumFractionDigits: 2 })} por orden ambas políticas cuestan lo mismo; ${eq.propuestaMasCaraDebajo ? "por debajo de ese valor la propuesta cuesta más" : "por encima de ese valor la propuesta cuesta más"}. Hoy se usan USD ${(sOrden.valor ?? 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}.`);
  const calc = filas.filter((x) => x.pol.calculable && x.prop.valorPromedio !== null);
  const bajan = calc.filter((x) => x.prop.valorPromedio < x.actual.valorPromedio - 0.005);
  const suben = calc.filter((x) => x.prop.valorPromedio > x.actual.valorPromedio + 0.005);
  if (bajan.length) detalle.push(`Productos con stock promedio por encima del necesario: ${bajan.map((x) => x.prod.codigo).join(", ")}.`);
  if (suben.length) detalle.push(`Productos que necesitan más stock que el actual para cumplir el nivel de servicio: ${suben.map((x) => x.prod.codigo).join(", ")}.`);
  const conFalta = filas.filter((x) => x.simP.unidadesFaltantes > 0);
  if (conFalta.length) detalle.push(`La política propuesta no alcanzó a cubrir la demanda de ${conFalta.map((x) => `${x.prod.codigo} (${x.simP.unidadesFaltantes} un.)`).join(", ")}.`);
  if (tot.faltaActual > 0) detalle.push(`Con la política actual también faltarían ${tot.faltaActual} unidades (OTIF ${pct(oA)}).`);
  // Sensibilidad
  const sens = res.sensibilidad.filter((s) => s.variacion > 0);
  const primeraFallaP = sens.find((s) => s.faltaPropuesta > 0), primeraFallaA = sens.find((s) => s.faltaActual > 0);
  detalle.push(primeraFallaP
    ? `Ante aumentos de ventas, la política propuesta tiene faltantes desde +${primeraFallaP.variacion} % (OTIF ${pct(primeraFallaP.otifPropuesta)}); la actual ${primeraFallaA ? `desde +${primeraFallaA.variacion} % (OTIF ${pct(primeraFallaA.otifActual)})` : "no tiene faltantes hasta +50 %"}.`
    : `Ante aumentos de ventas de hasta +50 %, la política propuesta no tiene faltantes en la simulación; la actual ${primeraFallaA ? `sí, desde +${primeraFallaA.variacion} % (OTIF ${pct(primeraFallaA.otifActual)})` : "tampoco"}.`);
  // Límites
  const S = res.series;
  const baja = filas.filter((x) => x.pol.bajaConfianza && !x.pol.sinDemanda);
  const sinDem = filas.filter((x) => x.pol.sinDemanda);
  const limites = [];
  limites.push(`Período usado: ${fmtFecha(S.dias[0])} al ${fmtFecha(S.dias[S.L - 1])} (${S.L} días). La demanda y su desvío se calculan por día, incluidos los días sin venta.`);
  if (baja.length) limites.push(`Baja confianza en ${baja.length} de ${filas.length - sinDem.length} productos con ventas (${baja.map((x) => x.prod.codigo).join(", ")}): vendieron entre ${Math.min(...baja.map((x) => x.pol.diasVenta))} y ${Math.max(...baja.map((x) => x.pol.diasVenta))} de ${S.L} días (mínimo ${res.P.v("min_dias_venta_confianza")} días con venta${S.L < res.P.v("min_periodos_confianza") ? ` y ${res.P.v("min_periodos_confianza")} períodos` : ""}). El stock de seguridad supone demanda normal y con pocas ventas esa hipótesis no está respaldada.`);
  if (sinDem.length) limites.push(`Sin ventas en el período: ${sinDem.map((x) => x.prod.codigo).join(", ")}. El modelo no les asigna stock; su stock actual figura como inmovilizado, pero 0 ventas en ${S.L} días no prueba que no haya demanda.`);
  const sup = res.supuestos;
  const nombresSup = [...sup.globales.map((x) => x.etiqueta), ...sup.porProducto.filter((x) => x.supuesto.length).map((x) => `${x.etiqueta} (${x.supuesto.length} prod.)`)];
  if (sup.retornosSupuestos) nombresSup.push(`motivo de ${sup.retornosSupuestos} retorno(s)`);
  if (nombresSup.length) limites.push(`Supuestos activos (${nombresSup.length}): ${nombresSup.join("; ")}. Los montos en USD dependen de ellos.`);
  const nombresFalt = [...sup.faltGlob.map((x) => x.etiqueta), ...sup.porProducto.filter((x) => x.faltante.length).map((x) => `${x.etiqueta} (${x.faltante.length} prod.)`)];
  if (nombresFalt.length) limites.push(`Datos faltantes: ${nombresFalt.join("; ")}.`);
  limites.push("El OTIF es simulado: no hay pedidos de clientes registrados, así que cada retiro por venta se toma como una línea de pedido para el mismo día. La evaluación usa la misma historia con la que se calcula el stock de seguridad (no es una prueba con datos nuevos).");
  limites.push("El costo de la propuesta es el de régimen (stock promedio = SS + Q ÷ 2). Bajar desde el stock actual lleva tiempo: el ahorro se materializa a medida que se consume el excedente.");
  return { tono, veredicto, detalle, limites, dif, difPct };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pctSigno = (x) => (x === null ? "sin base de comparación" : `${x > 0 ? "+" : "−"}${Math.abs(x * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}\u00a0%`);

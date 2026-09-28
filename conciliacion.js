// Conciliación por POSICIÓN + PRODUCTO + LOTE, revisión de diferencias, ajustes y cierre.
import { rpc, leer, puede } from "../api.js";
import { esc, num, signo, claseSigno, aviso, ICON, nuevoId, fechaHora, tabla, chip, CATEGORIAS, ESTADOS_REV, ESTADOS_JORNADA,
         pedir, descargarCSV, toast } from "../ui.js";

export async function render(el, { params }) {
  if (params[0] && /^\d+$/.test(params[0])) return detalle(el, Number(params[0]));
  const jornadas = await leer("v_jornadas", (q) => q.order("id", { ascending: false }));
  el.innerHTML = `<div class="panel"><h2>Elegí una jornada</h2>
    ${tabla([
      { t: "Jornada", html: (j) => `<a href="#/conciliacion/${j.id}"><b>${esc(j.codigo)}</b></a>` },
      { t: "Tipo", html: (j) => j.tipo === "CICLICA" ? "Cíclica" : "Caso TP6 · referencia de la consigna" },
      { t: "Corte", html: (j) => fechaHora(j.fecha_corte) },
      { t: "Estado", html: (j) => chip(ESTADOS_JORNADA, j.estado) },
      { t: "Diferencias", num: true, html: (j) => num(j.diferencias) },
      { t: "Sin resolver", num: true, html: (j) => j.diferencias_sin_resolver ? `<span class="neg">${j.diferencias_sin_resolver}</span>` : "0" },
    ], jornadas)}</div>`;
}

async function detalle(el, id) {
  const [[j]] = await Promise.all([leer("v_jornadas", (q) => q.eq("id", id))]);
  if (!j) { el.innerHTML = aviso("error", "Jornada inexistente."); return; }
  const enVivo = j.estado === "ABIERTA";
  let filas;
  if (enVivo) {
    if (!puede("supervisor")) { el.innerHTML = aviso("info", "La conciliación en vivo de una jornada abierta es visible para supervisores."); return; }
    filas = (await rpc("conciliacion_en_vivo", { p_jornada_id: id })).map((f) => ({ ...f, estado_revision: f.diferencia === 0 ? "SIN_DIFERENCIA" : "PENDIENTE" }));
  } else {
    filas = await leer("v_diferencias", (q) => q.eq("jornada_id", id).order("posicion", { nullsFirst: false }).order("producto").order("lote"));
  }
  const esCaso = j.tipo === "CASO_REFERENCIA";
  const resumenCaso = esCaso ? (await leer("v_caso_resumen"))[0] : null;
  const tot = {
    t: filas.reduce((a, f) => a + f.teorico, 0), f: filas.reduce((a, f) => a + f.fisico, 0),
    d: filas.reduce((a, f) => a + f.diferencia, 0), n: filas.filter((f) => f.diferencia !== 0).length,
    sr: filas.filter((f) => f.diferencia !== 0 && !["AJUSTE_APROBADO", "JUSTIFICADA_SIN_AJUSTE"].includes(f.estado_revision)).length,
  };
  const editable = puede("supervisor") && j.estado === "EN_REVISION";

  el.innerHTML = `
    <div class="panel"><div class="panel-cab"><div><h2>${esc(j.codigo)} ${chip(ESTADOS_JORNADA, j.estado)}</h2>
      <div class="small muted">${esCaso ? "Caso TP6 · conteo físico de referencia de la consigna" : "Jornada cíclica"} · Corte <b>${fechaHora(j.fecha_corte)}</b> (hora Argentina) · Responsable ${esc(j.responsable_nombre)}</div></div>
      <div class="btns"><button class="btn chico" id="csv">${ICON.csv} CSV</button><button class="btn chico" onclick="window.print()">Imprimir</button>
      <a class="btn chico" href="#/conciliacion">Otras jornadas</a></div></div>
      ${enVivo ? aviso("alerta", "<b>Vista preliminar:</b> la jornada sigue abierta. Las diferencias se guardan para revisión al finalizar el conteo.") : ""}
      ${esCaso ? aviso("info", `Stock teórico = stock inicial al 30/09/2026 + movimientos del 01/10 al 14/10/2026 (fecha ≤ corte). Se compara con el conteo de referencia del 14/10/2026 por <b>posición + producto + lote</b>.
         Las posiciones sin registro en la referencia se toman como físico 0 y se indica en la nota. Los dos registros sin posición se muestran aparte, sin asignarles ubicación.`) : ""}
      ${j.posiciones_no_contadas?.length ? aviso("alerta", `<b>Cierre parcial del conteo.</b> No contadas: ${esc(j.posiciones_no_contadas.join(", "))}. Motivo: ${esc(j.motivo_cierre_parcial)}`) : ""}
      ${j.estado.startsWith("CERRADA") ? aviso("ok", `<b>Conciliación cerrada</b> el ${fechaHora(j.cerrada_en)} por ${esc(j.cerrada_por_email)}. Totales guardados: teórico ${num(j.teorico_total)} · físico ${num(j.fisico_total)} · diferencia ${signo(j.diferencia_neta)} · ${num(j.cantidad_diferencias)} diferencias.${j.comentario_cierre ? " " + esc(j.comentario_cierre) : ""}`) : ""}
      <div class="grilla g4">
        <div class="kpi"><div class="etq">Stock teórico</div><div class="val">${num(tot.t)}</div>${esCaso && resumenCaso ? `<div class="sub">${num(resumenCaso.stock_inicial)} inicial ${signo(resumenCaso.variacion_neta)} (${resumenCaso.movimientos} mov.)</div>` : ""}</div>
        <div class="kpi"><div class="etq">Stock físico</div><div class="val">${num(tot.f)}</div></div>
        <div class="kpi ${tot.d < 0 ? "neg" : tot.d > 0 ? "pos" : ""}"><div class="etq">Diferencia neta</div><div class="val">${signo(tot.d)}</div></div>
        <div class="kpi"><div class="etq">Diferencias individuales</div><div class="val">${tot.n}</div><div class="sub">${tot.sr} sin resolver</div></div>
      </div></div>
    <div class="panel">
      <div class="filtros">
        <div><label for="f-cat">Categoría</label><select id="f-cat"><option value="">Todas</option>${Object.entries(CATEGORIAS).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
        <div><label for="f-est">Estado de revisión</label><select id="f-est"><option value="">Todos</option>${Object.entries(ESTADOS_REV).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("")}</select></div>
        <div><label for="f-txt">Posición, producto o lote</label><input id="f-txt" type="text"></div>
        <div><label>&nbsp;</label><label class="check" style="min-height:40px"><input type="checkbox" id="f-dif" checked> Solo con diferencia</label></div>
      </div>
      <div id="msg"></div>
      <div id="tabla"></div>
      ${editable ? `<div class="sep"></div><div class="flex entre"><div class="small muted">Para cerrar, cada diferencia debe tener un ajuste aprobado o una justificación sin ajuste.</div>
        <button class="btn prim" id="cerrar" ${tot.sr ? "disabled" : ""}>Cerrar conciliación</button></div>` : ""}
    </div>`;

  const f = { cat: el.querySelector("#f-cat"), est: el.querySelector("#f-est"), txt: el.querySelector("#f-txt"), dif: el.querySelector("#f-dif") };
  const pintar = () => {
    const t = f.txt.value.trim().toUpperCase();
    const vis = filas.filter((x) => (!f.cat.value || x.categoria === f.cat.value) && (!f.est.value || x.estado_revision === f.est.value)
      && (!f.dif.checked || x.diferencia !== 0 || x.categoria === "SIN_POSICION")
      && (!t || `${x.posicion || ""} ${x.producto} ${x.lote || ""}`.toUpperCase().includes(t)));
    el.querySelector("#tabla").innerHTML = tabla([
      { t: "Posición", html: (x) => x.posicion ? `<b>${esc(x.posicion)}</b>` : `<span class="muted">sin posición</span>` },
      { t: "Producto", html: (x) => `<b>${esc(x.producto)}</b><div class="nota">${esc(x.descripcion || "")}</div>` },
      { t: "Lote", k: "lote" },
      { t: "Teórico", num: true, html: (x) => num(x.teorico) },
      { t: "Físico", num: true, html: (x) => num(x.fisico) },
      { t: "Diferencia", num: true, html: (x) => `<span class="${claseSigno(x.diferencia)}">${signo(x.diferencia)}</span>` },
      { t: "Categoría", html: (x) => `${chip(CATEGORIAS, x.categoria)}${x.nota ? `<div class="nota">${esc(x.nota)}</div>` : ""}` },
      { t: "Revisión", html: (x) => `${chip(ESTADOS_REV, x.estado_revision)}${x.causa ? `<div class="nota"><b>Causa:</b> ${esc(x.causa)}</div>` : ""}
          ${x.comentario ? `<div class="nota">${esc(x.comentario)}</div>` : ""}${x.revisado_por_email ? `<div class="nota">${esc(x.revisado_por_email)} · ${fechaHora(x.revisado_en)}</div>` : ""}
          ${x.ajuste_id ? `<div class="nota">Ajuste <span class="mono">${esc(x.ajuste_id)}</span></div>` : ""}` },
      ...(editable ? [{ t: "Acciones", html: (x) => acciones(x, j) }] : []),
    ], vis, { vacio: "No hay filas para este filtro.", claseFila: (x) => (x.nota && x.diferencia !== 0 ? "resaltar" : "") });
    el.querySelectorAll("[data-acc]").forEach((b) => b.addEventListener("click", () => ejecutar(b.dataset.acc, filas.find((x) => String(x.id) === b.dataset.id), j, el)));
  };
  Object.values(f).forEach((x) => x.addEventListener("input", pintar));
  pintar();

  el.querySelector("#csv").addEventListener("click", () => descargarCSV(`conciliacion_${j.codigo}.csv`, filas, [
    { t: "Jornada", f: () => j.codigo }, { t: "FechaCorte", f: () => fechaHora(j.fecha_corte) }, { k: "posicion", t: "Posicion" },
    { k: "producto", t: "Codigo" }, { k: "lote", t: "Lote" }, { k: "teorico", t: "Teorico" }, { k: "fisico", t: "Fisico" },
    { k: "diferencia", t: "Diferencia" }, { k: "categoria", t: "Categoria" }, { k: "nota", t: "Nota" }, { k: "estado_revision", t: "EstadoRevision" },
    { k: "causa", t: "Causa" }, { k: "comentario", t: "Comentario" }, { k: "revisado_por_email", t: "RevisadoPor" }, { k: "ajuste_id", t: "AjusteMovID" }]));
  el.querySelector("#cerrar")?.addEventListener("click", async () => {
    const r = await pedir({ titulo: `Cerrar ${j.codigo}`, texto: "Se congelan los resultados y las evidencias de la conciliación. No admite cambios posteriores.",
      campos: [{ id: "com", etiqueta: "Comentario de cierre (opcional)", tipo: "textarea" }], confirmar: "Cerrar conciliación" });
    if (!r) return;
    try { await rpc("cerrar_jornada", { p_jornada_id: j.id, p_comentario: r.com || null }); toast("Conciliación cerrada"); detalle(el, id); }
    catch (e) { el.querySelector("#msg").innerHTML = aviso("error", esc(e.message)); }
  });
}

function acciones(x, j) {
  if (x.diferencia === 0 || !x.id || ["AJUSTE_APROBADO", "JUSTIFICADA_SIN_AJUSTE"].includes(x.estado_revision)) return "";
  const b = (acc, t, cls = "") => `<button class="btn chico ${cls}" data-acc="${acc}" data-id="${x.id}">${t}</button>`;
  return `<div class="acc-dif">${x.posicion ? b("ajuste", "Ajustar", "prim") : ""}${j.tipo === "CICLICA" && x.posicion ? b("recuento", "Recuento") : ""}
    ${b("justificar", "Sin ajuste")}${b("investigar", "Comentar")}</div>`;
}

async function ejecutar(acc, x, j, el) {
  const msg = el.querySelector("#msg");
  const desc = `<b>${esc(x.posicion || "sin posición")}</b> · ${esc(x.producto)} / ${esc(x.lote || "—")} · teórico ${num(x.teorico)}, físico ${num(x.fisico)}, diferencia <b>${signo(x.diferencia)}</b>`;
  try {
    if (acc === "investigar") {
      const r = await pedir({ titulo: "Registrar investigación", texto: desc, campos: [
        { id: "com", etiqueta: "Comentario / avance de la investigación", tipo: "textarea", requerido: true }], confirmar: "Guardar" });
      if (!r) return;
      await rpc("revisar_diferencia", { p_diferencia_id: x.id, p_estado: "EN_INVESTIGACION", p_causa: null, p_comentario: r.com });
    } else if (acc === "recuento") {
      const r = await pedir({ titulo: `Solicitar recuento de ${x.posicion}`, texto: `${desc}<br>El operario verá la solicitud al escanear la posición. La primera lectura se conserva.`,
        campos: [{ id: "mot", etiqueta: "Motivo", tipo: "textarea", requerido: true }], confirmar: "Solicitar recuento" });
      if (!r) return;
      await rpc("solicitar_recuento", { p_jornada_id: j.id, p_posicion: x.posicion, p_motivo: r.mot });
    } else if (acc === "ajuste") {
      const r = await pedir({ titulo: "Aprobar ajuste de inventario", texto: `${desc}<br>Se generará un movimiento <b>Ajuste_Inventario_Ciclico</b> de <b>${signo(x.diferencia)}</b> un. en ${esc(x.posicion)}, fechado hoy, vinculado a esta diferencia y a tu usuario.`,
        campos: [{ id: "causa", etiqueta: "Causa investigada", tipo: "textarea", requerido: true, placeholder: "Ej.: rotura verificada, error de ubicación confirmado…" },
                 { id: "com", etiqueta: "Comentario / evidencia (opcional)", tipo: "text" }], confirmar: "Aprobar ajuste" });
      if (!r) return;
      const m = await rpc("aprobar_ajuste", { p_client_id: nuevoId(), p_diferencia_id: x.id, p_causa: r.causa, p_comentario: r.com || null });
      toast(`Ajuste ${m.id} registrado`);
    } else if (acc === "justificar") {
      const r = await pedir({ titulo: "Cerrar sin ajuste", texto: `${desc}<br>El stock teórico no se modifica.`,
        campos: [{ id: "causa", etiqueta: "Causa que justifica no ajustar", tipo: "textarea", requerido: true }], confirmar: "Justificar sin ajuste" });
      if (!r) return;
      await rpc("revisar_diferencia", { p_diferencia_id: x.id, p_estado: "JUSTIFICADA_SIN_AJUSTE", p_causa: r.causa, p_comentario: null });
    }
    await render(el, { params: [String(j.id)] });
  } catch (e) { msg.innerHTML = aviso("error", esc(e.message)); msg.scrollIntoView({ block: "center" }); }
}

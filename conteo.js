// Conteo cíclico: jornadas, captura por posición (QR o manual), recuentos y avance.
import { rpc, leer, estado, puede } from "./api.js?v=202610241532";
import { esc, num, aviso, ICON, nuevoId, fechaHora, tabla, chip, ESTADOS_JORNADA, pedir, toast } from "./ui.js?v=202610241532";
import { escanear } from "./escaner.js?v=202610241532";
import { rackHTML, seguirSync } from "./componentes.js?v=202610241532";

let temporizador = null;
export function destruir() { clearInterval(temporizador); }

export async function render(el, { params }) {
  if (params[0] && /^\d+$/.test(params[0])) return captura(el, Number(params[0]));
  return lista(el);
}

// ------------------------------------------------------------------ Lista de jornadas
async function lista(el) {
  const jornadas = await leer("v_jornadas", (q) => q.order("id", { ascending: false }).limit(30));
  const abiertas = jornadas.filter((j) => j.tipo === "CICLICA" && ["ABIERTA", "EN_REVISION"].includes(j.estado));
  el.innerHTML = `
    <div class="panel"><div class="panel-cab"><h2>Jornadas para contar</h2></div>
      ${abiertas.length ? abiertas.map((j) => `
        <a class="accion" style="margin-bottom:10px;min-height:0" href="#/conteo/${j.id}">
          <div class="flex entre" style="width:100%"><b>${esc(j.codigo)}</b>${chip(ESTADOS_JORNADA, j.estado)}</div>
          <span>Corte ${fechaHora(j.fecha_corte)} · Responsable: ${esc(j.responsable_nombre)} · ${j.posiciones_contadas}/${j.total_posiciones} posiciones contadas${j.recuentos_pendientes ? ` · <b>${j.recuentos_pendientes} recuento(s) pendiente(s)</b>` : ""}</span>
          <div class="progreso" style="width:100%"><div style="width:${Math.round(100 * j.posiciones_contadas / j.total_posiciones)}%"></div></div>
        </a>`).join("") : `<div class="vacio">No hay jornadas de conteo abiertas.${puede("supervisor") ? " Abrí una acá abajo." : " Pedile al supervisor que abra una."}</div>`}
    </div>
    ${puede("supervisor") ? `<details class="panel" id="panel-nueva" ${abiertas.length ? "" : "open"}><summary>Abrir una jornada de conteo</summary><div id="nueva"></div></details>` : ""}
    <div class="panel"><h2>Historial de jornadas</h2>
      ${tabla([
        { t: "Jornada", html: (j) => `<a href="#/conciliacion/${j.id}">${esc(j.codigo)}</a>` },
        { t: "Tipo", html: (j) => j.tipo === "CICLICA" ? "Cíclica" : "Histórico (referencia)" },
        { t: "Corte", html: (j) => fechaHora(j.fecha_corte) },
        { t: "Estado", html: (j) => chip(ESTADOS_JORNADA, j.estado) },
        { t: "Posiciones", num: true, html: (j) => j.tipo === "CICLICA" ? `${j.posiciones_contadas}/${j.total_posiciones}` : j.total_posiciones },
        { t: "Diferencias", num: true, html: (j) => num(j.diferencias) },
      ], jornadas)}
    </div>`;
  if (puede("supervisor")) formularioNueva(el.querySelector("#nueva"));
}

async function formularioNueva(cont) {
  const [usuarios, pos] = await Promise.all([
    leer("perfiles", (q) => q.eq("activo", true).order("nombre"), "id,nombre,rol"),
    leer("v_posiciones_estado", (q) => q.order("posicion")),
  ]);
  const modulos = [...new Set(estado.posiciones.map((p) => p.modulo))].sort();
  cont.innerHTML = `<form id="f-nueva">
    <div class="grilla g2">
      <div class="campo"><label for="alc-tipo">Alcance</label>
        <select id="alc-tipo"><option value="todas">Todas las posiciones activas (${estado.posiciones.filter((p) => p.activa).length})</option>
          <option value="modulos">Por módulo del rack</option><option value="lista">Posiciones seleccionadas</option></select></div>
      <div class="campo"><label for="resp">Responsable del conteo</label>
        <select id="resp">${usuarios.map((u) => `<option value="${u.id}" ${u.id === estado.perfil.id ? "selected" : ""}>${esc(u.nombre)} (${esc(u.rol)})</option>`).join("")}</select></div>
    </div>
    <div id="alc-mod" class="campo oculto"><label>Módulos</label><div class="flex">${modulos.map((m) => `<label class="check"><input type="checkbox" value="${m}"> ${m}</label>`).join("")}</div></div>
    <div id="alc-lista" class="campo oculto"><label>Posiciones (tocá en el mapa)</label><div id="mapa-sel">${rackHTML(pos)}</div>
      <div class="ayuda" id="sel-txt">Ninguna seleccionada.</div></div>
    <div class="campo"><label for="obs-j">Observación</label><input id="obs-j" type="text" maxlength="200" placeholder="Ej.: conteo cíclico semanal, clase A"></div>
    <div class="aviso alerta small">Al abrir la jornada se fija la <b>fecha de corte</b> (ahora) y las posiciones del alcance quedan <b>bloqueadas para ingresos y egresos</b> hasta el cierre.</div>
    <div id="err-j"></div>
    <button class="btn prim" type="submit">${ICON.conteo} Abrir jornada</button></form>`;
  const f = cont.querySelector("#f-nueva");
  const sel = new Set();
  const tipo = f.querySelector("#alc-tipo");
  tipo.addEventListener("change", () => {
    f.querySelector("#alc-mod").classList.toggle("oculto", tipo.value !== "modulos");
    f.querySelector("#alc-lista").classList.toggle("oculto", tipo.value !== "lista");
  });
  f.querySelectorAll("#mapa-sel [data-pos]").forEach((b) => b.addEventListener("click", () => {
    const p = b.dataset.pos;
    sel.has(p) ? sel.delete(p) : sel.add(p);
    b.classList.toggle("contada", sel.has(p));
    f.querySelector("#sel-txt").textContent = sel.size ? `${sel.size} seleccionada(s): ${[...sel].sort().join(", ")}` : "Ninguna seleccionada.";
  }));
  const clientId = nuevoId();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    let alcance = null;
    if (tipo.value === "modulos") {
      const mods = [...f.querySelectorAll("#alc-mod input:checked")].map((i) => i.value);
      alcance = estado.posiciones.filter((p) => p.activa && mods.includes(p.modulo)).map((p) => p.codigo);
      if (!alcance.length) { f.querySelector("#err-j").innerHTML = aviso("error", "Elegí al menos un módulo."); return; }
    } else if (tipo.value === "lista") {
      alcance = [...sel];
      if (!alcance.length) { f.querySelector("#err-j").innerHTML = aviso("error", "Seleccioná al menos una posición."); return; }
    }
    const b = e.submitter; b.disabled = true;
    try {
      const r = await rpc("abrir_jornada", { p_client_id: clientId, p_alcance: alcance, p_responsable_id: f.querySelector("#resp").value,
                                            p_observacion: f.querySelector("#obs-j").value || null });
      toast(`Jornada ${r.codigo} abierta`);
      location.hash = `#/conteo/${r.id}`;
    } catch (err) { f.querySelector("#err-j").innerHTML = aviso("error", esc(err.message)); b.disabled = false; }
  });
}

// ------------------------------------------------------------------ Captura
async function captura(el, jornadaId) {
  let j, pos;
  const cargar = async () => {
    [[j], pos] = await Promise.all([
      leer("v_jornadas", (q) => q.eq("id", jornadaId)),
      leer("v_posiciones_estado", (q) => q.order("posicion")),
    ]);
  };
  await cargar();
  if (!j) { el.innerHTML = aviso("error", "Jornada inexistente."); return; }
  if (j.tipo !== "CICLICA") { location.hash = `#/conciliacion/${j.id}`; return; }

  el.innerHTML = `
    <div class="panel"><div class="panel-cab"><div><h2>${esc(j.codigo)} ${chip(ESTADOS_JORNADA, j.estado)}</h2>
      <div class="small muted">Corte ${fechaHora(j.fecha_corte)} · Responsable ${esc(j.responsable_nombre)}${j.observacion ? " · " + esc(j.observacion) : ""}</div></div>
      <div class="btns">${puede("supervisor") ? `<a class="btn chico" href="#/conciliacion/${j.id}">${ICON.conciliar} Conciliación</a>` : ""}
      <a class="btn chico" href="#/conteo">Volver</a></div></div>
      <div id="avance"></div></div>
    <div class="grilla g2">
      <div class="panel" id="panel-captura">
        <button class="btn prim grande" id="scan">${ICON.qr} Escanear posición</button>
        <form id="f-man" class="fila-input" style="margin-top:10px"><select id="man"></select><button class="btn" type="submit">Usar</button></form>
        <div id="cap" style="margin-top:14px"></div>
      </div>
      <div class="panel"><h2>Posiciones de la jornada</h2><div id="mapa"></div><div id="acciones-sup" style="margin-top:14px"></div></div>
    </div>`;
  const elCap = el.querySelector("#cap");

  const pintarAvance = () => {
    const pend = j.posiciones_pendientes || [];
    el.querySelector("#avance").innerHTML = `
      <div class="flex entre small"><span><b>${j.posiciones_contadas}</b> de ${j.total_posiciones} posiciones contadas</span>
      <span>${pend.length ? `Pendientes: <b>${pend.join(", ")}</b>` : "Todas las posiciones tienen primera lectura"}</span></div>
      <div class="progreso" style="margin-top:6px"><div style="width:${Math.round(100 * j.posiciones_contadas / j.total_posiciones)}%"></div></div>
      ${j.recuentos_pendientes ? aviso("info", `Hay <b>${j.recuentos_pendientes}</b> recuento(s) solicitado(s) por el supervisor.`) : ""}
      ${j.estado === "EN_REVISION" ? aviso("info", "El conteo finalizó. Solo se registran los recuentos solicitados.") : ""}`;
    const alc = new Set(j.alcance), cont = new Set(j.alcance.filter((p) => !pend.includes(p)));
    el.querySelector("#mapa").innerHTML = rackHTML(pos, { alcance: alc, contadas: cont, detalle: false });
    el.querySelectorAll("#mapa [data-pos]").forEach((b) => b.addEventListener("click", () => { if (alc.has(b.dataset.pos)) elegir(b.dataset.pos, "MANUAL"); }));
    const man = el.querySelector("#man"), previo = man.value;
    man.innerHTML = `<option value="">…o elegí la posición (pendientes primero)</option>
      ${[...pend, ...j.alcance.filter((p) => !pend.includes(p))].map((p) => `<option value="${p}">${p}${pend.includes(p) ? " · pendiente" : " · contada"}</option>`).join("")}`;
    man.value = previo;
    accionesSupervisor(el.querySelector("#acciones-sup"), j, async () => { await cargar(); pintarAvance(); });
  };
  pintarAvance();
  clearInterval(temporizador);
  temporizador = setInterval(async () => { try { await cargar(); pintarAvance(); } catch { /* reintenta */ } }, 20000);

  el.querySelector("#scan").addEventListener("click", async () => {
    const r = await escanear({ titulo: "Escanear posición", sugerencias: j.alcance });
    if (r) elegir(r.texto, r.metodo);
  });
  el.querySelector("#f-man").addEventListener("submit", (e) => { e.preventDefault(); const v = el.querySelector("#man").value; if (v) elegir(v, "MANUAL"); });

  async function elegir(codigo, metodoPos) {
    elCap.innerHTML = `<span class="muted">Consultando ${esc(codigo)}…</span>`;
    let info;
    try { info = await rpc("info_posicion", { p_posicion: codigo }); } catch (e) { elCap.innerHTML = aviso("error", esc(e.message)); return; }
    if (!info.existe) { elCap.innerHTML = aviso("error", `«${esc(codigo)}» no es una posición válida. Ingresala manualmente si la etiqueta está dañada.`); return; }
    if (!j.alcance.includes(info.posicion)) { elCap.innerHTML = aviso("error", `La posición ${esc(info.posicion)} no pertenece a esta jornada.`); return; }
    formularioConteo(info, metodoPos);
  }

  function formularioConteo(info, metodoPos) {
    const lect = info.lecturas || [];
    const ult = lect.length ? Math.max(...lect.map((l) => l.lectura)) : 0;
    const esp = (info.esperado_al_corte || [])[0];
    const recuento = info.recuento_pendiente && ult > 0;
    const yaContada = ult > 0 && !recuento;
    if (j.estado === "EN_REVISION" && !recuento) {
      elCap.innerHTML = `<div class="pos-grande">${esc(info.posicion)}</div>` + aviso("alerta", "El conteo de esta jornada ya finalizó y esta posición no tiene un recuento solicitado.");
      return;
    }
    const clientId = nuevoId();
    elCap.innerHTML = `
      <div class="flex entre"><div class="pos-grande">${esc(info.posicion)}</div>
        <span class="chip ${recuento ? "info" : yaContada ? "ok" : "alerta"}">${recuento ? `Recuento · lectura ${ult + 1}` : yaContada ? `Contada (lectura ${ult})` : "Primera lectura"}</span></div>
      <div class="ficha"><dt>Esperado al corte</dt><dd>${esp ? `${esc(esp.producto)} · lote ${esc(esp.lote)}` : "Posición vacía"}</dd>
        <dt>Identificación</dt><dd>${metodoPos === "QR" ? "QR escaneado" : "Ingreso manual"}</dd></div>
      <div class="ayuda" style="margin:-4px 0 10px">Conteo a ciegas: la app no muestra la cantidad teórica. Registrá lo que <b>efectivamente</b> encontrás.</div>
      ${lect.length ? `<details style="margin-bottom:10px"><summary class="small">Lecturas anteriores (${lect.length})</summary>
        ${lect.map((l) => `<div class="small">Lectura ${l.lectura}: ${l.vacia ? "posición vacía" : `${esc(l.producto)} / ${esc(l.lote)} · ${num(l.cantidad)} un.`} · ${esc(l.usuario || "")} · ${fechaHora(l.registrado_en)}</div>`).join("")}</details>` : ""}
      ${yaContada ? aviso("alerta", "Esta posición ya tiene su lectura. Para evitar duplicados solo podés agregar <b>otro producto encontrado</b> en la misma posición. Si hace falta recontar, el supervisor debe solicitar un recuento.") : ""}
      <form id="f-conteo" novalidate>
        ${yaContada ? `<input type="hidden" id="adicional" value="1">` : `<label class="check"><input type="checkbox" id="vacia"> Posición vacía (no hay mercadería)</label>`}
        <div id="datos-prod">
          <div class="campo"><label for="c-prod">Producto encontrado</label>
            <div class="fila-input"><select id="c-prod"><option value="">Elegí…</option>
              ${estado.productos.map((p) => `<option value="${esc(p.codigo)}" ${!yaContada && esp?.producto === p.codigo ? "selected" : ""}>${esc(p.codigo)} · ${esc(p.descripcion)}</option>`).join("")}</select>
              <button class="btn" type="button" id="c-scan-prod" title="Escanear producto">${ICON.qr}</button></div>
            <div class="ayuda">${esp && !yaContada ? "Precargado con el producto esperado. Si encontrás otro, cambialo: no hace falta que coincida." : "Elegí o escaneá el producto."}</div></div>
          <div class="campo"><label for="c-lote">Lote encontrado</label>
            <input id="c-lote" type="text" autocomplete="off" autocapitalize="characters" value="${!yaContada && esp ? esc(esp.lote) : ""}" placeholder="Ej.: L0009"></div>
        </div>
        <div class="campo"><label for="c-cant">Cantidad contada</label>
          <input id="c-cant" class="grande" type="number" inputmode="numeric" min="0" step="1" placeholder="0">
          <div class="ayuda">El cero es válido: significa «contado y no hay unidades».</div></div>
        <div class="campo"><label for="c-obs">Observación (opcional)</label><input id="c-obs" type="text" maxlength="200"></div>
        <div id="c-err"></div>
        <div class="accion-fija"><button class="btn ok grande" type="submit">Guardar ${recuento ? "recuento" : yaContada ? "producto adicional" : "conteo"}</button></div>
      </form>`;
    const f = elCap.querySelector("#f-conteo");
    let metodoProd = esp && !yaContada ? "SUGERIDO" : "MANUAL";
    const selProd = f.querySelector("#c-prod"), lote = f.querySelector("#c-lote"), cant = f.querySelector("#c-cant");
    selProd.addEventListener("change", () => { metodoProd = "MANUAL"; });
    lote.addEventListener("input", () => { if (metodoProd === "SUGERIDO") metodoProd = "MANUAL"; });
    f.querySelector("#vacia")?.addEventListener("change", (e) => {
      f.querySelector("#datos-prod").classList.toggle("oculto", e.target.checked);
      if (e.target.checked) { cant.value = "0"; cant.readOnly = true; } else { cant.readOnly = false; cant.value = ""; }
    });
    f.querySelector("#c-scan-prod").addEventListener("click", async () => {
      const r = await escanear({ titulo: "Escanear producto", tipo: "producto", sugerencias: estado.productos.map((p) => p.codigo) });
      if (!r) return;
      const p = estado.productos.find((x) => x.codigo === r.texto || x.codigo_barras === r.texto);
      if (p) { selProd.value = p.codigo; metodoProd = "QR"; } else toast(`Código «${r.texto}» no corresponde a un producto`);
    });
    (esp && !yaContada ? cant : selProd).focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const vacia = f.querySelector("#vacia")?.checked || false;
      const errores = [];
      const n = cant.value === "" ? NaN : Number(cant.value);
      if (!Number.isInteger(n) || n < 0) errores.push("Ingresá la cantidad contada (entero, 0 o mayor).");
      if (!vacia) {
        if (!selProd.value) errores.push("Elegí el producto encontrado (o marcá «Posición vacía»).");
        if (!/^[A-Z0-9-]{1,20}$/.test(lote.value.trim().toUpperCase())) errores.push("Ingresá el lote encontrado.");
      }
      if (errores.length) { f.querySelector("#c-err").innerHTML = aviso("error", errores.join("<br>")); return; }
      const b = e.submitter; b.disabled = true; b.textContent = "Guardando…";
      try {
        const r = await rpc("registrar_conteo", {
          p_client_id: clientId, p_jornada_id: j.id, p_posicion: info.posicion,
          p_producto: vacia ? null : selProd.value, p_lote: vacia ? null : lote.value.trim().toUpperCase(),
          p_cantidad: n, p_vacia: vacia, p_metodo_posicion: metodoPos, p_metodo_producto: vacia ? null : metodoProd,
          p_adicional: yaContada, p_observacion: f.querySelector("#c-obs").value || null,
        });
        elCap.innerHTML = aviso("ok", `<b>${esc(info.posicion)} registrada</b> · ${vacia ? "posición vacía" : `${esc(selProd.value)} / ${esc(lote.value.toUpperCase())} · ${num(n)} un.`}<br>
            ID <span class="mono">${esc(r.id)}</span> · lectura ${r.lectura}${r.repetido ? " (ya estaba registrada; no se duplicó)" : ""}
            ${!vacia && r.coincide_con_esperado === false ? "<br>Se registró un producto o lote distinto del esperado: quedará como diferencia a revisar." : ""}`)
          + `<div id="sync-c"></div>`;
        seguirSync(elCap.querySelector("#sync-c"), r.id);
        await cargar(); pintarAvance();
      } catch (err) {
        f.querySelector("#c-err").innerHTML = aviso("error", esc(err.message));
        b.disabled = false; b.textContent = err.red ? "Reintentar (sin duplicar)" : `Guardar ${recuento ? "recuento" : yaContada ? "producto adicional" : "conteo"}`;
      }
    });
  }
}

function accionesSupervisor(cont, j, refrescar) {
  if (!puede("supervisor") || j.estado !== "ABIERTA") { cont.innerHTML = ""; return; }
  const pend = j.posiciones_pendientes || [];
  cont.innerHTML = `<div class="sep"></div><h3>Supervisor</h3>
    <p class="small muted">Al finalizar el conteo se calculan las diferencias por posición + producto + lote contra el stock teórico al corte.</p>
    <button class="btn prim" id="finalizar">Finalizar conteo${pend.length ? ` (${pend.length} pendiente/s)` : ""}</button><div id="fin-err"></div>`;
  cont.querySelector("#finalizar").addEventListener("click", async () => {
    let motivo = null;
    if (pend.length) {
      const r = await pedir({ titulo: "Cierre parcial", texto: `Faltan contar: <b>${pend.join(", ")}</b>. Para finalizar igual, indicá el motivo (quedará registrado).`,
        campos: [{ id: "motivo", etiqueta: "Motivo del cierre parcial", tipo: "textarea", requerido: true }], confirmar: "Finalizar con cierre parcial" });
      if (!r) return;
      motivo = r.motivo;
    } else if (!(await pedir({ titulo: "Finalizar conteo", texto: "Todas las posiciones tienen lectura. ¿Finalizar y calcular diferencias?", confirmar: "Finalizar" }))) return;
    try {
      await rpc("finalizar_conteo", { p_jornada_id: j.id, p_motivo_parcial: motivo });
      toast("Conteo finalizado. Diferencias calculadas.");
      location.hash = `#/conciliacion/${j.id}`;
    } catch (e) { cont.querySelector("#fin-err").innerHTML = aviso("error", esc(e.message)); await refrescar(); }
  });
}

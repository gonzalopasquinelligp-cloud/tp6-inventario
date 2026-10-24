// Ingreso por OC, egreso por venta y retorno de venta (mismo circuito de 3 pasos).
import { rpc, estado, producto } from "./api.js?v=202610241559";
import { esc, num, aviso, ICON, nuevoId, fechaHora, toast } from "./ui.js?v=202610241559";
import { escanear } from "./escaner.js?v=202610241559";
import { seguirSync } from "./componentes.js?v=202610241559";
import { MOTIVOS } from "./modelo.js?v=202610241559";

const CONF = {
  ingreso: { rpc: "registrar_ingreso", titulo: "Ingreso de mercadería", doc: "Orden de compra / documento", docPh: "Ej.: OC-2026-0154",
             verbo: "Registrar ingreso", suma: true },
  egreso: { rpc: "registrar_egreso", titulo: "Egreso por venta", doc: "Número de pedido o comprobante", docPh: "Ej.: PED-10234",
            verbo: "Registrar egreso", suma: false },
  retorno: { rpc: "registrar_retorno_motivo", titulo: "Retorno de venta", doc: "Comprobante de devolución", docPh: "Ej.: NC-0045",
             verbo: "Registrar retorno", suma: true },
};

export async function render(el, { ruta, params }) {
  const c = CONF[ruta];
  const s = { pos: null, metodoPos: null, info: null, clientId: nuevoId() };

  el.innerHTML = `
    <nav class="segmento" aria-label="Tipo de operación">
      <a href="#/ingreso" ${ruta === "ingreso" ? 'aria-current="page"' : ""}>Ingreso</a>
      <a href="#/egreso" ${ruta === "egreso" ? 'aria-current="page"' : ""}>Egreso</a>
      <a href="#/retorno" ${ruta === "retorno" ? 'aria-current="page"' : ""}>Retorno</a>
    </nav>
    <div class="panel pasos" style="max-width:640px">
      <div class="paso actual" id="p1"><h3>Posición</h3>
        <button class="btn prim grande" id="scan">${ICON.qr} Escanear QR de la posición</button>
        <form id="f-pos" class="fila-input" style="margin-top:10px">
          <select id="pos-man" aria-label="Posición manual"><option value="">…o elegí la posición manualmente</option>
            ${estado.posiciones.filter((p) => p.activa).map((p) => `<option>${esc(p.codigo)}</option>`).join("")}</select>
          <button class="btn" type="submit">Usar</button></form>
        <div id="pos-info" style="margin-top:12px"></div>
      </div>
      <div class="paso" id="p2"><h3>Producto, lote y cantidad</h3><div id="form-det" class="muted small">Primero identificá la posición.</div></div>
      <div class="paso" id="p3" style="border-left-color:transparent"><h3>Confirmación</h3><div id="res"></div></div>
    </div>`;

  const elInfo = el.querySelector("#pos-info"), elDet = el.querySelector("#form-det"), elRes = el.querySelector("#res");

  async function elegirPosicion(codigo, metodo) {
    elInfo.innerHTML = `<span class="muted">Consultando ${esc(codigo)}…</span>`; elDet.innerHTML = ""; elRes.innerHTML = "";
    let info;
    try { info = await rpc("info_posicion", { p_posicion: codigo }); }
    catch (e) { elInfo.innerHTML = aviso("error", esc(e.message)); return; }
    if (!info.existe) { elInfo.innerHTML = aviso("error", `«${esc(codigo)}» no es una posición del rack. Verificá la etiqueta o elegila de la lista.`); return; }
    s.pos = info.posicion; s.metodoPos = metodo; s.info = info; s.clientId = nuevoId();
    const cont = info.contenido[0];
    elInfo.innerHTML = `<div class="ficha"><dt>Posición</dt><dd class="pos-grande">${esc(info.posicion)}</dd>
      <dt>Contenido</dt><dd>${cont ? `${esc(cont.producto)} · ${esc(cont.descripcion)}<br>Lote ${esc(cont.lote)} · <b>${num(cont.cantidad)} un. disponibles</b>` : "Vacía"}</dd>
      <dt>Lectura</dt><dd>${metodo === "QR" ? "Escaneada (QR)" : "Ingreso manual"}</dd></div>
      <button class="btn chico" type="button" id="cambiar-pos">Cambiar posición</button>`;
    elInfo.querySelector("#cambiar-pos").addEventListener("click", () => {
      el.querySelector("#p1").classList.remove("hecho"); el.querySelector("#p1").classList.add("actual");
      el.querySelector("#p2").classList.remove("actual", "hecho"); el.querySelector("#p3").classList.remove("actual", "hecho");
      elInfo.innerHTML = ""; elDet.innerHTML = `<span class="muted small">Primero identificá la posición.</span>`; elRes.innerHTML = ""; s.pos = null;
    });
    if (!info.activa) { elInfo.innerHTML += aviso("error", "La posición está inactiva."); return; }
    if (info.jornada) {
      elInfo.innerHTML += aviso("alerta", `La posición está incluida en la jornada de conteo <b>${esc(info.jornada.codigo)}</b> (${esc(info.jornada.estado)}). No se registran movimientos hasta su cierre.`);
      return;
    }
    if (info.contenido.length > 1) elInfo.innerHTML += aviso("alerta", "La posición registra más de un producto/lote. Revisá con el supervisor.");
    el.querySelector("#p1").classList.replace("actual", "hecho");
    el.querySelector("#p2").classList.add("actual");
    formularioDetalle(cont);
  }

  function formularioDetalle(cont) {
    if (ruta === "egreso" && !cont) { elDet.innerHTML = aviso("error", "La posición está vacía: no hay stock para egresar."); return; }
    const fijo = Boolean(cont);
    elDet.innerHTML = `<form id="f-det" novalidate>
      <div class="campo"><label for="prod">Producto</label>
        ${fijo ? `<input id="prod" type="text" value="${esc(cont.producto)} · ${esc(cont.descripcion)}" readonly data-cod="${esc(cont.producto)}">
                  <div class="ayuda">${ruta === "egreso" ? "Producto almacenado en la posición." : "La posición ya contiene este producto: solo admite el mismo producto y lote."}</div>`
          : `<div class="fila-input"><select id="prod" required><option value="">Elegí un producto…</option>
              ${estado.productos.filter((p) => p.activo).map((p) => `<option value="${esc(p.codigo)}">${esc(p.codigo)} · ${esc(p.descripcion)}</option>`).join("")}</select>
              <button class="btn" type="button" id="scan-prod" title="Escanear etiqueta del producto">${ICON.qr}</button></div>`}
      </div>
      <div class="campo"><label for="lote">Lote</label>
        <input id="lote" type="text" required autocomplete="off" autocapitalize="characters" value="${fijo ? esc(cont.lote) : ""}" ${fijo ? "readonly" : ""} placeholder="Ej.: L0021"></div>
      <div class="campo"><label for="cant">Cantidad (unidades)</label>
        <input id="cant" class="grande" type="number" inputmode="numeric" min="1" step="1" ${ruta === "egreso" ? `max="${cont.cantidad}"` : ""} required>
        ${ruta === "egreso" ? `<div class="ayuda">Disponible en ${esc(s.pos)}: <b>${num(cont.cantidad)}</b> un.</div>` : ""}</div>
      <div class="campo"><label for="doc">${esc(c.doc)}</label><input id="doc" type="text" required maxlength="40" placeholder="${esc(c.docPh)}"></div>
      ${ruta === "retorno" ? `<div class="campo"><label for="motivo">Motivo del retorno</label>
        <select id="motivo" required><option value="">Elegí el motivo…</option>
          ${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join("")}</select>
        <div class="ayuda">Se usa para calcular el costo de las devoluciones.</div></div>
        <div class="campo oculto" id="campo-motivo-obs"><label for="motivo-obs">Describí el motivo</label><input id="motivo-obs" type="text" maxlength="200"></div>` : ""}
      <div class="campo"><label for="obs">Observación (opcional)</label><input id="obs" type="text" maxlength="200"></div>
      <div id="err"></div>
      <div class="accion-fija"><button class="btn prim grande" type="submit">Revisar ${esc(c.verbo.split(" ")[1])}</button></div>
    </form>`;
    const f = elDet.querySelector("#f-det");
    elDet.querySelector("#scan-prod")?.addEventListener("click", async () => {
      const r = await escanear({ titulo: "Escanear producto", tipo: "producto", sugerencias: estado.productos.map((p) => p.codigo) });
      if (!r) return;
      const p = estado.productos.find((x) => x.codigo === r.texto || x.codigo_barras === r.texto);
      if (p) f.querySelector("#prod").value = p.codigo; else toast(`Código «${r.texto}» no corresponde a un producto`);
    });
    f.querySelector("#motivo")?.addEventListener("change", (e) => f.querySelector("#campo-motivo-obs").classList.toggle("oculto", e.target.value !== "otro"));
    f.addEventListener("submit", (e) => { e.preventDefault(); validarYConfirmar(f, cont); });
    f.querySelector(fijo ? "#cant" : "#prod").focus();
  }

  function validarYConfirmar(f, cont) {
    const err = f.querySelector("#err");
    const prod = f.querySelector("#prod").dataset.cod || f.querySelector("#prod").value;
    const lote = f.querySelector("#lote").value.trim().toUpperCase();
    const cant = Number(f.querySelector("#cant").value);
    const doc = f.querySelector("#doc").value.trim();
    const obs = f.querySelector("#obs").value.trim();
    const motivo = f.querySelector("#motivo")?.value || null;
    const motivoObs = f.querySelector("#motivo-obs")?.value.trim() || "";
    const errores = [];
    if (!prod) errores.push("Elegí el producto.");
    if (!/^[A-Z0-9-]{1,20}$/.test(lote)) errores.push("Lote vacío o inválido (letras, números o guiones).");
    if (!Number.isInteger(cant) || cant <= 0) errores.push("La cantidad debe ser un número entero mayor que cero.");
    if (ruta === "egreso" && cant > cont.cantidad) errores.push(`No podés egresar ${cant}: el disponible en ${s.pos} es ${cont.cantidad}.`);
    if (!doc) errores.push(`Completá: ${c.doc}.`);
    if (ruta === "retorno" && !motivo) errores.push("Elegí el motivo del retorno.");
    if (ruta === "retorno" && motivo === "otro" && !motivoObs) errores.push("Describí el motivo del retorno.");
    if (errores.length) { err.innerHTML = aviso("error", errores.join("<br>")); return; }
    err.innerHTML = "";
    const pr = producto(prod);
    el.querySelector("#p2").classList.replace("actual", "hecho");
    el.querySelector("#p3").classList.add("actual");
    const nuevo = cont ? cont.cantidad + (c.suma ? cant : -cant) : cant;
    elRes.innerHTML = `<div class="ficha">
      <dt>Operación</dt><dd>${esc(c.titulo)}</dd><dt>Posición</dt><dd>${esc(s.pos)}</dd>
      <dt>Producto</dt><dd>${esc(prod)} · ${esc(pr?.descripcion || "")}</dd><dt>Lote</dt><dd>${esc(lote)}</dd>
      <dt>Cantidad</dt><dd>${c.suma ? "+" : "−"}${num(cant)} un.</dd><dt>Documento</dt><dd>${esc(doc)}</dd>
      ${motivo ? `<dt>Motivo</dt><dd>${esc(MOTIVOS[motivo])}${motivoObs ? ` · ${esc(motivoObs)}` : ""}</dd>` : ""}
      <dt>Saldo estimado</dt><dd>${num(cont?.cantidad || 0)} → ${num(nuevo)} un.</dd></div>
      <div id="envio"></div>
      <div class="accion-fija btns"><button class="btn ok grande" id="confirmar">${esc(c.verbo)}</button><button class="btn" id="corregir">Corregir datos</button></div>`;
    elRes.querySelector("#corregir").addEventListener("click", () => {
      elRes.innerHTML = ""; el.querySelector("#p3").classList.remove("actual"); el.querySelector("#p2").classList.replace("hecho", "actual");
    });
    elRes.querySelector("#confirmar").addEventListener("click", (e) => enviar(e.currentTarget, { prod, lote, cant, doc, obs, motivo, motivoObs }));
  }

  async function enviar(boton, d) {
    const envio = elRes.querySelector("#envio");
    boton.disabled = true; boton.textContent = "Guardando…";
    try {
      const r = await rpc(c.rpc, { p_client_id: s.clientId, p_posicion: s.pos, p_producto: d.prod, p_lote: d.lote,
                                   p_cantidad: d.cant, p_documento: d.doc, p_observacion: d.obs || null,
                                   ...(ruta === "retorno" ? { p_motivo: d.motivo, p_motivo_obs: d.motivoObs || null } : {}) });
      el.querySelector("#p3").classList.replace("actual", "hecho");
      elRes.innerHTML = aviso("ok", `<b>Operación guardada${r.repetido ? " (ya estaba registrada; no se duplicó)" : ""}.</b><br>
          ID <span class="mono">${esc(r.id)}</span> · ${esc(r.tipo)} · ${esc(r.posicion)} · ${esc(r.producto)}/${esc(r.lote)} · ${r.cantidad > 0 ? "+" : ""}${num(r.cantidad)} un.<br>
          Saldo actual de la posición: <b>${num(r.saldo_posicion)}</b> un. · Fecha contable ${fechaHora(r.fecha_contable)}`)
        + `<div id="sync-est" style="margin-bottom:12px"></div>
          <div class="btns"><a class="btn prim" href="#/${ruta}/nuevo-${Date.now()}">Nueva operación</a><a class="btn" href="#/consulta/${esc(r.posicion)}">Ver posición</a></div>`;
      seguirSync(elRes.querySelector("#sync-est"), r.id);
    } catch (e) {
      envio.innerHTML = aviso("error", esc(e.message));
      boton.disabled = false; boton.textContent = e.red ? "Reintentar (sin duplicar)" : c.verbo;
    }
  }

  el.querySelector("#scan").addEventListener("click", async () => {
    const r = await escanear({ titulo: "Escanear posición", sugerencias: estado.posiciones.map((p) => p.codigo) });
    if (r) elegirPosicion(r.texto, r.metodo);
  });
  el.querySelector("#f-pos").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = el.querySelector("#pos-man").value;
    if (v) elegirPosicion(v, "MANUAL");
  });
  if (params[0] && /^[A-Z][0-9]{1,2}$/i.test(params[0])) elegirPosicion(params[0].toUpperCase(), "MANUAL");
}

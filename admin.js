// Administración: usuarios y roles, productos, posiciones, QR y fecha operativa.
import { rpc, leer, estado, cargarMaestros } from "./api.js?v=202610241559";
import { esc, aviso, ICON, fechaHora, tabla, pedir, toast } from "./ui.js?v=202610241559";

export async function render(el) {
  const [usuarios, cfg, audit] = await Promise.all([
    leer("perfiles", (q) => q.order("creado_en")),
    leer("config"),
    leer("auditoria", (q) => q.order("id", { ascending: false }).limit(40)),
  ]);
  const desf = cfg.find((c) => c.clave === "desfase_simulacion")?.valor || "0";
  el.innerHTML = `
    <div id="msg"></div>
    <div class="panel"><div class="panel-cab"><h2>Usuarios y roles</h2></div>
      <p class="small muted">Las contraseñas las administra Supabase Auth (cifradas; nunca pasan por esta app ni por Google Sheets).
      Alta de usuarios: el usuario se registra desde la pantalla de ingreso o se crea en Supabase › Authentication. Acá se activa y se asigna el rol.</p>
      ${tabla([{ t: "Nombre", html: (u) => `<b>${esc(u.nombre)}</b>` }, { t: "Correo", html: (u) => `<span class="small">${esc(u.email)}</span>` },
        { t: "Rol", html: (u) => `<select data-rol="${u.id}" ${u.id === estado.perfil.id ? "disabled" : ""}>${["operario", "supervisor", "administrador"].map((r) => `<option ${r === u.rol ? "selected" : ""}>${r}</option>`).join("")}</select>` },
        { t: "Activo", html: (u) => `<label class="check"><input type="checkbox" data-act="${u.id}" ${u.activo ? "checked" : ""} ${u.id === estado.perfil.id ? "disabled" : ""}> ${u.activo ? "Sí" : "No"}</label>` },
        { t: "Alta", html: (u) => fechaHora(u.creado_en) }], usuarios)}
      <div class="small muted" style="margin-top:8px"><b>Operario:</b> consulta, ingresos, egresos, retornos y conteos. <b>Supervisor:</b> además abre/cierra jornadas, pide recuentos, aprueba ajustes. <b>Administrador:</b> además usuarios y datos maestros.</div>
    </div>
    <div class="panel"><div class="panel-cab"><h2>Productos</h2><button class="btn chico" id="nuevo-prod">${ICON.mas} Nuevo producto</button></div>
      ${tabla([{ t: "Código", html: (p) => `<b>${esc(p.codigo)}</b>` }, { t: "Descripción", k: "descripcion" }, { t: "Unidad", k: "unidad" },
        { t: "Código de barras / QR", html: (p) => `<span class="mono">${esc(p.codigo_barras || "")}</span>` },
        { t: "Estado", html: (p) => p.activo ? `<span class="chip ok">Activo</span>` : `<span class="chip">Inactivo</span>` },
        { t: "", html: (p) => `<button class="btn chico" data-edit="${esc(p.codigo)}">Editar</button>` }], estado.productos)}
    </div>
    <div class="panel"><div class="panel-cab"><h2>Posiciones del rack</h2>
      <div class="btns"><a class="btn chico" href="QR_posiciones_A1-G4.pdf" target="_blank">${ICON.qr} QR de posiciones (PDF)</a>
      <a class="btn chico" href="QR_productos.pdf" target="_blank">${ICON.qr} Etiquetas de productos (PDF)</a></div></div>
      <div class="flex">${estado.posiciones.map((p) => `<label class="check" style="min-width:74px"><input type="checkbox" data-pos="${esc(p.codigo)}" ${p.activa ? "checked" : ""}> ${esc(p.codigo)}</label>`).join("")}</div>
      <div class="ayuda">Desmarcar = desactivar (solo si la posición no tiene stock).</div>
    </div>
    <div class="panel"><h2>Fecha operativa</h2>
      <p class="small">La fecha contable de cada operación es la hora real más este desfase. Con desfase 0 la app usa la fecha real; el desfase solo se usa para cargar operaciones en una fecha posterior a la real.
      Desfase actual: <span class="mono">${esc(desf)}</span> · fecha contable ahora: <b>${fechaHora(new Date(Date.now() + estado.relojOffsetMs))}</b>. La hora real de registro se guarda siempre aparte.</p>
      <button class="btn chico" id="desfase">Cambiar desfase</button></div>
    <div class="panel"><h2>Auditoría reciente</h2>
      ${tabla([{ t: "Fecha real", html: (a) => fechaHora(a.ocurrido_en) }, { t: "Usuario", html: (a) => `<span class="small">${esc(a.usuario_email || "")}</span>` },
        { t: "Acción", k: "accion" }, { t: "Registro", html: (a) => `<span class="mono small">${esc(a.entidad_id || "")}</span>` },
        { t: "Detalle", html: (a) => `<span class="small mono">${esc(JSON.stringify(a.detalle || {})).slice(0, 140)}</span>` }], audit)}</div>`;

  const msg = el.querySelector("#msg");
  const recargar = async () => { await cargarMaestros(); await render(el); };
  const fallo = (e) => { msg.innerHTML = aviso("error", esc(e.message)); window.scrollTo(0, 0); };

  const guardarUsuario = async (id) => {
    const rol = el.querySelector(`[data-rol="${id}"]`).value, act = el.querySelector(`[data-act="${id}"]`).checked;
    try { await rpc("admin_actualizar_usuario", { p_id: id, p_rol: rol, p_activo: act }); toast("Usuario actualizado"); await recargar(); } catch (e) { fallo(e); await recargar(); }
  };
  el.querySelectorAll("[data-rol]").forEach((s) => s.addEventListener("change", () => guardarUsuario(s.dataset.rol)));
  el.querySelectorAll("[data-act]").forEach((s) => s.addEventListener("change", () => guardarUsuario(s.dataset.act)));

  const editarProducto = async (p) => {
    const r = await pedir({ titulo: p ? `Editar ${p.codigo}` : "Nuevo producto", campos: [
      { id: "codigo", etiqueta: "Código", valor: p?.codigo || "", requerido: true, placeholder: "PROD011", ayuda: p ? "El código no se puede cambiar." : "" },
      { id: "descripcion", etiqueta: "Descripción", valor: p?.descripcion || "", requerido: true },
      { id: "unidad", etiqueta: "Unidad", valor: p?.unidad || "UN" },
      { id: "barras", etiqueta: "Código de barras / QR de la etiqueta", valor: p?.codigo_barras || "" },
      { id: "activo", etiqueta: "Estado", tipo: "select", opciones: [{ v: "true", t: "Activo" }, { v: "false", t: "Inactivo" }] }], confirmar: "Guardar" });
    if (!r) return;
    try {
      await rpc("admin_guardar_producto", { p_codigo: p ? p.codigo : r.codigo, p_descripcion: r.descripcion, p_unidad: r.unidad, p_codigo_barras: r.barras || null, p_activo: r.activo === "true" });
      toast("Producto guardado"); await recargar();
    } catch (e) { fallo(e); }
  };
  el.querySelector("#nuevo-prod").addEventListener("click", () => editarProducto(null));
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editarProducto(estado.productos.find((p) => p.codigo === b.dataset.edit))));
  el.querySelectorAll("[data-pos]").forEach((c) => c.addEventListener("change", async () => {
    try { await rpc("admin_guardar_posicion", { p_codigo: c.dataset.pos, p_activa: c.checked }); toast(`Posición ${c.dataset.pos} actualizada`); await recargar(); }
    catch (e) { fallo(e); c.checked = !c.checked; }
  }));
  el.querySelector("#desfase").addEventListener("click", async () => {
    const r = await pedir({ titulo: "Desfase de la fecha contable", texto: "Formato PostgreSQL, p. ej. <span class='mono'>0</span>, <span class='mono'>17 days 09:30:00</span>. No puede dejar la fecha contable antes del último registro.",
      campos: [{ id: "d", etiqueta: "Desfase", valor: desf, requerido: true }], confirmar: "Guardar" });
    if (!r) return;
    try { await rpc("admin_set_desfase", { p_desfase: r.d }); toast("Desfase actualizado"); location.reload(); } catch (e) { fallo(e); }
  });
}

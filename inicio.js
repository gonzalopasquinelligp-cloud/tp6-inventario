import { leer, puede, estado } from "./api.js?v=202610242329";
import { esc, num, signo, claseSigno, fechaHora, ICON, tabla, chip, ESTADOS_JORNADA } from "./ui.js?v=202610242329";
import { rackHTML } from "./componentes.js?v=202610242329";

export async function render(el) {
  const [pos, jornadas, sync, movs, pendientes] = await Promise.all([
    leer("v_posiciones_estado", (q) => q.order("posicion")),
    leer("v_jornadas", (q) => q.in("estado", ["ABIERTA", "EN_REVISION"]).order("id")),
    leer("v_sync_resumen"),
    leer("v_movimientos", (q) => q.order("id", { ascending: false }).limit(8)),
    leer("v_diferencias", (q) => q.neq("diferencia", 0).in("jornada_estado", ["ABIERTA", "EN_REVISION"])
      .not("estado_revision", "in", "(AJUSTE_APROBADO,JUSTIFICADA_SIN_AJUSTE)"), "id"),
  ]);
  const ocupadas = pos.filter((p) => p.estado === "Ocupada");
  const total = ocupadas.reduce((a, p) => a + p.cantidad, 0);
  const s = sync[0] || {};

  el.innerHTML = `
    <div class="acciones" style="margin-bottom:16px">
      <a class="accion" href="#/consulta"><div class="ic">${ICON.buscar}</div><b>Consultar</b><span>Stock por código, lote o posición</span></a>
      <a class="accion" href="#/ingreso"><div class="ic">${ICON.ingreso}</div><b>Ingreso</b><span>Mercadería por orden de compra</span></a>
      <a class="accion" href="#/egreso"><div class="ic">${ICON.egreso}</div><b>Egreso</b><span>Salida por venta</span></a>
      <a class="accion" href="#/conteo"><div class="ic">${ICON.conteo}</div><b>Conteo cíclico</b><span>${jornadas.filter((j) => j.estado === "ABIERTA").length} jornada(s) abierta(s)</span></a>
    </div>
    ${puede("supervisor") ? `<div class="btns" style="margin-bottom:16px"><a class="btn" href="#/gestion">${ICON.tablero} Tablero de gestión</a><a class="btn" href="#/costos">${ICON.costo} Costo y servicio</a></div>` : ""}
    <div class="grilla g4" style="margin-bottom:16px">
      <div class="kpi"><div class="etq">Stock disponible</div><div class="val">${num(total)}</div><div class="sub">unidades teóricas (libro)</div></div>
      <div class="kpi"><div class="etq">Posiciones ocupadas</div><div class="val">${ocupadas.length} / ${pos.length}</div><div class="sub">${pos.length - ocupadas.length} vacías</div></div>
      <div class="kpi ${pendientes.length ? "neg" : ""}"><div class="etq">Diferencias a revisar</div><div class="val">${pendientes.length}</div><div class="sub">en jornadas sin cerrar</div></div>
      <div class="kpi ${s.pendientes ? "" : "pos"}"><div class="etq">Google Sheets</div><div class="val">${s.pendientes ? s.pendientes + " pend." : "Al día"}</div>
        <div class="sub">última: ${fechaHora(s.ultima_sincronizacion)}</div></div>
    </div>
    <div class="grilla g2">
      <div class="panel"><div class="panel-cab"><h2>Mapa del rack</h2><a class="btn chico" href="#/consulta">Ver detalle</a></div>
        <div id="rack">${rackHTML(pos)}</div></div>
      <div>
        <div class="panel"><div class="panel-cab"><h2>Jornadas en curso</h2>${puede("supervisor") ? `<a class="btn chico" href="#/conteo">Nueva jornada</a>` : ""}</div>
          ${tabla([
            { t: "Jornada", html: (j) => `<a href="#/${j.estado === "ABIERTA" ? "conteo" : "conciliacion"}/${j.id}">${esc(j.codigo)}</a>` },
            { t: "Estado", html: (j) => chip(ESTADOS_JORNADA, j.estado) },
            { t: "Avance", html: (j) => j.tipo === "CICLICA" ? `${j.posiciones_contadas}/${j.total_posiciones}` : "Referencia" },
            { t: "Dif. sin resolver", num: true, html: (j) => num(j.diferencias_sin_resolver) },
          ], jornadas, { vacio: "No hay jornadas abiertas ni en revisión." })}
        </div>
        <div class="panel"><div class="panel-cab"><h2>Últimos movimientos</h2><a class="btn chico" href="#/informes">Historial</a></div>
          ${tabla([
            { t: "ID", html: (m) => `<span class="mono small">${esc(m.id_publico)}</span>` },
            { t: "Tipo", k: "tipo" },
            { t: "Pos.", k: "posicion" },
            { t: "Producto / lote", html: (m) => `${esc(m.producto)} · ${esc(m.lote)}` },
            { t: "Cant.", num: true, html: (m) => `<span class="${claseSigno(m.cantidad)}">${signo(m.cantidad)}</span>` },
          ], movs)}
        </div>
      </div>
    </div>`;
  el.querySelectorAll("#rack [data-pos]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/consulta/${b.dataset.pos}`; }));
}
